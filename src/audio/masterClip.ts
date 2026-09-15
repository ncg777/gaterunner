import { lookupTransferCurve } from './trackDistortion.js';

/** Input level, in linear gain, that the curve spans before its ceiling flattens out. */
export const MASTER_CLIP_DOMAIN = 4;
/** Below this level the transfer curve is exactly linear, so quiet mixes stay untouched. */
export const MASTER_CLIP_THRESHOLD = 0.75;

const CURVE_SIZE = 8193;

function softClip(sample: number): number {
  const magnitude = Math.abs(sample);
  if (magnitude <= MASTER_CLIP_THRESHOLD) {
    return sample;
  }

  const knee = 1 - MASTER_CLIP_THRESHOLD;
  const shaped = MASTER_CLIP_THRESHOLD + knee * Math.tanh((magnitude - MASTER_CLIP_THRESHOLD) / knee);
  return sample < 0 ? -shaped : shaped;
}

// An odd length puts a sample exactly on zero, so the linear region stays symmetric.
export const MASTER_CLIP_CURVE = Float32Array.from(
  { length: CURVE_SIZE },
  (_, index) => softClip(((index / (CURVE_SIZE - 1)) * 2 - 1) * MASTER_CLIP_DOMAIN),
);

/** Offline equivalent of the WaveShaper that terminates the realtime master bus. */
export function applyMasterClip(sample: number): number {
  return lookupTransferCurve(MASTER_CLIP_CURVE, sample / MASTER_CLIP_DOMAIN);
}
