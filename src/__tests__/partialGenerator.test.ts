import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generatePartialSpectrum,
  generateProceduralAmplitudes,
  MAX_PROCEDURAL_AMPLITUDE,
  normalizePartialGenerator,
} from '../audio/partialGenerator.js';
import {
  FLUTE_HARMONICS, PULSE_DUTY, REED_HARMONICS, getWaveformPartialAmplitude, isPulseWaveform,
} from '../audio/spectra.js';
import { getTonewheelSpectrum } from '../audio/tonewheelSpectrum.js';
import {
  arePresetDataEqual, buildSinglePresetExport, clonePresetData, clonePresetTrackData,
  createNamedPreset, DEFAULT_PRESET_DATA, DEFAULT_TONEWHEEL_DRAWBARS,
  normalizePresetData, normalizePresetTrackData, parsePresetImportPayload,
} from '../presets.js';

const sequence = (name: string, extra: Record<string, unknown> = {}) => ({
  type: 'sequence', sequence: name, harmonicCount: 8, normalize: false, ...extra,
});
const binary = (mode: string, extra: Record<string, unknown> = {}) => ({
  type: 'binary', mode, harmonicCount: 8, normalize: false, ...extra,
});
const maskDefaults = { mask: 'none', invertMask: false, maskPeriod: 2, maskOffset: 0 };
const waveformDefaults = {
  type: 'waveform', harmonicCount: 64, tilt: 0, contrast: 1,
  oddEvenBalance: 0, ...maskDefaults, normalize: false,
};

test('each sequence has the documented starting index', () => {
  const examples = {
    natural: [1, 2, 3, 4, 5, 6, 7, 8],
    fibonacci: [1, 1, 2, 3, 5, 8, 13, 21],
    primes: [2, 3, 5, 7, 11, 13, 17, 19],
    'powers-of-two': [1, 2, 4, 8, 16, 32, 64, 128],
    'thue-morse': [0, 1, 1, 0, 1, 0, 0, 1],
    triangular: [1, 3, 6, 10, 15, 21, 28, 36],
    lucas: [2, 1, 3, 4, 7, 11, 18, 29],
    'divisor-count': [1, 2, 2, 3, 2, 4, 2, 4],
    'stern-diatomic': [1, 1, 2, 1, 3, 2, 3, 1],
    'euler-totient': [1, 1, 2, 2, 4, 2, 6, 4],
    recaman: [0, 1, 3, 6, 2, 7, 13, 20],
  };
  for (const [name, expected] of Object.entries(examples)) {
    assert.deepEqual(generateProceduralAmplitudes(sequence(name)), expected);
  }
});

test('binary modes count bits, return parity, or select an individual bit starting at zero', () => {
  assert.deepEqual(generateProceduralAmplitudes(binary('popcount')), [0, 1, 1, 2, 1, 2, 2, 3]);
  assert.deepEqual(generateProceduralAmplitudes(binary('parity')), [0, 1, 1, 0, 1, 0, 0, 1]);
  assert.deepEqual(generateProceduralAmplitudes(binary('bit')), [0, 1, 0, 1, 0, 1, 0, 1]);
  assert.deepEqual(generateProceduralAmplitudes(binary('bit', { bit: 1 })), [0, 0, 1, 1, 0, 0, 1, 1]);
  assert.deepEqual(generateProceduralAmplitudes(binary('bit', { bit: 2 })), [0, 0, 0, 0, 1, 1, 1, 1]);
  assert.deepEqual(generateProceduralAmplitudes(binary('bit', { bit: 5, harmonicCount: 64 })),
    [...Array(32).fill(0), ...Array(32).fill(1)]);
});

