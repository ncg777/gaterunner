import assert from 'node:assert/strict';
import test from 'node:test';
import { compileMathExpression, isMathParameterName } from '../domain/mathExpression.js';

test('strict parser preserves arithmetic precedence and infers named parameters', () => {
  assert.equal(compileMathExpression('-2^2').evaluate(0), 4);
  assert.equal(compileMathExpression('2^3^2').evaluate(0), 512);
  const expression = compileMathExpression('y = sin(gain*x) + offset + PI/E');
  assert.deepEqual(expression.parameters, ['gain', 'offset']);
  assert.equal(expression.evaluate(0, { gain: 2, offset: 1 }), 1 + Math.PI / Math.E);
});

test('strict evaluation rejects invalid arity, domains and nonfinite intermediates', () => {
  for (const expression of ['sin()', 'sin(1,2)', 'pow(2)', 'clamp(1,2)', 'min()']) {
    assert.throws(() => compileMathExpression(expression), /arity/);
  }
  for (const expression of ['1/0', '1%0', 'sqrt(-1)', 'log(0)', 'asin(2)', 'exp(1000)*0', 'clamp(0,2,1)']) {
    assert.throws(() => compileMathExpression(expression).evaluate(0), Error, expression);
  }
});

test('expression length, AST node count, depth, names and parameter counts are bounded', () => {
  assert.equal(compileMathExpression('x'.padEnd(512)).evaluate(0.5), 0.5);
  assert.throws(() => compileMathExpression('x'.padEnd(513)), /512/);
  assert.equal(compileMathExpression('('.repeat(32) + 'x' + ')'.repeat(32)).evaluate(0.5), 0.5);
  assert.throws(() => compileMathExpression('('.repeat(33) + 'x' + ')'.repeat(33)), /depth/);
  assert.equal(compileMathExpression('+'.repeat(31) + 'x').evaluate(0.5), 0.5);
  assert.throws(() => compileMathExpression('+'.repeat(32) + 'x'), /depth/);
  assert.throws(() => compileMathExpression(Array(33).fill('x').join('+')), /depth/);
  assert.throws(() => compileMathExpression(Array(33).fill('x').join('^')), /depth/);
  assert.throws(() => compileMathExpression('sin('.repeat(32) + 'x' + ')'.repeat(32)), /depth/);
  const balanced = (leaves: number): string => leaves === 1 ? 'x'
    : `(${balanced(Math.floor(leaves / 2))}+${balanced(Math.ceil(leaves / 2))})`;
  const atLimit = '+' + balanced(128);
  assert.equal(atLimit.length, 510);
  assert.equal(compileMathExpression(atLimit).evaluate(1), 128);
  assert.throws(() => compileMathExpression('+' + atLimit), /256 nodes/);
  const names = Array.from({ length: 17 }, (_, index) => `param${index}`);
  assert.deepEqual(compileMathExpression(names.slice(0, 16).join('+')).parameters, names.slice(0, 16));
  assert.throws(() => compileMathExpression(names.join('+')), /16 free parameters/);
  assert.deepEqual(compileMathExpression('a'.repeat(32)).parameters, ['a'.repeat(32)]);
  assert.throws(() => compileMathExpression('a'.repeat(33)), /32 characters/);
});

