import assert from 'node:assert/strict';
import test from 'node:test';
import { compileWarpExpression, resolveTimeWarpFunction, warpNormalizedTime, wform, stowform, sawWform, revsawWform, triangleWform } from '../audio/timeWarp.js';

test('time-warp expressions preserve legacy arithmetic and constants', () => {
  for (const [expression, expected] of [
    ['Y = T * 2 + sin(PI / 2)', 1.5],
    ['-2^2', 4],
    ['2^3^2', 512],
    ['1 / 0', 0],
    ['1 % 0', 0],
    ['sin()', 0],
  ] as const) {
    const resolution = compileWarpExpression(expression);
    assert.equal(resolution.error, null, expression);
    assert.equal(resolution.fn(0.25), expected, expression);
  }
});

test('invalid time-warp syntax and domains retain identity fallback', () => {
  assert.match(compileWarpExpression('unknown(T)').error ?? '', /Unknown function/);
  assert.match(compileWarpExpression('x').error ?? '', /Unknown identifier/);
  assert.equal(compileWarpExpression('sqrt(-1)').fn(0.25), 0.25);
  assert.equal(compileWarpExpression('').fn(0.25), 0.25);
  assert.equal(resolveTimeWarpFunction('lin').fn(0.25), 0.25);
  assert.equal(warpNormalizedTime(0.75, () => 2, 1), 1);
});

test('shared parser preserves permissive legacy functions and sequence helpers', () => {
  for (const [expression, expected] of [
    ['cos()', 1], ['pow()', 1], ['sin(0,99)', 0], ['integer(-1.75)', -1],
    ['Y=T+E', 0.25 + Math.E], ['y=T', 0.25], ['min()', 0.25],
    ['sin(0,sqrt(-1))', 0], ['seq(1,2)', 0.25], ['stowform(T)', 0.25],
    ['wform(T)', 0], ['1e2e3', 100], ['max(1,2,3)', 3],
    ['saw_wform(T)', sawWform(0.25)], ['revsaw_wform(T)', revsawWform(0.25)],
    ['triangle_wform(T)', triangleWform(0.25)],
    ['wform(T,0,.5,1)', wform(0.25, 0, 0.5, 1)],
    ['stowform(T,seq(0,2,4,2,0))', stowform(0.25, [0, 2, 4, 2, 0])],
  ] as const) {
    const resolution = compileWarpExpression(expression);
    assert.equal(resolution.error, null, expression);
    assert.equal(resolution.fn(0.25), expected, expression);
  }
  for (const expression of ['sqrt(-1)', '1e308*1e308', 'stowform(T,1)', 'seq(T)+1']) {
    assert.equal(compileWarpExpression(expression).fn(0.25), 0.25, expression);
  }
  for (const expression of ['gain*T', 't', 'tanh(T)', 'T.foo', 'constructor(T)']) {
    assert.ok(compileWarpExpression(expression).error, expression);
  }
});