test('mappings operate on values, preserve zeros, and do not mutate inputs', () => {
  for (const [mapping, expected] of [
    ['linear', [1, 2, 3, 4]],
    ['power', [1, 4, 9, 16]],
    ['sqrt', [1, Math.sqrt(2), Math.sqrt(3), 2]],
    ['inverse', [1, 1 / 2, 1 / 3, 1 / 4]],
    ['logarithmic', [1, Math.log2(3), 2, Math.log2(5)]],
    ['inverse-sqrt', [1, 1 / Math.sqrt(2), 1 / Math.sqrt(3), 0.5]],
    ['saturating', [0.5, 2 / 3, 0.75, 0.8]],
    ['modulo', [1, 2, 0, 1]],
  ] as const) {
    const generator = sequence('natural', { mapping, exponent: 2, mappingModulus: 3, harmonicCount: 4 });
    const before = { ...generator };
    assert.deepEqual(generateProceduralAmplitudes(generator), expected);
    assert.deepEqual(generator, before);
    const zeroWeights = generateProceduralAmplitudes(binary('parity', { mapping, exponent: 0 }));
    for (const index of [0, 3, 5, 6]) assert.equal(zeroWeights[index], 0);
  }
});

test('masks select musical harmonic numbers, not generated values or zero-based indices', () => {
  const selected = {
    none: [1, 2, 3, 4, 5, 6, 7, 8],
    odd: [1, 3, 5, 7],
    even: [2, 4, 6, 8],
    prime: [2, 3, 5, 7],
    fibonacci: [1, 2, 3, 5, 8],
    'power-of-two': [1, 2, 4, 8],
    square: [1, 4],
    triangular: [1, 3, 6],
    'thue-morse': [2, 3, 5, 8],
  };
  for (const [mask, harmonics] of Object.entries(selected)) {
    const values = generateProceduralAmplitudes(sequence('primes', { mask }));
    assert.deepEqual(values.map((weight, index) => weight > 0 ? index + 1 : 0).filter(Boolean), harmonics);
  }
  const periodic = generateProceduralAmplitudes(sequence('natural', {
    mask: 'periodic', maskPeriod: 3, maskOffset: 1,
  }));
  assert.deepEqual(periodic.map((weight, index) => weight > 0 ? index + 1 : 0).filter(Boolean), [2, 5, 8]);
  const inverted = generateProceduralAmplitudes(sequence('natural', { mask: 'prime', invertMask: true }));
  assert.deepEqual(inverted.map((weight, index) => weight > 0 ? index + 1 : 0).filter(Boolean), [1, 4, 6, 8]);
  assert.deepEqual(
    generateProceduralAmplitudes(sequence('natural', { mask: 'none', invertMask: true })),
    generateProceduralAmplitudes(sequence('natural')),
  );
});

test('tilt uses dB per octave, after mapping and masks, before peak normalization', () => {
  const flat = sequence('natural', { mapping: 'inverse', harmonicCount: 4 });
  const tilted = generateProceduralAmplitudes({ ...flat, tilt: 6 });
  assert.equal(tilted[0], 1);
  assert.equal(tilted[1], 0.5 * 10 ** (6 / 20));
  assert.equal(tilted[3], 0.25 * 10 ** (12 / 20));
  const attenuated = generateProceduralAmplitudes({ ...flat, tilt: -6 });
  assert.equal(attenuated[3], 0.25 * 10 ** (-12 / 20));
  const config = sequence('natural', { mask: 'odd', mapping: 'power', exponent: 2, tilt: 6 });
  const unnormalized = generateProceduralAmplitudes(config);
  const normalized = generateProceduralAmplitudes({ ...config, normalize: true });
  assert.deepEqual(normalized, unnormalized.map((value) => value / Math.max(...unnormalized)));
  assert.equal(Math.max(...normalized), 1);
  assert.deepEqual(generateProceduralAmplitudes(binary('bit', { bit: 5, normalize: true })), Array(8).fill(0));
});

test('procedural spectra use direct amplitudes in half-fundamental bins without waveform or drawbars', () => {
  const config = sequence('natural', { harmonicCount: 4 });
  for (const waveform of ['sine', 'sawtooth', 'triangle', 'square', 'choir-ah', 'choir-oh', 'pink-noise', 'brown-noise']) {
    assert.deepEqual(generatePartialSpectrum(config, waveform), [0, 1, 0, 2, 0, 3, 0, 4]);
    assert.deepEqual(generatePartialSpectrum(binary('parity'), waveform), generatePartialSpectrum(binary('parity')));
    assert.deepEqual(generatePartialSpectrum({ type: 'tonewheel' }, waveform), getTonewheelSpectrum(DEFAULT_TONEWHEEL_DRAWBARS));
  }
  assert.deepEqual(generatePartialSpectrum(config, 'sawtooth', Array(9).fill(0)),
    generatePartialSpectrum(config, 'sawtooth', Array(9).fill(8)));
  const masked = generatePartialSpectrum(binary('parity'), 'sawtooth');
  assert.equal(masked[1], 0);
  assert.equal(masked[7], 0);
});

