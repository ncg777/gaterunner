import assert from 'node:assert/strict';
import test from 'node:test';

import {
  arePresetDataEqual,
  buildDraftFromUrl,
  buildSinglePresetExport,
  clonePresetData,
  createNamedPreset,
  DEFAULT_PRESET_DATA,
  normalizePresetData,
  parsePresetImportPayload,
} from '../presets.js';
import {
  buildTrackChunkActivationStates,
  gateEventByActivation,
  getActivationChunkIndex,
  isTrackBitActive,
  parseBitmaskSequenceInput,
} from '../trackActivation.js';

test('blank bitmask sequence disables gating', () => {
  const parsed = parseBitmaskSequenceInput('   ');
  assert.equal(parsed.normalizedInput, '');
  assert.deepEqual(parsed.masks, []);
  assert.equal(parsed.valid, true);

  const gated = gateEventByActivation({
    time: 0.5,
    duration: 1,
    trackIndex: 0,
    loopDuration: 4,
    masks: parsed.masks,
  });
  assert.deepEqual(gated, { time: 0.5, duration: 1 });
});

test('parses nonnegative decimal masks and rejects invalid tokens', () => {
  const parsed = parseBitmaskSequenceInput('1 0 3 foo 10 -2 01 4');
  assert.equal(parsed.valid, false);
  assert.deepEqual(parsed.invalidTokens, ['foo', '-2', '01']);
  assert.deepEqual(parsed.masks, [1n, 0n, 3n, 10n, 4n]);
  assert.equal(parsed.normalizedInput, '1 0 3 10 4');
});

test('supports arbitrary-width bigint masks', () => {
  const parsed = parseBitmaskSequenceInput('18446744073709551616');
  assert.equal(parsed.valid, true);
  assert.equal(parsed.masks[0], 1n << 64n);
  assert.equal(isTrackBitActive(parsed.masks[0], 64), true);
  assert.equal(isTrackBitActive(parsed.masks[0], 0), false);
});

test('maps track order to mask bits', () => {
  assert.equal(isTrackBitActive(1n, 0), true);
  assert.equal(isTrackBitActive(2n, 1), true);
  assert.equal(isTrackBitActive(3n, 0), true);
  assert.equal(isTrackBitActive(3n, 1), true);
  assert.equal(isTrackBitActive(3n, 2), false);
  assert.deepEqual(buildTrackChunkActivationStates([1n, 2n, 3n, 0n], 0), [true, false, true, false]);
  assert.deepEqual(buildTrackChunkActivationStates([1n, 2n, 3n, 0n], 1), [false, true, true, false]);
});

test('assigns half-open equal chunks across the loop', () => {
  assert.equal(getActivationChunkIndex(0, 4, 4), 0);
  assert.equal(getActivationChunkIndex(0.999, 4, 4), 0);
  assert.equal(getActivationChunkIndex(1, 4, 4), 1);
  assert.equal(getActivationChunkIndex(3.999, 4, 4), 3);
  assert.equal(getActivationChunkIndex(4, 4, 4), 3);
});

test('omits inactive onsets and clips active notes at inactive boundaries', () => {
  const masks = [1n, 2n, 3n, 0n];
  const loopDuration = 4;

  assert.equal(
    gateEventByActivation({
      time: 0.25,
      duration: 2,
      trackIndex: 1,
      loopDuration,
      masks,
    }),
    null,
  );

  const clipped = gateEventByActivation({
    time: 0.25,
    duration: 2,
    trackIndex: 0,
    loopDuration,
    masks,
  });
  assert.ok(clipped);
  assert.equal(clipped.time, 0.25);
  assert.ok(Math.abs(clipped.duration - 0.75) < 1e-9);

  const continuous = gateEventByActivation({
    time: 1.25,
    duration: 2,
    trackIndex: 1,
    loopDuration,
    masks,
  });
  assert.ok(continuous);
  assert.equal(continuous.time, 1.25);
  assert.ok(Math.abs(continuous.duration - 1.75) < 1e-9);
});

test('all-active masks preserve original duration', () => {
  const gated = gateEventByActivation({
    time: 0.5,
    duration: 3.5,
    trackIndex: 0,
    loopDuration: 4,
    masks: [1n, 1n, 1n, 1n],
  });
  assert.deepEqual(gated, { time: 0.5, duration: 3.5 });
});

