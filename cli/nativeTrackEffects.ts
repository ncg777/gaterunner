import { normalizePresetTrackData, PHASER_MAX_SWEEP_OCTAVES, type PresetTrackData } from '../src/presets.js';
import { getLfoSyncRateHz } from '../src/audio/lfo.js';

// Use the preset schema for every setting formerly omitted by the native renderer.
const effectKeys = [
  'phase', 'tremoloSpread', 'filterRolloff', 'filterLfoEnabled', 'filterLfoSync',
  'filterLfoRateHz', 'filterLfoRate', 'filterLfoAmount', 'filterLfoWaveform', 'filterLfoInitPhase',
  'filterLfoRetrigger',
  'chorusEnabled', 'chorusRate', 'chorusDelay', 'chorusDepth', 'chorusSpread', 'chorusFeedback', 'chorusWet',
  'flangerEnabled', 'flangerRate', 'flangerDelay', 'flangerDepth', 'flangerFeedback', 'flangerWet',
  'phaserEnabled', 'phaserRate', 'phaserCenter', 'phaserDepth', 'phaserStages', 'phaserFeedback', 'phaserQ', 'phaserWet',
] as const satisfies readonly (keyof PresetTrackData)[];

export type NativeEffectSettings = Pick<PresetTrackData, typeof effectKeys[number]>;

export function normalizeNativeEffectSettings(value: unknown): NativeEffectSettings {
  const normalized = normalizePresetTrackData(value);
  return Object.fromEntries(effectKeys.map(key => [key, normalized[key]])) as NativeEffectSettings;
}

type TrackEffects = NativeEffectSettings & Pick<PresetTrackData,
  'vibratoEnabled' | 'vibratoFrequency' | 'vibratoDepth' |
  'tremoloEnabled' | 'tremoloFrequency' | 'tremoloDepth' |
  'echoEnabled' | 'echoFeedback' | 'echoWet' | 'echoPingPong'>;

function wetMix(db: number): [number, number] {
  const wet = db <= -96 ? 0 : Math.min(1, 10 ** (db / 20));
  return [Math.cos(wet * Math.PI / 2), Math.sin(wet * Math.PI / 2)];
}

/** A fractional delay line with private feedback, independent of the output mix. */
export function createDelayLine(sampleRate: number, maxDelay: number, cyclic = false) {
  const buffer = new Float32Array(Math.max(cyclic ? 128 : 0, Math.ceil(sampleRate * maxDelay)) + 2);
  let cursor = 0;
  const feedbackHistory = new Float32Array(128);
  let feedbackCursor = 0;
  return (input: number, delaySeconds: number, feedback = 0): number => {
    const delay = Math.max(cyclic ? 128 : 0, Math.min(buffer.length - 2, delaySeconds * sampleRate));
    // Include the current input for the sub-sample, feed-forward case.
    buffer[cursor] = input + feedbackHistory[feedbackCursor] * feedback;
    const position = (cursor - delay + buffer.length) % buffer.length;
    const index = Math.floor(position);
    const fraction = position - index;
    const output = buffer[index] * (1 - fraction) + buffer[(index + 1) % buffer.length] * fraction;
    feedbackHistory[feedbackCursor] = output;
    feedbackCursor = (feedbackCursor + 1) % 128;
    cursor = (cursor + 1) % buffer.length;
    return output;
  };
}

function applyDelayEffect(left: Float32Array, right: Float32Array, sampleRate: number,
  delayAtTime: (time: number, channel: number) => number, maxDelay: number, feedback: number, mix: [number, number], cyclic = true): void {
  const delays = [createDelayLine(sampleRate, maxDelay, cyclic), createDelayLine(sampleRate, maxDelay, cyclic)];
  for (let frame = 0; frame < left.length; frame++) {
    const time = frame / sampleRate;
    const wetLeft = delays[0](left[frame], delayAtTime(time, 0), feedback);
    const wetRight = delays[1](right[frame], delayAtTime(time, 1), feedback);
    left[frame] = left[frame] * mix[0] + wetLeft * mix[1];
    right[frame] = right[frame] * mix[0] + wetRight * mix[1];
  }
}

/** Native equivalents of the browser's post-distortion modulation chain, in routing order. */
export function applyNativeTrackEffects(left: Float32Array, right: Float32Array, track: TrackEffects,
  sampleRate: number, bpm: number, a4: number): void {
  if (track.vibratoEnabled) {
    // Tone.Vibrato modulates a 5 ms delay; depth scales the bipolar LFO, not pitch in semitones.
    applyDelayEffect(left, right, sampleRate,
      time => 0.0025 * (1 + track.vibratoDepth * Math.cos(2 * Math.PI * track.vibratoFrequency * time)),
      0.005, 0, [0, 1], false);
  }
  if (track.tremoloEnabled) {
    const phases = [90 - track.tremoloSpread / 2, 90 + track.tremoloSpread / 2].map(degrees => degrees * Math.PI / 180);
    for (let frame = 0; frame < left.length; frame++) {
      const phase = 2 * Math.PI * track.tremoloFrequency * frame / sampleRate;
      left[frame] *= 0.5 * (1 - track.tremoloDepth * Math.sin(phase - phases[0]));
      right[frame] *= 0.5 * (1 - track.tremoloDepth * Math.sin(phase - phases[1]));
    }
  }
  if (track.chorusEnabled) {
    const rate = getLfoSyncRateHz(track.chorusRate, bpm);
    const base = track.chorusDelay / 1000;
    const phases = [90 - track.chorusSpread / 2, 90 + track.chorusSpread / 2].map(degrees => degrees * Math.PI / 180);
    applyDelayEffect(left, right, sampleRate,
      (time, channel) => base * (1 + track.chorusDepth * Math.sin(2 * Math.PI * rate * time - phases[channel])),
      base * 2, track.chorusFeedback, wetMix(track.chorusWet));
  }
  if (track.flangerEnabled) {
    const rate = getLfoSyncRateHz(track.flangerRate, bpm);
    const base = track.flangerDelay / 1000;
    const minimum = Math.max(0.00005, base * (1 - track.flangerDepth));
    const maximum = Math.min(0.04, base * (1 + track.flangerDepth));
    applyDelayEffect(left, right, sampleRate,
      time => minimum + (maximum - minimum) * (0.5 + 0.5 * Math.sin(2 * Math.PI * rate * time)),
      0.04, track.flangerFeedback, wetMix(track.flangerWet));
  }
  if (track.phaserEnabled) applyPhaser(left, right, track, sampleRate, bpm, a4);
}

