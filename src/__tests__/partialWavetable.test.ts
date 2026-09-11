import assert from 'node:assert/strict';
import test from 'node:test';
import {
  blendPartialWavetableSpectra,
  getPartialWavetableWeights,
  resolvePartialSourceSpectrum,
  type PartialSourceSnapshot,
  type PartialWavetable,
} from '../audio/partialWavetable.js';
import { getPartialSpectrumGain, getRealtimePartialSpectrumGain } from '../audio/partialSpectrumGain.js';
import {
  arePresetDataEqual,
  clonePresetData,
  clonePresetTrackData,
  DEFAULT_PRESET_DATA,
  normalizePresetTrackData,
} from '../presets.js';

const tonewheel: PartialSourceSnapshot = {
  partialGenerator: { type: 'tonewheel' },
  waveform: 'sine',
  tonewheelDrawbars: [8, 0, 0, 0, 0, 0, 0, 0, 0],
};
const sequence: PartialSourceSnapshot = {
  partialGenerator: {
    type: 'sequence', sequence: 'natural', harmonicCount: 1, normalize: true,
    mapping: 'linear', exponent: 1, mappingModulus: 2,
    mask: 'none', invertMask: false, maskPeriod: 2, maskOffset: 0, tilt: 0,
  },
  waveform: 'sine',
  tonewheelDrawbars: [],
};

function mixedTable(value: number): PartialWavetable {
  return {
    enabled: true,
    dimensions: [{ name: 'Source', value }],
    configurations: [
      { name: 'Tonewheel', position: [0], source: tonewheel },
      { name: 'Sequence', position: [1], source: sequence },
    ],
    lfos: [],
  };
}

test('returns exact sparse-configuration weights at endpoints', () => {
  assert.deepEqual(getPartialWavetableWeights(mixedTable(0)), [1, 0]);
  assert.deepEqual(getPartialWavetableWeights(mixedTable(1)), [0, 1]);
});

test('crossfades cached spectra from different partial sources', () => {
  assert.deepEqual(blendPartialWavetableSpectra(mixedTable(0.5), sequence), [0.5, 0.5]);
  assert.strictEqual(resolvePartialSourceSpectrum(tonewheel), resolvePartialSourceSpectrum(tonewheel));
});

test('pads shorter configuration spectra with silence', () => {
  const longer = {
    ...sequence,
    partialGenerator: { ...sequence.partialGenerator, harmonicCount: 2 },
  } as PartialSourceSnapshot;
  const table = mixedTable(0.5);
  table.configurations[1].source = longer;

  assert.deepEqual(blendPartialWavetableSpectra(table, tonewheel), [0.5, 0.25, 0, 0.5]);
});

test('preserves frozen noise spectra in mixed-source configurations', () => {
  const pink: PartialSourceSnapshot = {
    partialGenerator: { type: 'waveform', harmonicCount: 8 },
    waveform: 'pink-noise',
    tonewheelDrawbars: [],
  };
  const table = mixedTable(1);
  table.configurations[1].source = pink;

  const spectrum = resolvePartialSourceSpectrum(pink);
  assert.equal(spectrum.length, 16);
  assert.ok(spectrum.some((amplitude) => amplitude < 0));
  assert.deepEqual(blendPartialWavetableSpectra(table, tonewheel), spectrum);
  assert.strictEqual(resolvePartialSourceSpectrum(pink), spectrum);
});

test('normalizes and deeply clones mixed-source preset configurations', () => {
  const track = normalizePresetTrackData({
    tonewheelWavetable: mixedTable(0.5),
  });
  const cloned = clonePresetTrackData(track);

  assert.equal(track.tonewheelWavetable.configurations[1].source?.partialGenerator.type, 'sequence');
  assert.notStrictEqual(
    cloned.tonewheelWavetable.configurations[1].source,
    track.tonewheelWavetable.configurations[1].source,
  );
});

test('normalizes unsupported embedded waveform names to sine', () => {
  const table = mixedTable(0.5);
  table.configurations[1].source = { ...sequence, waveform: 'not-a-waveform' };
  const track = normalizePresetTrackData({ tonewheelWavetable: table });

  assert.equal(track.tonewheelWavetable.configurations[1].source?.waveform, 'sine');
});

test('mixed-source configuration edits participate in preset dirty equality', () => {
  const saved = clonePresetData(DEFAULT_PRESET_DATA);
  const draft = clonePresetData(saved);
  draft.tracks[0].tonewheelWavetable = normalizePresetTrackData({
    tonewheelWavetable: mixedTable(0.5),
  }).tonewheelWavetable;

  assert.equal(arePresetDataEqual(saved, draft), false);
  const savedMixed = clonePresetData(draft);
  const source = draft.tracks[0].tonewheelWavetable.configurations[1].source;
  if (source?.partialGenerator.type === 'sequence') source.partialGenerator.tilt = 6;
  assert.equal(arePresetDataEqual(savedMixed, draft), false);
});

test('realtime gain estimation retains high and dense partial levels', () => {
  const highestPartial = Array.from({ length: 128 }, (_, index) => index === 127 ? 1 : 0);
  const denseSpectrum = Array.from({ length: 128 }, (_, index) => Math.sin(index * 1.7) / (index + 1));
  const adversarialSpectra = Array.from({ length: 8 }, (_, seed) => Array.from(
    { length: 128 },
    (_, index) => Math.sin((index + 1) * (seed + 1) * 1.61803398875) / Math.sqrt(index + 1),
  ));
  for (const spectrum of [highestPartial, denseSpectrum, ...adversarialSpectra]) {
    const exact = getPartialSpectrumGain(spectrum);
    const realtime = getRealtimePartialSpectrumGain(spectrum);
    assert.ok(realtime > 0.99 * exact && realtime < 1.001 * exact, `${realtime} approximates ${exact}`);
  }
});