test('normalization preserves large sequence ratios rather than clipping their tails', () => {
  for (const [mapping, exponent, ratio] of [['linear', 1, 2], ['power', 4, 16]] as const) {
    const amplitudes = generateProceduralAmplitudes(sequence('powers-of-two', {
      harmonicCount: 64, normalize: true, mapping, exponent,
    }));
    assert.equal(amplitudes[63], 1);
    assert.equal(amplitudes[63] / amplitudes[62], ratio);
    assert.equal(amplitudes[62] / amplitudes[61], ratio);
    assert.ok(amplitudes.every((amplitude) => amplitude > 0 && amplitude <= 1));
  }
});

test('unknown configs default to tonewheel and recognized sparse configs get safe defaults', () => {
  for (const invalid of [
    undefined, null, false, 3, 'sequence', [], {}, { type: 'unknown' },
    ...['bogus', null, 1, {}, []].flatMap((invalidMode) => [
      { type: 'sequence', sequence: invalidMode },
      { type: 'binary', mode: invalidMode },
    ]),
  ]) {
    assert.deepEqual(normalizePartialGenerator(invalid), { type: 'tonewheel' });
    assert.deepEqual(generatePartialSpectrum(invalid), getTonewheelSpectrum(DEFAULT_TONEWHEEL_DRAWBARS));
  }
  assert.deepEqual(normalizePartialGenerator({ type: 'sequence' }), {
    type: 'sequence', sequence: 'natural', harmonicCount: 16, normalize: true,
    mapping: 'linear', exponent: 1, mappingModulus: 2, ...maskDefaults, tilt: 0,
  });
  assert.deepEqual(normalizePartialGenerator({ type: 'binary' }), {
    type: 'binary', mode: 'popcount', bit: 0, harmonicCount: 16, normalize: true,
    mapping: 'linear', exponent: 1, mappingModulus: 2, ...maskDefaults, tilt: 0,
  });
  assert.deepEqual(normalizePartialGenerator({
    type: 'binary', bit: Infinity, harmonicCount: NaN, normalize: 'false',
    mapping: {}, exponent: null, mask: [], tilt: -Infinity,
  }), normalizePartialGenerator({ type: 'binary' }));
  assert.deepEqual(normalizePartialGenerator({
    type: 'binary', harmonicCount: -1, exponent: 0, tilt: 100, bit: 100,
  }), {
    type: 'binary', mode: 'popcount', bit: 5, harmonicCount: 1, normalize: true,
    mapping: 'linear', exponent: 0.1, mappingModulus: 2, ...maskDefaults, tilt: 24,
  });
  const clamped = normalizePartialGenerator({ type: 'sequence', harmonicCount: 100, exponent: 100, tilt: -100 });
  assert.equal(clamped.type === 'sequence' && clamped.harmonicCount, 64);
  assert.equal(clamped.type === 'sequence' && clamped.exponent, 4);
  assert.equal(clamped.type === 'sequence' && clamped.tilt, -24);
  assert.deepEqual(normalizePartialGenerator({
    type: 'sequence', mapping: 'modulo', mappingModulus: 100,
    mask: 'periodic', maskPeriod: 5.6, maskOffset: 100, invertMask: true,
  }), {
    type: 'sequence', sequence: 'natural', harmonicCount: 16, normalize: true,
    mapping: 'modulo', exponent: 1, mappingModulus: 64,
    mask: 'periodic', invertMask: true, maskPeriod: 6, maskOffset: 5, tilt: 0,
  });
  const none = normalizePartialGenerator({ type: 'waveform', mask: 'none', invertMask: true });
  assert.equal(none.type === 'waveform' && none.invertMask, false);
});

