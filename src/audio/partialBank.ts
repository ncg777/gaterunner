import { compileMathExpression, WAVESHAPER_EXPRESSION_PROFILE } from '../domain/mathExpression.js';
import type { ModulationValues } from './modulation.js';

type Parameter = { title: string; min: number; max: number; step: number; value: number };
const parameter = (title: string, value: number, min: number, max: number, step = 0.01): Parameter => ({ title, value, min, max, step });
const primes: number[] = [];
for (let n = 2; primes.length < 64; n++) if (!primes.some(p => p * p <= n && n % p === 0)) primes.push(n);
const fibonacci = [1, 2];
while (fibonacci.length < 64) fibonacci.push(fibonacci[fibonacci.length - 1] + fibonacci[fibonacci.length - 2]);
function noise(n: number, seed: number) {
  let x = Math.imul(Math.round(n * 2) ^ seed, 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return ((x ^ (x >>> 16)) >>> 0) / 0xffffffff * 2 - 1;
}
interface PositionFunction {
  title: string; description: string; formula: string; parameters: Parameter[];
  evaluate(n: number, a: number, b: number, c: number, seed: number): number;
}
export const POSITION_FUNCTIONS = {
  harmonic: { title: 'Harmonic', description: 'The familiar harmonic series.', formula: 'n', parameters: [], evaluate: (n: number) => n },
  linear: { title: 'Linear spacing', description: 'Evenly spaced partials with adjustable distance.', formula: '1 + a*(n-1)', parameters: [parameter('Spacing', 1, 0.01, 8)], evaluate: (n: number, a: number) => 1 + a * (n - 1) },
  power: { title: 'Power stretch', description: 'Compress below 1; stretch above 1.', formula: 'n^a', parameters: [parameter('Exponent', 1.08, 0.1, 3)], evaluate: (n: number, a: number) => n ** a },
  'stiff-string': { title: 'Stiff string', description: 'Upper partials sharpen progressively.', formula: 'n*sqrt((1+a*n*n)/(1+a))', parameters: [parameter('Stiffness', 0.003, 0, 0.2, 0.001)], evaluate: (n: number, a: number) => n * Math.sqrt((1 + a * n * n) / (1 + a)) },
  logarithmic: { title: 'Logarithmic', description: 'Partials gather more closely as frequency rises.', formula: '1 + a*log(n)', parameters: [parameter('Spread', 2, 0.05, 16)], evaluate: (n: number, a: number) => 1 + a * Math.log(n) },
  geometric: { title: 'Pitch grid', description: 'Each partial is a fixed number of semitones above the last.', formula: '2^(a*(n-1)/12)', parameters: [parameter('Semitones per partial', 3, 0.01, 24)], evaluate: (n: number, a: number) => 2 ** (a * (n - 1) / 12) },
  odd: { title: 'Odd series', description: 'The odd-numbered harmonics.', formula: '2*n-1', parameters: [], evaluate: (n: number) => 2 * n - 1 },
  subharmonic: { title: 'Subharmonic', description: 'A descending series beneath the played note.', formula: '1/n^a', parameters: [parameter('Exponent', 1, 0.1, 2)], evaluate: (n: number, a: number) => n ** -a },
  primes: { title: 'Prime series', description: 'Prime-number ratios, anchored to the first prime.', formula: 'prime(round(n))/2', parameters: [], evaluate: (n: number) => primes[Math.max(0, Math.min(63, Math.round(n) - 1))] / 2 },
  fibonacci: { title: 'Fibonacci series', description: 'Increasingly wide intervals from 1, 2, 3, 5, 8…', formula: 'fibonacci(round(n))', parameters: [], evaluate: (n: number) => fibonacci[Math.max(0, Math.min(63, Math.round(n) - 1))] },
  triangular: { title: 'Triangular series', description: 'Ratios 1, 3, 6, 10, 15…', formula: 'n*(n+1)/2', parameters: [], evaluate: (n: number) => n * (n + 1) / 2 },
  square: { title: 'Square series', description: 'Widely separated ratios 1, 4, 9, 16…', formula: 'n*n', parameters: [], evaluate: (n: number) => n * n },
  root: { title: 'Square root', description: 'Dense fractional ratios 1, √2, √3…', formula: 'sqrt(n)', parameters: [], evaluate: (n: number) => Math.sqrt(n) },
  'root-lattice': { title: 'Root lattice', description: 'A curved family of closely spaced ratios.', formula: 'sqrt((n*n+a)/(1+a))', parameters: [parameter('Compression', 3, 0, 100)], evaluate: (n: number, a: number) => Math.sqrt((n * n + a) / (1 + a)) },
  golden: { title: 'Golden ratio', description: 'Geometric spacing based on the golden ratio.', formula: '((1+sqrt(5))/2)^(a*(n-1))', parameters: [parameter('Spacing exponent', 0.5, 0.01, 2)], evaluate: (n: number, a: number) => ((1 + Math.sqrt(5)) / 2) ** (a * (n - 1)) },
  cluster: { title: 'Bounded cluster', description: 'Partials converge toward a chosen upper ratio.', formula: '1+a*tanh((n-1)/b)', parameters: [parameter('Width', 2, 0.01, 32), parameter('Convergence', 8, 0.1, 64)], evaluate: (n: number, a: number, b: number) => 1 + a * Math.tanh((n - 1) / b) },
  alternating: { title: 'Alternating detune', description: 'Odd and even partials shift in opposite directions.', formula: 'n*2^((round(n)%2 ? -a : a)/1200)', parameters: [parameter('Detune (cents)', 30, -1200, 1200, 1)], evaluate: (n: number, a: number) => n * 2 ** ((Math.round(n) % 2 ? -a : a) / 1200) },
  ripple: { title: 'Spectral ripple', description: 'A sinusoidal detuning pattern across the bank.', formula: 'n*2^(a*sin(b*(n-1)+c)/1200)', parameters: [parameter('Depth (cents)', 100, -1200, 1200, 1), parameter('Rate across partials', 1, 0.01, 6.28), parameter('Phase (radians)', 0, -6.28, 6.28)], evaluate: (n: number, a: number, b: number, c: number) => n * 2 ** (a * Math.sin(b * (n - 1) + c) / 1200) },
  jitter: { title: 'Seeded irregularity', description: 'Repeatable detuning; changing depth keeps the same pattern.', formula: 'n*2^(a*seededNoise(n)/1200)', parameters: [parameter('Depth (cents)', 80, 0, 1200, 1)], evaluate: (n: number, a: number, _b: number, _c: number, seed: number) => n * 2 ** (a * noise(n, seed) / 1200) },
  custom: { title: 'Custom expression', description: 'Use n for the original partial ratio and a, b, c for live parameters.', formula: 'n^a', parameters: [parameter('a', 1, -16, 16), parameter('b', 0, -16, 16), parameter('c', 0, -16, 16)], evaluate: (n: number) => n },
} satisfies Record<string, PositionFunction>;
export type PositionFunctionType = keyof typeof POSITION_FUNCTIONS;
export interface BankPosition { type: PositionFunctionType; a: number; b: number; c: number; seed: number; expression: string }
export interface PartialBankSettings { position: BankPosition; target: BankPosition; morph: number; anchor: boolean }
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' ? v as Record<string, unknown> : {};
const bound = (v: unknown, fallback: number, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
export function normalizeBankPosition(value: unknown): BankPosition {
  const r = record(value);
  const type = Object.prototype.hasOwnProperty.call(POSITION_FUNCTIONS, String(r.type)) ? r.type as PositionFunctionType : 'harmonic';
  const definition: PositionFunction = POSITION_FUNCTIONS[type];
  const params = ['a', 'b', 'c'].map((key, i) => {
    const p = definition.parameters[i];
    return p ? bound(r[key], p.value, p.min, p.max) : 0;
  });
  return { type, a: params[0], b: params[1], c: params[2], seed: Math.round(bound(r.seed, 1, 0, 2147483647)),
    expression: typeof r.expression === 'string' ? r.expression.slice(0, 512) : 'n^a' };
}
export function normalizePartialBank(value: unknown): PartialBankSettings {
  const r = record(value);
  return { position: normalizeBankPosition(r.position), target: normalizeBankPosition(r.target ?? { type: 'power' }),
    morph: bound(r.morph, 0, 0, 1), anchor: r.anchor !== false };
}
const profile = { ...WAVESHAPER_EXPRESSION_PROFILE, input: 'n' };
export function bankExpressionError(expression: string): string | null {
  try {
    const compiled = compileMathExpression(expression, profile);
    if (compiled.parameters.some(p => !['a', 'b', 'c'].includes(p))) return 'Only n, a, b, c, PI and E are available.';
    return null;
  } catch (e) { return e instanceof Error ? e.message : 'Invalid expression'; }
}
/** Compile once per patch. Ratios are always relative to the musical note, not its half-frequency carrier. */
export function compileBankPosition(settings: PartialBankSettings) {
  const compile = (s: BankPosition, prefix: 'position' | 'target') => {
    const definition: PositionFunction = POSITION_FUNCTIONS[s.type];
    const expression = s.type === 'custom' && !bankExpressionError(s.expression) ? compileMathExpression(s.expression, profile) : null;
    return (n: number, m: ModulationValues) => {
      const values = [s.a + m[`${prefix}A`], s.b + m[`${prefix}B`], s.c + m[`${prefix}C`]];
      definition.parameters.forEach((p, i) => { values[i] = Math.max(p.min, Math.min(p.max, values[i])); });
      const [a, b, c] = values;
      const raw = (x: number) => {
        try { return s.type === 'custom' ? expression?.evaluate(x, { a, b, c }) as number ?? NaN
          : definition.evaluate(x, a, b, c, s.seed); } catch { return NaN; }
      };
      const anchor = settings.anchor ? raw(1) : 1;
      const ratio = anchor > 0 ? raw(n) / anchor : 0;
      return Number.isFinite(ratio) && ratio > 0 ? Math.max(1 / 64, Math.min(256, ratio)) : 0;
    };
  };
  const from = compile(settings.position, 'position'), to = compile(settings.target, 'target');
  return (n: number, m: ModulationValues) => {
    const morph = Math.max(0, Math.min(1, settings.morph + m.positionMorph));
    const a = from(n, m);
    if (morph === 0) return a;
    const b = to(n, m);
    if (morph === 1) return b;
    // Invalid endpoints silence the slot. Log interpolation follows musical pitch distance.
    return a > 0 && b > 0 ? a * (b / a) ** morph : 0;
  };
}

/** Fade the top tenth of the available band instead of folding high partials back into the sound. */
export function bankBandGain(frequency: number, sampleRate: number): number {
  return Math.max(0, Math.min(1, (sampleRate * 0.5 - frequency) / (sampleRate * 0.05)));
}

export function normalizeBankAmplitudes(spectrum: number[]): number[] {
  const energy = Math.hypot(...spectrum);
  return energy > 1 ? spectrum.map(a => a / energy) : spectrum;
}
