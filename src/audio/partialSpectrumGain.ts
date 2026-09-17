const gains = new WeakMap<number[], number>();
const realtimeGains = new WeakMap<readonly number[], { values: number[]; peak: number }>();
// The supported generators have at most 128 bins. Bound retained basis memory
// to ~12 MiB across both grids; larger external spectra still work uncached.
const bases = new Map<number, Map<number, Float64Array>>();
const scratch = new Map<number, Float64Array>();

function spectrumPeak(spectrum: readonly number[], size: number): number {
  let rows = bases.get(size);
  if (!rows) bases.set(size, rows = new Map());
  let samples = scratch.get(size);
  if (!samples) scratch.set(size, samples = new Float64Array(size));
  samples.fill(0);
  for (let index = 0; index < spectrum.length; index += 1) {
    const amplitude = spectrum[index];
    if (amplitude === 0) continue;
    let row = rows.get(index);
    if (!row) {
      row = new Float64Array(size);
      for (let sample = 0; sample < size; sample += 1) {
        row[sample] = Math.sin(2 * Math.PI * (index + 1) * sample / size);
      }
      if (index < 128) rows.set(index, row);
    }
    // Preserve the original per-sample partial summation order and precision.
    for (let sample = 0; sample < size; sample += 1) samples[sample] += amplitude * row[sample];
  }
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak;
}

/**
 * Web Audio normalizes custom waves. Restore the procedural spectrum's level at
 * the oscillator output, leaving the legacy tonewheel path untouched.
 */
export function getPartialSpectrumGain(spectrum: number[]): number {
  const cached = gains.get(spectrum);
  if (cached !== undefined) return cached;
  const peak = spectrumPeak(spectrum, 8192);
  gains.set(spectrum, peak);
  return peak;
}

/** Bounded-cost gain recovery for spectra that change at modulation rate. */
export function getRealtimePartialSpectrumGain(spectrum: readonly number[]): number {
  const cached = realtimeGains.get(spectrum);
  if (cached && cached.values.length === spectrum.length
    && cached.values.every((value, index) => value === spectrum[index])) return cached.peak;
  const peak = spectrumPeak(spectrum, 4099);
  realtimeGains.set(spectrum, { values: Array.from(spectrum), peak });
  return peak;
}
