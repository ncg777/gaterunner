export const CHOIR_FORMANT_GAIN_COMPENSATION_DB = 12;

export interface FormantBand {
  frequency: number;
  bandwidth: number;
  gainDb: number;
}

export const CHOIR_FORMANT_BANDS: Record<'choir-ah' | 'choir-oh', readonly FormantBand[]> = {
  'choir-ah': [
    { frequency: 730, bandwidth: 90, gainDb: 0 },
    { frequency: 1090, bandwidth: 110, gainDb: -4 },
    { frequency: 2440, bandwidth: 140, gainDb: -8 },
    { frequency: 3400, bandwidth: 220, gainDb: -14 },
    { frequency: 4500, bandwidth: 280, gainDb: -20 },
  ],
  'choir-oh': [
    { frequency: 450, bandwidth: 70, gainDb: 0 },
    { frequency: 800, bandwidth: 90, gainDb: -5 },
    { frequency: 2830, bandwidth: 130, gainDb: -12 },
    { frequency: 3500, bandwidth: 200, gainDb: -18 },
    { frequency: 4500, bandwidth: 260, gainDb: -24 },
  ],
};

/**
 * Choir vowel banks use many negative-dB formant peaks to keep the spectrum balanced.
 * The synth path still needs a modest +12 dB lift so the resulting vowel stack remains
 * audible across the mix and does not vanish behind other oscillator waveforms.
 */
export function getChoirFormantBandGainLinear(gainDb: number): number {
  return Math.pow(10, (gainDb + CHOIR_FORMANT_GAIN_COMPENSATION_DB) / 20);
}