test('wraparound clipping stops at the first inactive chunk after loop end', () => {
  // Track 0 active in chunks 3 and 0, inactive in 1.
  const masks = [1n, 0n, 0n, 1n];
  const gated = gateEventByActivation({
    time: 3.25,
    duration: 2,
    trackIndex: 0,
    loopDuration: 4,
    masks,
  });
  assert.ok(gated);
  assert.equal(gated.time, 3.25);
  assert.ok(Math.abs(gated.duration - 1.75) < 1e-9);
});

test('zero mask silences every track for that chunk', () => {
  const gated = gateEventByActivation({
    time: 3.1,
    duration: 0.5,
    trackIndex: 0,
    loopDuration: 4,
    masks: [1n, 1n, 1n, 0n],
  });
  assert.equal(gated, null);
});

test('normalizePresetData defaults missing bitmask field and preserves equality', () => {
  const normalized = normalizePresetData({
    bpm: 90,
    a4: 440,
    forte: '5-35.05',
    tracks: [DEFAULT_PRESET_DATA.tracks[0]],
    reverb: DEFAULT_PRESET_DATA.reverb,
  });
  assert.equal(normalized.bitmaskSequenceInput, '');

  const withMask = normalizePresetData({
    ...normalized,
    bitmaskSequenceInput: '1 2 0',
  });
  assert.equal(withMask.bitmaskSequenceInput, '1 2 0');
  assert.equal(arePresetDataEqual(normalized, withMask), false);

  const cloned = clonePresetData(withMask);
  assert.equal(cloned.bitmaskSequenceInput, '1 2 0');
  assert.equal(arePresetDataEqual(cloned, withMask), true);
});

test('URL override and import/export preserve bitmask sequence B', () => {
  const draft = buildDraftFromUrl('?b=1+2+3+0', DEFAULT_PRESET_DATA);
  assert.equal(draft.bitmaskSequenceInput, '1 2 3 0');

  const preset = createNamedPreset('Activation', {
    ...DEFAULT_PRESET_DATA,
    bitmaskSequenceInput: '1 2 3 0',
  });
  const exported = buildSinglePresetExport(preset);
  const payload = parsePresetImportPayload(JSON.stringify(exported));
  assert.equal(payload.kind, 'single-preset');
  if (payload.kind === 'single-preset') {
    assert.equal(payload.preset.data.bitmaskSequenceInput, '1 2 3 0');
  }
});

test('URL draft and import/export preserve custom reverb settings', () => {
  const customReverb = {
    enabled: false,
    decay: 12.5,
    decayCurve: 2.5,
    preDelay: 0.18,
    dry: -3,
    wet: -9,
    lowCut: 24,
    highCut: 96,
  };
  const saved = {
    ...DEFAULT_PRESET_DATA,
    reverb: customReverb,
  };

  const draft = buildDraftFromUrl('?bpm=120', saved);
  assert.deepEqual(draft.reverb, customReverb);
  assert.equal(arePresetDataEqual(draft, { ...saved, bpm: 120 }), true);
  assert.equal(arePresetDataEqual(draft, { ...draft, reverb: { ...customReverb, decayCurve: 1 } }), false);
  assert.deepEqual(clonePresetData(draft).reverb, customReverb);

  const preset = createNamedPreset('Reverb Room', saved);
  const exported = buildSinglePresetExport(preset);
  const payload = parsePresetImportPayload(JSON.stringify(exported));
  assert.equal(payload.kind, 'single-preset');
  if (payload.kind === 'single-preset') {
    assert.deepEqual(payload.preset.data.reverb, customReverb);
  }
});

test('reverb curvature defaults for older presets and normalizes invalid input', () => {
  for (const [decayCurve, expected] of [
    [undefined, 1], [null, 1], [Number.NaN, 1], [Infinity, 1], ['', 1],
    ['2.5', 2.5], [0, 0.1], [-2, 0.1], [20, 10],
  ]) {
    const project = normalizePresetData({ reverb: { decay: 2, decayCurve } });
    assert.equal(project.reverb.decayCurve, expected);
    assert.equal(project.reverb.decay, 2);
  }
});
