import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GeneratorDSP, type GeneratorSample } from '../audio/generatorDSP.js';
import { GENERATOR_MODES, normalizeGeneratorEngines, type GeneratorMode } from '../audio/generatorSettings.js';
import { normalizeSynthEngine, resolveGeneratorEngine, resolveSynthMode } from '../audio/synthEngine.js';
import { normalizePresetData, clonePresetData, arePresetDataEqual, buildDraftFromUrl, normalizePresetTrackData } from '../presets.js';
import { presetDataToGeneratorInput } from '../../cli/cli.js';
import { compileModulation, emptyModulationValues, normalizeModulation } from '../audio/modulation.js';
import { createSampleAsset } from '../audio/sampleAssets.js';
import { validateProject } from '../domain/projectValidation.js';
import { renderWavChannels, generateMidi } from '../audio/nativeRenderer.js';

const sampleRate = 48000;
const sample: GeneratorSample = { hash: 'test', sampleRate,
  channels: [Float32Array.from({ length: sampleRate }, (_, i) => Math.sin(2 * Math.PI * 261.625565 * i / sampleRate))] };
const energy = (values: ArrayLike<number>, start = 0, end = values.length) => {
  let sum = 0; for (let i = start; i < end; i++) sum += values[i] ** 2; return sum / Math.max(1, end - start);
};
function render(mode: GeneratorMode, changes: Record<string, unknown> = {}, hz = 220, frames = 24000) {
  const settings = normalizeGeneratorEngines({ [mode]: changes });
  const source = new GeneratorDSP(mode, settings, sampleRate, mode === 'granular' ? sample : undefined);
  source.attack(hz);
  return Float32Array.from({ length: frames }, (_, frame) => source.sample(hz, frame / sampleRate, 0.4));
}
function spectralEnergy(samples: Float32Array, hz: number, start = 0) {
  let real = 0, imaginary = 0;
  for (let i = start; i < samples.length; i++) { const phase = 2 * Math.PI * hz * i / sampleRate;
    real += samples[i] * Math.cos(phase); imaginary += samples[i] * Math.sin(phase); }
  return real * real + imaginary * imaginary;
}

test('all new generators resolve explicitly, normalize safely and preserve inactive settings', () => {
  for (const synthMode of GENERATOR_MODES) assert.equal(resolveSynthMode({ synthMode, waveform: 'choir-ah' }), synthMode);
  const settings = normalizeGeneratorEngines({ modal: { material: 'invalid', modes: 100 }, fm: { index: Infinity },
    pulse: { width: -20 }, pluck: { seed: NaN }, granular: { density: 999, size: 0 } });
  assert.equal(settings.modal.material, 'bell'); assert.equal(settings.modal.modes, 16);
  assert.equal(settings.fm.index, 2); assert.equal(settings.pulse.width, 0.02);
  assert.equal(settings.pluck.seed, 1); assert.equal(settings.granular.density, 100); assert.equal(settings.granular.size, 0.005);
  for (const synthMode of GENERATOR_MODES) {
    const track = normalizePresetTrackData({ synthMode, generatorEngines: settings });
    assert.deepEqual(normalizeSynthEngine(JSON.parse(JSON.stringify(track))).generatorEngines, settings);
  }
});

test('generator settings survive cloning, JSON, share URLs and CLI conversion, and affect equality', () => {
  const project = normalizePresetData({ tracks: [{ synthMode: 'fm', generatorEngines: { fm: { ratio: 2.37 } } }] });
  const copy = clonePresetData(project);
  assert.ok(arePresetDataEqual(project, copy)); copy.tracks[0].generatorEngines!.fm.ratio = 3;
  assert.equal(project.tracks[0].generatorEngines!.fm.ratio, 2.37); assert.ok(!arePresetDataEqual(project, copy));
  assert.deepEqual(normalizePresetData(JSON.parse(JSON.stringify(project))), project);
  assert.equal(presetDataToGeneratorInput(project).tracks[0].generatorEngines!.fm.ratio, 2.37);
  const shared = buildDraftFromUrl(new URLSearchParams({ project: JSON.stringify(project) }).toString(), normalizePresetData({}));
  assert.deepEqual(shared.tracks[0].generatorEngines, project.tracks[0].generatorEngines);
});

test('new DSP produces finite audible reproducible output and meaningful control changes', () => {
  const changes = { modal: { material: 'glass' }, pulse: { width: 0.2 }, fm: { index: 0 },
    pluck: { position: 0.6, seed: 7 }, granular: { position: 0.8, pitchScatter: 12 } };
  for (const mode of GENERATOR_MODES) {
    const original = render(mode), changed = render(mode, changes[mode]);
    assert.ok(original.every(Number.isFinite), `${mode}: finite`);
    assert.ok(energy(original) > 1e-6, `${mode}: audible`);
    assert.deepEqual(original, render(mode), `${mode}: reproducible`);
    assert.notDeepEqual(original, changed, `${mode}: controls change sound`);
  }
});

test('modal voices have independent decays and suppress modes above Nyquist', () => {
  const samples = render('modal', { material: 'harmonic', modes: 2, decay: 1, damping: 2, brightness: 0, strike: 0 }, 200, sampleRate);
  const early = samples.subarray(0, 4800), late = samples.subarray(9600, 14400);
  const earlyRatio = spectralEnergy(early, 400) / spectralEnergy(early, 200);
  const lateRatio = spectralEnergy(late, 400) / spectralEnergy(late, 200);
  assert.ok(lateRatio < earlyRatio * 0.01);
  const fundamental = render('modal', { material: 'harmonic', modes: 1, brightness: -24, damping: 0, strike: 0 }, 16000, 4096);
  assert.ok(energy(fundamental) > 1e-4);
  assert.equal(energy(render('modal', { strike: 0 }, 25000, 4096)), 0);
});

