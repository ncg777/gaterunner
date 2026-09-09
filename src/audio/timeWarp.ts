import { compileMathExpression, type MathExpressionProfile } from '../domain/mathExpression.js';

export type TimeWarpFn = (t: number) => number;

export interface TimeWarpCurveOption {
  title: string;
  value: string;
  group: string;
}

export interface TimeWarpResolution {
  fn: TimeWarpFn;
  error: string | null;
  source: 'builtin' | 'custom' | 'fallback';
}

interface BuiltinCurveEntry extends TimeWarpCurveOption {
  fn: TimeWarpFn;
}

type EvalValue = number | number[];

const PI = Math.PI;
const MIN_NOTE_DIVISIONS = 1;

export const DEFAULT_TIME_WARP_CURVE = 'lin';
export const CUSTOM_TIME_WARP_CURVE = 'custom';

export const TIME_WARP_QUANTIZE_OPTIONS = [0, 1, 2, 4, 8] as const;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return clamp(value, 0, 1);
}

export function integerPart(value: number): number {
  return value < 0 ? Math.ceil(value) : Math.floor(value);
}

export function fracPart(value: number): number {
  return value - integerPart(value);
}

export function sawWform(x: number): number {
  const f = fracPart(x);
  return (f * 2.0) - 1.0;
}

export function revsawWform(x: number): number {
  const f = fracPart(x);
  return 1.0 - (f * 2.0);
}

export function triangleWform(x: number): number {
  return -2.0 * (Math.asin(Math.sin(2.0 * PI * (x - 0.5))) / PI);
}

function asFiniteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function wform(x: number, ...args: number[]): number {
  if (args.length < 3) {
    return 0;
  }

  const values: number[] = [];
  const durations: number[] = [];

  values.push(asFiniteNumber(args[0], 0));
  for (let i = 1; i < args.length; i += 2) {
    const duration = asFiniteNumber(args[i], 0);
    const nextValue = asFiniteNumber(args[i + 1], values[values.length - 1]);
    durations.push(duration);
    values.push(nextValue);
    if (i + 1 >= args.length - 1) {
      break;
    }
  }

  if (values.length < 2) {
    return asFiniteNumber(values[0], 0);
  }

  const steps = durations.reduce((sum, value) => sum + value, 0);
  durations.push(Math.max(0, 1.0 - steps));
  values.push(values[0]);

  const xx = x - integerPart(x);
  let elapsed = 0;
  const offset = integerPart(x);

  for (let i = 0; i < durations.length; i += 1) {
    const duration = durations[i];
    elapsed += duration;

    if (elapsed > xx || i === durations.length - 1) {
      const startValue = values[i];
      const endValue = values[i + 1];
      if (duration <= 0) {
        return offset + endValue;
      }
      const segmentStart = elapsed - duration;
      const mix = (xx - segmentStart) / duration;
      return offset + startValue + (endValue - startValue) * mix;
    }
  }

  return offset + values[values.length - 1];
}

export function stowform(x: number, seq: number[]): number {
  if (!Array.isArray(seq) || seq.length < 2) {
    return x;
  }

  const tmax = Math.max(...seq);
  if (!Number.isFinite(tmax) || tmax === 0) {
    return x;
  }

  const normalized = seq.map((value) => asFiniteNumber(value, 0) / tmax);
  const spacing = 1.0 / (normalized.length - 1);
  const args: number[] = [];

  for (let i = 0; i < normalized.length; i += 1) {
    args.push(normalized[i]);
    if (i < normalized.length - 1) {
      args.push(spacing);
    }
  }

  return wform(x, ...args);
}

function halfSinePower(exponent: number): TimeWarpFn {
  return (t) => Math.pow(Math.sin(PI * t), exponent);
}

function reversePower(exponent: number): TimeWarpFn {
  return (t) => Math.pow(1.0 - t, exponent);
}

function fmModel1(amp: number, freq: number, modfreq: number, modindex: number): TimeWarpFn {
  return (t) => t + Math.sin(PI * t) * amp * Math.sin(freq * 2 * PI * (t + modindex * Math.sin(modfreq * 2 * PI * t)));
}

function fmModel2(amp: number, freq: number, modfreq: number, modindex: number): TimeWarpFn {
  return (t) => t + Math.pow(Math.sin(PI * t), 2.0) * amp * Math.sin(freq * 2 * PI * (t + modindex * Math.sin(modfreq * 2 * PI * t)));
}

