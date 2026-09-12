import assert from 'node:assert/strict';
import test from 'node:test';
import { generatePartialSpectrum, normalizePartialGenerator } from '../src/audio/partialGenerator.js';
import { normalizePresetData } from '../src/presets.js';
import { presetDataToGeneratorInput } from './cli.js';
import { generateMidi, generateWav, type GenerateTrackOptions } from './generate.js';
import { preparePartialOscillator, preparePartialSpectrumOscillator } from './partialOscillator.js';

test('CLI oscillators sample the shared browser spectrum at the musical fundamental', () => {
  const configs = [
    { type: 'waveform' },
    { type: 'waveform', contrast: 0.5, oddEvenBalance: 12, normalize: true },
    ...[
      'natural', 'fibonacci', 'primes', 'powers-of-two', 'thue-morse', 'triangular', 'lucas',
      'divisor-count', 'stern-diatomic', 'euler-totient', 'recaman',
    ].map(sequence => ({
      type: 'sequence', sequence,
    })),
    ...[
      'popcount', 'parity', 'bit', 'gray-code', 'gray-popcount', 'bit-length', 'ruler',
      'longest-one-run', 'one-run-count', 'rudin-shapiro', 'bit-reversal',
    ].map(mode => ({ type: 'binary', mode, bit: 2, bitWidth: 4 })),
    {
      type: 'sequence', sequence: 'recaman', mapping: 'modulo', mappingModulus: 5,
      mask: 'periodic', maskPeriod: 4, maskOffset: 1, invertMask: true,
    },
  ];
  for (const config of configs) {
    const generator = normalizePartialGenerator({ harmonicCount: 64, mask: 'odd', tilt: -3, ...config });
    assert.notEqual(generator.type, 'tonewheel');
    if (generator.type === 'tonewheel') throw new Error('Expected procedural generator');
    for (const waveform of ['sine', 'square', 'triangle', 'sawtooth', 'flute', 'oboe', 'pulse-25', 'formant', 'choir-ah', 'pink-noise']) {
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

test('CLI excludes harmonics at and above Nyquist, including changing pitch and sample rate', () => {
  const generator = normalizePartialGenerator({
    type: 'sequence', sequence: 'powers-of-two', harmonicCount: 64,
  });
  if (generator.type === 'tonewheel') throw new Error('Expected procedural generator');
  const spectrum = generatePartialSpectrum(generator, 'sawtooth');
  const sample = preparePartialOscillator(generator, 'sawtooth');
  for (const sampleRate of [44100, 48000, 96000]) {
    for (const frequency of [880, 220, 10000, sampleRate / 2, 440]) {
      const phase = 0.13571;
      const expected = spectrum.reduce((sum, amplitude, bin) => {
        const ratio = (bin + 1) / 2;
        return ratio * frequency < sampleRate / 2
          ? sum + amplitude * Math.sin(2 * Math.PI * ratio * phase) : sum;
      }, 0);
      const interpolationBound = spectrum.reduce((sum, amplitude, bin) =>
        sum + Math.abs(amplitude) * (Math.PI * (bin + 1) / 65536) ** 2 / 8, 0);
      assert.ok(Math.abs(sample(phase, frequency, sampleRate) - expected) <= interpolationBound + 1e-12);
    }
  }
});

test('CLI samples arbitrary half-fundamental spectra on their shared basis', () => {
  const spectrum = [0.5, 0, -0.25, 0.125];
  const sample = preparePartialSpectrumOscillator(spectrum, 'arbitrary-test');
  for (const phase of [0, 0.03125, 0.13371, 0.713, 0.99999, 1]) {
    const expected = spectrum.reduce((sum, amplitude, index) => (
      sum + amplitude * Math.sin(2 * Math.PI * (index + 1) * phase)
    ), 0);
    assert.ok(Math.abs(sample(phase) - expected) < 1e-5);
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
    tracks: [{
      ...track,
      sequenceInput: '1 2',
      partialGenerator: {
        type: 'binary', mode: 'bit-reversal', bitWidth: 4, mapping: 'modulo', mappingModulus: 5,
        mask: 'periodic', maskPeriod: 4, maskOffset: 2, invertMask: true,
      },
    }, {}],
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

test('generic tonewheel endpoints match standalone tonewheel rendering', async () => {
  for (const drawbars of [
    [8, 0, 0, 0, 0, 0, 0, 0, 0],
    [8, 8, 8, 8, 8, 8, 8, 8, 8],
  ]) {
    const standalone = { ...track, partialGenerator: { type: 'tonewheel' } as const, tonewheelDrawbars: drawbars };
    const generic = {
      ...standalone,
      tonewheelWavetable: {
        enabled: true,
        dimensions: [{ name: 'Source', value: 0 }],
        configurations: [{
          name: 'Tonewheel',
          position: [0],
          drawbars,
          source: { partialGenerator: { type: 'tonewheel' } as const, waveform: 'sine', tonewheelDrawbars: drawbars },
        }],
        lfos: [],
      },
    };

    assert.deepEqual(await generateWav({ ...options, tracks: [generic] }),
      await generateWav({ ...options, tracks: [standalone] }));
  }
});

test('procedural WAV output changes deterministically without changing MIDI', async () => {
  const legacyOptions = { ...options, tracks: [track] };
  const legacy = await generateWav(legacyOptions);
  for (const partialGenerator of [
    normalizePartialGenerator({ type: 'sequence', sequence: 'primes', mapping: 'inverse' }),
    normalizePartialGenerator({
      type: 'binary', mode: 'bit-reversal', bitWidth: 4, mapping: 'logarithmic',
      mask: 'periodic', maskPeriod: 3, maskOffset: 1, invertMask: true,
    }),
  ]) {
    const proceduralOptions = { ...options, tracks: [{ ...track, partialGenerator }] };
    const rendered = await generateWav(proceduralOptions);
    assert.notDeepEqual(rendered, legacy);
    assert.deepEqual(await generateWav(proceduralOptions), rendered);
    assert.deepEqual(await generateMidi(proceduralOptions), await generateMidi(legacyOptions));
  }
});

test('waveform transforms survive CLI preset conversion and change WAV but not MIDI', async () => {
  const data = normalizePresetData({ tracks: [{
    ...track, sequenceInput: '1 2', partialGenerator: {
      type: 'waveform', harmonicCount: 12, tilt: -6, contrast: 0.5,
      oddEvenBalance: 9, mask: 'prime', normalize: true,
    },
  }] });
  const input = presetDataToGeneratorInput(data);
  assert.deepEqual(input.tracks[0].partialGenerator, data.tracks[0].partialGenerator);
  const transformed = { ...options, tracks: input.tracks };
  const neutral = { ...options, tracks: [{ ...input.tracks[0], partialGenerator: { type: 'waveform' } as const }] };
  const rendered = await generateWav(transformed);
  assert.notDeepEqual(rendered, await generateWav(neutral));
  assert.deepEqual(rendered, await generateWav(transformed));
  assert.deepEqual(await generateMidi(transformed), await generateMidi(neutral));
});

test('inactive tonewheel settings do not alter waveform or procedural rendering', async () => {
  for (const type of ['sequence', 'binary', 'waveform']) {
  const partialGenerator = normalizePartialGenerator({ type, mode: 'popcount' });
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
  }
});

test('mixed-source wavetable renders deterministic static and animated WAV without changing MIDI', async () => {
  const data = normalizePresetData({ tracks: [{
    ...track,
    sequenceInput: '1 2',
    tonewheelWavetable: {
      enabled: true,
      dimensions: [{ name: 'Source', value: 0.5 }],
      configurations: [
        {
          name: 'Tonewheel', position: [0], drawbars: [8, 0, 0, 0, 0, 0, 0, 0, 0],
          source: {
            partialGenerator: { type: 'tonewheel' }, waveform: 'sine',
            tonewheelDrawbars: [8, 0, 0, 0, 0, 0, 0, 0, 0],
          },
        },
        {
          name: 'Sequence', position: [1], drawbars: Array(9).fill(0),
          source: {
            partialGenerator: {
              type: 'sequence', sequence: 'primes', harmonicCount: 8, normalize: true,
              mapping: 'inverse', exponent: 1, mask: 'none', tilt: -3,
            },
            waveform: 'sine', tonewheelDrawbars: Array(9).fill(0),
          },
        },
      ],
      lfos: [{
        enabled: true, name: 'Source sweep', waveform: 'sine', sync: false, rateHz: 2,
        syncRate: '1/4', phase: 0, depth: 0.5, polarity: 'bipolar', retrigger: 'note',
        smoothing: 0, fmSource: -1, fmAmount: 0, routes: [1],
      }],
    },
  }] });
  const input = { ...options, tracks: presetDataToGeneratorInput(data).tracks };
  const rendered = await generateWav(input);

  assert.deepEqual(await generateWav(input), rendered);
  assert.notDeepEqual(rendered, await generateWav({ ...options, tracks: [track] }));
  for (const waveform of ['sine', 'choir-ah', 'pink-noise', 'brown-noise']) {
    assert.deepEqual(await generateWav({
      ...options,
      tracks: [{ ...input.tracks[0], waveform }],
    }), rendered, `generic wavetable ignores inactive top-level ${waveform}`);
  }
  const wavetableDisabled = {
    ...input.tracks[0],
    tonewheelWavetable: { ...input.tracks[0].tonewheelWavetable, enabled: false },
  };
  assert.deepEqual(await generateMidi(input), await generateMidi({ ...options, tracks: [wavetableDisabled] }));
});

test('inactive waveform selections cannot change tonewheel, sequence, or binary WAV and MIDI', async () => {
  for (const type of ['tonewheel', 'sequence', 'binary']) {
    const partialGenerator = normalizePartialGenerator({ type });
    const source = { ...track, partialGenerator, waveform: 'sine' };
    const expected = await generateWav({ ...options, tracks: [source] });
    const midi = await generateMidi({ ...options, tracks: [source] });
    for (const waveform of ['triangle', 'square', 'choir-ah', 'choir-oh', 'pink-noise', 'brown-noise']) {
      const input = { ...options, tracks: [{ ...source, waveform }] };
      assert.deepEqual(await generateWav(input), expected, `${type} ignores ${waveform}`);
      assert.deepEqual(await generateMidi(input), midi);
    }
  }
});

test('waveform source renders distinct deterministic spectra without drawbars', async () => {
  let previous: Uint8Array | undefined;
  const midi = await generateMidi({ ...options, tracks: [track] });
  for (const waveform of ['sine', 'square', 'choir-ah', 'choir-oh', 'pink-noise', 'brown-noise']) {
    const source = { ...track, waveform, partialGenerator: { type: 'waveform' } as const, tonewheelDrawbars: Array(9).fill(0) };
    const input = { ...options, tracks: [source] };
    const wav = await generateWav(input);
    assert.ok(wav.subarray(44).some(byte => byte !== 0), `${waveform} is audible`);
    assert.deepEqual(await generateWav(input), wav);
    assert.deepEqual(await generateWav({ ...options, tracks: [{ ...source, tonewheelDrawbars: Array(9).fill(8) }] }), wav);
    assert.deepEqual(await generateMidi(input), midi);
    if (previous) assert.notDeepEqual(wav, previous);
    previous = wav;
    if (waveform.endsWith('-noise')) {
      assert.deepEqual(await generateWav({ ...options, tracks: [{ ...source, partialGenerator: undefined }] }), wav);
      assert.notDeepEqual(await generateWav({ ...options, tracks: [{ ...source, unisonVoices: 4, unisonDetune: 80 }] }), wav);
      assert.notDeepEqual(await generateWav({ ...options, tracks: [{ ...source, octave: 5 }] }), wav);
      assert.notDeepEqual(wav, await generateWav({ ...options, tracks: [{ ...source, waveform: 'sine' }] }));
    }
  }
});

test('legacy single-track noise input migrates but an explicit tonewheel source remains tonal', async () => {
  for (const waveform of ['pink-noise', 'brown-noise']) {
    const legacy = { ...options, waveform, sequence: '1', denominator: 16 };
    const migrated = await generateWav(legacy);
    assert.deepEqual(await generateWav({ ...legacy, partialGenerator: { type: 'waveform' } }), migrated);
    const tonal = await generateWav({ ...legacy, partialGenerator: { type: 'tonewheel' } });
    assert.notDeepEqual(tonal, migrated);
    assert.deepEqual(tonal, await generateWav({ ...legacy, waveform: 'sine', partialGenerator: { type: 'tonewheel' } }));
  }
});

test('tracks inherit an explicit top-level source without overriding local sources or legacy noise migration', async () => {
  for (const type of ['sequence', 'binary', 'tonewheel']) {
    const partialGenerator = normalizePartialGenerator({ type });
    for (const waveform of ['pink-noise', 'brown-noise', 'choir-ah']) {
      const source = { ...track, waveform };
      const inherited = { ...options, partialGenerator, tracks: [source] };
      assert.deepEqual(await generateWav(inherited),
        await generateWav({ ...options, tracks: [{ ...source, partialGenerator }] }));
      assert.deepEqual(await generateWav(inherited),
        await generateWav({ ...inherited, tracks: [{ ...source, waveform: 'sine' }] }));
      assert.deepEqual(await generateMidi(inherited), await generateMidi({ ...options, tracks: [source] }));
      const explicit = { ...source, partialGenerator: { type: 'waveform' } as const };
      assert.deepEqual(await generateWav({ ...inherited, tracks: [explicit] }),
        await generateWav({ ...options, tracks: [explicit] }));
    }
  }
  const legacyNoise = { ...track, waveform: 'pink-noise' };
  assert.deepEqual(await generateWav({ ...options, tracks: [legacyNoise] }),
    await generateWav({ ...options, tracks: [{ ...legacyNoise, partialGenerator: { type: 'waveform' } }] }));
});
