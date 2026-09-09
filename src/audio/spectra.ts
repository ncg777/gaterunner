export const FLUTE_HARMONICS = [1, 0.25, 0.1, 0.04, 0.02] as const;

export const REED_HARMONICS = {
  oboe: [1, 0.85, 0.95, 0.7, 0.5, 0.35, 0.22, 0.14, 0.09, 0.05, 0.03, 0.02],
  clarinet: [1, 0.04, 0.65, 0.03, 0.4, 0.02, 0.22, 0.015, 0.12, 0.01, 0.06, 0.005],
  saxophone: [1, 0.75, 0.55, 0.42, 0.32, 0.25, 0.19, 0.14, 0.1, 0.07, 0.05, 0.035],
} as const;

export type ReedWaveform = keyof typeof REED_HARMONICS;

export const PULSE_DUTY = {
  'pulse-25': 0.25,
  'pulse-12': 0.125,
} as const;

export type PulseWaveform = keyof typeof PULSE_DUTY;

export const BREATH_FILTER_Q = 2;

export function getFluteHarmonicAmplitude(harmonic: number): number {
  return harmonic > 0 ? FLUTE_HARMONICS[harmonic - 1] ?? 0 : 0;
}

export function isReedWaveform(waveform: string): waveform is ReedWaveform {
  return Object.prototype.hasOwnProperty.call(REED_HARMONICS, waveform);
}

export function getReedHarmonicAmplitude(waveform: ReedWaveform, harmonic: number): number {
  return harmonic > 0 ? REED_HARMONICS[waveform][harmonic - 1] ?? 0 : 0;
}

export function isPulseWaveform(waveform: string): waveform is PulseWaveform {
  return waveform in PULSE_DUTY;
}

export function getPulseHarmonicAmplitude(duty: number, harmonic: number): number {
  return harmonic > 0 ? Math.sin(Math.PI * harmonic * duty) / harmonic : 0;
}