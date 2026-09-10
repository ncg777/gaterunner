import { getWaveformPartialAmplitude } from './spectra.js';
import { DEFAULT_TONEWHEEL_DRAWBARS, getTonewheelSpectrum } from './tonewheelSpectrum.js';

export type PartialSpectrum = number[];
export type PartialSequence = 'natural' | 'fibonacci' | 'primes' | 'powers-of-two' | 'thue-morse';
export type PartialMapping = 'linear' | 'power' | 'sqrt' | 'inverse';
export type PartialMask = 'none' | 'odd' | 'even' | 'prime' | 'fibonacci' | 'power-of-two';
export type PartialBinaryMode = 'popcount' | 'parity' | 'bit';

interface ProceduralSettings {
  harmonicCount: number;
  normalize: boolean;
  mapping: PartialMapping;
  exponent: number;
  mask: PartialMask;
  tilt: number;
}

interface WaveformSettings {
  harmonicCount: number;
  tilt: number;
  contrast: number;
  oddEvenBalance: number;
  mask: PartialMask;
  normalize: boolean;
}

export type PartialGenerator =
  | { type: 'tonewheel' }
  | (Partial<WaveformSettings> & { type: 'waveform' })
  | (ProceduralSettings & { type: 'sequence'; sequence: PartialSequence })
  | (ProceduralSettings & { type: 'binary'; mode: PartialBinaryMode; bit: number });

export type NormalizedPartialGenerator =
  | Exclude<PartialGenerator, { type: 'waveform' }>
  | (WaveformSettings & { type: 'waveform' });

export const MAX_PROCEDURAL_AMPLITUDE = Number.MAX_SAFE_INTEGER;

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : fallback;
}

function choice<T extends string>(value: unknown, choices: readonly T[], fallback: T): T {
  return choices.includes(value as T) ? value as T : fallback;
}

export function normalizePartialGenerator(value: unknown): NormalizedPartialGenerator {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  if (raw.type === 'waveform') return {
    type: 'waveform',
    harmonicCount: Math.round(boundedNumber(raw.harmonicCount, 64, 1, 64)),
    tilt: boundedNumber(raw.tilt, 0, -24, 24),
    contrast: boundedNumber(raw.contrast, 1, 0.25, 4),
    oddEvenBalance: boundedNumber(raw.oddEvenBalance, 0, -24, 24),
    mask: choice(raw.mask, ['none', 'odd', 'even', 'prime', 'fibonacci', 'power-of-two'], 'none'),
    normalize: typeof raw.normalize === 'boolean' ? raw.normalize : false,
  };
  if (raw.type !== 'sequence' && raw.type !== 'binary') {
    return { type: 'tonewheel' };
  }
  const sequences: readonly PartialSequence[] = ['natural', 'fibonacci', 'primes', 'powers-of-two', 'thue-morse'];
  const modes: readonly PartialBinaryMode[] = ['popcount', 'parity', 'bit'];
  if ((raw.type === 'sequence' && raw.sequence !== undefined && !sequences.includes(raw.sequence as PartialSequence))
    || (raw.type === 'binary' && raw.mode !== undefined && !modes.includes(raw.mode as PartialBinaryMode))) {
    return { type: 'tonewheel' };
  }
  const common: ProceduralSettings = {
    harmonicCount: Math.round(boundedNumber(raw.harmonicCount, 16, 1, 64)),
    normalize: typeof raw.normalize === 'boolean' ? raw.normalize : true,
    mapping: choice(raw.mapping, ['linear', 'power', 'sqrt', 'inverse'], 'linear'),
    exponent: boundedNumber(raw.exponent, 1, 0.1, 4),
    mask: choice(raw.mask, ['none', 'odd', 'even', 'prime', 'fibonacci', 'power-of-two'], 'none'),
    tilt: boundedNumber(raw.tilt, 0, -24, 24),
  };
  return raw.type === 'sequence'
    ? { type: 'sequence', sequence: choice(raw.sequence, sequences, 'natural'), ...common }
    : { type: 'binary', mode: choice(raw.mode, modes, 'popcount'), bit: Math.round(boundedNumber(raw.bit, 0, 0, 5)), ...common };
}

export function isNoiseWaveform(waveform: string): boolean {
  return waveform === 'pink-noise' || waveform === 'brown-noise';
}

/** Only legacy noise tracks without an explicit source need source migration. */
export function normalizeTrackPartialGenerator(value: unknown, waveform: string): NormalizedPartialGenerator {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  if (!['tonewheel', 'waveform', 'sequence', 'binary'].includes(raw.type as string) && isNoiseWaveform(waveform)) {
    return normalizePartialGenerator({ type: 'waveform' });
  }
  return normalizePartialGenerator(value);
}

export function getEffectiveWaveform(generator: unknown, waveform: string): string {
  return normalizePartialGenerator(generator).type === 'waveform' ? waveform : 'sine';
}

