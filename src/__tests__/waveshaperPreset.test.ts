import assert from 'node:assert/strict';
import test from 'node:test';

import {
  arePresetDataEqual,
  buildPresetLibraryExport,
  buildSinglePresetExport,
  clonePresetData,
  clonePresetTrackData,
  createNamedPreset,
  DEFAULT_PRESET_DATA,
  mergeImportedPresets,
  mergePresetTracks,
  normalizePresetData,
  normalizePresetTrackData,
  parsePresetImportPayload,
} from '../presets.js';
import type { WaveshaperSettings } from '../audio/waveshaper.js';

function customPreset() {
  const data = clonePresetData(DEFAULT_PRESET_DATA);
  data.tracks[0] = normalizePresetTrackData({
    ...data.tracks[0],
    waveshaper: {
      enabled: true,
      curve: 'custom',
      expression: 'sin(amount*x+offset)',
      customParameters: [
        { name: 'amount', value: 3, min: 0.5, max: 12, step: 0.25 },
        { name: 'offset', value: -0.2, min: -1, max: 1, step: 0.05 },
      ],
      builtinParameters: {
        'sine-fold': { k: 4 },
        'sine-phase': { k: 2, p: 0.5 },
        staircase: { n: 7 },
      },
      inputDriveDb: 9,
      mix: 65,
      dcBlock: false,
    },
  });
  return data;
}

test('preset and track clones isolate all nested waveshaper settings', () => {
  const source = customPreset();
  for (const cloned of [clonePresetData(source).tracks[0], clonePresetTrackData(source.tracks[0])]) {
    const original = source.tracks[0].waveshaper;
    assert.deepEqual(cloned.waveshaper, original);
    assert.notEqual(cloned.waveshaper, original);
    assert.notEqual(cloned.waveshaper.customParameters, original.customParameters);
    assert.notEqual(cloned.waveshaper.customParameters[0], original.customParameters[0]);
    assert.notEqual(cloned.waveshaper.builtinParameters, original.builtinParameters);
    assert.notEqual(cloned.waveshaper.builtinParameters['sine-phase'], original.builtinParameters['sine-phase']);
    cloned.waveshaper.customParameters[0].value = 6;
    cloned.waveshaper.customParameters[0].step = 0.5;
    cloned.waveshaper.customParameters.push({ name: 'extra', value: 1, min: 0, max: 2, step: 1 });
    cloned.waveshaper.builtinParameters['sine-phase'].p = -1;
    assert.equal(original.customParameters[0].value, 3);
    assert.equal(original.customParameters[0].step, 0.25);
    assert.equal(original.customParameters.length, 2);
    assert.equal(original.builtinParameters['sine-phase'].p, 0.5);
  }
});

test('switching built-ins and disabling retains custom metadata and inactive built-in values', () => {
  const source = customPreset().tracks[0];
  let track = source;
  for (const curve of ['sine-phase', 'staircase', 'custom']) {
    track = normalizePresetTrackData({ ...track, waveshaper: { ...track.waveshaper, enabled: false, curve } });
    assert.equal(track.waveshaper.curve, curve);
    assert.equal(track.waveshaper.enabled, false);
    assert.equal(track.waveshaper.expression, source.waveshaper.expression);
    assert.deepEqual(track.waveshaper.customParameters, source.waveshaper.customParameters);
    assert.deepEqual(track.waveshaper.builtinParameters, source.waveshaper.builtinParameters);
  }
});

