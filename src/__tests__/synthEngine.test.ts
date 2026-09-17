import assert from 'node:assert/strict';
import { test } from 'node:test';
import { choirBands, normalizeSynthEngine, normalizeNoiseEngine, normalizeChoirEngine } from '../audio/synthEngine.js';
import { clonePresetTrackData, normalizePresetTrackData } from '../presets.js';
import { createNativeEngineSource } from '../../cli/nativeEngineSource.js';
import { generateWav } from '../../cli/generate.js';

test('legacy active sources migrate; inactive waveform metadata and explicit modes survive', () => {
  for (const waveform of ['flute', 'oboe', 'clarinet', 'saxophone', 'pink-noise', 'brown-noise', 'duct']) {
    assert.equal(normalizeSynthEngine({ waveform, partialGenerator: { type: 'waveform' } }).synthMode, 'resonant-noise');
    assert.equal(normalizeSynthEngine({ waveform, partialGenerator: { type: 'tonewheel' } }).synthMode, 'additive');
    assert.equal(normalizeSynthEngine({ waveform, synthMode: 'additive' }).synthMode, 'additive');
  }
  assert.equal(normalizeSynthEngine({ waveform: 'choir-oh' }).choirEngine.vowel, 'o');
  assert.equal(normalizeSynthEngine({ waveform: 'choir-ah' }).synthMode, 'choir');
  assert.equal(normalizeSynthEngine({ waveform: 'brown-noise' }).noiseEngine.color, 'brown');
});

test('engine settings are bounded, cloned and persist through preset JSON', () => {
  const engine = normalizeSynthEngine({ synthMode: 'choir', noiseEngine: { resonance: Infinity, bands: 900 },
    choirEngine: { vowel: 'invalid', voices: 100, breath: NaN, formantOffsets: [99, -99], formantGains: [Infinity] } });
  assert.equal(engine.noiseEngine.bands, 8);
  assert.equal(engine.choirEngine.voices, 8);
  assert.deepEqual(engine.choirEngine.formantOffsets, [12, -12, 0, 0, 0]);
  const original = normalizePresetTrackData({ ...engine, id: 'engine', waveform: 'sine' }, 0);
  const clone = clonePresetTrackData(original);
  clone.choirEngine!.formantOffsets[0] = 3;
  assert.equal(original.choirEngine!.formantOffsets[0], 12);
  assert.deepEqual(normalizeSynthEngine(JSON.parse(JSON.stringify(original))), engine);
  assert.deepEqual(normalizeSynthEngine(engine), engine);
});

test('formants morph geometrically and shift independently by an octave', () => {
  const from = choirBands(normalizeChoirEngine({ vowel: 'a', targetVowel: 'i', morph: 0 }));
  const to = choirBands(normalizeChoirEngine({ vowel: 'a', targetVowel: 'i', morph: 1 }));
  const middle = choirBands(normalizeChoirEngine({ vowel: 'a', targetVowel: 'i', morph: 0.5 }));
  const shifted = choirBands(normalizeChoirEngine({ formantShift: 12 }));
  from.forEach((band, i) => {
    assert.ok(Math.abs(middle[i].frequency - Math.sqrt(band.frequency * to[i].frequency)) < 1e-9);
    assert.equal(shifted[i].frequency, band.frequency * 2);
  });
});

function render(synthMode: 'choir' | 'resonant-noise', settings: Record<string, unknown> = {}, hz = 220) {
  const engine = normalizeSynthEngine({ synthMode, [synthMode === 'choir' ? 'choirEngine' : 'noiseEngine']: settings });
  const source = createNativeEngineSource(engine, 48000, 1234);
  return Float32Array.from({ length: 24000 }, (_, frame) => source(hz, frame / 48000, 0.4));
}
const energy = (samples: Float32Array) => samples.reduce((sum, v) => sum + v * v, 0) / samples.length;
function binEnergy(samples: Float32Array, hz: number) {
  let real = 0, imag = 0;
  samples.forEach((sample, i) => { const w = 2 * Math.PI * hz * i / 48000; real += sample * Math.cos(w); imag += sample * Math.sin(w); });
  return real * real + imag * imag;
}

test('native engines produce finite audible deterministic output, with meaningful parameter changes', () => {
  for (const mode of ['choir', 'resonant-noise'] as const) {
    const samples = render(mode);
    assert.ok(samples.every(Number.isFinite));
    assert.ok(energy(samples) > 1e-5);
    assert.deepEqual(samples, render(mode));
  }
  assert.notDeepEqual(render('choir', { vowel: 'a' }), render('choir', { vowel: 'i' }));
  assert.notDeepEqual(render('choir', { breath: 0 }), render('choir', { breath: 1 }));
  assert.notDeepEqual(render('resonant-noise', { resonance: 2 }), render('resonant-noise', { resonance: 60 }));
  assert.notDeepEqual(render('resonant-noise', { lfoDepth: 0 }), render('resonant-noise', { lfoDepth: 12 }));
});

test('resonator key tracking moves the dominant pitch, and frozen noise is not used', () => {
  const settings = { color: 'white', bands: 1, resonance: 80, dry: 0, keyTrack: 1 };
  const low = render('resonant-noise', settings, 220), high = render('resonant-noise', settings, 440);
  assert.ok(binEnergy(low, 220) > binEnergy(low, 440) * 10);
  assert.ok(binEnergy(high, 440) > binEnergy(high, 220) * 10);
  assert.deepEqual(render('resonant-noise', { ...settings, keyTrack: 0 }, 220), render('resonant-noise', { ...settings, keyTrack: 0 }, 440));
  assert.notDeepEqual(low.slice(1000, 2000), low.slice(2000, 3000));
});

test('extreme normalized engine settings remain finite at low and high pitches', () => {
  for (const hz of [20, 4000, 15000]) {
    assert.ok(render('choir', { voices: 8, bandwidth: 0.3, formantShift: 24, formantGains: [12, 12, 12, 12, 12], vibratoDepth: 100 }, hz).every(Number.isFinite));
    assert.ok(render('resonant-noise', { bands: 8, resonance: 80, spacing: 3, envelopeAmount: 48, lfoDepth: 24 }, hz).every(Number.isFinite));
  }
});

test('WAV pipeline accepts both engines and migrates old sources consistently', async () => {
  const base = { bpm: 120, reverb: { enabled: false }, tracks: [{ sequence: '1 3', gain: -12, release: 0.02 }] };
  const choir = await generateWav({ ...base, tracks: [{ ...base.tracks[0], synthMode: 'choir' }] });
  const noise = await generateWav({ ...base, tracks: [{ ...base.tracks[0], synthMode: 'resonant-noise' }] });
  assert.notDeepEqual(choir, noise);
  const legacy = await generateWav({ ...base, tracks: [{ ...base.tracks[0], waveform: 'oboe', partialGenerator: { type: 'waveform' } }] });
  const explicit = await generateWav({ ...base, tracks: [{ ...base.tracks[0], ...normalizeSynthEngine({ waveform: 'oboe' }) }] });
  assert.deepEqual(legacy, explicit);
  assert.equal(normalizeNoiseEngine({ color: 'invalid' }).color, 'pink');
});
