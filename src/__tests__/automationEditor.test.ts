import { test } from 'node:test';
import assert from 'node:assert/strict';
import { curveValue, parameterDefinitions, returnParameterDefinitions, type Automation, type ParameterDefinition } from '../domain/development.js';
import { copyCurve, curveError, curvePath, editPoint, fitBeatRange, pointFromPosition, pointPosition, retargetCurve, snapBeat } from '../domain/automationEditor.js';

const definition: ParameterDefinition = { label: 'Level', min: -96, max: 24, scope: 'bus', continuous: true };
const curve = (): Automation => ({ id: 'level', target: 'gain', interpolation: 'smooth', clock: 'song', points: [{ beat: 0, value: -48 }, { beat: 8, value: 12 }] });
test('coordinates, snapping and range preserve precise values without mutating inputs', () => {
  const range = { start: 4, end: 20 }, point = { beat: 7.123456789, value: -23.123456789 };
  const position = pointPosition(point, definition, range);
  const restored = pointFromPosition(position.x, position.y, definition, range, 0);
  assert.equal(restored.beat, point.beat); assert.ok(Math.abs(Number(restored.value) - Number(point.value)) < 1e-12);
  assert.equal(snapBeat(1.12, .25), 1); assert.equal(snapBeat(1.14, .25), 1.25);
  assert.deepEqual(pointFromPosition(-10, 10, definition, range, .25), { beat: 4, value: -96 });
  assert.deepEqual(fitBeatRange([]), { start: 0, end: 16 });
  assert.deepEqual(fitBeatRange([{ beat: 100, value: 0 }]), { start: 0, end: 100 });
  const input = curve(), copy = copyCurve(input); copy.points[0].value = 1;
  assert.equal(input.points[0].value, -48);
});
test('point edits maintain order and selected identity; duplicate and invalid edits are rejected', () => {
  const input = curve(), inserted = editPoint(input, -1, { beat: 4, value: 0 }, definition);
  assert.notEqual(typeof inserted, 'string'); if (typeof inserted === 'string') return;
  assert.equal(inserted.index, 1); assert.deepEqual(inserted.curve.points.map(p => p.beat), [0, 4, 8]);
  const moved = editPoint(inserted.curve, 1, { beat: 12, value: 0 }, definition);
  assert.notEqual(typeof moved, 'string'); if (typeof moved === 'string') return;
  assert.equal(moved.index, 2); assert.deepEqual(moved.curve.points.map(p => p.beat), [0, 8, 12]);
  for (const candidate of [{ beat: 8, value: 0 }, { beat: -1, value: 0 }, { beat: Infinity, value: 0 }, { beat: 1e7 + 1, value: 0 }, { beat: 4, value: NaN }, { beat: 4, value: 25 }])
    assert.equal(typeof editPoint(input, -1, candidate, definition), 'string');
  assert.deepEqual(input, curve());
});
test('empty, single-point and categorical curves have faithful geometry', () => {
  assert.equal(curvePath({ ...curve(), points: [] }, definition, { start: 0, end: 16 }, 800, 200), '');
  assert.match(curvePath({ ...curve(), points: [{ beat: 4, value: -36 }] }, definition, { start: 0, end: 16 }, 800, 200), /^M 200 100 H 800$/);
  const categorical = parameterDefinitions().filterEnabled;
  assert.equal(pointFromPosition(.5, 0, categorical, { start: 0, end: 16 }, .25).value, true);
  const discrete: Automation = { ...curve(), interpolation: 'step', points: [{ beat: 0, value: false }, { beat: 8, value: true }] };
  assert.equal(curveError(discrete, categorical), '');
  assert.equal(curvePath(discrete, categorical, { start: 0, end: 16 }, 800, 200), 'M 0 200 H 400 V 0 H 800');
  assert.equal(curveValue(discrete, 7.99, false), false); assert.equal(curveValue(discrete, 8, false), true);
});
test('smoothstep Bezier matches the playback evaluator at intermediate beats', () => {
  const input = curve(), path = curvePath(input, definition, { start: 0, end: 8 }, 800, 200);
  assert.match(path, / C /);
  const start = pointPosition(input.points[0], definition, { start: 0, end: 8 });
  const end = pointPosition(input.points[1], definition, { start: 0, end: 8 });
  for (const t of [.1, .25, .5, .75, .9]) {
    const y = (1 - t) ** 3 * start.y + 3 * (1 - t) ** 2 * t * start.y + 3 * (1 - t) * t ** 2 * end.y + t ** 3 * end.y;
    assert.ok(Math.abs((-96 + (1 - y) * 120) - Number(curveValue(input, t * 8, 0))) < 1e-10);
  }
  assert.match(curvePath({ ...input, interpolation: 'linear' }, definition, { start: 0, end: 8 }, 800, 200), / L /);
});
test('retargeting enforces ranges and scope, preserving curve identity and compatible values', () => {
  const input = { ...curve(), lane: 2, clock: 'note' as const };
  const gain = retargetCurve(input, 'gain', definition, -6);
  assert.equal(gain.clock, 'song'); assert.equal(gain.lane, undefined); assert.equal(gain.id, input.id);
  const enabled = retargetCurve(input, 'filterEnabled', parameterDefinitions().filterEnabled, true);
  assert.deepEqual(enabled.points.map(p => p.value), [true, true]); assert.equal(enabled.interpolation, 'step');
  const sustain = retargetCurve(input, 'sustain', parameterDefinitions().sustain, .5);
  assert.deepEqual(sustain.points.map(p => p.value), [0, 1]);
  const returns = returnParameterDefinitions({ id: 'aux', name: 'Dub', level: -6, automation: [], chain: [{ id: 'd', type: 'delay', beats: .5, feedback: .4, cutoff: 4000, drive: 0, mode: 'stereo' }, { id: 'f', type: 'filter', frequency: 1000, mode: 'lowpass' }] });
  assert.deepEqual(returns['d.mode'].options, ['mono', 'stereo', 'ping-pong']);
  assert.deepEqual(returns['f.mode'].options, ['lowpass', 'highpass']);
  assert.equal(returns['d.cutoff'].unit, 'Hz');
});
test('invalid imported data stays intact until explicitly repaired', () => {
  const input = curve(); input.points[0].value = 900;
  const before = JSON.stringify(input); assert.ok(curveError(input, definition)); assert.equal(JSON.stringify(input), before);
  const repaired = editPoint(input, 0, { beat: 0, value: -48 }, definition);
  assert.notEqual(typeof repaired, 'string'); if (typeof repaired !== 'string') assert.equal(curveError(repaired.curve, definition), '');
  assert.ok(curveError(curve(), undefined));
});
