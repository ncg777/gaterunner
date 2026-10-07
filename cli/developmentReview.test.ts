import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { normalizePresetData, clonePresetData } from '../src/presets.js';
import { normalizeDevelopment } from '../src/domain/development.js';
import { resolveProjectEvents } from '../src/domain/developmentSchedule.js';
import { renderDevelopment } from '../src/audio/developmentRender.js';
import { createScheduledRenderSession } from '../src/audio/nativeRenderer.js';
import { MemoryRenderCache } from '../src/audio/renderCache.js';
import { importWavAsset } from '../src/audio/sampleAssets.js';
import { exportStems } from './projectApi.js';

const project = () => normalizePresetData({ bpm: 300, reverb: { enabled: false }, tracks: [
  { id: 'lead', sequenceInput: '1 1', denominator: 4, lengthFactor: 100, gain: -18, release: 0.01,
    development: normalizeDevelopment({ enabled: true }) },
] });

test('later accents retain an inherited tie unless explicitly cleared', async () => {
  const input = project(), d = input.tracks[0].development!;
  d.steps = [{ step: 0, tie: true }, { step: 0, velocity: 0.8 }];
  const events = (await resolveProjectEvents(input)).tracks[0].events;
  assert.equal(events.length, 1);
  assert.equal(events[0].duration, 0.1);
  d.steps[1].tie = false;
  assert.equal((await resolveProjectEvents(input)).tracks[0].events.length, 2);
});

test('drum velocity variation stays relative to each decoded lane velocity', async () => {
  const input = normalizePresetData({ bpm: 300, tracks: [{ id: 'drums', trackKind: 'rhythmic',
    sequenceInput: '63', drumVelocityBits: 2, development: normalizeDevelopment({ enabled: true }) }] });
  const original = (await resolveProjectEvents(input)).tracks[0].events;
  input.tracks[0].development!.steps = [{ step: 0, lane: 0, velocityVariation: 0.01 }];
  const varied = (await resolveProjectEvents(input)).tracks[0].events;
  assert.ok(original.length > 1);
  for (let i = 0; i < original.length; i++) {
    assert.ok(Math.abs(varied[i].noteVelocities![0] - original[i].noteVelocities![0]) <= 0.010001);
  }
});

test('disabled development sends stay silent when a shared return selects developed rendering', async () => {
  const input = project();
  input.studio = { version: 1, seed: 0, assets: [], returns: [{ id: 'dub', name: 'Dub', level: 0, chain: [], automation: [] }] };
  input.tracks[0].development!.enabled = false;
  input.tracks[0].development!.sends.dub = 0;
  const rendered = await renderDevelopment(input);
  assert.ok(rendered.stems.find(s => s.id === 'dub')!.channels.every(c => c.every(v => v === 0)));
  delete input.tracks[0].development;
  assert.deepEqual(rendered.channels, (await renderDevelopment(input)).channels);
});

test('silent developed stems preserve full and excerpt durations and can be cached', async () => {
  const input = project(), cache = new MemoryRenderCache();
  input.tracks[0].development!.steps = [{ step: 0, condition: { probability: 0 } }, { step: 1, condition: { probability: 0 } }];
  const full = await renderDevelopment(input, { cache, preInsertStems: true });
  assert.ok(full.stems.every(s => s.channels[0].length === full.channels[0].length));
  const excerpt = await renderDevelopment(input, { cache, preInsertStems: true, range: { start: 0.02, end: 0.08, unit: 'seconds' } });
  assert.equal(excerpt.stats.cacheHits, 1);
  assert.ok(excerpt.stems.every(s => s.channels[0].length === 2880));
});

test('reverb automation from a closed send receives the complete reverb tail', async () => {
  const input = project();
  input.reverb = { ...input.reverb, enabled: true, wet: -6, decay: 8, preDelay: 0.1 };
  input.tracks[0].reverbWet = -96;
  input.tracks[0].development!.automation = [{ id: 'send', target: 'reverbWet', interpolation: 'step', points: [{ beat: 0, value: -6 }] }];
  const duration = (await createScheduledRenderSession(input, await resolveProjectEvents(input))).duration;
  input.tracks[0].reverbWet = -6;
  assert.equal(duration, (await createScheduledRenderSession(input, await resolveProjectEvents(input))).duration);
});

test('muting preserves song timing, audible stems and cache correctness', async () => {
  const input = project(), cache = new MemoryRenderCache();
  input.tracks.push({ ...clonePresetData(input).tracks[0], id: 'long', sequenceInput: '1 2 4 8 1 2 4 8' });
  input.bitmaskSequenceInput = '3 0';
  const full = await renderDevelopment(input, { cache });
  const muted = await renderDevelopment(input, { cache, mutedTrackIds: ['long'] });
  assert.equal(muted.songDuration, full.songDuration);
  assert.deepEqual(muted.resolved, full.resolved);
  assert.deepEqual(muted.stems[0].channels, full.stems[0].channels);
  assert.deepEqual(muted.preMaster, full.stems[0].channels);
  assert.ok(muted.stems[1].channels.every(c => c.every(v => v === 0)));
  assert.deepEqual((await renderDevelopment(input, { cache })).channels, full.channels);
});

test('exported stems preserve samples above full scale for recombination', async () => {
  const input = project(), directory = await mkdtemp(join(tmpdir(), 'gaterunner-stem-headroom-'));
  input.tracks[0].gain = 24;
  try {
    const rendered = await renderDevelopment(input);
    assert.ok(rendered.stems[0].channels[0].some(v => Math.abs(v) > 1));
    const manifest = await exportStems(input, directory, { stemStage: 'post', preInsertStems: false, laneStems: false });
    const decoded = await importWavAsset(await readFile(manifest.files[0].file), 'stem');
    assert.deepEqual(Float32Array.from(decoded.channels[0]), rendered.preMaster[0]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('muting invalidates shared return caches without changing the audible source', async () => {
  const input = project(), cache = new MemoryRenderCache();
  input.tracks.push({ ...clonePresetData(input).tracks[0], id: 'long', sequenceInput: '1 2 4 8' });
  input.studio = { version: 1, seed: 0, assets: [], returns: [{ id: 'dub', name: 'Dub', level: -6,
    chain: [{ id: 'delay', type: 'delay', beats: 0.25, feedback: 0.2, cutoff: 2000, drive: 0, mode: 'stereo' }], automation: [] }] };
  input.tracks.forEach(track => { track.development!.sends.dub = -6; });
  const full = await renderDevelopment(input, { cache });
  const muted = await renderDevelopment(input, { cache, mutedTrackIds: ['long'] });
  assert.equal(muted.stats.returnCacheHits, 0);
  const reference = clonePresetData(input);
  reference.tracks[1].sequenceInput = '0 0 0 0';
  const expected = await renderDevelopment(reference);
  assert.deepEqual(muted.channels, expected.channels);
  const again = await renderDevelopment(input, { cache });
  assert.equal(again.stats.returnCacheHits, 1);
  assert.deepEqual(again.channels, full.channels);
});
