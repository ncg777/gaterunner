function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function fillPinkNoise(channel: Float32Array, startFrame: number, decayFrames: number, seed: number) {
  const random = createSeededRandom(seed);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;

  for (let frame = 0; frame < decayFrames; frame += 1) {
    const white = random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;

    const progress = frame / Math.max(1, decayFrames - 1);
    const envelope = Math.exp(-6 * progress);
    channel[startFrame + frame] = pink * 0.11 * envelope;
  }
}

/**
 * Web Audio's own convolver normalization scales by 44100/sampleRate, which makes the
 * wet level drift between a 44.1 kHz playback context and a 48 kHz render. This repeats
 * the spec's RMS formula without that term so both contexts land on the same level.
 */
function normalizeImpulse(channels: Float32Array[]) {
  const calibration = 0.00125;
  const minimumPower = 0.000125;
  let power = 0;
  for (const samples of channels) {
    for (let frame = 0; frame < samples.length; frame += 1) {
      power += samples[frame] * samples[frame];
    }
  }

  const rms = Math.sqrt(power / Math.max(1, channels.length * channels[0].length));
  const scale = calibration / Math.max(minimumPower, Number.isFinite(rms) ? rms : 0);
  for (const samples of channels) {
    for (let frame = 0; frame < samples.length; frame += 1) {
      samples[frame] *= scale;
    }
  }
}

export function createPinkNoiseImpulseChannels(decay: number, preDelay: number, sampleRate: number): [Float32Array, Float32Array] {
  const preDelayFrames = Math.round(Math.max(0, preDelay) * sampleRate);
  const decayFrames = Math.max(1, Math.round(Math.max(0.1, decay) * sampleRate));
  const channels: [Float32Array, Float32Array] = [
    new Float32Array(preDelayFrames + decayFrames), new Float32Array(preDelayFrames + decayFrames),
  ];
  fillPinkNoise(channels[0], preDelayFrames, decayFrames, 0x7f4a7c15);
  fillPinkNoise(channels[1], preDelayFrames, decayFrames, 0x3c6ef372);
  normalizeImpulse(channels);
  return channels;
}