test('pulse and FM generators obey spectral limits and index zero removes FM sidebands', () => {
  assert.equal(energy(render('pulse', {}, 25000, 2048)), 0);
  assert.equal(energy(render('fm', {}, 25000, 2048)), 0);
  const plain = render('fm', { index: 0, ratio: 2, attack: 0, sustain: 1 }, 440);
  const rich = render('fm', { index: 2, ratio: 2, attack: 0, sustain: 1 }, 440);
  assert.ok(spectralEnergy(rich, 1320, 1000) > spectralEnergy(plain, 1320, 1000) * 100);
});

test('fractional-delay plucked strings stay tuned and decay across multiple pitches', () => {
  for (const hz of [110, 220, 440]) {
    const samples = render('pluck', { decay: 4, brightness: 0.8 }, hz, sampleRate);
    let bestHz = 0, bestEnergy = 0;
    for (let offset = -2; offset <= 2; offset += 0.25) {
      const candidate = hz + offset, power = spectralEnergy(samples, candidate, 2000);
      if (power > bestEnergy) { bestEnergy = power; bestHz = candidate; }
    }
    assert.ok(Math.abs(bestHz - hz) <= 0.5, `${hz} Hz tuned to ${bestHz}`);
    assert.ok(energy(samples, 40000) < energy(samples, 2000, 10000));
  }
});

test('grain pool remains bounded, honors pitch and stops launching grains on release', () => {
  const settings = normalizeGeneratorEngines({ granular: { density: 100, size: 0.5, scatter: 0, pitchScatter: 0 } });
  const dsp = new GeneratorDSP('granular', settings, sampleRate, sample); dsp.attack(261.625565);
  const samples = Float32Array.from({ length: sampleRate * 2 }, (_, frame) => dsp.sample(261.625565, frame / sampleRate, 0.6));
  assert.ok(samples.every(Number.isFinite)); assert.ok(Math.max(...samples.subarray(0, 10000)) <= 0.81);
  assert.equal(energy(samples, sampleRate * 1.2), 0);
  const pitched = render('granular', { scatter: 0, density: 20, size: 0.1 }, 523.25113);
  assert.ok(spectralEnergy(pitched, 523.25113) > spectralEnergy(pitched, 261.625565) * 10);
});

test('generator modulation targets survive normalization and actually change the source', () => {
  const matrix = compileModulation(normalizeModulation({ sources: [{ id: 'env', type: 'envelope', attack: 0, decay: 0, sustain: 1 }],
    routes: [{ id: 'width', source: 'env', target: 'pulseWidth', amount: -0.3 }] }));
  const values = matrix.sample({ time: 0.1, noteStart: 0, bpm: 90 }, emptyModulationValues());
  assert.equal(values.pulseWidth, -0.3);
  const a = new GeneratorDSP('pulse', normalizeGeneratorEngines({}), sampleRate), b = new GeneratorDSP('pulse', normalizeGeneratorEngines({}), sampleRate);
  a.attack(220); b.attack(220);
  const plain = Float32Array.from({ length: 2048 }, (_, frame) => a.sample(220, frame / sampleRate, 1));
  const modulated = Float32Array.from({ length: 2048 }, (_, frame) => b.sample(220, frame / sampleRate, 1, values));
  assert.notDeepEqual(plain, modulated);
});

test('native WAV pipeline renders every generator; assets validate and MIDI stays unchanged', async () => {
  const asset = await createSampleAsset(sample.channels, sampleRate, 'Sine');
  for (const synthMode of GENERATOR_MODES) {
    const project = normalizePresetData({ forte: '7-35.11', bpm: 240, tracks: [{ synthMode, sequenceInput: '1 3',
      lengthFactor: 50, release: 0.05, generatorEngines: { granular: { asset: asset.hash } } }],
      studio: { version: 1, seed: 0, returns: [], assets: [asset] } });
    assert.ok(validateProject(project).valid, synthMode);
    const input = presetDataToGeneratorInput(project);
    const rendered = await renderWavChannels(input);
    assert.ok(rendered.left.every(Number.isFinite)); assert.ok(energy(rendered.left) > 1e-7, `${synthMode}: rendered audio`);
    const other = { ...input, tracks: input.tracks.map(t => ({ ...t, synthMode: 'additive' as const })) };
    assert.deepEqual(await generateMidi(input), await generateMidi(other));
  }
  const missing = normalizePresetData({ tracks: [{ synthMode: 'granular' }] });
  assert.ok(!validateProject(missing).valid);
  assert.throws(() => resolveGeneratorEngine(missing.tracks[0]), /Choose an imported sample/);
  const corrupted = normalizePresetData({ tracks: [{ synthMode: 'granular', generatorEngines: { granular: { asset: asset.hash } } }],
    studio: { version: 1, seed: 0, returns: [], assets: [{ ...asset, channels: [Array.from({ length: 10 }, () => 0)] }] } });
  await assert.rejects(renderWavChannels(presetDataToGeneratorInput(corrupted)), /hash mismatch/);
});