function applyPhaser(left: Float32Array, right: Float32Array, track: NativeEffectSettings,
  sampleRate: number, bpm: number, a4: number): void {
  const rate = getLfoSyncRateHz(track.phaserRate, bpm);
  const center = a4 * 2 ** ((track.phaserCenter - 69) / 12);
  const stages = track.phaserStages;
  const inputs = [new Float64Array(stages * 2), new Float64Array(stages * 2)];
  const outputs = [new Float64Array(stages * 2), new Float64Array(stages * 2)];
  const feedbackHistory = [new Float32Array(129), new Float32Array(129)];
  const mix = 0.5 + 0.5 * (track.phaserWet <= -96 ? 0 : 10 ** (track.phaserWet / 20));
  const dryGain = Math.cos(mix * Math.PI / 2);
  const wetGain = Math.sin(mix * Math.PI / 2);
  // Reproduce the browser's 1024-point octave-to-frequency WaveShaper, including its input domain.
  const curve = Float32Array.from({ length: 1024 }, (_, index) => center * 2 ** (index / 1023 * 2 - 1));
  for (let frame = 0; frame < left.length; frame++) {
    const sweep = Math.cos(2 * Math.PI * rate * frame / sampleRate) * track.phaserDepth / 100 * PHASER_MAX_SWEEP_OCTAVES;
    const cursor = frame % 129;
    // One sample of explicit delay plus the feedback connection's processing quantum.
    const dry = [left[frame] - feedbackHistory[0][cursor] * track.phaserFeedback,
      right[frame] - feedbackHistory[1][cursor] * track.phaserFeedback];
    const wet = dry.slice();
    for (let stage = 0; stage < stages; stage++) {
      const position = (Math.max(-1, Math.min(1, stage * 2 - (stages - 1) + sweep)) + 1) * 1023 / 2;
      const index = Math.floor(position);
      const frequency = Math.min(sampleRate / 2, curve[index] + (curve[Math.min(1023, index + 1)] - curve[index]) * (position - index));
      const omega = 2 * Math.PI * frequency / sampleRate;
      const alpha = Math.sin(omega) / (2 * track.phaserQ);
      const a1 = -2 * Math.cos(omega) / (1 + alpha);
      const a2 = (1 - alpha) / (1 + alpha);
      for (let channel = 0; channel < 2; channel++) {
        const offset = stage * 2;
        const input = wet[channel];
        wet[channel] = a2 * input + a1 * inputs[channel][offset] + inputs[channel][offset + 1]
          - a1 * outputs[channel][offset] - a2 * outputs[channel][offset + 1];
        inputs[channel][offset + 1] = inputs[channel][offset];
        inputs[channel][offset] = input;
        outputs[channel][offset + 1] = outputs[channel][offset];
        outputs[channel][offset] = wet[channel];
      }
    }
    feedbackHistory[0][cursor] = wet[0];
    feedbackHistory[1][cursor] = wet[1];
    left[frame] = dry[0] * dryGain + wet[0] * wetGain;
    right[frame] = dry[1] * dryGain + wet[1] * wetGain;
  }
}

/** Tone's feedback-delay return, with the right pre-delay used by PingPongDelay. */
export function applyNativeEcho(left: Float32Array, right: Float32Array,
  track: Pick<TrackEffects, 'echoEnabled' | 'echoFeedback' | 'echoWet' | 'echoPingPong'>,
  sampleRate: number, delaySeconds: number, returnLeft = left, returnRight = right): void {
  if (!track.echoEnabled || track.echoWet <= -96) return;
  const delay = Math.max(128, Math.round(delaySeconds * sampleRate));
  const wetLeft = new Float32Array(left.length);
  const wetRight = new Float32Array(right.length);
  const isSend = returnLeft !== left;
  const [dryGain, wetGain] = isSend ? [1, 10 ** (track.echoWet / 20)] : wetMix(track.echoWet);
  for (let frame = 0; frame < left.length; frame++) {
    const prior = frame - delay;
    const feedbackPrior = prior - 128;
    if (prior >= 0) {
      wetLeft[frame] = left[prior] + (feedbackPrior >= 0 ? (track.echoPingPong ? wetRight[feedbackPrior] : wetLeft[feedbackPrior]) * track.echoFeedback : 0);
      wetRight[frame] = (track.echoPingPong ? (frame >= 2 * delay ? right[frame - 2 * delay] : 0) : right[prior])
        + (feedbackPrior >= 0 ? (track.echoPingPong ? wetLeft[feedbackPrior] : wetRight[feedbackPrior]) * track.echoFeedback : 0);
    }
  }
  for (let frame = 0; frame < left.length; frame++) {
    returnLeft[frame] = returnLeft[frame] * dryGain + wetLeft[frame] * wetGain;
    returnRight[frame] = returnRight[frame] * dryGain + wetRight[frame] * wetGain;
  }
}
