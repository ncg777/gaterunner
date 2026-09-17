import { normalizeDrumParameters, type DrumParameterBag, type DrumVoiceId } from '../src/domain/rhythmTrack.js';
import { createStereoFilter } from './biquad.js';
import { createNativeDrumVoice } from './nativeDrumVoice.js';
import { lookupTransferCurve } from '../src/audio/trackDistortion.js';

// Distortion's setter calls WaveShaper.setMap without a length, rebuilding 1024 bins.
const DRUM_DISTORTION_CURVE = Float32Array.from({ length: 1024 }, (_, index) => {
  const x = index / 1023 * 2 - 1;
  return Math.abs(x) < 0.001 ? 0 : 103 * x * 20 * Math.PI / 180 / (Math.PI + 100 * Math.abs(x));
});

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function parameter(parameters: DrumParameterBag, name: string, fallback: number): number {
  const value = parameters[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function createDrumVoiceSampler(voiceId: DrumVoiceId, parameters: DrumParameterBag, velocity: number,
  sampleRate = 48000, duration = Number(parameters.decay ?? 0.2)) {
  const voice = createNativeDrumVoice(voiceId, normalizeDrumParameters(voiceId, parameters),
    clamp(velocity, 0, 1), sampleRate, duration);
  return (elapsed: number, _sampleIndex: number) => voice.sample(elapsed);
}

export function getDrumVoiceTailSeconds(voiceId: DrumVoiceId, parameters: DrumParameterBag, duration: number): number {
  return createNativeDrumVoice(voiceId, normalizeDrumParameters(voiceId, parameters), 1, 48000, duration).tail;
}

/** Inspect a single point; use createDrumVoiceSampler for efficient sequential sampling. */
export function sampleDrumVoice(
  voiceId: DrumVoiceId,
  parameters: DrumParameterBag,
  elapsed: number,
  velocity: number,
  sampleIndex: number,
  sampleRate: number,
): number {
  const sampler = createDrumVoiceSampler(voiceId, parameters, velocity, sampleRate);
  const frames = Math.max(0, Math.floor(elapsed * sampleRate));
  for (let frame = 0; frame < frames; frame++) sampler(frame / sampleRate, sampleIndex - frames + frame);
  return sampler(elapsed, sampleIndex);
}

export function renderDrumHitIntoBuffers(options: {
  left: Float32Array;
  right: Float32Array;
  startFrame: number;
  sampleRate: number;
  duration: number;
  velocity: number;
  voiceId: DrumVoiceId;
  parameters: DrumParameterBag;
  /** Seconds after the hit start when another exclusive-group member cuts this tail off. */
  chokeUntil?: number;
  /** The browser has one pooled voice per drum layer; a restrike replaces the old source. */
  retriggerUntil?: number;
  oscillatorPhase?: number;
  transform?: (sample: number, elapsed: number) => number;
  onSample?: (frame: number, left: number, right: number) => void;
}): void {
  const { left, right, startFrame, sampleRate, duration, velocity, voiceId, chokeUntil, retriggerUntil, transform, onSample } = options;
  const parameters = normalizeDrumParameters(voiceId, options.parameters);
  const phase = options.oscillatorPhase ?? startFrame / sampleRate * parameter(parameters, 'tune', 55);
  const startTime = startFrame / sampleRate;
  const voice = createNativeDrumVoice(voiceId, parameters, clamp(velocity, 0, 1), sampleRate, duration, startFrame + 1, phase, startTime);
  const rightVoice = voice.stereo ? createNativeDrumVoice(voiceId, parameters, clamp(velocity, 0, 1),
    sampleRate, duration, (startFrame + 1) ^ 0x7f4a7c15, phase, startTime) : undefined;
  const tailSeconds = voice.tail;
  const fadeSeconds = 0.008;
  const audibleSeconds = chokeUntil === undefined
    ? tailSeconds
    : Math.min(tailSeconds, Math.max(0, chokeUntil) + fadeSeconds);
  const endFrame = Math.min(left.length, startFrame + Math.ceil(Math.min(audibleSeconds,
    retriggerUntil ?? Infinity) * sampleRate));
  const driveGain = 10 ** (parameter(parameters, 'distortionInputGain', 0) / 20);
  const cutoff = parameter(parameters, 'filterFrequency', 20000);
  const filters = createStereoFilter({ filterEnabled: true,
    filterType: String(parameters.filterType ?? 'lowpass'),
    filterQ: parameter(parameters, 'filterResonance', 1),
    filterGain: parameter(parameters, 'filterGain', 0),
    filterRolloff: parameter(parameters, 'filterRolloff', -12) }, sampleRate);

  const process = (input: number, channel: number, elapsed: number, gain: number) => {
    const sample = filters[channel](lookupTransferCurve(DRUM_DISTORTION_CURVE, input * driveGain), cutoff) * gain;
    return transform ? transform(sample, elapsed) : sample;
  };
  for (let frame = Math.max(0, startFrame); frame < endFrame; frame += 1) {
    const elapsed = (frame - startFrame) / sampleRate;
    const inputLeft = voice.sample(elapsed);
    const inputRight = rightVoice ? rightVoice.sample(elapsed) : inputLeft;
    const velocityGain = clamp(velocity, 0, 1) + (1 - clamp(velocity, 0, 1)) * Math.min(1, elapsed / Math.max(0.03, voice.velocityDuration));
    const chokeGain = chokeUntil !== undefined && elapsed >= chokeUntil
      ? clamp(1 - ((elapsed - chokeUntil) / fadeSeconds), 0, 1) : 1;
    const outputLeft = process(inputLeft, 0, elapsed, velocityGain) * chokeGain;
    const outputRight = process(inputRight, 1, elapsed, velocityGain) * chokeGain;
    left[frame] += outputLeft;
    right[frame] += outputRight;
    onSample?.(frame, outputLeft, outputRight);
  }
}
