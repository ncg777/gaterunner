import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_WAVESHAPER_SETTINGS, WAVESHAPER_BUILTINS, cloneWaveshaperSettings,
  normalizeWaveshaperSettings, reconcileWaveshaperParameters, resolveWaveshaperCurve,
} from '../audio/waveshaper.js';

test('all 33 registered waveshapers produce finite clipped 4097-sample curves', () => {
  assert.equal(WAVESHAPER_BUILTINS.length, 33);
  assert.equal(new Set(WAVESHAPER_BUILTINS.map((entry) => entry.id)).size, 33);
  assert.equal(WAVESHAPER_BUILTINS[0].group, 'Sine');
  for (const entry of WAVESHAPER_BUILTINS) {
    const result = resolveWaveshaperCurve({ ...DEFAULT_WAVESHAPER_SETTINGS, curve: entry.id });
    assert.equal(result.error, null, entry.id);
    assert.equal(result.curve?.length, 4097, entry.id);
    assert.ok(result.curve?.every((value) => Number.isFinite(value) && value >= -1 && value <= 1), entry.id);
  }
});

test('identity, sine and analytic special cases have correct exact sample positions', () => {
  const curve = (id: string) => resolveWaveshaperCurve({ ...DEFAULT_WAVESHAPER_SETTINGS, curve: id }).curve!;
  assert.equal(curve('identity')[0], -1);
  assert.equal(curve('identity')[2048], 0);
  assert.equal(curve('identity')[4096], 1);
  assert.equal(curve('sine-fold')[0], -1);
  assert.equal(curve('sine-fold')[2048], 0);
  assert.equal(curve('sinc')[2048], 1);
  assert.equal(curve('smooth-bump')[0], 0);
  assert.equal(curve('smooth-bump')[2048], 1);
  assert.equal(curve('smooth-bump')[4096], 0);
  assert.equal(curve('chebyshev')[3072], -1);
  assert.equal(curve('asymmetric-power')[1024], -0.5);
  assert.equal(curve('asymmetric-power')[3072], 0.25);
});

test('custom LUT validation includes midpoint probes and nonfinite intermediates', () => {
  for (const expression of ['1/x', '1/(x-1/4096)', 'sqrt(x)', 'exp(1000)', 'exp(1000)*0', 'sin()', 'x.foo', '']) {
    const result = resolveWaveshaperCurve({ ...DEFAULT_WAVESHAPER_SETTINGS, curve: 'custom', expression });
    assert.equal(result.curve, null, expression);
    assert.ok(result.error, expression);
  }
  const huge = resolveWaveshaperCurve({ ...DEFAULT_WAVESHAPER_SETTINGS, curve: 'custom', expression: '1e300' });
  assert.equal(huge.error, null);
  assert.ok(huge.curve?.every((value) => value === 1));
});

test('normalization and cloning produce independent canonical settings', () => {
  assert.deepEqual(normalizeWaveshaperSettings(null), DEFAULT_WAVESHAPER_SETTINGS);
  const source = normalizeWaveshaperSettings({
    curve: 'custom', expression: 'bad(', inputDriveDb: 100, mix: -1,
    builtinParameters: { staircase: { n: 100 }, saturation: { k: -1 }, unknown: { value: 3 } },
  });
  assert.equal(source.expression, 'bad(');
  assert.equal(source.inputDriveDb, 36);
  assert.equal(source.mix, 0);
  assert.deepEqual(source.builtinParameters, { saturation: { k: 0.1 }, staircase: { n: 64 } });
  const clone = cloneWaveshaperSettings(source);
  clone.customParameters[0].value = 9;
  clone.builtinParameters.staircase.n = 2;
  assert.equal(source.customParameters[0].value, Math.PI / 2);
  assert.equal(source.builtinParameters.staircase.n, 64);
});

test('parameter reconciliation preserves metadata and invalid-expression rows', () => {
  const previous = [{ name: 'gain', value: 3, min: 0, max: 5, step: 0.1 }];
  const valid = reconcileWaveshaperParameters('sin(gain*x)+offset', previous);
  assert.equal(valid.error, null);
  assert.deepEqual(valid.parameters, [...previous, { name: 'offset', value: 1, min: -10, max: 10, step: 0.01 }]);
  assert.deepEqual(reconcileWaveshaperParameters('x', previous).parameters, []);
  assert.deepEqual(reconcileWaveshaperParameters('sin(', previous).parameters, previous);
});

test('normalization defaults malformed fields and bounds all custom metadata', () => {
  for (const value of [undefined, null, [], 1, 'x', true, {}]) {
    assert.deepEqual(normalizeWaveshaperSettings(value), DEFAULT_WAVESHAPER_SETTINGS);
  }
  assert.deepEqual(normalizeWaveshaperSettings({
    enabled: 'false', curve: '__proto__', expression: 3, customParameters: {},
    builtinParameters: [], inputDriveDb: NaN, mix: Infinity, dcBlock: 0,
  }), DEFAULT_WAVESHAPER_SETTINGS);
  const result = normalizeWaveshaperSettings({
    inputDriveDb: -100, mix: 300,
    customParameters: [
      { name: 'gain', value: 1e9, min: -1e9, max: 1e9, step: 1e9 },
      { name: 'gain', value: 2 },
      { name: 'offset', value: -Infinity, min: 10, max: -10, step: -1 },
      { name: 'tiny', value: 0, min: 0, max: 1e-8, step: 0.1 },
      { name: 'wide', value: 0, min: -1e6, max: 1e6, step: 1.5e6 },
      ...['__proto__', 'constructor', 'x', 'PI', 'sin', 'a'.repeat(33), 'a.b'].map((name) => ({ name, value: 1 })),
    ],
  });
  assert.equal(result.inputDriveDb, -24);
  assert.equal(result.mix, 100);
  assert.deepEqual(result.customParameters, [
    { name: 'gain', value: 1e6, min: -1e6, max: 1e6, step: 0.01 },
    { name: 'offset', value: 1, min: -10, max: 10, step: 0.01 },
    { name: 'tiny', value: 0, min: 0, max: 1e-8, step: 1e-8 },
    { name: 'wide', value: 0, min: -1e6, max: 1e6, step: 1e6 },
  ]);
  assert.equal(normalizeWaveshaperSettings({
    customParameters: Array.from({ length: 20 }, (_, index) => ({ name: `param${index}` })),
  }).customParameters.length, 16);
});