function fmModel3(amp: number, freq: number, modfreq: number, modindex: number): TimeWarpFn {
  return (t) => t + (1.0 - Math.sin(PI * t)) * amp * Math.sin(freq * 2 * PI * (t + modindex * Math.sin(modfreq * 2 * PI * t)));
}

function fmModel4(amp: number, freq: number, modfreq: number, modindex: number): TimeWarpFn {
  return (t) => t + Math.sin(PI * t) * amp * triangleWform(freq * (t + modindex * Math.sin(modfreq * 2 * PI * t)));
}

function fmModel5(amp: number, freq: number, modfreq: number, modindex: number): TimeWarpFn {
  return (t) => t + Math.sin(PI * t) * amp * sawWform(freq * (t + modindex * Math.sin(modfreq * 2 * PI * t)));
}

function circularIn(t: number): number {
  return 1.0 - Math.sqrt(Math.max(0, 1.0 - t * t));
}

function circularOut(t: number): number {
  const u = t - 1.0;
  return Math.sqrt(Math.max(0, 1.0 - u * u));
}

function circularInOut(t: number): number {
  return t < 0.5 ? circularIn(t * 2.0) / 2.0 : 0.5 + circularOut((t * 2.0) - 1.0) / 2.0;
}

function backIn(t: number): number {
  return (t * t) * ((2.70158 * t) - 1.70158);
}

function backOut(t: number): number {
  const u = t - 1.0;
  return 1.0 + (2.70158 * u * u * u) + (1.70158 * u * u);
}

function bounceOut(t: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1.0 / d) {
    return n * t * t;
  }
  if (t < 2.0 / d) {
    const u = t - (1.5 / d);
    return (n * u * u) + 0.75;
  }
  if (t < 2.5 / d) {
    const u = t - (2.25 / d);
    return (n * u * u) + 0.9375;
  }
  const u = t - (2.625 / d);
  return (n * u * u) + 0.984375;
}

function elasticPulse(amp: number, freq: number): TimeWarpFn {
  return (t) => t + Math.sin(PI * t) * amp * Math.sin(freq * 2 * PI * t);
}

const F5_WFORM_ARGS = [
  0, 0.0625, 0.0625, 0, 0.3125, 0.125, 0.4375, 0, 0.1875, 0.0625,
  0.25, 0, 0.5, 0.25, 0.75, 0, 0.25, 0.0625, 0.3125, 0,
  0.8125, 0.125, 0.9375, 0, 0.4375, 0.0625, 0.5, 0, 0.75, 0.0625,
  0.8125, 0, 0.0625, 0.125, 0.1875, 0, 0.9375, 0.0625, 1,
];

const F6_WFORM_ARGS = [
  0, 0.25, 0.25, 0, 0.375, 0.25, 0.625, 0, 0.75, 0.125, 0.875, 0,
  0.25, 0.125, 0.375, 0, 0.875, 0.125, 1, 0, 0.625, 0.125, 0.75,
];

