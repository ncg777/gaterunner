import type { DrumParameterBag, DrumVoiceId } from '../src/domain/rhythmTrack.js';

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function noiseSample(sampleIndex: number, salt: number): number {
  const value = Math.sin((sampleIndex + 1) * (12.9898 + salt * 78.233)) * 43758.5453123;
  return ((value - Math.floor(value)) * 2) - 1;
}

function noiseColor(sampleIndex: number, type: string): number {
  const white = noiseSample(sampleIndex, 1);
  if (type === 'brown') {
    return (noiseSample(sampleIndex, 0.31) + noiseSample(sampleIndex - 1, 0.31) * 0.82) * 0.52;
  }
  if (type === 'pink') {
    return (white + noiseSample(sampleIndex, 2) * 0.6 + noiseSample(sampleIndex, 3) * 0.35) / 1.95;
  }
  return white;
}

function parameter(parameters: DrumParameterBag, name: string, fallback: number): number {
  const value = parameters[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function percussionPhase(frequency: number, elapsed: number, sweepOctaves: number, sweepTime: number): number {
  const safeFrequency = Math.max(1, frequency);
  const safeSweepTime = Math.max(0.001, sweepTime);
  if (sweepOctaves <= 0 || elapsed >= safeSweepTime) {
    return 2 * Math.PI * safeFrequency * elapsed;
  }

  const startFrequency = safeFrequency * Math.pow(2, sweepOctaves);
  const ratio = Math.min(1, elapsed / safeSweepTime);
  const currentFrequency = startFrequency * Math.pow(2, -sweepOctaves * ratio);
  return 2 * Math.PI * elapsed * (startFrequency + currentFrequency) * 0.5;
}

function exponentialEnvelope(elapsed: number, decay: number, release = 0): number {
  const safeDecay = Math.max(0.001, decay);
  if (elapsed < 0) {
    return 0;
  }
  if (release > 0 && elapsed > safeDecay) {
    return Math.exp(-1) * Math.max(0, 1 - (elapsed - safeDecay) / release);
  }
  return Math.exp(-elapsed / safeDecay);
}

function metallicSample(phase: number, harmonicity: number, modulationIndex: number): number {
  const carrier = Math.sin(phase);
  const sideband = Math.sin(phase * Math.max(1.1, harmonicity) + carrier * Math.min(100, modulationIndex) * 0.04);
  return carrier * 0.35 + sideband * 0.65;
}

type DrumVoiceSampler = (elapsed: number, sampleIndex: number) => number;

export function createDrumVoiceSampler(
  voiceId: DrumVoiceId,
  parameters: DrumParameterBag,
  velocity: number,
): DrumVoiceSampler {
  const safeVelocity = clamp(velocity, 0, 1);
  const tune = parameter(parameters, 'tune', 220);
  const decay = parameter(parameters, 'decay', 0.2);
  const sweep = parameter(parameters, 'sweep', 0);
  const sweepTime = parameter(parameters, 'sweepTime', 0.03);
  const snap = clamp(parameter(parameters, 'snap', 0.3), 0, 1);
  const color = parameter(parameters, 'color', parameter(parameters, 'brightness', 7000));
  const noiseType = String(parameters.noiseType ?? 'white');
  const harmonicity = parameter(parameters, 'harmonicity', 3);
  const modulationIndex = parameter(parameters, 'modIndex', 32);
  const tonePhase = (elapsed: number) => percussionPhase(tune, elapsed, sweep, sweepTime);
  const noise = (sampleIndex: number) => noiseColor(sampleIndex, noiseType);

  if (voiceId === 'kick') {
    const kickDecay = parameter(parameters, 'decay', 0.45);
    const drive = clamp(parameter(parameters, 'drive', 0.35), 0, 1);
    return (elapsed, sampleIndex) => {
      const kickEnvelope = exponentialEnvelope(elapsed, kickDecay, 0.08);
      const click = noise(sampleIndex) * Math.exp(-elapsed / 0.008) * 0.08;
      const raw = Math.sin(tonePhase(elapsed)) * kickEnvelope + click;
      return Math.tanh(raw * (1 + drive * 5)) * safeVelocity * 0.9;
    };
  }

  if (voiceId === 'snare' || voiceId === 'clap' || voiceId === 'rimshot') {
    const noiseDecay = Math.max(0.004, parameter(parameters, 'noiseDecay', 0.24));
    const noiseLevel = voiceId === 'rimshot' ? snap * 0.85 : (voiceId === 'clap' ? 0.9 : parameter(parameters, 'mix', 0.5));
    return (elapsed, sampleIndex) => {
      const bodyEnvelope = exponentialEnvelope(elapsed, decay, decay * 0.6);
      const tone = Math.sin(tonePhase(elapsed)) * bodyEnvelope;
      let bursts = 1;
      if (voiceId === 'clap') {
        bursts = 0;
        for (const offset of [0, 0.012, 0.024, 0.041]) {
          bursts += elapsed >= offset ? Math.exp(-(elapsed - offset) / noiseDecay) : 0;
        }
        bursts /= 4;
      }
      const highFrequency = Math.sin(2 * Math.PI * Math.max(1200, color) * elapsed);
      return (tone * (1 - noiseLevel) * 0.65 + noise(sampleIndex) * bursts * noiseLevel + highFrequency * snap * 0.08) * safeVelocity * 0.72;
    };
  }

  if (voiceId === 'hat' || voiceId === 'hatPedal' || voiceId === 'hatOpen') {
    const hatDecay = parameter(parameters, 'decay', voiceId === 'hatOpen' ? 0.48 : 0.08);
    return (elapsed) => {
      const phase = tonePhase(elapsed);
      const metallic = metallicSample(phase, harmonicity, modulationIndex);
      const hatEnvelope = exponentialEnvelope(elapsed, hatDecay, hatDecay * 0.35);
      return metallic * hatEnvelope * safeVelocity * 0.48;
    };
  }

  if (['crash', 'chineseCymbal', 'splash', 'crash2', 'ride', 'rideBell', 'ride2'].includes(voiceId)) {
    const cymbalDecay = parameter(parameters, 'decay', 1.4);
    const wash = clamp(parameter(parameters, 'wash', 0.4), 0, 1);
    return (elapsed, sampleIndex) => {
      const phase = tonePhase(elapsed);
      const metallic = metallicSample(phase, harmonicity, modulationIndex);
      const cymbalEnvelope = exponentialEnvelope(elapsed, cymbalDecay, cymbalDecay * 0.7);
      return (metallic * (1 - wash) * 0.6 + noise(sampleIndex) * wash) * cymbalEnvelope * safeVelocity * 0.38;
    };
  }

  if (voiceId === 'shaker') {
    const shakerDecay = parameter(parameters, 'decay', 0.12);
    return (elapsed, sampleIndex) => {
      const shakerEnvelope = exponentialEnvelope(elapsed, shakerDecay, 0.05);
      let grains = 0;
      for (const offset of [0, 0.011, 0.026, 0.044, 0.067]) {
        grains += elapsed >= offset ? 1 : 0;
      }
      return noise(sampleIndex) * shakerEnvelope * (grains / 5) * snap * safeVelocity * 0.4;
    };
  }

  if (voiceId === 'cowbell') {
    return (elapsed) => {
      const phase = tonePhase(elapsed);
      const low = Math.sign(Math.sin(phase));
      const high = Math.sign(Math.sin(phase * 1.481));
      return (low * 0.55 + high * 0.45) * exponentialEnvelope(elapsed, decay, decay * 0.6) * safeVelocity * 0.42;
    };
  }

  if (voiceId === 'chimes') {
    return (elapsed) => {
      const phase = tonePhase(elapsed);
      return (
        Math.sin(phase) * 0.7
        + Math.sin(phase * 2.756) * 0.25
        + Math.sin(phase * 5.404) * 0.12
      ) * exponentialEnvelope(elapsed, decay, decay * 0.6) * safeVelocity * 0.34;
    };
  }

  if (voiceId === 'triangleMuted' || voiceId === 'triangle') {
    const triangleDecay = parameter(parameters, 'decay', voiceId === 'triangle' ? 1.1 : 0.14);
    return (elapsed) => {
      const phase = tonePhase(elapsed);
      const triangleEnvelope = exponentialEnvelope(elapsed, triangleDecay, triangleDecay * 0.9);
      return (Math.sin(phase) * 0.8 + Math.sin(phase * 3.92) * 0.2) * triangleEnvelope * safeVelocity * 0.34;
    };
  }

  if (voiceId.startsWith('tom') || voiceId.startsWith('conga') || voiceId.startsWith('timbale')) {
    return (elapsed, sampleIndex) => {
      const phase = tonePhase(elapsed);
      const shell = voiceId.startsWith('timbale') ? Math.sign(Math.sin(phase * 4.13)) : Math.sin(phase * 2.08);
      return (Math.sin(phase) * 0.78 + shell * snap * 0.22 + noise(sampleIndex) * snap * 0.08)
        * exponentialEnvelope(elapsed, decay, decay * 0.6) * safeVelocity * 0.58;
    };
  }

  return (elapsed) => Math.sin(tonePhase(elapsed))
    * exponentialEnvelope(elapsed, decay, decay * 0.6) * safeVelocity * 0.4;
}

export function getDrumVoiceTailSeconds(voiceId: DrumVoiceId, parameters: DrumParameterBag, duration: number): number {
  const decay = parameter(parameters, 'decay', 0.2);
  const noiseDecay = parameter(parameters, 'noiseDecay', decay);
  const release = Math.max(0.02, decay * 0.7);
  let naturalTail = Math.max(decay, noiseDecay) + release;

  if (voiceId === 'kick') {
    naturalTail = Math.max(naturalTail, parameter(parameters, 'decay', 0.45) + 0.06);
  } else if (voiceId === 'clap') {
    naturalTail = Math.max(naturalTail, parameter(parameters, 'noiseDecay', 0.24) + 0.1);
  } else if (voiceId === 'shaker') {
    naturalTail = Math.max(naturalTail, 0.15);
  } else if (['crash', 'chineseCymbal', 'splash', 'crash2', 'ride', 'rideBell', 'ride2', 'chimes', 'triangle'].includes(voiceId)) {
    naturalTail = Math.max(naturalTail, decay * 1.7);
  }

  return Math.max(0.01, duration, naturalTail);
}

export function sampleDrumVoice(
  voiceId: DrumVoiceId,
  parameters: DrumParameterBag,
  elapsed: number,
  velocity: number,
  sampleIndex: number,
  _sampleRate: number,
): number {
  return createDrumVoiceSampler(voiceId, parameters, velocity)(elapsed, sampleIndex);
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
  transform?: (sample: number, elapsed: number) => number;
  onSample?: (frame: number, left: number, right: number) => void;
}): void {
  const { left, right, startFrame, sampleRate, duration, velocity, voiceId, parameters, chokeUntil, transform, onSample } = options;
  const tailSeconds = getDrumVoiceTailSeconds(voiceId, parameters, duration);
  const fadeSeconds = 0.008;
  const audibleSeconds = chokeUntil === undefined
    ? tailSeconds
    : Math.min(tailSeconds, Math.max(0, chokeUntil) + fadeSeconds);
  const endFrame = Math.min(left.length, startFrame + Math.ceil(audibleSeconds * sampleRate));
  const panGain = Math.SQRT1_2;
  const sampler = createDrumVoiceSampler(voiceId, parameters, velocity);

  for (let frame = Math.max(0, startFrame); frame < endFrame; frame += 1) {
    const elapsed = (frame - startFrame) / sampleRate;
    const rawSample = sampler(elapsed, frame);
    let sample = transform ? transform(rawSample, elapsed) : rawSample;
    if (chokeUntil !== undefined && elapsed >= chokeUntil) {
      sample *= clamp(1 - ((elapsed - chokeUntil) / fadeSeconds), 0, 1);
    }
    left[frame] += sample * panGain;
    right[frame] += sample * panGain;
    onSample?.(frame, sample * panGain, sample * panGain);
  }
}