function isPrime(value: number): boolean {
  if (value < 2) return false;
  for (let divisor = 2; divisor * divisor <= value; divisor += 1) {
    if (value % divisor === 0) return false;
  }
  return true;
}

function popcount(value: number): number {
  let count = 0;
  for (let bits = value; bits > 0; bits >>>= 1) count += bits & 1;
  return count;
}

function passesMask(harmonic: number, mask: PartialMask): boolean {
  switch (mask) {
    case 'odd': return harmonic % 2 === 1;
    case 'even': return harmonic % 2 === 0;
    case 'prime': return isPrime(harmonic);
    case 'power-of-two': return (harmonic & (harmonic - 1)) === 0;
    case 'fibonacci': {
      let previous = 1;
      let current = 1;
      while (current < harmonic) [previous, current] = [current, previous + current];
      return current === harmonic;
    }
    default: return true;
  }
}

/** Direct note-harmonic amplitudes before half-fundamental expansion. */
export function generateProceduralAmplitudes(value: unknown): number[] {
  const generator = normalizePartialGenerator(value);
  if (generator.type !== 'sequence' && generator.type !== 'binary') return [];
  let previous = 0;
  let current = 1;
  let prime = 1;
  const amplitudes = Array.from({ length: generator.harmonicCount }, (_, n) => {
    const harmonic = n + 1;
    let weight: number;
    if (generator.type === 'binary') {
      weight = generator.mode === 'bit' ? (n >>> generator.bit) & 1
        : generator.mode === 'parity' ? popcount(n) % 2 : popcount(n);
    } else {
      switch (generator.sequence) {
        case 'fibonacci':
          weight = current;
          [previous, current] = [current, previous + current];
          break;
        case 'primes':
          do { prime += 1; } while (!isPrime(prime));
          weight = prime;
          break;
        case 'powers-of-two': weight = 2 ** n; break;
        case 'thue-morse': weight = popcount(n) % 2; break;
        default: weight = harmonic;
      }
    }
    // Zero stays silent, including inverse and externally supplied zero exponents.
    if (weight === 0) return 0;
    switch (generator.mapping) {
      case 'power': weight **= generator.exponent; break;
      case 'sqrt': weight = Math.sqrt(weight); break;
      case 'inverse': weight = 1 / weight; break;
    }
    if (!passesMask(harmonic, generator.mask)) return 0;
    weight *= 10 ** ((generator.tilt * Math.log2(harmonic)) / 20);
    return weight;
  });
  const peak = Math.max(...amplitudes);
  // Bounded counts/exponents keep raw values finite; normalize before limiting
  // unnormalized output so large sequences retain their relative amplitudes.
  return generator.normalize && peak > 0
    ? amplitudes.map((weight) => weight / peak)
    : amplitudes.map((weight) => Math.min(MAX_PROCEDURAL_AMPLITUDE, weight));
}

function generateWaveformAmplitudes(generator: WaveformSettings, waveform: string): number[] {
  const amplitudes = Array.from({ length: generator.harmonicCount }, (_, index) => {
    const harmonic = index + 1;
    const amplitude = getWaveformPartialAmplitude(waveform, harmonic);
    if (amplitude === 0 || !passesMask(harmonic, generator.mask)) return 0;
    // Positive balance attenuates odd harmonics; negative balance attenuates even ones.
    const balanceDb = harmonic % 2 === 1
      ? -Math.max(0, generator.oddEvenBalance) : Math.min(0, generator.oddEvenBalance);
    const gain = 10 ** ((generator.tilt * Math.log2(harmonic) + balanceDb) / 20);
    return Math.sign(amplitude) * Math.abs(amplitude) ** generator.contrast * gain;
  });
  const peak = Math.max(...amplitudes.map(Math.abs));
  return generator.normalize && peak > 0 ? amplitudes.map(amplitude => amplitude / peak) : amplitudes;
}

/** Source-local spectrum on the half-musical-fundamental basis. */
export function generatePartialSpectrum(
  generator: unknown,
  waveform = 'sine',
  drawbars: readonly number[] = DEFAULT_TONEWHEEL_DRAWBARS,
): PartialSpectrum {
  const normalized = normalizePartialGenerator(generator);
  if (normalized.type === 'tonewheel') return getTonewheelSpectrum(drawbars, 'sine');
  if (normalized.type === 'waveform' && isNoiseWaveform(waveform)) return [];
  const amplitudes = normalized.type === 'waveform'
    ? generateWaveformAmplitudes(normalized, waveform)
    : generateProceduralAmplitudes(normalized);
  const spectrum = Array.from({ length: amplitudes.length * 2 }, () => 0);
  amplitudes.forEach((weight, index) => {
    spectrum[2 * (index + 1) - 1] = weight;
  });
  return spectrum;
}
