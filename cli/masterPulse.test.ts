import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMasterPulse, DEFAULT_MASTER_PULSE, MasterPulseDSP, masterPulseEnvelope,
  masterPulseFrequency, normalizeMasterPulse } from '../src/audio/masterPulse.js';
import { applyMasterClip } from '../src/audio/masterClip.js';
import { arePresetDataEqual, buildDraftFromUrl, clonePresetData, normalizePresetData } from '../src/presets.js';
import { renderDevelopment } from '../src/audio/developmentRender.js';
import { MemoryRenderCache } from '../src/audio/renderCache.js';
import { combineWavChannelRenders, generateWav, renderWavChannels } from './generate.js';
import { presetDataToGeneratorInput } from './cli.js';

test('Master Pulse normalizes legacy/invalid settings and survives preset cloning and URLs', () => {
  assert.deepEqual(normalizeMasterPulse(undefined), DEFAULT_MASTER_PULSE);
  const sanitized = normalizeMasterPulse({ enabled: 'false', frequency: Infinity, width: -1, depth: 9, edgeMs: NaN, division: 'oops' });
  assert.equal(sanitized.enabled, false);
  assert.equal(sanitized.frequency, 10);
  assert.equal(sanitized.width, 0.05);
  assert.equal(sanitized.depth, 1);
  assert.equal(sanitized.edgeMs, 5);
  assert.equal(sanitized.division, '1/16');
  const original = normalizePresetData({ masterPulse: { enabled: true, shape: 'pulse', frequency: 7.83 } });
  const clone = clonePresetData(original);
  assert.notEqual(clone.masterPulse, original.masterPulse);
  assert.ok(arePresetDataEqual(original, clone));
  assert.deepEqual(buildDraftFromUrl(`?project=${encodeURIComponent(JSON.stringify(original))}`, normalizePresetData({})), original);
  assert.deepEqual(presetDataToGeneratorInput(original).masterPulse, original.masterPulse);
  clone.masterPulse!.frequency = 6;
  assert.ok(!arePresetDataEqual(original, clone));
  const legacy = clonePresetData(normalizePresetData({}));
  delete legacy.masterPulse;
  assert.ok(arePresetDataEqual(legacy, normalizePresetData(legacy)));
});

test('rate divisions include dotted/triplet timing and free rates through 80 Hz', () => {
  const settings = normalizeMasterPulse({ rateMode: 'sync', division: '1/8' });
  assert.equal(masterPulseFrequency(settings, 120), 4);
  assert.equal(masterPulseFrequency({ ...settings, division: '1/8D' }, 120), 8 / 3);
  assert.equal(masterPulseFrequency({ ...settings, division: '1/8T' }, 120), 6);
  assert.equal(masterPulseFrequency({ ...settings, rateMode: 'hz', frequency: 80 }, 120), 80);
});

test('pulse envelopes have silence between pulses, bounded edges, and linked stereo gain', () => {
  for (const width of [0.05, 0.5, 0.95]) for (const edge of [0.001, 0.2, 4]) {
    assert.equal(masterPulseEnvelope(width, 'pulse', width, edge), 0);
    assert.equal(masterPulseEnvelope(0, 'pulse', width, edge), 0);
    assert.equal(masterPulseEnvelope(width / 2, 'pulse', width, edge), 1);
  }
  const channels = [new Float32Array(48000).fill(0.5), new Float32Array(48000).fill(-0.25)];
  applyMasterPulse(channels, normalizeMasterPulse({ enabled: true, shape: 'pulse', depth: 1, frequency: 10 }), 120, 48000);
  let audible = 0, silent = 0;
  for (let i = 0; i < channels[0].length; i++) {
    const left = channels[0][i], right = channels[1][i];
    assert.equal(right, -left / 2);
    assert.ok(left >= 0 && left <= 0.5);
    if (left > 0) audible++; else silent++;
  }
  assert.ok(audible > 20000 && silent > 20000);
});