test('every generator and mapping stays deterministic, nonnegative and bounded at extremes', () => {
  const modes = [
    'natural', 'fibonacci', 'primes', 'powers-of-two', 'thue-morse', 'triangular', 'lucas',
    'divisor-count', 'stern-diatomic', 'euler-totient', 'recaman',
  ].map((name) => sequence(name));
  modes.push(...['popcount', 'parity', 'bit'].map((mode) => binary(mode)));
  for (const mode of modes) {
    for (const mapping of [
      'linear', 'power', 'sqrt', 'inverse', 'logarithmic', 'inverse-sqrt', 'saturating', 'modulo',
    ]) {
      for (const tilt of [-24, 24]) {
        for (const normalize of [false, true]) {
          const config = { ...mode, harmonicCount: 64, exponent: 4, mapping, mappingModulus: 7, tilt, normalize };
          const result = generateProceduralAmplitudes(config);
          assert.equal(result.length, 64);
          assert.deepEqual(result, generateProceduralAmplitudes(config));
          assert.ok(result.every((value) => Number.isFinite(value) && value >= 0
            && value <= (normalize ? 1 : MAX_PROCEDURAL_AMPLITUDE)));
          assert.ok(generatePartialSpectrum(config, 'duct').every(Number.isFinite));
        }
      }
    }
  }
});

// Literal browser arithmetic, deliberately independent of the extracted functions.
function legacyWaveform(waveform: string, harmonic: number): number {
  const gaussian = (h: number, center: number, width: number) => {
    const safeWidth = Math.max(0.001, width);
    return Math.exp(-((h - center) ** 2) / (2 * safeWidth * safeWidth));
  };
  const raw = Math.sin(harmonic * 12.9898 + 78.233) * 43758.5453123;
  const noise = ((raw - Math.floor(raw)) * 2) - 1;
  const noisyTail = noise / Math.sqrt(harmonic);
  if (waveform === 'pink-noise') return noisyTail;
  if (waveform === 'brown-noise') return noise / harmonic;
  if (waveform === 'triangle') {
    if (harmonic % 2 === 0) return 0;
    return (Math.floor(harmonic / 2) % 2 === 0 ? 1 : -1) / (harmonic * harmonic);
  }
  if (waveform === 'sawtooth') return -1 / harmonic;
  if (waveform === 'square') return harmonic % 2 === 0 ? 0 : 1 / harmonic;
  if (waveform === 'flute') return (FLUTE_HARMONICS[harmonic - 1] ?? 0) + (0.02 * noisyTail * gaussian(harmonic, 8, 3));
  if (Object.hasOwn(REED_HARMONICS, waveform)) return REED_HARMONICS[waveform as keyof typeof REED_HARMONICS][harmonic - 1] ?? 0;
  if (Object.hasOwn(PULSE_DUTY, waveform)) return Math.sin(Math.PI * harmonic * PULSE_DUTY[waveform as keyof typeof PULSE_DUTY]) / harmonic;
  if (waveform === 'choir-ah' || waveform === 'choir-oh') return (-1 / harmonic) + (0.035 * noisyTail);
  if (waveform === 'helmholtz') return (harmonic === 1 ? 1.35 : 0)
    + (0.78 * gaussian(harmonic, 4, 1.15)) + (0.22 * noisyTail * gaussian(harmonic, 10, 3.4));
  if (waveform === 'formant') return (0.45 * gaussian(harmonic, 1.5, 0.8))
    + (1.05 * gaussian(harmonic, 4.5, 1.3)) + (0.82 * gaussian(harmonic, 9.5, 2))
    + (0.12 * noisyTail * gaussian(harmonic, 15, 4));
  if (waveform === 'duct') return (0.6 * gaussian(harmonic, 2.2, 0.7))
    + (0.95 * gaussian(harmonic, 6.2, 1.4)) + (0.55 * gaussian(harmonic, 12.4, 2.6)) + (0.18 * noisyTail);
  if (waveform === 'aeolian') return (harmonic === 1 ? 0.55 : 0) + (0.38 * Math.abs(noisyTail))
    + (0.65 * gaussian(harmonic, 7.5, 3.2)) + (0.28 * noisyTail * gaussian(harmonic, 18, 5.5));
  if (waveform === 'stochastic-bandpass') return (0.16 * noisyTail)
    + (1.15 * gaussian(harmonic, 5.5, 1.1)) + (0.95 * gaussian(harmonic, 11.5, 2))
    + (0.4 * Math.sign(noisyTail || 1) * gaussian(harmonic, 18, 3.2));
  return harmonic === 1 ? 1 : 0;
}

