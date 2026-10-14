import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEngineCombination, normalizeSynthEngine, resolveGeneratorEngine, engineCombinationGain } from '../audio/synthEngine.js';
import { normalizePresetData, clonePresetData, arePresetDataEqual, buildDraftFromUrl } from '../presets.js';
import { presetDataToGeneratorInput } from '../../cli/cli.js';
import { renderWavChannels, generateMidi } from '../audio/nativeRenderer.js';
import { createSampleAsset } from '../audio/sampleAssets.js';
import { validateProject } from '../domain/projectValidation.js';

const energy = (data: Float32Array) => data.reduce((sum, v) => sum + v * v, 0) / data.length;
const project = (combination?: unknown) => normalizePresetData({ bpm: 240, forte: '7-35.11',
  tracks: [{ synthMode: 'fm', generatorEngines: { fm: { index: 0 } }, sequenceInput: '1 3', release: 0.03,
    engineCombination: combination }], reverb: { enabled: false } });

test('AM and RM have distinct bounded transfer functions and exact bypass', () => {
  assert.deepEqual([-1, 0, 1].map(b => engineCombinationGain(b, 'am', 1)), [0, 0.5, 1]);
  assert.deepEqual([-1, 0, 1].map(b => engineCombinationGain(b, 'rm', 1)), [-1, 0, 1]);
  assert.equal(engineCombinationGain(-1, 'rm', 0.25), 0.5);
  assert.equal(engineCombinationGain(99, 'am', 1), 1);
  assert.equal(engineCombinationGain(-99, 'rm', 1), -1);
  assert.equal(engineCombinationGain(-1, 'rm', 0), 1);
  assert.equal(normalizeSynthEngine({}).engineCombination, undefined);
  const normalized = normalizeEngineCombination({ mode: 'bad', depth: Infinity, frequencyRatio: -1,
    engineB: { unisonVoices: 100, choirEngine: { morph: Infinity } } });
  assert.equal(normalized.mode, 'off'); assert.equal(normalized.depth, 1); assert.equal(normalized.frequencyRatio, 0.125);
  assert.equal(normalized.engineB.unisonVoices, 8);
  assert.equal(normalized.engineB.engineCombination, undefined);
  const routed = normalizeEngineCombination({ engineB: { modulation: { sources: [{ id: 'env', type: 'envelope' }],
    routes: ['pitch', 'level', 'cutoff', 'pan'].map(target => ({ id: target, source: 'env', target, amount: 1 })) } } });
  assert.deepEqual(routed.engineB.modulation.routes.map(route => route.target), ['pitch', 'level']);
});

test('both engines survive preset cloning, JSON, URL sharing and CLI conversion independently', () => {
  const original = project({ mode: 'rm', frequencyRatio: 1.5, engineB: { synthMode: 'pulse', generatorEngines: { pulse: { width: 0.13 } },
    partialGenerator: { type: 'sequence', sequence: 'primes' }, unisonVoices: 3 } });
  const clone = clonePresetData(original);
  assert.deepEqual(clone, original); clone.tracks[0].engineCombination!.engineB.generatorEngines.pulse.width = 0.3;
  assert.equal(original.tracks[0].engineCombination!.engineB.generatorEngines.pulse.width, 0.13);
  assert.equal(original.tracks[0].generatorEngines!.fm.index, 0); assert.equal(arePresetDataEqual(original, clone), false);
  assert.deepEqual(normalizePresetData(JSON.parse(JSON.stringify(original))), original);
  assert.deepEqual(buildDraftFromUrl(new URLSearchParams({ project: JSON.stringify(original) }).toString(), project()), original);
  assert.deepEqual(presetDataToGeneratorInput(original).tracks[0].engineCombination, original.tracks[0].engineCombination);
});

test('native rendering preserves old PCM and MIDI with an inactive second engine', async () => {
  const original = presetDataToGeneratorInput(project());
  const baseline = await renderWavChannels(original);
  for (const combination of [{ mode: 'off', engineB: { synthMode: 'granular' } }, { mode: 'rm', depth: 0, engineB: { synthMode: 'granular' } }]) {
    const input = presetDataToGeneratorInput(project(combination));
    assert.deepEqual((await renderWavChannels(input)).left, baseline.left);
    assert.deepEqual(await generateMidi(input), await generateMidi(original));
  }
  const am = await renderWavChannels(presetDataToGeneratorInput(project({ mode: 'am', frequencyRatio: 1.5 })));
  const rm = await renderWavChannels(presetDataToGeneratorInput(project({ mode: 'rm', frequencyRatio: 1.5 })));
  assert.notDeepEqual(am.left, baseline.left); assert.notDeepEqual(rm.left, am.left);
});

test('all Engine B modes render audible finite audio, including unison, mono glide and granular assets', async () => {
  const asset = await createSampleAsset([Float32Array.from({ length: 4800 }, (_, i) => Math.sin(2 * Math.PI * 220 * i / 48000))], 48000, 'Sine');
  for (const synthMode of ['additive', 'partial-bank', 'resonant-noise', 'choir', 'modal', 'pulse', 'fm', 'pluck', 'granular']) {
    const data = project({ mode: 'rm', depth: 0.75, frequencyRatio: 1.5,
      engineB: { synthMode, unisonVoices: 2, unisonDetune: 8, generatorEngines: { granular: { asset: asset.hash } } } });
    data.studio = { version: 1, seed: 0, returns: [], assets: [asset] };
    data.tracks[0].polyphony = 1; data.tracks[0].glideTime = 0.03; data.tracks[0].monoLegato = true;
    assert.ok(validateProject(data).valid, synthMode);
    const input = presetDataToGeneratorInput(data), rendered = await renderWavChannels(input);
    assert.ok(rendered.left.every(Number.isFinite), synthMode); assert.ok(energy(rendered.left) > 1e-8, synthMode);
    assert.deepEqual((await renderWavChannels(input)).left, rendered.left, synthMode);
  }
  const missing = project({ mode: 'rm', engineB: { synthMode: 'granular' } });
  assert.ok(!validateProject(missing).valid);
  assert.throws(() => resolveGeneratorEngine(missing.tracks[0]), /sample/);
  await assert.rejects(renderWavChannels(presetDataToGeneratorInput(missing)), /sample/);
  const corrupted = project({ mode: 'rm', engineB: { synthMode: 'granular', generatorEngines: { granular: { asset: asset.hash } } } });
  corrupted.studio = { version: 1, seed: 0, returns: [], assets: [{ ...asset, channels: [[0, 1]] }] };
  await assert.rejects(renderWavChannels(presetDataToGeneratorInput(corrupted)), /hash mismatch/);
});