const BUILTIN_CURVES: BuiltinCurveEntry[] = [
  { value: 'lin', title: 'lin', group: 'Basic', fn: (t) => t },
  { value: 'invlin', title: 'invlin', group: 'Basic', fn: (t) => 1.0 - t },
  { value: 'smoothstep', title: 'smoothstep', group: 'Basic', fn: (t) => (t * t) * (3.0 - (2.0 * t)) },
  { value: 'smootherstep', title: 'smootherstep', group: 'Basic', fn: (t) => (t * t * t) * (t * (t * 6.0 - 15.0) + 10.0) },
  { value: 'halfsine', title: 'halfsine', group: 'Half-Sine Power', fn: halfSinePower(1.0) },
  { value: 'hsp1over3', title: 'hsp1over3', group: 'Half-Sine Power', fn: halfSinePower(1.0 / 3.0) },
  { value: 'hsp1over2', title: 'hsp1over2', group: 'Half-Sine Power', fn: halfSinePower(1.0 / 2.0) },
  { value: 'hsp1', title: 'hsp1', group: 'Half-Sine Power', fn: halfSinePower(1.0) },
  { value: 'hsp2', title: 'hsp2', group: 'Half-Sine Power', fn: halfSinePower(2.0) },
  { value: 'hsp3', title: 'hsp3', group: 'Half-Sine Power', fn: halfSinePower(3.0) },
  { value: 'bump', title: 'bump', group: 'Bell and Fold', fn: (t) => Math.sin(PI * t) },
  { value: 'dip', title: 'dip', group: 'Bell and Fold', fn: (t) => 1.0 - Math.sin(PI * t) },
  { value: 'bell2', title: 'bell2', group: 'Bell and Fold', fn: (t) => Math.pow(Math.sin(PI * t), 2.0) },
  { value: 'bell4', title: 'bell4', group: 'Bell and Fold', fn: (t) => Math.pow(Math.sin(PI * t), 4.0) },
  { value: 'mirror', title: 'mirror', group: 'Bell and Fold', fn: (t) => Math.abs((2.0 * t) - 1.0) },
  { value: 'tent', title: 'tent', group: 'Bell and Fold', fn: (t) => 1.0 - Math.abs((2.0 * t) - 1.0) },
  { value: 'rev', title: 'rev', group: 'Reverse Power', fn: reversePower(1.0) },
  { value: 'rp1over3', title: 'rp1over3', group: 'Reverse Power', fn: reversePower(1.0 / 3.0) },
  { value: 'rp1over2', title: 'rp1over2', group: 'Reverse Power', fn: reversePower(1.0 / 2.0) },
  { value: 'rp1', title: 'rp1', group: 'Reverse Power', fn: reversePower(1.0) },
  { value: 'rp2', title: 'rp2', group: 'Reverse Power', fn: reversePower(2.0) },
  { value: 'rp3', title: 'rp3', group: 'Reverse Power', fn: reversePower(3.0) },
  { value: 'rp4', title: 'rp4', group: 'Reverse Power', fn: reversePower(4.0) },
  { value: 'rp5', title: 'rp5', group: 'Reverse Power', fn: reversePower(5.0) },
  { value: 'pow1over2', title: 'pow1over2', group: 'Power', fn: (t) => Math.pow(t, 1.0 / 2.0) },
  { value: 'pow1over3', title: 'pow1over3', group: 'Power', fn: (t) => Math.pow(t, 1.0 / 3.0) },
  { value: 'pow2over3', title: 'pow2over3', group: 'Power', fn: (t) => Math.pow(t, 2.0 / 3.0) },
  { value: 'pow2', title: 'pow2', group: 'Power', fn: (t) => Math.pow(t, 2.0) },
  { value: 'pow3', title: 'pow3', group: 'Power', fn: (t) => Math.pow(t, 3.0) },
  { value: 'pow4', title: 'pow4', group: 'Power', fn: (t) => Math.pow(t, 4.0) },
  { value: 'pow5', title: 'pow5', group: 'Power', fn: (t) => Math.pow(t, 5.0) },
  { value: 'powm1over3', title: 'powm1over3', group: 'Power', fn: (t) => 1.0 - Math.pow(t, 1.0 / 3.0) },
  { value: 'sqrt', title: 'sqrt', group: 'Power', fn: (t) => Math.sqrt(t) },
  { value: 'step2', title: 'step2', group: 'Basic', fn: (t) => integerPart(t * 2) / 2.0 },
  { value: 'step4', title: 'step4', group: 'Basic', fn: (t) => integerPart(t * 4) / 4.0 },
  { value: 'step8', title: 'step8', group: 'Basic', fn: (t) => integerPart(t * 8) / 8.0 },
  { value: 'step16', title: 'step16', group: 'Basic', fn: (t) => integerPart(t * 16) / 16.0 },
  { value: 'circin', title: 'circin', group: 'Circular', fn: circularIn },
  { value: 'circout', title: 'circout', group: 'Circular', fn: circularOut },
  { value: 'circinout', title: 'circinout', group: 'Circular', fn: circularInOut },
  { value: 'backin', title: 'backin', group: 'Overshoot', fn: backIn },
  { value: 'backout', title: 'backout', group: 'Overshoot', fn: backOut },
  { value: 'bouncein', title: 'bouncein', group: 'Overshoot', fn: (t) => 1.0 - bounceOut(1.0 - t) },
  { value: 'bounceout', title: 'bounceout', group: 'Overshoot', fn: bounceOut },
  { value: 'elastic1', title: 'elastic1', group: 'Overshoot', fn: elasticPulse(0.1875, 5) },
  { value: 'elastic2', title: 'elastic2', group: 'Overshoot', fn: elasticPulse(0.25, 8) },
  { value: 'sin1', title: 'sin1', group: 'Wobble', fn: (t) => t + Math.sin(2 * PI * t) * 0.25 },
  { value: 'sin2', title: 'sin2', group: 'Wobble', fn: (t) => t + Math.sin(2 * PI * 2 * t) * 0.1875 },
  { value: 'sin4', title: 'sin4', group: 'Wobble', fn: (t) => t + Math.sin(2 * PI * 4 * t) * 0.125 },
  { value: 'sin8', title: 'sin8', group: 'Wobble', fn: (t) => t + Math.sin(2 * PI * 8 * t) * 0.125 },
  { value: 'sin16', title: 'sin16', group: 'Wobble', fn: (t) => t + Math.sin(2 * PI * 16 * t) * 0.0625 },
  { value: 'tri4', title: 'tri4', group: 'Wobble', fn: (t) => t + triangleWform(4 * t) * 0.1875 },
  { value: 'tri8', title: 'tri8', group: 'Wobble', fn: (t) => t + triangleWform(8 * t) * 0.125 },
  { value: 'saw4', title: 'saw4', group: 'Wobble', fn: (t) => t + sawWform(4 * t) * 0.1875 },
  { value: 'saw8', title: 'saw8', group: 'Wobble', fn: (t) => t + sawWform(8 * t) * 0.125 },
  { value: 'revsaw4', title: 'revsaw4', group: 'Wobble', fn: (t) => t + revsawWform(4 * t) * 0.1875 },
  { value: 'revsaw8', title: 'revsaw8', group: 'Wobble', fn: (t) => t + revsawWform(8 * t) * 0.125 },
  { value: 'ripple', title: 'ripple', group: 'Wobble', fn: (t) => t + Math.sin(PI * t) * Math.sin(12 * PI * t) * 0.0625 },
  { value: 'archseq', title: 'archseq', group: 'Sequence Shapes', fn: (t) => stowform(t, [0, 2, 4, 6, 4, 2, 0]) },
  { value: 'zigzag', title: 'zigzag', group: 'Sequence Shapes', fn: (t) => stowform(t, [0, 4, 1, 5, 2, 6, 3, 7]) },
  { value: 'pendulum', title: 'pendulum', group: 'Sequence Shapes', fn: (t) => stowform(t, [0, 2, 4, 6, 8, 6, 4, 2, 0]) },
  { value: 'f1', title: 'f1', group: 'Sequence Shapes', fn: (t) => (wform(t * 8, 0, 0.25, 1, 0.25, 0, 0.25, -2) * (1 / 16.0)) + wform(t, 0, 1, 1) },
  { value: 'f2', title: 'f2', group: 'Sequence Shapes', fn: (t) => stowform(t, [0, 5, 6, 7, 4, 1, 2, 5, 8]) },
  { value: 'f3', title: 'f3', group: 'Sequence Shapes', fn: (t) => stowform(t, [1, 0, 2]) },
  { value: 'f4', title: 'f4', group: 'Sequence Shapes', fn: (t) => stowform(t, [0, 4, 2, 1, 4]) },
  { value: 'f5', title: 'f5', group: 'Sequence Shapes', fn: (t) => wform(t, ...F5_WFORM_ARGS) },
  { value: 'f6', title: 'f6', group: 'Sequence Shapes', fn: (t) => wform(t, ...F6_WFORM_ARGS) },
  { value: 'climb', title: 'climb', group: 'Sequence Shapes', fn: (t) => stowform(t, [0, 2, 1, 3, 2, 4, 3, 5]) },
  { value: 'valley', title: 'valley', group: 'Sequence Shapes', fn: (t) => stowform(t, [4, 2, 0, 2, 4]) },
  { value: 'hesitate', title: 'hesitate', group: 'Sequence Shapes', fn: (t) => stowform(t, [0, 0, 2, 2, 1, 3, 3, 4]) },
  { value: 'sin+x', title: 'sin+x', group: 'Wobble', fn: (t) => t + Math.sin(8 * PI * t) * 0.125 },
  { value: 'f7', title: 'f7', group: 'Wobble', fn: (t) => t + triangleWform(t / 2.0) * 0.25 * triangleWform(8 * t) },
  { value: 'f8', title: 'f8', group: 'Wobble', fn: (t) => t + triangleWform(t / 2.0) * 0.25 * sawWform(8 * t) },
  { value: 'f9', title: 'f9', group: 'Wobble', fn: (t) => t + triangleWform(t) * 0.25 * triangleWform(8 * t) },
  { value: 'fm1', title: 'fm1', group: 'FM', fn: fmModel1(0.25, 8, 3, 0.125) },
  { value: 'fm2', title: 'fm2', group: 'FM', fn: fmModel1(0.25, 4, 7, 0.25) },
  { value: 'fm3', title: 'fm3', group: 'FM', fn: fmModel1(0.25, 16, 4, 0.125) },
  { value: 'fm4', title: 'fm4', group: 'FM', fn: fmModel1(0.25, 12, 7, 0.25) },
  { value: 'fm_gentle1', title: 'fm_gentle1', group: 'FM', fn: fmModel1(0.0625, 4, 2, 0.0625) },
  { value: 'fm_gentle2', title: 'fm_gentle2', group: 'FM', fn: fmModel1(0.0625, 8, 3, 0.0625) },
  { value: 'fm_mid1', title: 'fm_mid1', group: 'FM', fn: fmModel1(0.125, 6, 2, 0.125) },
  { value: 'fm_mid2', title: 'fm_mid2', group: 'FM', fn: fmModel1(0.125, 8, 3, 0.125) },
  { value: 'fm_mid3', title: 'fm_mid3', group: 'FM', fn: fmModel1(0.1875, 12, 5, 0.125) },
  { value: 'fm_strong1', title: 'fm_strong1', group: 'FM', fn: fmModel1(0.25, 8, 3, 0.125) },
  { value: 'fm_strong2', title: 'fm_strong2', group: 'FM', fn: fmModel1(0.25, 12, 7, 0.25) },
  { value: 'fm_strong3', title: 'fm_strong3', group: 'FM', fn: fmModel1(0.3125, 16, 5, 0.25) },
  { value: 'fm_center1', title: 'fm_center1', group: 'FM', fn: fmModel2(0.125, 8, 3, 0.125) },
  { value: 'fm_center2', title: 'fm_center2', group: 'FM', fn: fmModel2(0.25, 12, 5, 0.25) },
  { value: 'fm_edge1', title: 'fm_edge1', group: 'FM', fn: fmModel3(0.125, 8, 3, 0.125) },
  { value: 'fm_edge2', title: 'fm_edge2', group: 'FM', fn: fmModel3(0.25, 12, 7, 0.25) },
  { value: 'fm_tri1', title: 'fm_tri1', group: 'FM', fn: fmModel4(0.125, 8, 3, 0.125) },
  { value: 'fm_tri2', title: 'fm_tri2', group: 'FM', fn: fmModel4(0.25, 12, 5, 0.25) },
  { value: 'fm_saw1', title: 'fm_saw1', group: 'FM', fn: fmModel5(0.125, 8, 3, 0.125) },
  { value: 'fm_saw2', title: 'fm_saw2', group: 'FM', fn: fmModel5(0.25, 16, 5, 0.25) },
];