test('tonewheel extraction exactly matches literal browser math for all waveforms and drawbars', () => {
  const waveforms = ['sine', 'triangle', 'sawtooth', 'square', 'flute', ...Object.keys(REED_HARMONICS),
    ...Object.keys(PULSE_DUTY), 'choir-ah', 'choir-oh', 'helmholtz', 'formant', 'duct', 'aeolian',
    'stochastic-bandpass', 'pink-noise', 'brown-noise'];
  for (const waveform of waveforms) {
    for (let h = 1; h <= 64; h += 1) {
      assert.equal(getWaveformPartialAmplitude(waveform, h), legacyWaveform(waveform, h));
    }
    for (const drawbars of [
      DEFAULT_TONEWHEEL_DRAWBARS, Array(9).fill(0), Array(9).fill(8),
      [0, 0, 0, 0.25, 0, 0, 0, 0, 0], [0.5, 2, 4, 1, 8, 0, 6.5, 3.3, 7],
    ]) {
      let expected = Array(64).fill(0) as number[];
      if (waveform === 'pink-noise' || waveform === 'brown-noise') {
        expected = [1];
      } else {
        [1, 3, 2, 4, 6, 8, 10, 12, 16].forEach((basePartial, index) => {
          for (let harmonic = 1; basePartial * harmonic <= 64; harmonic += 1) {
            const amplitude = legacyWaveform(waveform, harmonic);
            if (amplitude === 0) continue;
            expected[basePartial * harmonic - 1] += (drawbars[index] / 8) * amplitude;
          }
        });
        const normalizer = Math.max(1, Math.sqrt(expected.reduce((sum, amplitude) => sum + amplitude * amplitude, 0)));
        expected = expected.map((amplitude) => amplitude / normalizer);
      }
      assert.deepEqual(getTonewheelSpectrum(drawbars, waveform), expected);
      assert.deepEqual(generatePartialSpectrum({ type: 'tonewheel' }, waveform, drawbars), getTonewheelSpectrum(drawbars, 'sine'));
    }
  }
});

test('legacy presets normalize and clone to tonewheel without changing format or equality', () => {
  const legacy = clonePresetData(DEFAULT_PRESET_DATA);
  delete legacy.tracks[0].partialGenerator;
  const normalized = normalizePresetData(legacy);
  assert.deepEqual(normalized.tracks[0].partialGenerator, { type: 'tonewheel' });
  assert.deepEqual(clonePresetTrackData(legacy.tracks[0]).partialGenerator, { type: 'tonewheel' });
  assert.equal(arePresetDataEqual(legacy, normalized), true);
  assert.deepEqual(normalizePresetData({ waveform: 'triangle' }).tracks[0].partialGenerator, { type: 'tonewheel' });
  assert.deepEqual(normalizePresetTrackData({ partialGenerator: { type: 'invalid' } }).partialGenerator, { type: 'tonewheel' });
});

