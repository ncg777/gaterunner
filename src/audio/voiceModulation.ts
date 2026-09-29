import * as Tone from 'tone';
import { compileModulation, emptyModulationValues, type ModulationSettings, type ModulationTime, type ModulationValues } from './modulation';

const INTERVAL = 1 / 200;
type Event = { time: number; type: 'attack' | 'release' };
/** One clock listener per active voice, independent of how many sources/routes it owns. */
export class VoiceModulation {
  readonly gain: Tone.Gain;
  readonly pan: Tone.Panner;
  private pitch: Tone.Signal;
  private cutoff: Tone.Signal;
  private matrix = compileModulation({ sources: [], routes: [] });
  private values = emptyModulationValues();
  private events: Event[] = [];
  private nextTime = 0;
  private listening = false;
  private songStarts: number[];
  private baseQ = 1;
  private baseGain = 0;
  private readonly tick = () => this.schedule();
  private readonly songStart = (time: number) => {
    this.songStarts.push(time);
    this.refresh(time);
  };

  constructor(private context: Tone.BaseContext, detune: Tone.Signal<'cents'>,
    private filter: Tone.Filter, private isActive: () => boolean,
    private spectral?: { write(v: ModulationValues, t: ModulationTime, ramp: boolean): void; refresh(time: number): void; needsClock?(): boolean }) {
    this.gain = new Tone.Gain({ context, gain: Math.SQRT2 });
    this.pan = new Tone.Panner({ context, pan: 0 });
    this.gain.connect(this.pan);
    this.pitch = new Tone.Signal({ context, value: 0 });
    this.cutoff = new Tone.Signal({ context, value: 0 });
    // Bypass Signal.connect's override behavior: sum with the existing pitch/filter buses.
    Tone.connect(this.pitch, detune);
    Tone.connect(this.cutoff, filter.detune);
    const now = context.now();
    this.songStarts = [context.transport.state === 'started' ? now - context.transport.getSecondsAtTime(now) : 0];
    context.transport.on('start', this.songStart);
  }

  set(settings: ModulationSettings, q: number, gain: number): void {
    this.matrix = compileModulation(settings);
    this.baseQ = q;
    this.baseGain = gain;
    this.refresh(this.context.now());
  }

  attack(time: number): void { this.add({ time, type: 'attack' }); }
  release(time: number): void { this.add({ time, type: 'release' }); }
  private add(event: Event): void {
    this.events.push(event);
    this.events.sort((a, b) => a.time - b.time);
    this.refresh(event.time);
  }
  cancel(time: number): void {
    this.events = this.events.filter(e => e.time < time);
    this.refresh(time);
  }
  reset(time: number): void { this.events = []; this.refresh(time); }

  private parameters() { return [this.pitch, this.cutoff, this.gain.gain, this.pan.pan, this.filter.Q, this.filter.gain]; }
  private write(time: number, ramp: boolean): void {
    let noteStart: number | undefined, releaseTime: number | undefined;
    for (const event of this.events) {
      if (event.time > time + 1e-9) break;
      if (event.type === 'attack') { noteStart = event.time; releaseTime = undefined; }
      else releaseTime = event.time;
    }
    const v = this.values;
    const timing = { time, noteStart: noteStart ?? time, releaseTime,
      songStart: this.songStarts.reduce((origin, t) => t <= time ? t : origin, 0),
      bpm: this.context.transport.bpm.getValueAtTime(time) };
    if (noteStart === undefined) Object.assign(v, emptyModulationValues());
    else this.matrix.sample(timing, v);
    this.spectral?.write(v, timing, ramp);
    const values = [v.pitch * 100, v.cutoff * 100, Math.SQRT2 * 10 ** (v.level / 20), v.pan,
      Math.max(0.0001, Math.min(30, this.baseQ + v.resonance)), Math.max(-48, Math.min(48, this.baseGain + v.filterGain))];
    this.parameters().forEach((p, i) => ramp ? p.linearRampToValueAtTime(values[i], time) : p.setValueAtTime(values[i], time));
  }
  private refresh(time: number): void {
    time = Math.max(this.context.currentTime, Math.min(time, this.context.now()));
    this.parameters().forEach(p => p.cancelAndHoldAtTime(time));
    this.spectral?.refresh(time);
    this.write(time, false);
    this.nextTime = time + INTERVAL;
    if ((this.matrix.active || this.spectral?.needsClock?.()) && (this.context.isOffline || this.isActive())) {
      if (!this.listening) { this.context.on('tick', this.tick); this.listening = true; }
      this.schedule();
    } else this.pause();
  }
  private schedule(): void {
    if (!this.context.isOffline && (this.context.state === 'suspended' || !this.isActive())) { this.pause(); return; }
    const end = this.context.now() + INTERVAL * 2;
    while (this.nextTime <= end) {
      // Insert exact note boundaries as well as regular control samples.
      for (const e of this.events) if (e.time > this.nextTime - INTERVAL && e.time < this.nextTime) this.write(e.time, true);
      this.write(this.nextTime, true);
      this.nextTime += INTERVAL;
    }
    // Preserve the latest attack and all future reservations for pooled/offline voices.
    let last = -1;
    this.events.forEach((e, i) => { if (e.type === 'attack' && e.time <= this.context.currentTime) last = i; });
    if (last > 0) this.events.splice(0, last);
    while (this.songStarts.length > 1 && this.songStarts[1] <= this.context.currentTime) this.songStarts.shift();
  }
  private pause(): void { this.context.off('tick', this.tick); this.listening = false; }
  dispose(): void {
    this.pause();
    this.context.transport.off('start', this.songStart);
    this.pitch.dispose(); this.cutoff.dispose(); this.gain.dispose(); this.pan.dispose();
  }
}

