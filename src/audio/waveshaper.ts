import { compileMathExpression, expressionNumber, isMathParameterName } from '../domain/mathExpression.js';

export interface WaveshaperParameter {
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
}

export interface WaveshaperSettings {
  enabled: boolean;
  curve: string;
  expression: string;
  customParameters: WaveshaperParameter[];
  builtinParameters: Record<string, Record<string, number>>;
  inputDriveDb: number;
  mix: number;
  dcBlock: boolean;
}

export interface WaveshaperBuiltin {
  id: string;
  title: string;
  group: string;
  formula: string;
  parameters: WaveshaperParameter[];
}

function parameter(name: string, value: number, min: number, max: number, step = 0.01): WaveshaperParameter {
  return { name, value, min, max, step };
}

function builtin(id: string, title: string, group: string, formula: string, ...parameters: WaveshaperParameter[]): WaveshaperBuiltin {
  return { id, title, group, formula, parameters };
}

const sineGain = () => parameter('k', Math.PI / 2, 0.1, 32);
const phase = () => parameter('p', 0, -Math.PI, Math.PI);
const saturationGain = () => parameter('k', 2, 0.1, 32);
const power = (name = 'p', value = 2) => parameter(name, value, 0.1, 8);
const sawFormula = '2*((k*x+1)/2-floor((k*x+1)/2))-1';

export const WAVESHAPER_BUILTINS: readonly WaveshaperBuiltin[] = [
  builtin('sine-fold', 'Sine Fold', 'Sine', 'sin(k*x)', sineGain()),
  builtin('sine-phase', 'Sine Phase', 'Sine', 'sin(k*x+p)', sineGain(), phase()),
  builtin('cosine-bend', 'Cosine Bend', 'Sine', 'cos(k*x+p)', sineGain(), phase()),
  builtin('nested-sine', 'Nested Sine', 'Sine', 'sin(a*sin(b*x))', parameter('a', 2, 0.1, 16), parameter('b', 2, 0.1, 16)),
  builtin('sine-phase-modulation', 'Sine Phase Modulation', 'Sine', 'sin(k*x+d*sin(h*x))', sineGain(), parameter('d', 1, 0, 8), parameter('h', 3, 0.1, 16)),
  builtin('dual-sine', 'Dual Sine', 'Sine', '(sin(a*x)+m*sin(b*x))/(1+abs(m))', parameter('a', Math.PI / 2, 0.1, 32), parameter('b', Math.PI, 0.1, 32), parameter('m', 0.5, -1, 1)),
  builtin('odd-harmonic-sine', 'Odd Harmonic Sine', 'Sine', '(sin(k*x)+m*sin(3*k*x))/(1+abs(m))', parameter('k', Math.PI / 2, 0.1, 10), parameter('m', 0.3, -1, 1)),
  builtin('even-harmonic-sine', 'Even Harmonic Sine', 'Sine', '(sin(k*x)+m*sin(2*k*x))/(1+abs(m))', parameter('k', Math.PI / 2, 0.1, 10), parameter('m', 0.3, -1, 1)),
  builtin('power-sine', 'Power Sine', 'Sine', 'sin(k*sign(x)*abs(x)^p)', sineGain(), power()),
  builtin('damped-sine', 'Damped Sine', 'Sine', 'sin(k*x)*exp(-d*x*x)', parameter('k', 6, 0.1, 32), parameter('d', 2, 0, 16)),
  builtin('saturation', 'Tanh Saturation', 'Saturation', 'tanh(k*x)', parameter('k', 2, 0.1, 16)),
  builtin('atan', 'Arctangent', 'Saturation', '(2/PI)*atan(k*x)', saturationGain()),
  builtin('softsign', 'Softsign', 'Saturation', 'k*x/(1+abs(k*x))', saturationGain()),
  builtin('algebraic', 'Algebraic', 'Saturation', 'k*x/sqrt(1+(k*x)^2)', saturationGain()),
  builtin('exponential', 'Exponential', 'Saturation', 'sign(x)*(1-exp(-k*abs(x)))', saturationGain()),
  builtin('hard-clip', 'Hard Clip', 'Saturation', 'clamp(k*x,-1,1)', saturationGain()),
  builtin('triangle-fold', 'Triangle Fold', 'Fold and Rectify', '(2/PI)*asin(sin(k*x))', sineGain()),
  builtin('saw-wrap', 'Saw Wrap', 'Fold and Rectify', sawFormula, parameter('k', 2, 0.1, 16)),
  builtin('reverse-saw-wrap', 'Reverse Saw Wrap', 'Fold and Rectify', `-(${sawFormula})`, parameter('k', 2, 0.1, 16)),
  builtin('full-rectifier', 'Full Rectifier', 'Fold and Rectify', 'abs(x)'),
  builtin('half-rectifier', 'Half Rectifier', 'Fold and Rectify', 'max(0,x)'),
  builtin('staircase', 'Staircase', 'Fold and Rectify', 'round(n*x)/n', parameter('n', 8, 1, 64, 1)),
  builtin('signed-power', 'Signed Power', 'Polynomial', 'sign(x)*abs(x)^p', power()),
  builtin('cubic-bend', 'Cubic Bend', 'Polynomial', 'x-a*x^3', parameter('a', 0.5, -2, 2)),
  builtin('quintic-bend', 'Quintic Bend', 'Polynomial', 'x-a*x^3+b*x^5', parameter('a', 1, -2, 2), parameter('b', 0.5, -2, 2)),
  builtin('asymmetric-power', 'Asymmetric Power', 'Polynomial', 'x >= 0 ? x^p : -abs(x)^q', power(), power('q', 1)),
  builtin('chebyshev', 'Chebyshev', 'Polynomial', 'T_n(x); T_0=1, T_1=x, T_n=2*x*T_(n-1)-T_(n-2)', parameter('n', 3, 2, 12, 1)),
  builtin('polynomial-blend', 'Polynomial Blend', 'Polynomial', 'x+a*x^2+b*x^3', parameter('a', 0.25, -2, 2), parameter('b', -0.5, -2, 2)),
  builtin('gaussian', 'Gaussian', 'Bell', 'exp(-k*x*x)', parameter('k', 4, 0.1, 32)),
  builtin('rational-bell', 'Rational Bell', 'Bell', '1/(1+k*x*x)', parameter('k', 4, 0.1, 32)),
  builtin('sinc', 'Sinc', 'Bell', 'x == 0 ? 1 : sin(k*x)/(k*x)', parameter('k', Math.PI, 0.1, 32)),
  builtin('smooth-bump', 'Smooth Bump', 'Bell', 'abs(x) < 1 ? exp(1-1/(1-x*x)) : 0'),
  builtin('identity', 'Identity', 'Basic', 'x'),
];