test('procedural configs clone independently, round-trip version 2, and participate in equality', () => {
  for (const config of [sequence('fibonacci'), binary('bit', { bit: 2 })]) {
    const source = clonePresetData(DEFAULT_PRESET_DATA);
    source.tracks[0].partialGenerator = normalizePartialGenerator(config);
    const clone = clonePresetData(source);
    const trackClone = clonePresetTrackData(source.tracks[0]);
    assert.deepEqual(clone.tracks[0].partialGenerator, source.tracks[0].partialGenerator);
    assert.notEqual(clone.tracks[0].partialGenerator, source.tracks[0].partialGenerator);
    assert.notEqual(trackClone.partialGenerator, source.tracks[0].partialGenerator);
    assert.equal(arePresetDataEqual(source, clone), true);
    for (const [field, value] of Object.entries({
      harmonicCount: 9, normalize: true, mapping: 'modulo', exponent: 2, mappingModulus: 5,
      mask: 'periodic', maskPeriod: 4, maskOffset: 2, tilt: 6,
      ...(config.type === 'sequence' ? { sequence: 'primes' } : { mode: 'parity', bit: 3 }),
    })) {
      const changed = clonePresetData(source);
      changed.tracks[0].partialGenerator = normalizePartialGenerator({ ...changed.tracks[0].partialGenerator, [field]: value });
      assert.equal(arePresetDataEqual(source, changed), false, field);
    }
    const inverted = clonePresetData(source);
    inverted.tracks[0].partialGenerator = normalizePartialGenerator({
      ...inverted.tracks[0].partialGenerator, mask: 'prime', invertMask: true,
    });
    assert.equal(arePresetDataEqual(source, inverted), false, 'invertMask');
    const exported = buildSinglePresetExport(createNamedPreset('Procedural', source));
    assert.equal(exported.version, 2);
    const imported = parsePresetImportPayload(JSON.stringify(exported));
    assert.equal(imported.kind, 'single-preset');
    if (imported.kind === 'single-preset') assert.equal(arePresetDataEqual(imported.preset.data, source), true);
    if (clone.tracks[0].partialGenerator?.type === 'sequence' || clone.tracks[0].partialGenerator?.type === 'binary') {
      clone.tracks[0].partialGenerator.tilt = 12;
    }
    assert.equal(arePresetDataEqual(source, clone), false);
  }
});

test('waveform source preserves signed Fourier coefficients for 64 musical harmonics', () => {
  assert.deepEqual(normalizePartialGenerator({ type: 'waveform', waveform: 'triangle' }), waveformDefaults);
  for (const waveform of ['sine', 'triangle', 'sawtooth', 'square', 'flute', ...Object.keys(REED_HARMONICS),
    ...Object.keys(PULSE_DUTY), 'choir-ah', 'choir-oh', 'helmholtz', 'formant', 'duct', 'aeolian', 'stochastic-bandpass',
    'pink-noise', 'brown-noise']) {
    const spectrum = generatePartialSpectrum({ type: 'waveform' }, waveform);
    assert.equal(spectrum.length, 128);
    for (let harmonic = 1; harmonic <= 64; harmonic += 1) {
      assert.equal(spectrum[2 * harmonic - 2], 0);
      const pulseNull = isPulseWaveform(waveform) && Number.isInteger(harmonic * PULSE_DUTY[waveform]);
      assert.equal(spectrum[2 * harmonic - 1], pulseNull ? 0 : legacyWaveform(waveform, harmonic));
    }
    assert.deepEqual(spectrum, generatePartialSpectrum({ type: 'waveform' }, waveform, Array(9).fill(0)));
  }
});

test('waveform selections round trip, and only unspecified or unknown legacy noise sources migrate', () => {
  for (const waveform of ['triangle', 'choir-ah', 'pink-noise', 'brown-noise']) {
    const data = normalizePresetData({ tracks: [{ waveform, partialGenerator: { type: 'waveform' } }] });
    const imported = parsePresetImportPayload(JSON.stringify(buildSinglePresetExport(createNamedPreset('Waveform', data))));
    assert.equal(imported.kind, 'single-preset');
    if (imported.kind === 'single-preset') {
      assert.equal(arePresetDataEqual(data, imported.preset.data), true);
      assert.equal(imported.preset.data.tracks[0].waveform, waveform);
      assert.deepEqual(imported.preset.data.tracks[0].partialGenerator, waveformDefaults);
    }
  }
  for (const waveform of ['pink-noise', 'brown-noise']) {
    for (const partialGenerator of [undefined, null, { type: 'unknown' }]) {
      const track = normalizePresetTrackData({ waveform, partialGenerator });
      assert.deepEqual(track.partialGenerator, waveformDefaults);
      assert.deepEqual(clonePresetTrackData(track).partialGenerator, waveformDefaults);
    }
    for (const type of ['tonewheel', 'sequence', 'binary']) {
      assert.equal(normalizePresetTrackData({ waveform, partialGenerator: { type } }).partialGenerator?.type, type);
    }
    assert.deepEqual(normalizePresetData({ waveform }).tracks[0].partialGenerator, waveformDefaults);
  }
});