test('safe grammar rejects code, access, reserved names and malformed expressions', () => {
  const invalid = [
    '', 'y=', 'Y=x', 'x=1', 'x.x', 'x[0]', 'Math.sin(x)', 'globalThis', 'window',
    'document', 'process', 'require("fs")', 'import("fs")', 'eval(x)', 'new Function(x)',
    '__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', 'valueOf',
    'apply', 'call', 'bind', 'interface', 'private',
    'this', 'return', 'true', 'null', 'NaN', 'Infinity', 'undefined', 'time', 'random',
    'Date', 'performance', 'sin', 'sin.constructor(x)', 'seq(1,2)', 'wform(x,0,1,1)',
    'x;1', 'x=>x', 'x?1:0', 'x<1', 'x||1', 'x&&1', 'x**2', 'x//2', 'x/*2*/',
    'sin(x,)', '(x', 'x)', 'x+', '2x', 'sin x', '.', '1..2', '1e', '1e2e3',
    '1e999', '0xff', '1_000', 'sin(,x)', 'Sin(x)', 'PI(x)', 'x(1)', '\u03c0',
  ];
  for (const expression of invalid) {
    assert.throws(() => compileMathExpression(expression), Error, expression);
  }
  for (const name of ['x', 'PI', 'E', 'constructor', '__proto__', 'sin', 'time', 'a.b', 'a'.repeat(33)]) {
    assert.equal(isMathParameterName(name), false, name);
  }
  assert.deepEqual(compileMathExpression('gain+Gain+pi+e+_gain2').parameters, ['gain', 'Gain', 'pi', 'e', '_gain2']);
});

test('strict scalar whitelist enforces all arities and evaluates every function', () => {
  const unary: Record<string, (value: number) => number> = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos,
    atan: Math.atan, tanh: Math.tanh, sinh: Math.sinh, cosh: Math.cosh,
    sqrt: Math.sqrt, abs: Math.abs, sign: Math.sign, exp: Math.exp, log: Math.log,
    log10: Math.log10, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  };
  for (const [name, operation] of Object.entries(unary)) {
    assert.equal(compileMathExpression(`${name}(x)`).evaluate(0.5), operation(0.5), name);
    assert.throws(() => compileMathExpression(`${name}()`), /arity/, name);
    assert.throws(() => compileMathExpression(`${name}(1,2)`), /arity/, name);
  }
  for (const [expression, expected] of [
    ['pow(2,3)', 8], ['atan2(1,0)', Math.PI / 2], ['min(3,1,2)', 1],
    ['max(1,3,2)', 3], ['clamp(4,0,2)', 2], ['clamp(-1,0,2)', 0],
    ['min(3)', 3], ['max(3)', 3], ['1e-2+.5+2.', 2.51],
  ] as const) assert.equal(compileMathExpression(expression).evaluate(0), expected, expression);
  for (const expression of ['pow(1,2,3)', 'atan2(1)', 'atan2(1,2,3)', 'clamp(1,2,3,4)', 'max()']) {
    assert.throws(() => compileMathExpression(expression), /arity/);
  }
});

test('strict evaluation rejects invalid inputs, inherited parameters and domain violations', () => {
  const compiled = compileMathExpression('gain*x');
  for (const input of [NaN, Infinity, -Infinity]) assert.throws(() => compiled.evaluate(input, { gain: 1 }));
  for (const value of [NaN, Infinity, -Infinity]) assert.throws(() => compiled.evaluate(1, { gain: value }));
  assert.throws(() => compiled.evaluate(1));
  assert.throws(() => compiled.evaluate(1, Object.create({ gain: 1 })));
  let accessorRan = false;
  const accessor = Object.defineProperty({}, 'gain', { get: () => { accessorRan = true; return 1; } });
  assert.throws(() => compiled.evaluate(1, accessor));
  assert.equal(accessorRan, false);
  for (const expression of ['acos(-2)', 'log(-1)', 'log10(0)', 'pow(-1,.5)', '(-1)^.5', '0^-1', '1e308+1e308', '1e308*1e308', 'sinh(1000)', 'cosh(1000)', 'tan(PI/2)', 'tan(-PI/2)', 'tan(3*PI/2)']) {
    assert.throws(() => compileMathExpression(expression).evaluate(0), Error, expression);
  }
});

test('AST cache retains at most 128 entries and refreshes recently used expressions', () => {
  const first = compileMathExpression('x+12345');
  const second = compileMathExpression('x+12346');
  for (let index = 0; index < 126; index += 1) compileMathExpression(`x+${20000 + index}`);
  assert.equal(compileMathExpression('x+12345'), first);
  compileMathExpression('x+30000');
  assert.notEqual(compileMathExpression('x+12346'), second);
  assert.equal(first.evaluate(2), 12347);
  assert.ok(Object.isFrozen(first.parameters));
});