test('normalization ignores inherited data and accessors without invoking them', () => {
  const inherited = Object.create({ enabled: true, inputDriveDb: 36, curve: 'custom' });
  assert.deepEqual(normalizeWaveshaperSettings(inherited), DEFAULT_WAVESHAPER_SETTINGS);
  const accessor = Object.defineProperty({}, 'expression', { get: () => { throw new Error('Must not execute'); } });
  assert.deepEqual(normalizeWaveshaperSettings(accessor), DEFAULT_WAVESHAPER_SETTINGS);
  const polluted = JSON.parse('{"builtinParameters":{"__proto__":{"polluted":1},"staircase":{"n":3.6,"constructor":4}},"customParameters":[{"name":"__proto__","value":5}]}');
  assert.deepEqual(normalizeWaveshaperSettings(polluted).builtinParameters, { staircase: { n: 4 } });
  assert.deepEqual(normalizeWaveshaperSettings(polluted).customParameters, []);
  assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted'), false);
});

test('all built-in parameter bounds are fixed and valid at both extrema', () => {
  for (const entry of WAVESHAPER_BUILTINS) {
    for (const edge of ['min', 'max'] as const) {
      const stored = Object.fromEntries(entry.parameters.map((spec) => [spec.name, edge === 'min' ? -1e9 : 1e9]));
      const settings = normalizeWaveshaperSettings({ curve: entry.id, builtinParameters: { [entry.id]: stored } });
      for (const spec of entry.parameters) assert.equal(settings.builtinParameters[entry.id][spec.name], spec[edge], `${entry.id}.${spec.name}`);
      const result = resolveWaveshaperCurve(settings);
      assert.equal(result.error, null, `${entry.id}.${edge}`);
    }
  }
});

test('preview ignores enabled, drive, mix and dc state and isolates cached LUTs', () => {
  const source = normalizeWaveshaperSettings({ curve: 'identity', enabled: false, mix: 0, inputDriveDb: 36 });
  const original = resolveWaveshaperCurve(source).curve!;
  const again = resolveWaveshaperCurve({ ...source, enabled: true, mix: 100, inputDriveDb: -24, dcBlock: false }).curve!;
  assert.deepEqual(original, again);
  assert.notEqual(original, again);
  original.fill(0.123);
  assert.equal(resolveWaveshaperCurve(source).curve![0], -1);
  const bad = resolveWaveshaperCurve({ ...source, curve: 'custom', expression: '1/0' });
  assert.equal(bad.curve, null);
  assert.ok(bad.error);
});

test('custom parameters affect LUT keys and unused rows do not affect output', () => {
  const settings = normalizeWaveshaperSettings({ curve: 'custom', expression: 'gain*x' });
  const unit = resolveWaveshaperCurve(settings).curve!;
  assert.equal(unit[3072], 0.5);
  const doubled = resolveWaveshaperCurve({ ...settings, customParameters: [{ name: 'gain', value: 2, min: 0, max: 4, step: 0.01 }] }).curve!;
  assert.equal(doubled[3072], 1);
  assert.equal(resolveWaveshaperCurve(settings).curve![3072], 0.5);
  for (let index = 0; index < 40; index += 1) {
    assert.equal(resolveWaveshaperCurve({ ...settings, expression: `x+${index}` }).error, null);
  }
  assert.deepEqual(resolveWaveshaperCurve(settings).curve, unit);
});

test('invalid expression reconciliation preserves rows across every parser limit', () => {
  const previous = [{ name: 'gain', value: 3, min: 0, max: 5, step: 0.1 }];
  for (const expression of ['x'.repeat(513), '('.repeat(33) + 'x' + ')'.repeat(33), 'a'.repeat(33), Array.from({ length: 17 }, (_, index) => `a${index}`).join('+'), 'constructor', 'unknown(x)']) {
    const result = reconcileWaveshaperParameters(expression, previous);
    assert.ok(result.error, expression);
    assert.deepEqual(result.parameters, previous);
    assert.notEqual(result.parameters[0], previous[0]);
  }
});

test('LUT cache retains only 32 entries and refreshes recently used curves', () => {
  const originalConstructor = globalThis.Float32Array;
  let allocations = 0;
  globalThis.Float32Array = new Proxy(originalConstructor, {
    construct(target, args) {
      allocations += 1;
      return Reflect.construct(target, args);
    },
  });
  try {
    const resolve = (index: number) => resolveWaveshaperCurve({
      ...DEFAULT_WAVESHAPER_SETTINGS, curve: 'custom', expression: `x+${70000 + index}`,
    });
    for (let index = 0; index < 32; index += 1) assert.equal(resolve(index).error, null);
    assert.equal(allocations, 32);
    assert.equal(resolve(0).error, null);
    assert.equal(allocations, 32);
    assert.equal(resolve(32).error, null);
    assert.equal(allocations, 33);
    assert.equal(resolve(1).error, null);
    assert.equal(allocations, 34);
  } finally {
    globalThis.Float32Array = originalConstructor;
  }
});