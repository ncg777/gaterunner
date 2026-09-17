import { buildPitchEnvelopeCurve, type PitchEnvelopeParams } from '../src/audio/pitchEnvelope.js';
import type { NativeEnvelope } from './nativeEnvelope.js';
import type { NativeVoiceEvent } from './nativeVoices.js';

interface Event { time: number; value: number; type: 'set' | 'linear' | 'target'; constant?: number }
type Settings = NativeEnvelope & PitchEnvelopeParams & { monoLegato?: boolean };
const EPSILON = 1e-7;

/** Offline counterpart of Tone.Envelope/Param scheduling, including cancellation. */
export class NativeEnvelopeAutomation {
  private events: Event[] = [];
  private attackTime: number;
  private decayTime: number;
  private releaseTime: number;
  private sustain: number;
  private curve: number[] | undefined;

  constructor(settings: Settings, private kind: 'amplitude' | 'pitch', private sampleRate = 48000) {
    const pitch = kind === 'pitch';
    this.attackTime = Math.max(0.005, pitch ? settings.pitchEnvelopeAttack : settings.attack);
    this.decayTime = Math.max(0.005, pitch ? settings.pitchEnvelopeDecay : settings.decay);
    this.releaseTime = Math.max(0.005, pitch ? settings.pitchEnvelopeRelease : settings.release);
    this.sustain = pitch ? settings.pitchEnvelopeSustain : settings.sustain;
    this.curve = pitch && settings.pitchEnvelopeShape >= 1e-6 ? buildPitchEnvelopeCurve(settings.pitchEnvelopeShape) : undefined;
  }

  private indexAt(time: number): number {
    let low = 0, high = this.events.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.events[middle].time <= time) low = middle + 1;
      else high = middle;
    }
    return low - 1;
  }

  private add(event: Event) {
    const index = this.indexAt(event.time) + 1;
    this.events.splice(index, 0, event);
  }

  /** cancel() leaves an already-started target running, and removes future ramp endpoints. */
  cancel(time: number) {
    let index = this.indexAt(time);
    while (index >= 0 && Math.abs(this.events[index].time - time) < EPSILON) index--;
    this.events.length = index + 1;
  }

  private valueAt(time: number, audio = false): number {
    const index = this.indexAt(Math.max(0, time));
    if (index < 0) return 0;
    const before = this.events[index], after = this.events[index + 1];
    let value = before.value;
    let previousValue = this.events[index - 1]?.value ?? 0;
    if (audio && before.type === 'target') {
      const previous = this.events[index - 1], rampStart = this.events[index - 2];
      if (previous?.type === 'linear' && rampStart && previous.time > rampStart.time) {
        const position = Math.max(0, Math.min(1,
          (Math.floor(before.time * this.sampleRate) / this.sampleRate - rampStart.time) / (previous.time - rampStart.time)));
        previousValue = rampStart.value + (previous.value - rampStart.value) * position;
      }
    }
    if (before.type === 'target' && (!after || after.type === 'set')) {
      value = before.value + (previousValue - before.value) * Math.exp(-(time - before.time) / before.constant!);
    } else if (after?.type === 'linear') {
      const from = before.type === 'target' ? previousValue : before.value;
      value = from + (after.value - from) * (time - before.time) / (after.time - before.time);
    }
    return value;
  }

  sample(time: number): number { return this.valueAt(time, true); }

  private hold(time: number) {
    const value = this.valueAt(time);
    const index = this.indexAt(time), before = this.events[index], after = this.events[index + 1];
    if (before && Math.abs(before.time - time) < EPSILON) {
      this.cancel(after?.time ?? time + 1 / this.sampleRate);
    } else if (after) {
      this.cancel(after.time);
      if (after.type === 'linear') this.add({ type: 'linear', value, time });
    }
    this.add({ type: 'set', value, time });
  }

  private rampPoint(time: number) {
    const value = this.valueAt(time);
    this.hold(time);
    this.add({ type: 'set', value: value || 1e-7, time });
  }

  private approach(value: number, time: number, duration: number) {
    this.add({ type: 'target', value, time, constant: Math.log1p(duration) / Math.log(200) });
    this.hold(time + duration * 0.9);
    this.add({ type: 'linear', value, time: time + duration });
  }

  private setCurve(curve: number[], time: number, duration: number, scale = 1) {
    this.add({ type: 'set', value: curve[0] * scale, time });
    const step = duration / (curve.length - 1);
    for (let index = 1; index < curve.length; index++) {
      this.add({ type: 'linear', value: curve[index] * scale, time: time + index * step });
    }
  }

  attack(time: number, velocity = 1) {
    if (this.kind === 'pitch') velocity = 1;
    const current = this.valueAt(time);
    const attack = this.attackTime * (1 - current);
    if (attack < 1 / this.sampleRate) {
      this.cancel(time);
      this.add({ type: 'set', value: velocity, time });
    } else if (this.curve) {
      this.hold(time);
      let curve = this.curve;
      for (let index = 1; index < curve.length; index++) {
        if (curve[index - 1] <= current && current <= curve[index]) {
          curve = curve.slice(index);
          curve[0] = current;
          break;
        }
      }
      this.setCurve(curve, time, attack, velocity);
    } else {
      this.rampPoint(time);
      if (this.kind === 'amplitude') this.approach(velocity, time, attack);
      else this.add({ type: 'linear', value: velocity, time: time + attack });
    }
    if (this.sustain < 1) {
      const value = velocity * this.sustain, start = time + attack;
      if (this.kind === 'amplitude' || this.curve) this.approach(value, start, this.decayTime);
      else this.add({ type: 'linear', value, time: start + this.decayTime });
    }
  }

  release(time: number) {
    const current = this.valueAt(time);
    if (current <= 0) return;
    if (this.curve) {
      this.hold(time);
      this.setCurve(this.curve.slice().reverse(), time, this.releaseTime, current);
    } else {
      this.rampPoint(time);
      if (this.kind === 'amplitude') this.approach(0, time, this.releaseTime);
      else this.add({ type: 'linear', value: 0, time: time + this.releaseTime });
    }
  }
}

export function prepareNativeMonoEnvelopes(events: readonly NativeVoiceEvent[], settings: Settings, sampleRate: number) {
  const amplitude = new NativeEnvelopeAutomation(settings, 'amplitude', sampleRate);
  const pitch = new NativeEnvelopeAutomation(settings, 'pitch', sampleRate);
  for (const event of events) {
    if (!event.notes.length) continue;
    if (event.legato && settings.monoLegato) {
      amplitude.cancel(event.time);
      pitch.cancel(event.time);
    } else {
      amplitude.attack(event.time, event.velocity);
      pitch.attack(event.time);
    }
    amplitude.release(event.time + event.duration);
    pitch.release(event.time + event.duration);
  }
  return { amplitude, pitch };
}