test('single-preset and library JSON exports round-trip complete waveshaper settings', () => {
  const data = customPreset();
  const preset = createNamedPreset('Waveshaper persistence', data, '2026-09-09T00:00:00.000Z');
  const exports = [
    buildSinglePresetExport(preset),
    buildPresetLibraryExport({ version: 2, folders: [], presets: [preset], selectedPresetId: preset.id }),
  ];
  for (const exported of exports) {
    const payload = parsePresetImportPayload(JSON.stringify(exported));
    const imported = payload.kind === 'single-preset' ? payload.preset : payload.presets[0];
    assert.deepEqual(imported.data.tracks[0].waveshaper, data.tracks[0].waveshaper);
    assert.equal(arePresetDataEqual(imported.data, data), true);
    imported.data.tracks[0].waveshaper.customParameters[0].min = 0;
    imported.data.tracks[0].waveshaper.builtinParameters['sine-fold'].k = 8;
    assert.equal(preset.data.tracks[0].waveshaper.customParameters[0].min, 0.5);
    assert.equal(preset.data.tracks[0].waveshaper.builtinParameters['sine-fold'].k, 4);
  }
});

test('track merge and colliding preset import preserve independent waveshaper settings', () => {
  const current = customPreset();
  const source = customPreset();
  source.tracks[0].waveshaper.customParameters[0].value = 5;
  const merged = mergePresetTracks(current, source);
  assert.deepEqual(merged.tracks[0].waveshaper, current.tracks[0].waveshaper);
  assert.deepEqual(merged.tracks[1].waveshaper, source.tracks[0].waveshaper);
  merged.tracks[0].waveshaper.customParameters[0].value = 7;
  merged.tracks[1].waveshaper.builtinParameters['sine-phase'].k = 9;
  assert.equal(current.tracks[0].waveshaper.customParameters[0].value, 3);
  assert.equal(source.tracks[0].waveshaper.builtinParameters['sine-phase'].k, 2);

  const preset = createNamedPreset('Shared name', source);
  const imported = mergeImportedPresets([preset], [preset], preset.id);
  const added = imported.importedPresets[0];
  assert.notEqual(added.id, preset.id);
  assert.notEqual(added.name, preset.name);
  assert.equal(imported.selectedPresetId, added.id);
  assert.deepEqual(added.data.tracks[0].waveshaper, preset.data.tracks[0].waveshaper);
  added.data.tracks[0].waveshaper.customParameters[0].max = 20;
  added.data.tracks[0].waveshaper.builtinParameters.staircase.n = 12;
  assert.equal(preset.data.tracks[0].waveshaper.customParameters[0].max, 12);
  assert.equal(preset.data.tracks[0].waveshaper.builtinParameters.staircase.n, 7);
});

test('dirty equality detects every waveshaper setting and parameter metadata change', () => {
  const source = customPreset();
  source.tracks[0].waveshaper.enabled = false;
  const changes: Record<string, (settings: WaveshaperSettings) => void> = {
    enabled: (settings) => { settings.enabled = true; },
    curve: (settings) => { settings.curve = 'sine-fold'; },
    expression: (settings) => { settings.expression = 'sin(amount*x)'; },
    inputDriveDb: (settings) => { settings.inputDriveDb = 10; },
    mix: (settings) => { settings.mix = 50; },
    dcBlock: (settings) => { settings.dcBlock = true; },
    name: (settings) => { settings.customParameters[0].name = 'strength'; },
    value: (settings) => { settings.customParameters[0].value = 4; },
    min: (settings) => { settings.customParameters[0].min = 0; },
    max: (settings) => { settings.customParameters[0].max = 16; },
    step: (settings) => { settings.customParameters[0].step = 0.5; },
    builtinValue: (settings) => { settings.builtinParameters['sine-fold'].k = 6; },
  };
  assert.equal(arePresetDataEqual(source, clonePresetData(source)), true);
  for (const [name, change] of Object.entries(changes)) {
    const changed = clonePresetData(source);
    change(changed.tracks[0].waveshaper);
    assert.equal(arePresetDataEqual(source, changed), false, name);
  }
});

