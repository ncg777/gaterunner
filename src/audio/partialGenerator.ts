export type PartialGeneratorType = 'tonewheel' | 'sequence' | 'binary';

export type PartialSequence = 'natural' | 'fibonacci' | 'primes' | 'powers-of-two' | 'thue-morse';
export type PartialMapping = 'normalize' | 'sqrt' | 'power' | 'inverse';
export type PartialMask = 'none' | 'odd' | 'even' | 'prime' | 'fibonacci' | 'power-of-two';

export interface TonewheelPartialGenerator {
  type: 'tonewheel';
}

export interface SequencePartialGenerator {
  type: 'sequence';
  sequence: PartialSequence;
  mapping: PartialMapping;
  exponent: number;
  mask: PartialMask;
  tilt: number;
}

export interface BinaryPartialGenerator {
  type: 'binary';
  operation: 'popcount' | 'parity' | 'bit';
  bit?: number;
  mapping: PartialMapping;
  exponent: number;
  tilt: number;
}

export type PartialGenerator =
  | TonewheelPartialGenerator
  | SequencePartialGenerator
  | BinaryPartialGenerator;

export interface PartialSpectrum {
  amplitudes: number[];
  ratios: number[];
}

const TONEWHEEL_RATIOS = [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8];
const SEQUENCES: PartialSequence[] = ['natural', 'fibonacci', 'primes', 'powers-of-two', 'thue-morse'];
const MAPPINGS: PartialMapping[] = ['normalize', 'sqrt', 'power', 'inverse'];
const MASKS: PartialMask[] = ['none', 'odd', 'even', 'prime', 'fibonacci', 'power-of-two'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function normalizePartialGenerator(value: unknown): PartialGenerator {
  if (!isObject(value) || (value.type !== 'sequence' && value.type !== 'binary')) {
    return { type: 'tonewheel' };
  }
  const mapping = MAPPINGS.includes(value.mapping as PartialMapping) ? value.mapping as PartialMapping : 'normalize';
  const exponent = typeof value.exponent === 'number' && Number.isFinite(value.exponent)
    ? Math.max(0.01, Math.min(8, value.exponent))
    : 1;
  const tilt = typeof value.tilt === 'number' && Number.isFinite(value.tilt)
    ? Math.max(-48, Math.min(48, value.tilt))
    : 0;
  if (value.type === 'sequence') {
    return {
      type: 'sequence',
      sequence: SEQUENCES.includes(value.sequence as PartialSequence) ? value.sequence as PartialSequence : 'natural',
      mapping,
      exponent,
      mask: MASKS.includes(value.mask as PartialMask) ? value.mask as PartialMask : 'none',
      tilt,
    };
  }
  return {
    type: 'binary',
    operation: value.operation === 'parity' || value.operation === 'bit' ? value.operation : 'popcount',
    bit: typeof value.bit === 'number' && Number.isFinite(value.bit) ? Math.max(0, Math.min(31, Math.floor(value.bit))) : 0,
    mapping,
    exponent,
    tilt,
  };
}

function isPrime(value: number): boolean {
  if (value < 2) return false;
  for (let divisor = 2; divisor * divisor <= value; divisor += 1) {
    if (value % divisor === 0) return false;
  }
  return true;
}

function isFibonacci(value: number): boolean {
  let a = 1;
  let b = 1;
  while (b < value) [a, b] = [b, a + b];
  return value === a || value === b;
}

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

function popcount(value: number): number {
  let count = 0;
  for (let bits = value; bits > 0; bits >>>= 1) count += bits & 1;
  return count;
}

function sequenceValue(sequence: PartialSequence, index: number): number {
  const n = index + 1;
  if (sequence === 'natural') return n;
  if (sequence === 'powers-of-two') return 2 ** index;
  if (sequence === 'thue-morse') return popcount(index) & 1;
  if (sequence === 'fibonacci') {
    let a = 1;
    let b = 1;
    for (let step = 1; step < n; step += 1) [a, b] = [b, a + b];
    return a;
  }
  let candidate = 1;
  let found = 0;
  while (found < n) {
    candidate += 1;
    if (isPrime(candidate)) found += 1;
  }
  return candidate;
}

function applyMapping(value: number, mapping: PartialMapping, exponent: number): number {
  if (mapping === 'inverse') return value > 0 ? 1 / value ** exponent : 0;
  if (mapping === 'sqrt') return Math.sqrt(Math.max(0, value));
  if (mapping === 'power') return Math.max(0, value) ** exponent;
  return value;
}

function applyMask(value: number, index: number, mask: PartialMask): number {
  const harmonic = index + 1;
  if (mask === 'none') return value;
  if (mask === 'odd') return harmonic % 2 === 1 ? value : 0;
  if (mask === 'even') return harmonic % 2 === 0 ? value : 0;
  if (mask === 'prime') return isPrime(harmonic) ? value : 0;
  if (mask === 'fibonacci') return isFibonacci(harmonic) ? value : 0;
  return isPowerOfTwo(harmonic) ? value : 0;
}

function finishSpectrum(values: number[], ratios: number[], tilt: number): PartialSpectrum {
  const amplitudes = values.map((value, index) => {
    const tiltGain = 10 ** ((tilt * Math.log2(ratios[index])) / 20);
    return Math.max(0, value * tiltGain);
  });
  const normalizer = Math.max(1, Math.sqrt(amplitudes.reduce((sum, value) => sum + value * value, 0)));
  return { amplitudes: amplitudes.map((value) => value / normalizer), ratios };
}

export function generatePartialSpectrum(
  generator: PartialGenerator,
  partialCount: number,
  tonewheelDrawbars: number[] = [],
): PartialSpectrum {
  const count = Math.max(0, Math.floor(partialCount));
  if (generator.type === 'tonewheel') {
    const amplitudes = TONEWHEEL_RATIOS.map((ratio, index) => (tonewheelDrawbars[index] ?? 0) / 8)
      .filter((_, index) => index < tonewheelDrawbars.length && (tonewheelDrawbars[index] ?? 0) !== 0);
    const ratios = TONEWHEEL_RATIOS.filter((_, index) => index < tonewheelDrawbars.length && (tonewheelDrawbars[index] ?? 0) !== 0);
    const normalizer = Math.max(1, Math.sqrt(amplitudes.reduce((sum, value) => sum + value * value, 0)));
    return { amplitudes: amplitudes.map((value) => value / normalizer), ratios };
  }
  const ratios = Array.from({ length: count }, (_, index) => index + 1);
  const values = ratios.map((_, index) => {
    const raw = generator.type === 'sequence'
      ? sequenceValue(generator.sequence, index)
      : generator.operation === 'popcount'
        ? popcount(index + 1)
        : generator.operation === 'parity'
          ? popcount(index + 1) & 1
          : ((index + 1) >>> (generator.bit ?? 0)) & 1;
    const mapped = applyMapping(raw, generator.mapping, generator.exponent);
    return applyMask(mapped, index, generator.type === 'sequence' ? generator.mask : 'none');
  });
  return finishSpectrum(values, ratios, generator.tilt);
}
