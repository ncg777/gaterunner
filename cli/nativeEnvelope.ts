import { buildPitchEnvelopeCurve, type PitchEnvelopeParams } from '../src/audio/pitchEnvelope.js';

/** Tone.Param's target approach, with its final ten percent linear ramp. */
export function targetApproach(from: number, to: number, elapsed: number, duration: number): number {
  if (elapsed <= 0) return from;
  if (elapsed >= duration || duration <= 0) return to;
  const constant = Math.log1p(duration) / Math.log(200);
  const approach = (time: number) => to + (from - to) * Math.exp(-time / constant);
  if (elapsed < duration * 0.9) return approach(elapsed);
  return to + (approach(duration * 0.9) - to) * (duration - elapsed) / (duration * 0.1);
}

export interface NativeEnvelope {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export function sampleAmplitudeEnvelope(elapsed: number, duration: number, envelope: NativeEnvelope): number {
  const attack = Math.max(0.005, envelope.attack);
  const decay = Math.max(0.005, envelope.decay);
  const release = Math.max(0.005, envelope.release);
  const held = Math.min(Math.max(0, elapsed), Math.max(0, duration));
  const level = held < attack ? targetApproach(0, 1, held, attack)
    : targetApproach(1, envelope.sustain, held - attack, decay);
  return elapsed > duration ? targetApproach(level, 0, elapsed - duration, release) : level;
}

function sampleCurve(curve: number[], progress: number): number {
  const position = Math.min(1, Math.max(0, progress)) * (curve.length - 1);
  const index = Math.floor(position);
  return curve[index] + ((curve[index + 1] ?? curve[index]) - curve[index]) * (position - index);
}

/** Custom pitch attacks/releases and exponential decays follow PitchEnvelopeSynth. */
export function createNativePitchEnvelope(track: PitchEnvelopeParams, startTime = 0,
  sampleRate = 48000): (elapsed: number, duration: number) => number {
  const attack = Math.max(0.005, track.pitchEnvelopeAttack);
  const decay = Math.max(0.005, track.pitchEnvelopeDecay);
  const release = Math.max(0.005, track.pitchEnvelopeRelease);
  const shaped = track.pitchEnvelopeShape >= 1e-6;
  const curve = buildPitchEnvelopeCurve(track.pitchEnvelopeShape);
  // Envelope.triggerAttack slices from the first sample above its current level.
  const attackCurve = shaped ? [0, ...curve.slice(2)] : curve;
  const decayStartLevel = shaped && attack > 0 ? sampleCurve(attackCurve,
    (Math.floor((startTime + attack) * sampleRate) / sampleRate - startTime) / attack) : 1;
  const reverse = curve.slice().reverse();
  return (elapsed, duration) => {
    const held = Math.min(Math.max(0, elapsed), Math.max(0, duration));
    const level = held < attack ? sampleCurve(attackCurve, held / attack)
      : shaped ? targetApproach(decayStartLevel, track.pitchEnvelopeSustain, held - attack, decay)
        : 1 + (track.pitchEnvelopeSustain - 1) * Math.min(1, (held - attack) / decay);
    return elapsed > duration ? level * sampleCurve(reverse, (elapsed - duration) / release) : level;
  };
}

/** Per-oscillator Unison gain, matching the browser voice bus. */
export function nativeUnisonGain(count: number): number {
  return count > 1 ? 10 ** ((-6 - count * 1.1) / 20) : 1;
}