test('waveform settings have neutral defaults and clamp malformed input', () => {
  assert.deepEqual(normalizePartialGenerator({
    type: 'waveform', harmonicCount: NaN, tilt: Infinity, contrast: null,
    oddEvenBalance: '12', mask: 'invalid', normalize: 'true',
  }), waveformDefaults);
  assert.deepEqual(normalizePartialGenerator({
    type: 'waveform', harmonicCount: 100, tilt: 100, contrast: 100, oddEvenBalance: -100,
  }), { ...waveformDefaults, tilt: 24, contrast: 4, oddEvenBalance: -24 });
  assert.deepEqual(normalizePartialGenerator({
    type: 'waveform', harmonicCount: -1, tilt: -100, contrast: -1, oddEvenBalance: 100,
  }), { ...waveformDefaults, harmonicCount: 1, tilt: -24, contrast: 0.25, oddEvenBalance: 24 });
  assert.equal(normalizePartialGenerator({ type: 'waveform', harmonicCount: 3.7 }).type, 'waveform');
  assert.equal(generatePartialSpectrum({ type: 'waveform', harmonicCount: 3.7 }).length, 8);
});

test('waveform tilt uses musical octaves and contrast preserves coefficient signs and zeros', () => {
  for (const tilt of [-6, 6]) {
    const spectrum = generatePartialSpectrum({ type: 'waveform', tilt, harmonicCount: 4 }, 'sawtooth');
    assert.equal(spectrum[1], -1);
    assert.equal(spectrum[3], -0.5 * 10 ** (tilt / 20));
    assert.equal(spectrum[7], -0.25 * 10 ** (2 * tilt / 20));
  }
  for (const contrast of [0.25, 0.5, 2, 4]) {
    const spectrum = generatePartialSpectrum({ type: 'waveform', contrast, harmonicCount: 4 }, 'triangle');
    assert.deepEqual(spectrum, [0, 1, 0, 0, 0, -((1 / 9) ** contrast), 0, 0]);
  }
});

test('waveform balance attenuates the opposite parity and masks select musical harmonics', () => {
  const even = generatePartialSpectrum({ type: 'waveform', oddEvenBalance: 12 }, 'sawtooth');
  assert.equal(even[1], -(10 ** (-12 / 20)));
  assert.equal(even[3], -0.5);
  const odd = generatePartialSpectrum({ type: 'waveform', oddEvenBalance: -12 }, 'sawtooth');
  assert.equal(odd[1], -1);
  assert.equal(odd[3], -0.5 * 10 ** (-12 / 20));
  for (const [mask, selected] of Object.entries({
    none: [1, 2, 3, 4, 5, 6, 7, 8], odd: [1, 3, 5, 7], even: [2, 4, 6, 8],
    prime: [2, 3, 5, 7], fibonacci: [1, 2, 3, 5, 8], 'power-of-two': [1, 2, 4, 8],
    square: [1, 4], triangular: [1, 3, 6], 'thue-morse': [2, 3, 5, 8],
  })) {
    const spectrum = generatePartialSpectrum({ type: 'waveform', harmonicCount: 8, mask }, 'sawtooth');
    assert.deepEqual(spectrum.flatMap((amplitude, bin) => amplitude ? [(bin + 1) / 2] : []), selected);
  }
  const periodic = generatePartialSpectrum({
    type: 'waveform', harmonicCount: 8, mask: 'periodic', maskPeriod: 3, maskOffset: 1, invertMask: true,
  }, 'sawtooth');
  assert.deepEqual(periodic.flatMap((amplitude, bin) => amplitude ? [(bin + 1) / 2] : []), [1, 3, 4, 6, 7]);
});

