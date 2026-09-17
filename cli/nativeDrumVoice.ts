import type { DrumParameterBag, DrumVoiceId } from '../src/domain/rhythmTrack.js';
import { createStereoFilter } from './biquad.js';
import { targetApproach } from './nativeEnvelope.js';
import { lookupTransferCurve } from '../src/audio/trackDistortion.js';

interface Layer {
  type: 'sine' | 'triangle' | 'square' | 'noise' | 'metal';
  frequency?: number;
  noiseType?: string;
  attack: number;
  decay: number;
  release: number;
  duration: number;
  level: number;
  offset?: number;
  sustain?: number;
  sweep?: number;
  sweepTime?: number;
  filter?: { type: string; frequency: number; Q: number };
  octaves?: number;
  exponentialAttack?: boolean;
}

function number(parameters: DrumParameterBag, key: string, fallback: number): number {
  const value = parameters[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Layer scheduling and gains mirror createDrumInstrument in src/audio/drumKit.ts. */
function describeVoice(id: DrumVoiceId, p: DrumParameterBag, duration: number) {
  const tune = number(p, 'tune', 220), decay = number(p, 'decay', 0.2);
  const snap = number(p, 'snap', 0.3), mix = number(p, 'mix', 0.5);
  const brightness = number(p, 'brightness', 8000), color = number(p, 'color', 4800);
  const layers: Layer[] = [];
  const tone = (type: Layer['type'], frequency: number, attack: number, d: number, release: number,
    gate: number, level = 1, extra: Partial<Layer> = {}) => layers.push({ type, frequency, attack, decay: d, release, duration: gate, level, ...extra });
  const noise = (type: string, attack: number, d: number, release: number, gate: number, level: number,
    filter?: Layer['filter'], offset = 0) => layers.push({ type: 'noise', noiseType: type, attack, decay: d,
      release, duration: gate, level, filter, offset });
  const membrane = (attack: number, release: number, gate: number, sustain = 0) => tone('sine', tune, attack,
    decay, release, gate, 1, { sweep: number(p, 'sweep', 0), sweepTime: number(p, 'sweepTime', 0.03),
      sustain, exponentialAttack: true });
  let velocityDuration = decay + 0.05;
  switch (id) {
    case 'kick': velocityDuration = Math.max(0.01, duration) + 0.02; break;
    case 'snare': {
      const td = number(p, 'toneDecay', 0.12), nd = number(p, 'noiseDecay', 0.2);
      velocityDuration = Math.max(td, nd) + 0.05;
      tone('triangle', tune, 0.001, td, td * 0.3, td * 1.3, 1 - mix);
      noise(String(p.noiseType ?? 'white'), 0.002, nd, nd * 0.25, Math.max(velocityDuration, duration), mix);
      if (snap > 0.01) noise('white', 0.0005, 0.015, 0.005, 0.02, snap * snap);
      break;
    }
    case 'clap': {
      const c = Math.max(700, tune), td = number(p, 'toneDecay', 0.03), nd = number(p, 'noiseDecay', 0.24);
      velocityDuration = Math.max(0.041 + nd + 0.04, duration);
      [0, 0.012, 0.024, 0.041].forEach((offset, index) => {
        noise(String(p.noiseType ?? 'pink'), 0.0006, td, td * 0.35, Math.max(0.004, td * (1 + index * 0.22)),
          (0.35 + (1 - mix) * 0.55) * (1 - index * 0.16), { type: 'bandpass', frequency: c, Q: 1.35 }, offset);
        noise('white', 0.0002, 0.005, 0.002, 0.006 + index * 0.0015,
          snap * (1 - index * 0.14), { type: 'highpass', frequency: Math.max(3200, c * 2.3), Q: 0.7 }, offset);
      });
      noise(String(p.noiseType ?? 'pink'), 0.0025, nd, nd * 0.35, Math.max(0.02, nd),
        0.18 + mix * 0.85, { type: 'highpass', frequency: Math.max(1400, c * 1.5), Q: 0.8 }, 0.016);
      break;
    }
    case 'hat': case 'hatPedal': case 'hatOpen':
      velocityDuration = decay + 0.02;
      tone('metal', tune, 0.001, decay, decay * 0.3, Math.max(decay * 1.3, duration), 1, { octaves: 1.5 });
      break;
    case 'crash': case 'chineseCymbal': case 'splash': case 'crash2': {
      const wash = number(p, 'wash', 0.65);
      velocityDuration = decay * 1.7 + 0.05;
      tone('metal', tune, 0.001, decay, decay * 0.7, Math.max(decay * 1.7, duration), 1, { octaves: 2 });
      if (wash > 0.01) noise('white', 0.002, Math.max(0.3, decay * 1.15), Math.max(0.12, decay * 0.45),
        Math.max(0.4, decay * 1.1), wash * wash, { type: 'highpass', frequency: Math.max(2200, brightness * 0.35), Q: 0.8 });
      break;
    }
    case 'rimshot':
      velocityDuration = decay + 0.03;
      tone('sine', tune, 0.0005, decay, 0.015, decay + 0.02, 0.68 * 0.78);
      tone('triangle', tune * 2.72, 0.0005, decay * 0.52, 0.008, decay * 0.62, 0.68 * 0.55);
      noise('white', 0.0002, 0.008, 0.003, 0.012, snap * snap, { type: 'bandpass', frequency: color, Q: 2.8 });
      break;
    case 'tomLowFloor': case 'tomHighFloor': case 'tom': case 'tomLowMid': case 'tomHighMid': case 'tomHigh':
      velocityDuration = decay * 1.45 + number(p, 'sweepTime', 0.035);
      membrane(0.001, decay * 0.45, Math.max(velocityDuration, duration), 0.025);
      tone('triangle', tune * 2.08, 0.001, decay * 0.48, 0.035, decay * 0.58, 0.22 * 0.42);
      break;
    case 'congaMuted': case 'congaOpen': case 'conga':
      velocityDuration = decay + 0.08;
      membrane(0.0008, decay * 0.18, Math.max(decay * 1.2, duration));
      noise('pink', 0.0005, 0.018, 0.006, 0.025, snap * snap, { type: 'bandpass', frequency: number(p, 'color', 3200), Q: 1.6 });
      break;
    case 'timbale': case 'timbaleLow':
      membrane(0.0005, decay * 0.16, Math.max(decay, duration));
      tone('square', tune * 4.13, 0.0004, decay * 0.32, 0.012, decay * 0.4,
        Math.min(0.55, snap) * 0.46, { filter: { type: 'bandpass', frequency: number(p, 'color', 4400), Q: 1.2 } });
      break;
    case 'cowbell': {
      const filter = { type: 'bandpass', frequency: brightness * 0.24, Q: 0.65 };
      tone('square', tune, 0.0005, decay, decay * 0.22, decay * 1.2, 0.48, { filter });
      tone('square', tune * 1.481, 0.0005, decay * 0.72, decay * 0.16, decay, 0.48 * 0.82, { filter });
      break;
    }
    case 'chimes':
      velocityDuration = Math.max(decay * 1.55, duration);
      tone('sine', tune, 0.001, decay, decay * 0.55, velocityDuration, 0.62 * 0.76);
      tone('sine', tune * 2.756, 0.001, decay * 0.72, decay * 0.38, decay * 1.1, 0.62 * 0.34);
      tone('sine', tune * 5.404, 0.001, decay * 0.48, decay * 0.25, decay * 0.72, 0.62 * 0.18);
      break;
    case 'triangleMuted': case 'triangle':
      velocityDuration = Math.max(decay * 1.9, duration);
      tone('sine', tune, 0.0005, decay, decay * 0.9, velocityDuration, 0.56 * 0.78);
      tone('sine', tune * 3.92, 0.0003, decay * 0.62, decay * 0.42, decay * 1.05, 0.56 * 0.24);
      break;
    case 'ride': case 'rideBell': case 'ride2': {
      const wash = Math.min(0.75, Math.max(0.12, number(p, 'wash', 0.38)));
      velocityDuration = Math.max(decay * 1.72, duration);
      tone('metal', tune, 0.0007, decay, decay * 0.72, velocityDuration, 0.82, { octaves: 1.35 });
      noise('white', 0.001, decay * 0.95, decay * 0.5, decay * 1.45, wash * wash,
        { type: 'bandpass', frequency: 7200, Q: 0.38 });
      break;
    }
    case 'shaker': {
      velocityDuration = decay + 0.04;
      const nd = Math.max(0.009, decay * 0.18);
      [0, 0.011, 0.026, 0.044, 0.067].forEach((offset, index) => noise('white', 0.0003, nd, 0.006,
        Math.max(0.012, decay * (0.18 + index * 0.035)), snap * (0.62 + index * 0.07),
        { type: 'bandpass', frequency: number(p, 'color', 7500), Q: 1.25 }, offset));
      break;
    }
  }
  return { layers, velocityDuration };
}

function layerEnvelope(layer: Layer, time: number, sampleRate: number, startTime: number): number {
  if (time < 0) return 0;
  const held = Math.min(time, layer.duration);
  const sustain = layer.sustain ?? 0;
  const level = held < layer.attack
    ? layer.exponentialAttack ? targetApproach(0, 1, held, layer.attack) : held / layer.attack
    // Native target automation starts from the ramp value at its integer frame.
    // Use the absolute timestamp: floating-point endpoints can land one frame early.
    : targetApproach(layer.exponentialAttack ? 1 : Math.max(0, Math.min(1,
      (Math.floor((startTime + layer.attack) * sampleRate) - startTime * sampleRate) / (layer.attack * sampleRate))),
      sustain, held - layer.attack, layer.decay);
  return time > layer.duration ? targetApproach(level, 0, time - layer.duration, layer.release) : level;
}

/** Tone noise coloration; use fixed seeds so CLI and worker exports remain reproducible. */
export function createNativeNoise(type: string, initialSeed: number): () => number {
  let seed = initialSeed || 1, brown = 0;
  const b = new Float64Array(7);
  return () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    const white = (seed >>> 0) / 0xffffffff * 2 - 1;
    if (type === 'brown') {
      brown = (brown + 0.02 * white) / 1.02;
      return brown * 3.5;
    }
    if (type !== 'pink') return white;
    b[0] = 0.99886 * b[0] + white * 0.0555179;
    b[1] = 0.99332 * b[1] + white * 0.0750759;
    b[2] = 0.969 * b[2] + white * 0.153852;
    b[3] = 0.8665 * b[3] + white * 0.3104856;
    b[4] = 0.55 * b[4] + white * 0.5329522;
    b[5] = -0.7616 * b[5] - white * 0.016898;
    const result = (b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + white * 0.5362) * 0.11;
    b[6] = white * 0.115926;
    return result;
  };
}

function filterFor(type: string, Q: number, sampleRate: number) {
  return createStereoFilter({ filterEnabled: true, filterType: type, filterQ: Q, filterGain: 0, filterRolloff: -12 }, sampleRate)[0];
}

function polyBlep(phase: number, step: number): number {
  const width = Math.min(0.5, Math.abs(step));
  if (width === 0) return 0;
  if (phase < width) { const t = phase / width; return 2 * t - t * t - 1; }
  if (phase > 1 - width) { const t = (phase - 1) / width; return t * t + 2 * t + 1; }
  return 0;
}

function square(phase: number, step: number): number {
  const p = phase - Math.floor(phase);
  return (p < 0.5 ? 1 : -1) + polyBlep(p, step) - polyBlep((p + 0.5) % 1, step);
}

/** Integrate the same 24 linear power-curve segments scheduled by the kick voice. */
function powerCurveIntegral(progress: number, shape: number): number {
  const p = Math.min(1, Math.max(0, progress)), segments = 24;
  const exponent = Math.max(0.05, Math.min(12, shape));
  let integral = 0;
  for (let index = 0; index < segments && index / segments < p; index++) {
    const from = (1 - index / segments) ** exponent;
    const to = (1 - (index + 1) / segments) ** exponent;
    const width = Math.min(1 / segments, p - index / segments);
    integral += from * width + (to - from) * width * width * segments / 2;
  }
  return integral;
}

function powerCurve(progress: number, shape: number): number {
  const p = Math.min(1, Math.max(0, progress)) * 24, index = Math.floor(p);
  const exponent = Math.max(0.05, Math.min(12, shape));
  const from = Math.max(0, 1 - index / 24) ** exponent;
  const to = Math.max(0, 1 - (index + 1) / 24) ** exponent;
  return from + (to - from) * (p - index);
}

/** Kick VCO phase continues through gates and restrikes, as in the browser. */
export function nativeKickCycles(time: number, p: DrumParameterBag): number {
  const tune = number(p, 'tune', 55), sweepTime = number(p, 'sweepTime', 0.05);
  return tune * time + tune * (2 ** number(p, 'sweep', 4) - 1) * sweepTime
    * powerCurveIntegral(time / sweepTime, number(p, 'pitchShape', 3));
}

export function createNativeDrumVoice(id: DrumVoiceId, p: DrumParameterBag, velocity: number,
  sampleRate: number, duration: number, seed = 1, phaseOffset = 0, startTime = 0) {
  const { layers, velocityDuration } = describeVoice(id, p, duration);
  if (id === 'kick') {
    const ampShape = number(p, 'ampShape', 2);
    const gate = Math.max(0.01, duration), drive = number(p, 'drive', 0.35), power = number(p, 'wavePower', 2.5);
    const curve = Float32Array.from({ length: 2048 }, (_, index) => {
      const x = (index / 2047 * 2 - 1) * (1 + drive * 12);
      return x / (1 + Math.abs(x) ** power) ** (1 / power);
    });
    return { tail: 0.0015 + gate, velocityDuration, stereo: false,
      sample: (time: number) => {
        const cycles = phaseOffset + nativeKickCycles(time, p);
        // schedulePowerCurve cancels the attack endpoint at 1.5 ms. The browser
        // holds zero until that endpoint, then starts the segmented decay.
        const envelope = time < 0.0015 ? 0 : powerCurve((time - 0.0015) / gate, ampShape);
        return lookupTransferCurve(curve, Math.sin(2 * Math.PI * cycles)) * envelope * velocity;
      } };
  }
  const samplers = layers.map((layer, index) => {
    const noise = createNativeNoise(layer.noiseType ?? 'white', seed ^ Math.imul(index + 1, 0x9e3779b9));
    const filter = layer.filter ? filterFor(layer.filter.type, layer.filter.Q, sampleRate) : undefined;
    const metalFilter = layer.type === 'metal' ? filterFor('highpass', 0, sampleRate) : undefined;
    const carrierPhases = new Float64Array(6), ratios = [1, 1.483, 1.932, 2.546, 2.63, 3.897];
    return (time: number) => {
      const t = time - (layer.offset ?? 0);
      if (t < 0) return 0;
      const envelope = layerEnvelope(layer, t, sampleRate, startTime + (layer.offset ?? 0));
      const frequency = layer.frequency ?? 0;
      let phase = frequency * t;
      if (layer.sweep && layer.sweepTime) {
        const rate = layer.sweep * Math.LN2 / layer.sweepTime;
        phase = frequency * 2 ** layer.sweep * -Math.expm1(-rate * Math.min(t, layer.sweepTime)) / rate
          + frequency * Math.max(0, t - layer.sweepTime);
      }
      let input: number;
      if (layer.type === 'noise') input = noise();
      else if (layer.type === 'triangle') input = 2 / Math.PI * Math.asin(Math.sin(2 * Math.PI * phase));
      else if (layer.type === 'square') input = square(phase, frequency / sampleRate);
      else if (layer.type === 'metal') {
        input = 0;
        const harmonicity = number(p, 'harmonicity', 5.1), modulation = number(p, 'modIndex', 32);
        for (let i = 0; i < ratios.length; i++) {
          const f = frequency * ratios[i];
          const modulator = square(f * harmonicity * t, f * harmonicity / sampleRate);
          const step = f * (1 + modulation * modulator) / sampleRate;
          input += square(carrierPhases[i], step);
          carrierPhases[i] += step;
        }
        // The same envelope drives the amplitude and the highpass frequency.
        const base = number(p, 'brightness', 8000);
        input = metalFilter!(input, base * (1 + (2 ** (layer.octaves ?? 1.5) - 1) * envelope * velocity * layer.level));
      } else input = Math.sin(2 * Math.PI * phase);
      const sample = input * envelope * velocity * layer.level;
      return filter ? filter(sample, layer.filter!.frequency) : sample;
    };
  });
  const tail = Math.max(0.01, ...layers.map(layer => (layer.offset ?? 0) + Math.max(layer.attack + layer.decay,
    layer.duration + layer.release)));
  return { tail, velocityDuration, stereo: layers.some(layer => layer.type === 'noise'),
    sample: (time: number) => samplers.reduce((sum, sampler) => sum + sampler(time), 0) };
}