test('missing and malformed waveshaper settings get independent disabled defaults', () => {
  const expected: WaveshaperSettings = {
    enabled: false, curve: 'sine-fold', expression: 'sin(k*x)',
    customParameters: [{ name: 'k', value: Math.PI / 2, min: 0.1, max: 32, step: 0.01 }],
    builtinParameters: {}, inputDriveDb: 0, mix: 100, dcBlock: true,
  };
  for (const waveshaper of [undefined, null, [], 'invalid', 42]) {
    assert.deepEqual(normalizePresetTrackData({ waveshaper }).waveshaper, expected);
  }
  const legacy = normalizePresetData({ waveform: 'square' });
  assert.deepEqual(legacy.tracks[0].waveshaper, expected);
  const tracks = normalizePresetData({ tracks: [{}, {}] }).tracks;
  tracks[0].waveshaper.customParameters[0].value = 8;
  assert.deepEqual(tracks[1].waveshaper, expected);
  assert.deepEqual(DEFAULT_PRESET_DATA.tracks[0].waveshaper, expected);
});

test('invalid persisted settings normalize bounds and metadata without deleting invalid math', () => {
  const normalized = normalizePresetTrackData({ waveshaper: {
    enabled: 'yes', curve: 'unknown', expression: 'sqrt(x)', dcBlock: 0,
    inputDriveDb: 100, mix: -5,
    customParameters: [
      { name: 'amount', value: 500, min: 0, max: 5, step: -1 },
      { name: 'amount', value: 1 },
      { name: 'PI', value: 2 },
      { name: 'x', value: 2 },
      { name: '__proto__', value: 2 },
      { name: 'offset', value: NaN, min: 4, max: 4, step: Infinity },
    ],
    builtinParameters: { 'sine-fold': { k: 500, extra: 9 }, staircase: { n: 3.7 }, unknown: { k: 2 } },
  } }).waveshaper;
  assert.deepEqual(normalized, {
    enabled: false, curve: 'sine-fold', expression: 'sqrt(x)', dcBlock: true,
    inputDriveDb: 36, mix: 0,
    customParameters: [
      { name: 'amount', value: 5, min: 0, max: 5, step: 0.01 },
      { name: 'offset', value: 1, min: -10, max: 10, step: 0.01 },
    ],
    builtinParameters: { 'sine-fold': { k: 32 }, staircase: { n: 4 } },
  });
  assert.equal(normalizePresetTrackData({ waveshaper: { inputDriveDb: -100, mix: 200 } }).waveshaper.inputDriveDb, -24);
  assert.equal(normalizePresetTrackData({ waveshaper: { mix: 200 } }).waveshaper.mix, 100);
  const nonfinite = normalizePresetTrackData({ waveshaper: { inputDriveDb: NaN, mix: Infinity } }).waveshaper;
  assert.equal(nonfinite.inputDriveDb, 0);
  assert.equal(nonfinite.mix, 100);
  const invalidMath = customPreset();
  invalidMath.tracks[0].waveshaper.expression = 'sin(';
  const payload = parsePresetImportPayload(JSON.stringify(buildSinglePresetExport(createNamedPreset('Invalid math', invalidMath))));
  assert.equal(payload.kind, 'single-preset');
  if (payload.kind !== 'single-preset') assert.fail('Expected a single preset');
  assert.equal(payload.preset.data.tracks[0].waveshaper.expression, 'sin(');
  assert.equal(payload.preset.data.tracks[0].waveshaper.enabled, true);
});

test('normalization canonicalizes JSON object ordering for stable dirty equality', () => {
  const source = customPreset();
  const reordered = JSON.parse(JSON.stringify(source));
  const settings = reordered.tracks[0].waveshaper;
  settings.builtinParameters = { staircase: { n: 7 }, 'sine-phase': { p: 0.5, k: 2 }, 'sine-fold': { k: 4 } };
  settings.customParameters = settings.customParameters.map((parameter: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(parameter).reverse()));
  reordered.tracks[0].waveshaper = Object.fromEntries(Object.entries(settings).reverse());
  const normalized = normalizePresetData(reordered);
  assert.equal(JSON.stringify(normalized.tracks[0].waveshaper), JSON.stringify(source.tracks[0].waveshaper));
  assert.equal(arePresetDataEqual(normalized, source), true);
  assert.equal(arePresetDataEqual(normalized, normalizePresetData(normalized)), true);
});