const BUILTIN_CURVE_MAP = new Map<string, TimeWarpFn>(BUILTIN_CURVES.map((entry) => [entry.value, entry.fn]));

export const TIME_WARP_CURVE_OPTIONS: TimeWarpCurveOption[] = BUILTIN_CURVES.map(({ title, value, group }) => ({
  title,
  value,
  group,
}));

export const TIME_WARP_CURVE_VALUES = new Set<string>([
  ...TIME_WARP_CURVE_OPTIONS.map((option) => option.value),
  CUSTOM_TIME_WARP_CURVE,
]);

const ALLOWED_FUNCTIONS = new Set<string>([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
  'sqrt', 'pow', 'abs', 'min', 'max', 'floor', 'ceil', 'round',
  'integer', 'exp', 'log', 'sign',
  'seq', 'wform', 'stowform', 'saw_wform', 'revsaw_wform', 'triangle_wform',
]);

function asNumber(value: EvalValue): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('Expected a number value.');
  }
  return value;
}

function asSequence(value: EvalValue): number[] {
  if (!Array.isArray(value)) {
    throw new Error('Expected a sequence value.');
  }
  return value;
}

function evaluateFunction(name: string, args: EvalValue[]): EvalValue {
  switch (name) {
    case 'sin':
      return Math.sin(asNumber(args[0] ?? 0));
    case 'cos':
      return Math.cos(asNumber(args[0] ?? 0));
    case 'tan':
      return Math.tan(asNumber(args[0] ?? 0));
    case 'asin':
      return Math.asin(asNumber(args[0] ?? 0));
    case 'acos':
      return Math.acos(asNumber(args[0] ?? 0));
    case 'atan':
      return Math.atan(asNumber(args[0] ?? 0));
    case 'sqrt':
      return Math.sqrt(asNumber(args[0] ?? 0));
    case 'pow':
      return Math.pow(asNumber(args[0] ?? 0), asNumber(args[1] ?? 0));
    case 'abs':
      return Math.abs(asNumber(args[0] ?? 0));
    case 'min':
      return Math.min(...args.map((arg) => asNumber(arg)));
    case 'max':
      return Math.max(...args.map((arg) => asNumber(arg)));
    case 'floor':
      return Math.floor(asNumber(args[0] ?? 0));
    case 'ceil':
      return Math.ceil(asNumber(args[0] ?? 0));
    case 'round':
      return Math.round(asNumber(args[0] ?? 0));
    case 'integer':
      return integerPart(asNumber(args[0] ?? 0));
    case 'exp':
      return Math.exp(asNumber(args[0] ?? 0));
    case 'log':
      return Math.log(asNumber(args[0] ?? 0));
    case 'sign':
      return Math.sign(asNumber(args[0] ?? 0));
    case 'seq':
      return args.map((arg) => asNumber(arg));
    case 'saw_wform':
      return sawWform(asNumber(args[0] ?? 0));
    case 'revsaw_wform':
      return revsawWform(asNumber(args[0] ?? 0));
    case 'triangle_wform':
      return triangleWform(asNumber(args[0] ?? 0));
    case 'wform': {
      const x = asNumber(args[0] ?? 0);
      const points = args.slice(1).map((arg) => asNumber(arg));
      return wform(x, ...points);
    }
    case 'stowform': {
      const x = asNumber(args[0] ?? 0);
      const seq = asSequence(args[1] ?? []);
      return stowform(x, seq);
    }
    default:
      throw new Error(`Function '${name}' is not supported.`);
  }
}

