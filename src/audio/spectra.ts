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

export function gaussian(harmonic: number, center: number, width: number): number {
  const safeWidth = Math.max(0.001, width);
  return Math.exp(-((harmonic - center) ** 2) / (2 * safeWidth * safeWidth));
}

export function pseudoNoise(harmonic: number): number {
  const raw = Math.sin(harmonic * 12.9898 + 78.233) * 43758.5453123;
  return ((raw - Math.floor(raw)) * 2) - 1;
}

export function getWaveformPartialAmplitude(waveform: string, harmonic: number): number {
  const noisyTail = pseudoNoise(harmonic) / Math.sqrt(harmonic);
  if (waveform === 'triangle') {
    if (harmonic % 2 === 0) {
      return 0;
    }
    return (Math.floor(harmonic / 2) % 2 === 0 ? 1 : -1) / (harmonic * harmonic);
  }
  if (waveform === 'sawtooth') {
    return -1 / harmonic;
  }
  if (waveform === 'square') {
    return harmonic % 2 === 0 ? 0 : 1 / harmonic;
  }
  if (waveform === 'flute') {
    return getFluteHarmonicAmplitude(harmonic)
      + (0.02 * noisyTail * gaussian(harmonic, 8, 3));
  }
  if (isReedWaveform(waveform)) {
    return getReedHarmonicAmplitude(waveform, harmonic);
  }
  if (isPulseWaveform(waveform)) {
    return getPulseHarmonicAmplitude(PULSE_DUTY[waveform], harmonic);
  }
  // Choir uses parallel fixed-frequency formants; keep a bright saw-like excitation here.
  if (waveform === 'choir-ah' || waveform === 'choir-oh') {
    return (-1 / harmonic) + (0.035 * noisyTail);
  }
  if (waveform === 'helmholtz') {
    return (harmonic === 1 ? 1.35 : 0)
      + (0.78 * gaussian(harmonic, 4, 1.15))
      + (0.22 * noisyTail * gaussian(harmonic, 10, 3.4));
  }
  if (waveform === 'formant') {
    return (0.45 * gaussian(harmonic, 1.5, 0.8))
      + (1.05 * gaussian(harmonic, 4.5, 1.3))
      + (0.82 * gaussian(harmonic, 9.5, 2))
      + (0.12 * noisyTail * gaussian(harmonic, 15, 4));
  }
  if (waveform === 'duct') {
    return (0.6 * gaussian(harmonic, 2.2, 0.7))
      + (0.95 * gaussian(harmonic, 6.2, 1.4))
      + (0.55 * gaussian(harmonic, 12.4, 2.6))
      + (0.18 * noisyTail);
  }
  if (waveform === 'aeolian') {
    return (harmonic === 1 ? 0.55 : 0)
      + (0.38 * Math.abs(noisyTail))
      + (0.65 * gaussian(harmonic, 7.5, 3.2))
      + (0.28 * noisyTail * gaussian(harmonic, 18, 5.5));
  }
  if (waveform === 'stochastic-bandpass') {
    return (0.16 * noisyTail)
      + (1.15 * gaussian(harmonic, 5.5, 1.1))
      + (0.95 * gaussian(harmonic, 11.5, 2))
      + (0.4 * Math.sign(noisyTail || 1) * gaussian(harmonic, 18, 3.2));
  }
  return harmonic === 1 ? 1 : 0;
}