import { resolveWaveshaperCurve, type WaveshaperSettings } from './waveshaper.js';

export const TANH_CURVE = Float32Array.from(
  { length: 1024 },
  (_, index) => Math.tanh(index / 1023 * 2 - 1),
);

export function lookupTransferCurve(curve: Float32Array, input: number): number {
  if (curve.length < 2) return Number.isFinite(input) ? input : 0;
  if (Number.isNaN(input)) return 0;
  const position = (Math.max(-1, Math.min(1, input)) + 1) * 0.5 * (curve.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(curve.length - 1, lower + 1);
  const value = curve[lower] + (curve[upper] - curve[lower]) * (position - lower);
  return Number.isFinite(value) ? value : 0;
}

export function getWaveshaperHighpassCoefficients(sampleRate: number) {
  const safeSampleRate = Number.isFinite(sampleRate) && sampleRate > 20 ? sampleRate : 44100;
  const frequency = 10;
  const q = Math.SQRT1_2;
  const omega = 2 * Math.PI * frequency / safeSampleRate;
  const cosine = Math.cos(omega);
  const alpha = Math.sin(omega) / (2 * q);
  const denominator = 1 + alpha;
  const b0 = (1 + cosine) / (2 * denominator);
  return {
    frequency,
    q,
    qDb: 20 * Math.log10(q),
    b0,
    b1: -2 * b0,
    b2: b0,
    a1: -2 * cosine / denominator,
    a2: (1 - alpha) / denominator,
  };
}

export function getWaveshaperLevels(settings: WaveshaperSettings) {
  const driveDb = Number.isFinite(settings.inputDriveDb)
    ? Math.max(-24, Math.min(36, settings.inputDriveDb)) : 0;
  const mix = Number.isFinite(settings.mix) ? Math.max(0, Math.min(100, settings.mix)) / 100 : 0;
  return { drive: Math.pow(10, driveDb / 20), mix };
}

export function createWaveshaperProcessor(
  settings: WaveshaperSettings,
  sampleRate: number,
): (input: number) => number {
  const { drive, mix } = getWaveshaperLevels(settings);
  if (!settings.enabled || mix === 0) return input => input;
  const { curve, error } = resolveWaveshaperCurve(settings);
  if (!curve || error) return input => input;
  const coefficients = getWaveshaperHighpassCoefficients(sampleRate);
  const dcBlock = settings.dcBlock;
  let state1 = 0;
  let state2 = 0;
  return input => {
    if (!Number.isFinite(input)) {
      state1 = 0;
      state2 = 0;
      return 0;
    }
    let wet = lookupTransferCurve(curve, input * drive);
    if (dcBlock) {
      const filtered = coefficients.b0 * wet + state1;
      state1 = coefficients.b1 * wet - coefficients.a1 * filtered + state2;
      state2 = coefficients.b2 * wet - coefficients.a2 * filtered;
      wet = filtered;
    }
    const output = input * (1 - mix) + wet * mix;
    if (Number.isFinite(output) && Number.isFinite(state1) && Number.isFinite(state2)) return output;
    state1 = 0;
    state2 = 0;
    return 0;
  };
}