test('waveform transforms compose before absolute peak normalization and stay finite at extremes', () => {
  const config = { type: 'waveform', harmonicCount: 8, mask: 'even', contrast: 2, tilt: 6, oddEvenBalance: -12 };
  const before = { ...config };
  const raw = generatePartialSpectrum(config, 'sawtooth');
  assert.equal(raw[3], -(0.5 ** 2) * 10 ** ((6 - 12) / 20));
  assert.equal(raw[7], -(0.25 ** 2));
  const peak = Math.max(...raw.map(Math.abs));
  const normalized = generatePartialSpectrum({ ...config, normalize: true }, 'sawtooth');
  assert.deepEqual(normalized, raw.map(amplitude => amplitude / peak));
  assert.equal(Math.max(...normalized.map(Math.abs)), 1);
  assert.deepEqual(config, before);
  assert.deepEqual(generatePartialSpectrum({ ...config, normalize: true }, 'sine'), Array(16).fill(0));
  for (const tilt of [-24, 24]) {
    for (const contrast of [0.25, 4]) {
      for (const oddEvenBalance of [-24, 24]) {
        for (const normalize of [false, true]) {
          const extreme = { type: 'waveform', tilt, contrast, oddEvenBalance, normalize };
          for (const waveform of [
            'triangle', 'sawtooth', 'helmholtz', 'stochastic-bandpass', 'pink-noise', 'brown-noise',
          ]) {
            const spectrum = generatePartialSpectrum(extreme, waveform);
            assert.ok(spectrum.every(Number.isFinite));
            assert.deepEqual(spectrum, generatePartialSpectrum(extreme, waveform));
            if (normalize) assert.equal(Math.max(...spectrum.map(Math.abs)), 1);
          }
        }
      }
    }
  }
});

test('waveform transforms clone independently, round trip, and each field affects preset equality', () => {
  const legacy = clonePresetData(DEFAULT_PRESET_DATA);
  legacy.tracks[0].partialGenerator = { type: 'waveform' };
  assert.equal(arePresetDataEqual(legacy, normalizePresetData(legacy)), true);
  const fields = { harmonicCount: 12, tilt: -6, contrast: 0.5, oddEvenBalance: 9, mask: 'prime', normalize: true };
  const data = normalizePresetData({ tracks: [{ waveform: 'triangle', partialGenerator: { type: 'waveform', ...fields } }] });
  const clone = clonePresetData(data);
  assert.notEqual(clone.tracks[0].partialGenerator, data.tracks[0].partialGenerator);
  assert.notEqual(clonePresetTrackData(data.tracks[0]).partialGenerator, data.tracks[0].partialGenerator);
  const imported = parsePresetImportPayload(JSON.stringify(buildSinglePresetExport(createNamedPreset('Transformed', data))));
  assert.equal(imported.kind, 'single-preset');
  if (imported.kind === 'single-preset') assert.equal(arePresetDataEqual(imported.preset.data, data), true);
  for (const [field, value] of Object.entries(fields)) {
    const changed = clonePresetData(legacy);
    changed.tracks[0].partialGenerator = normalizePartialGenerator({ type: 'waveform', [field]: value });
    assert.equal(arePresetDataEqual(legacy, changed), false, field);
  }
  if (clone.tracks[0].partialGenerator?.type === 'waveform') clone.tracks[0].partialGenerator.tilt = 12;
  assert.equal(arePresetDataEqual(data, clone), false);
});

test('waveform transforms never amplify floating-point residue at analytical pulse nulls', () => {
  for (const waveform of ['pulse-25', 'pulse-12'] as const) {
    for (const settings of [
      {}, { contrast: 0.25, tilt: 24, normalize: true, mask: 'power-of-two' },
    ]) {
      const spectrum = generatePartialSpectrum({ type: 'waveform', ...settings }, waveform);
      for (let harmonic = 1; harmonic <= 64; harmonic += 1) {
        if (Number.isInteger(harmonic * PULSE_DUTY[waveform])) {
          assert.equal(spectrum[2 * harmonic - 1], 0, `${waveform} harmonic ${harmonic}`);
        }
      }
    }
    const spectrum = generatePartialSpectrum({
      type: 'waveform', contrast: 0.25, tilt: 24, normalize: true, mask: 'power-of-two',
    }, waveform);
    const highestNonzero = (1 / PULSE_DUTY[waveform]) / 2;
    assert.equal(spectrum[2 * highestNonzero - 1], 1);
  }
});
