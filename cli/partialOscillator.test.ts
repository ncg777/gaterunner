import assert from 'node:assert/strict';
import test from 'node:test';
import { generatePartialSpectrum, normalizePartialGenerator } from '../src/audio/partialGenerator.js';
import { normalizePresetData } from '../src/presets.js';
import { presetDataToGeneratorInput } from './cli.js';
import { generateMidi, generateWav, type GenerateTrackOptions } from './generate.js';
import { preparePartialOscillator } from './partialOscillator.js';

test('CLI oscillators sample the shared browser spectrum at the musical fundamental', () => {
  const configs = [
    ...['natural', 'fibonacci', 'primes', 'powers-of-two', 'thue-morse'].map(sequence => ({
      type: 'sequence', sequence,
    })),
    ...['popcount', 'parity', 'bit'].map(mode => ({ type: 'binary', mode, bit: 2 })),
  ];
  for (const config of configs) {
    const generator = normalizePartialGenerator({ ...config, harmonicCount: 64, mask: 'odd', tilt: -3 });
    assert.notEqual(generator.type, 'tonewheel');
    if (generator.type === 'tonewheel') throw new Error('Expected procedural generator');
    for (const waveform of ['sine', 'square', 'triangle', 'sawtooth', 'flute', 'oboe', 'pulse-25', 'formant']) {
      const spectrum = generatePartialSpectrum(generator, waveform);
      const sample = preparePartialOscillator(generator, waveform);
      const cachedSample = preparePartialOscillator(generator, waveform);
      for (const phase of [0, 0.03125, 0.13371, 0.25703, 0.713, 0.99999, 1]) {
        const expected = spectrum.reduce((sum, amplitude, bin) => (
          sum + amplitude * Math.sin(Math.PI * (bin + 1) * phase)
        ), 0);
        assert.ok(Math.abs(sample(phase) - expected) < 1e-5, `${JSON.stringify(config)} ${waveform}`);
        assert.equal(sample(phase), cachedSample(phase));
      }
    }
  }
});

const track: GenerateTrackOptions = {
  sequence: '1 2', denominator: 16, waveform: 'sawtooth',
  attack: 0, decay: 0, sustain: 1, release: 0.01, gain: -18,
  tonewheelDrawbars: [0, 0, 8, 0, 0, 0, 0, 0, 0],
};
const options = { bpm: 240, reverb: { enabled: false } };

test('CLI preset conversion retains generator configuration and legacy tonewheel defaults', () => {
  const data = normalizePresetData({
    tracks: [{ ...track, sequenceInput: '1 2', partialGenerator: { type: 'binary', mode: 'bit', bit: 2 } }, {}],
  });
  const input = presetDataToGeneratorInput(data);
  assert.deepEqual(input.tracks[0].partialGenerator, data.tracks[0].partialGenerator);
  assert.deepEqual(input.tracks[1].partialGenerator, { type: 'tonewheel' });
});

test('CLI legacy, explicit tonewheel, and invalid generator render byte-identical WAV', async () => {
  const legacy = await generateWav({ ...options, tracks: [track] });
  for (const partialGenerator of [{ type: 'tonewheel' }, { type: 'invalid' }, null]) {
    const rendered = await generateWav({
      ...options, tracks: [{ ...track, partialGenerator: partialGenerator as GenerateTrackOptions['partialGenerator'] }],
    });
    assert.deepEqual(rendered, legacy);
  }
});

test('procedural WAV output changes deterministically without changing MIDI', async () => {
  const partialGenerator = normalizePartialGenerator({ type: 'sequence', sequence: 'primes', mapping: 'inverse' });
  const legacyOptions = { ...options, tracks: [track] };
  const proceduralOptions = { ...options, tracks: [{ ...track, partialGenerator }] };
  const legacy = await generateWav(legacyOptions);
  const rendered = await generateWav(proceduralOptions);
  assert.notDeepEqual(rendered, legacy);
  assert.deepEqual(await generateWav(proceduralOptions), rendered);
  assert.deepEqual(await generateMidi(proceduralOptions), await generateMidi(legacyOptions));
});

test('inactive tonewheel settings do not alter procedural rendering', async () => {
  const partialGenerator = normalizePartialGenerator({ type: 'binary', mode: 'popcount' });
  const proceduralTrack = { ...track, partialGenerator };
  const expected = await generateWav({ ...options, tracks: [proceduralTrack] });
  const animatedTrack = normalizePresetData({ tracks: [{
    ...proceduralTrack,
    tonewheelDrawbars: [8, 8, 8, 8, 8, 8, 8, 8, 8],
    tonewheelWavetable: {
      enabled: true, dimensions: [{ name: 'X', value: 0.5 }],
      configurations: [
        { name: 'A', position: [0], drawbars: [8, 0, 0, 0, 0, 0, 0, 0, 0] },
        { name: 'B', position: [1], drawbars: [0, 0, 0, 0, 0, 0, 0, 0, 8] },
      ],
      lfos: [{ enabled: true, depth: 1, routes: [1] }],
    },
  }] }).tracks[0];
  assert.deepEqual(await generateWav({
    ...options, tracks: [{ ...proceduralTrack, tonewheelDrawbars: animatedTrack.tonewheelDrawbars,
      tonewheelWavetable: animatedTrack.tonewheelWavetable }],
  }), expected);
});