test('bypass and zero depth preserve bytes; live shape and bypass changes ramp without steps', () => {
  for (const settings of [DEFAULT_MASTER_PULSE, { ...DEFAULT_MASTER_PULSE, enabled: true, depth: 0 }]) {
    const channels = [Float32Array.of(0.2, -0.7, 0.5)];
    const before = channels[0].slice();
    applyMasterPulse(channels, settings, 90, 48000);
    assert.deepEqual(channels[0], before);
  }
  const off = normalizeMasterPulse({ enabled: false, shape: 'pulse', width: 0.05, frequency: 0.1, depth: 1 });
  const dsp = new MasterPulseDSP(48000, off, 120);
  dsp.reset(120000); // Start in the silent part of the envelope.
  let previous = dsp.nextGain();
  for (const settings of [{ ...off, enabled: true }, off]) {
    dsp.set(settings, 120);
    for (let i = 0; i < 480; i++) {
      const value = dsp.nextGain();
      assert.ok(Math.abs(value - previous) <= 1 / 480 + 1e-10);
      previous = value;
    }
  }
  assert.equal(previous, 1);
});

test('the master pulses the clipped sum of tracks and preserves native worker exports', async () => {
  const project = normalizePresetData({ bpm: 300, tracks: [
    { sequenceInput: '1 2', release: 0.01, gain: -18 },
    { sequenceInput: '3 4', release: 0.01, gain: -21 },
  ], reverb: { enabled: false }, masterPulse: { enabled: true, shape: 'pulse', depth: 1, frequency: 7.83 } });
  const options = presetDataToGeneratorInput(project);
  assert.deepEqual(await generateWav(options, { threads: 1 }), await generateWav(options, { threads: 2 }));
  const raw = await renderWavChannels(options);
  raw.left = new Float32Array(9600).fill(3);
  raw.right = new Float32Array(9600).fill(3);
  const { channels } = await combineWavChannelRenders([raw]);
  const expected = [new Float32Array(9600).fill(applyMasterClip(3))];
  applyMasterPulse(expected, project.masterPulse, project.bpm, raw.sampleRate);
  assert.deepEqual(channels[0], expected[0]);
  assert.deepEqual(channels[1], expected[0]);
});

test('the CLI Master Pulse JSON flag reaches the same WAV envelope as the rendering API', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'gaterunner-master-pulse-'));
  try {
    const output = join(directory, 'pulse.wav');
    const masterPulse = normalizeMasterPulse({ enabled: true, shape: 'pulse', frequency: 10, depth: 1 });
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'cli/cli.ts', '--format', 'wav', '--output', output,
      '--bpm', '300', '--sequence', '1', '--denominator', '16', '--reverb', '{"enabled":false}',
      '--master-pulse', JSON.stringify(masterPulse)], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const expected = await generateWav({ bpm: 300, sequence: '1', denominator: 16, reverb: { enabled: false }, masterPulse });
    assert.deepEqual(new Uint8Array(readFileSync(output)), expected);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('developed excerpts retain full-song pulse phase, including cached returns and tracks', async () => {
  const project = normalizePresetData({ bpm: 240, tracks: [{ id: 'a', sequenceInput: '1 2 3 4', gain: -18, release: 0.01,
    development: { enabled: true } }], reverb: { enabled: true, decay: 0.1, preDelay: 0, wet: -12 },
    masterPulse: { enabled: true, shape: 'sine', frequency: 7.83, depth: 0.9 } });
  const cache = new MemoryRenderCache();
  const full = await renderDevelopment(project, { cache });
  const start = 0.137, end = 0.313;
  const excerpt = await renderDevelopment(project, { cache, range: { start, end, unit: 'seconds' } });
  assert.ok(excerpt.stats.cacheHits > 0);
  const offset = Math.floor(start * full.sampleRate);
  for (let ch = 0; ch < 2; ch++) for (let i = 0; i < excerpt.channels[ch].length; i++) {
    assert.ok(Math.abs(excerpt.channels[ch][i] - full.channels[ch][i + offset]) < 1e-6);
  }
  const bypass = await renderDevelopment({ ...project, masterPulse: { ...project.masterPulse!, enabled: false } }, { cache });
  assert.deepEqual(bypass.preMaster, full.preMaster);
  assert.ok(bypass.stats.cacheHits > 0);
  assert.notDeepEqual(bypass.channels, full.channels);
});