for (const entry of WAVESHAPER_BUILTINS) {
  entry.parameters.forEach(Object.freeze);
  Object.freeze(entry.parameters);
  Object.freeze(entry);
}
Object.freeze(WAVESHAPER_BUILTINS);

const builtinMap = new Map(WAVESHAPER_BUILTINS.map((entry) => [entry.id, entry]));

function defaultSettings(): WaveshaperSettings {
  return {
    enabled: false,
    curve: 'sine-fold',
    expression: 'sin(k*x)',
    customParameters: [sineGain()],
    builtinParameters: {},
    inputDriveDb: 0,
    mix: 100,
    dcBlock: true,
  };
}

export const DEFAULT_WAVESHAPER_SETTINGS: WaveshaperSettings = defaultSettings();

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function own(value: Record<string, unknown>, name: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeParameters(value: unknown): WaveshaperParameter[] {
  if (!Array.isArray(value)) return [sineGain()];
  const parameters: WaveshaperParameter[] = [];
  const names = new Set<string>();
  for (const candidate of value) {
    const row = record(candidate);
    const name = own(row, 'name');
    if (typeof name !== 'string' || !isMathParameterName(name) || names.has(name)) continue;
    let min = clamp(finite(own(row, 'min'), -10), -1e6, 1e6);
    let max = clamp(finite(own(row, 'max'), 10), -1e6, 1e6);
    if (min >= max) { min = -10; max = 10; }
    const span = max - min;
    let step = finite(own(row, 'step'), Math.min(0.01, span));
    if (step <= 0 || step > span) step = Math.min(0.01, span);
    step = Math.min(step, 1e6);
    parameters.push(parameter(name, clamp(finite(own(row, 'value'), 1), min, max), min, max, step));
    names.add(name);
    if (parameters.length === 16) break;
  }
  return parameters;
}

export function normalizeWaveshaperSettings(value: unknown): WaveshaperSettings {
  const source = record(value);
  const defaults = defaultSettings();
  const curve = own(source, 'curve');
  const expression = own(source, 'expression');
  const enabled = own(source, 'enabled');
  const dcBlock = own(source, 'dcBlock');
  const storedBuiltins = record(own(source, 'builtinParameters'));
  const builtinParameters: Record<string, Record<string, number>> = {};
  for (const entry of WAVESHAPER_BUILTINS) {
    const stored = own(storedBuiltins, entry.id);
    if (stored === undefined || stored === null || typeof stored !== 'object' || Array.isArray(stored)) continue;
    const values: Record<string, number> = {};
    for (const spec of entry.parameters) {
      const numeric = clamp(finite(own(record(stored), spec.name), spec.value), spec.min, spec.max);
      values[spec.name] = spec.step === 1 ? Math.round(numeric) : numeric;
    }
    builtinParameters[entry.id] = values;
  }
  return {
    enabled: typeof enabled === 'boolean' ? enabled : defaults.enabled,
    curve: typeof curve === 'string' && (curve === 'custom' || builtinMap.has(curve)) ? curve : defaults.curve,
    expression: typeof expression === 'string' ? expression : defaults.expression,
    customParameters: normalizeParameters(own(source, 'customParameters')),
    builtinParameters,
    inputDriveDb: clamp(finite(own(source, 'inputDriveDb'), 0), -24, 36),
    mix: clamp(finite(own(source, 'mix'), 100), 0, 100),
    dcBlock: typeof dcBlock === 'boolean' ? dcBlock : defaults.dcBlock,
  };
}

export function cloneWaveshaperSettings(value: WaveshaperSettings): WaveshaperSettings {
  return normalizeWaveshaperSettings(value);
}

export function reconcileWaveshaperParameters(expression: string, previous: WaveshaperParameter[]): { parameters: WaveshaperParameter[]; error: string | null } {
  const existing = normalizeParameters(previous);
  try {
    const compiled = compileMathExpression(expression);
    const byName = new Map(existing.map((entry) => [entry.name, entry]));
    return {
      parameters: compiled.parameters.map((name) => byName.get(name) ?? parameter(name, 1, -10, 10)),
      error: null,
    };
  } catch (error) {
    return { parameters: existing, error: error instanceof Error ? error.message : 'Invalid expression.' };
  }
}

function builtinEvaluator(entry: WaveshaperBuiltin, values: Record<string, number>): (input: number) => number {
  switch (entry.id) {
    case 'asymmetric-power':
      return (input) => input >= 0 ? Math.pow(input, values.p) : -Math.pow(Math.abs(input), values.q);
    case 'chebyshev':
      return (input) => {
        let previous = 1;
        let current = input;
        for (let order = 2; order <= values.n; order += 1) {
          const next = 2 * input * current - previous;
          previous = current;
          current = next;
        }
        return current;
      };
    case 'sinc':
      return (input) => input === 0 ? 1 : Math.sin(values.k * input) / (values.k * input);
    case 'smooth-bump':
      return (input) => Math.abs(input) < 1 ? Math.exp(1 - 1 / (1 - input * input)) : 0;
    default: {
      const compiled = compileMathExpression(entry.formula);
      return (input) => expressionNumber(compiled.evaluate(input, values));
    }
  }
}

const lutCache = new Map<string, Float32Array>();

export function resolveWaveshaperCurve(settings: WaveshaperSettings): { curve: Float32Array | null; error: string | null } {
  try {
    const normalized = normalizeWaveshaperSettings(settings);
    let evaluate: (input: number) => number;
    let key: string;
    if (normalized.curve === 'custom') {
      const reconciled = reconcileWaveshaperParameters(normalized.expression, normalized.customParameters);
      if (reconciled.error) return { curve: null, error: reconciled.error };
      const compiled = compileMathExpression(normalized.expression);
      const values = Object.fromEntries(reconciled.parameters.map((entry) => [entry.name, entry.value]));
      key = JSON.stringify(['custom', normalized.expression, values]);
      evaluate = (input) => expressionNumber(compiled.evaluate(input, values));
    } else {
      const entry = builtinMap.get(normalized.curve)!;
      const stored = normalized.builtinParameters[entry.id] ?? {};
      const values = Object.fromEntries(entry.parameters.map((spec) => [spec.name, stored[spec.name] ?? spec.value]));
      key = JSON.stringify([entry.id, values]);
      evaluate = builtinEvaluator(entry, values);
    }
    const cached = lutCache.get(key);
    if (cached) {
      lutCache.delete(key);
      lutCache.set(key, cached);
      return { curve: cached.slice(), error: null };
    }
    const curve = new Float32Array(4097);
    for (let probe = 0; probe <= 8192; probe += 1) {
      const input = (probe - 4096) / 4096;
      const output = expressionNumber(evaluate(input));
      if (probe % 2 === 0) curve[probe / 2] = clamp(output, -1, 1);
    }
    lutCache.set(key, curve);
    if (lutCache.size > 32) lutCache.delete(lutCache.keys().next().value!);
    return { curve: curve.slice(), error: null };
  } catch (error) {
    return { curve: null, error: error instanceof Error ? error.message : 'Invalid expression.' };
  }
}