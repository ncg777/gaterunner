import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyModulationValues, normalizeModulation } from '../audio/modulation.js';
import { modulatedSourceSpectrum, spectralSpectrumAtTime } from '../audio/spectralModulation.js';
import { generatePartialSpectrum, normalizePartialGenerator } from '../audio/partialGenerator.js';
import { normalizePresetTrackData } from '../presets.js';
import { renderWavChannels } from '../../cli/generate.js';

test('spectral routes offset the existing generator controls before normalization', () => {
  const source = { partialGenerator: normalizePartialGenerator({ type: 'waveform', tilt: -3, contrast: 1.3, oddEvenBalance: 4, harmonicCount: 8 }),
    waveform: 'sawtooth', tonewheelDrawbars: [] };
  const m = { ...emptyModulationValues(), spectralTilt: -6, spectralContrast: 0.2, spectralBalance: -8, harmonicCount: 5 };
  assert.deepEqual(modulatedSourceSpectrum(source, m), generatePartialSpectrum({ ...source.partialGenerator,
    type: 'waveform', tilt: -9, contrast: 1.5, oddEvenBalance: -4, harmonicCount: 13 }, 'sawtooth'));
  assert.equal(source.partialGenerator.type === 'waveform' && source.partialGenerator.tilt, -3);
  const octaves = modulatedSourceSpectrum({ ...source, partialGenerator: { type: 'waveform' } }, { ...emptyModulationValues(), spectralTilt: -6 });
  const flat = generatePartialSpectrum({ type: 'waveform' }, 'sawtooth');
  assert.ok(Math.abs(octaves[7] / flat[7] - 10 ** (-12 / 20)) < 1e-12);
});

test('neutral procedural spectra retain large-sequence normalization and power mapping is modulatable', () => {
  for (const normalize of [true, false]) {
    const partialGenerator = normalizePartialGenerator({ type: 'sequence', sequence: 'powers-of-two', mapping: 'power', exponent: 2, harmonicCount: 64, normalize });
    const source = { partialGenerator, waveform: 'sine', tonewheelDrawbars: [] };
    const neutral = modulatedSourceSpectrum(source, emptyModulationValues());
    assert.deepEqual(neutral, generatePartialSpectrum(partialGenerator));
    const mapped = modulatedSourceSpectrum(source, { ...emptyModulationValues(), mappingExponent: -1 });
    assert.deepEqual(mapped, generatePartialSpectrum({ ...partialGenerator, exponent: 1 }));
  }
});

test('mixed wavetable sources receive spectral motion before blending', () => {
  const track = normalizePresetTrackData({ waveform: 'sawtooth', partialGenerator: { type: 'waveform' }, tonewheelWavetable: {
    enabled: true, dimensions: [{ name: 'X', value: 0.5 }], configurations: [
      { position: [0], source: { partialGenerator: { type: 'waveform' }, waveform: 'sawtooth', tonewheelDrawbars: [] } },
      { position: [1], source: { partialGenerator: { type: 'waveform' }, waveform: 'square', tonewheelDrawbars: [] } },
    ], lfos: [],
  } });
  const source = { ...track, partialGenerator: normalizePartialGenerator(track.partialGenerator) };
  const m = { ...emptyModulationValues(), spectralTilt: -4, harmonicCount: -50 };
  const actual = spectralSpectrumAtTime(source, m, { time: 0.2, noteStart: 0, bpm: 120 });
  const a = modulatedSourceSpectrum(track.tonewheelWavetable.configurations[0].source!, m);
  const b = modulatedSourceSpectrum(track.tonewheelWavetable.configurations[1].source!, m);
  assert.deepEqual(actual, a.map((v, i) => (v + b[i]) / 2));
});

test('native spectral envelopes and LFOs audibly alter the spectrum deterministically', async () => {
  const track = { sequence: '1 2', gain: -24, attack: 0, sustain: 1, release: 0.05,
    partialGenerator: { type: 'waveform' as const, harmonicCount: 12 }, waveform: 'sawtooth', reverbWet: -96 };
  const plain = await renderWavChannels({ bpm: 240, tracks: [track] });
  for (const [target, amount] of [['spectralTilt', -12], ['spectralContrast', 1], ['spectralBalance', 18], ['harmonicCount', -8]] as const) {
    const modulation = normalizeModulation({ sources: [{ id: 'env', type: 'envelope', attack: 0.15, decay: 0, sustain: 1 }],
      routes: [{ source: 'env', target, amount }] });
    const options = { bpm: 240, tracks: [{ ...track, modulation }] };
    const rendered = await renderWavChannels(options);
    assert.ok(rendered.left.every(Number.isFinite));
    assert.notDeepEqual(rendered.left, plain.left);
    assert.deepEqual(await renderWavChannels(options), rendered);
  }
});
