export const SPECTRUM_FLOOR_DB = -60;

/** Display magnitudes relative to the peak; signed coefficients retain their phase in synthesis. */
export function getSpectrumPreview(spectrum: readonly number[]) {
  const magnitudes = spectrum.map((value) => Number.isFinite(value) ? Math.abs(value) : 0);
  const peak = Math.max(0, ...magnitudes);
  const bars = magnitudes.flatMap((amplitude, index) => {
    if (amplitude === 0 || peak === 0) return [];
    const decibels = 20 * (Math.log10(amplitude) - Math.log10(peak));
    if (decibels < SPECTRUM_FLOOR_DB) return [];
    return [{
      harmonic: (index + 1) / 2,
      amplitude,
      decibels,
      x: 48 + (index + 1) / spectrum.length * 576,
      y: 120 - Math.max(0.01, 1 - decibels / SPECTRUM_FLOOR_DB) * 104,
    }];
  });
  return { peak, bars };
}