const TIME_WARP_EXPRESSION_PROFILE: MathExpressionProfile = {
  input: 'T',
  strict: false,
  allowParameters: false,
  legacyAssignment: true,
  functions: new Map([...ALLOWED_FUNCTIONS].map((name) => [name, {
    minArgs: 0,
    maxArgs: Infinity,
    evaluate: (args: EvalValue[]) => evaluateFunction(name, args),
  }])),
};

export function compileWarpExpression(source: string): TimeWarpResolution {
  try {
    const compiled = compileMathExpression(source, TIME_WARP_EXPRESSION_PROFILE);
    const fn: TimeWarpFn = (t: number) => {
      try {
        const evaluated = asNumber(compiled.evaluate(t));
        return Number.isFinite(evaluated) ? evaluated : t;
      } catch {
        return t;
      }
    };

    return {
      fn,
      error: null,
      source: 'custom',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid expression.';
    return {
      fn: (t) => t,
      error: message,
      source: 'custom',
    };
  }
}

export function resolveTimeWarpFunction(curveName: string, customExpression = ''): TimeWarpResolution {
  if (curveName === CUSTOM_TIME_WARP_CURVE) {
    return compileWarpExpression(customExpression);
  }

  const builtin = BUILTIN_CURVE_MAP.get(curveName);
  if (builtin) {
    return {
      fn: builtin,
      error: null,
      source: 'builtin',
    };
  }

  return {
    fn: BUILTIN_CURVE_MAP.get(DEFAULT_TIME_WARP_CURVE) ?? ((t) => t),
    error: `Unknown time warp curve '${curveName}'.`,
    source: 'fallback',
  };
}

export function warpNormalizedTime(t: number, curve: TimeWarpFn, amount: number): number {
  const safeT = Number.isFinite(t) ? t : 0;
  const safeAmount = clamp(amount, 0, 1);
  const targetValue = curve(safeT);
  const target = Number.isFinite(targetValue) ? targetValue : safeT;
  return clamp01(safeT + safeAmount * (target - safeT));
}

export function quantizeNormalizedTime(t: number, divisions: number): number {
  const safeDivisions = Math.max(MIN_NOTE_DIVISIONS, Math.floor(divisions));
  if (safeDivisions <= 1) {
    return clamp01(t);
  }
  return clamp01(Math.round(t * safeDivisions) / safeDivisions);
}

export function sampleWarpCurve(curve: TimeWarpFn, amount: number, samples = 96): number[] {
  const safeSamples = Math.max(2, Math.floor(samples));
  const values: number[] = [];
  for (let index = 0; index < safeSamples; index += 1) {
    const t = index / (safeSamples - 1);
    values.push(warpNormalizedTime(t, curve, amount));
  }
  return values;
}

export function isKnownTimeWarpCurve(value: string): boolean {
  return TIME_WARP_CURVE_VALUES.has(value);
}
