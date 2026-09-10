import { getWaveformPartialAmplitude } from './spectra.js';

export const DEFAULT_TONEWHEEL_DRAWBARS = [0, 0, 0, 8, 0, 0, 0, 0, 0];

/** Legacy browser spectrum, relative to half the musical fundamental. */
export function getTonewheelSpectrum(drawbars: readonly number[], waveform = 'sine'): number[] {
  if (waveform === 'pink-noise' || waveform === 'brown-noise') {
    return [1];
  }

  const partialIndices = [1, 3, 2, 4, 6, 8, 10, 12, 16];
  const maximumPartial = 64;
  const partials = Array.from({ length: maximumPartial }, () => 0);
  const addWaveformHarmonics = (basePartial: number, amplitude: number) => {
    for (let harmonic = 1; basePartial * harmonic <= maximumPartial; harmonic += 1) {
      const harmonicAmplitude = getWaveformPartialAmplitude(waveform, harmonic);
      if (harmonicAmplitude === 0) {
        continue;
      }
      partials[basePartial * harmonic - 1] += amplitude * harmonicAmplitude;
    }
  };

  partialIndices.forEach((partialIndex, drawbarIndex) => {
    addWaveformHarmonics(partialIndex, drawbars[drawbarIndex] / 8);
  });

  const normalizer = Math.max(1, Math.sqrt(partials.reduce((sum, amplitude) => sum + amplitude * amplitude, 0)));
  return partials.map((amplitude) => amplitude / normalizer);
}
