const gains = new WeakMap<number[], number>();

/**
 * Web Audio normalizes custom waves. Restore the procedural spectrum's level at
 * the oscillator output, leaving the legacy tonewheel path untouched.
 */
export function getPartialSpectrumGain(spectrum: number[]): number {
  const cached = gains.get(spectrum);
  if (cached !== undefined) return cached;
  const size = 8192;
  const samples = new Float64Array(size);
  spectrum.forEach((amplitude, index) => {
    if (amplitude === 0) return;
    for (let sample = 0; sample < size; sample += 1) {
      samples[sample] += amplitude * Math.sin(2 * Math.PI * (index + 1) * sample / size);
    }
  });
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  gains.set(spectrum, peak);
  return peak;
}

/** Bounded-cost gain recovery for spectra that change at modulation rate. */
export function getRealtimePartialSpectrumGain(spectrum: readonly number[]): number {
  const size = 4099;
  let peak = 0;
  for (let sample = 0; sample < size; sample += 1) {
    let value = 0;
    for (let index = 0; index < spectrum.length; index += 1) {
      value += spectrum[index] * Math.sin(2 * Math.PI * (index + 1) * sample / size);
    }
    peak = Math.max(peak, Math.abs(value));
  }
  return peak;
}
