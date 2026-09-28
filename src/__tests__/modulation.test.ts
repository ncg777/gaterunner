import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModulation, emptyModulationValues, modulationEnvelopeLevel, normalizeModulation } from '../audio/modulation.js';
import { clonePresetTrackData, normalizePresetTrackData } from '../presets.js';
import { renderWavChannels } from '../../cli/generate.js';

test('normalization preserves arbitrary counts and stable IDs, rejects unsafe routes and clones presets', () => {
  const modulation = normalizeModulation({ sources: Array.from({ length: 100 }, (_, i) => ({ id: `s${i}`, type: i % 2 ? 'lfo' : 'envelope' })),
    routes: [{ source: 's0', target: 'pitch', amount: 1000 }, { source: 'missing', target: 'pan', amount: 1 },
      { source: 's0', target: '__proto__' }, { source: 's1', target: 'level', amount: NaN }] });
  assert.equal(modulation.sources.length, 100);
  assert.equal(modulation.routes.length, 2);
  assert.equal(modulation.routes[0].amount, 48);
  assert.equal(modulation.routes[1].amount, 0);
  const track = normalizePresetTrackData({ modulation });
  const clone = clonePresetTrackData(track);
  clone.modulation!.sources[0].name = 'Changed';
  assert.notEqual(track.modulation!.sources[0].name, 'Changed');
  assert.deepEqual(normalizePresetTrackData(JSON.parse(JSON.stringify(track))).modulation, modulation);
  assert.deepEqual(normalizeModulation(null), { sources: [], routes: [] });
});

test('envelopes release from the instantaneous level, including zero stages and curved segments', () => {
  const source = normalizeModulation({ sources: [{ type: 'envelope', attack: 1, decay: 1, sustain: 0.3, release: 1 }] }).sources[0];
  assert.equal(source.type, 'envelope');
  if (source.type !== 'envelope') return;
  assert.equal(modulationEnvelopeLevel(source, -0.1), 0);
  assert.equal(modulationEnvelopeLevel(source, 0.25, 0.25), 0.25);
  assert.equal(modulationEnvelopeLevel(source, 0.75, 0.25), 0.125);
  assert.equal(modulationEnvelopeLevel(source, 1.25, 0.25), 0);
  assert.equal(modulationEnvelopeLevel({ ...source, attack: 0, decay: 0 }, 0), 0.3);
  assert.equal(modulationEnvelopeLevel({ ...source, release: 0 }, 0.25, 0.25), 0);
  for (const curve of [-10, 10]) {
    const curved = { ...source, curve };
    assert.equal(modulationEnvelopeLevel(curved, 0.4, 0.4), modulationEnvelopeLevel(curved, 0.4));
    assert.ok(modulationEnvelopeLevel(curved, 0.8, 0.4) < modulationEnvelopeLevel(curved, 0.4));
  }
});

test('matrix sums signed routes, bypasses sources/routes and clamps after summing', () => {
  const settings = normalizeModulation({ sources: [{ id: 'env', type: 'envelope', attack: 0, decay: 0, sustain: 1 }],
    routes: [{ source: 'env', target: 'pitch', amount: 48 }, { source: 'env', target: 'pitch', amount: -12 },
      { source: 'env', target: 'pan', amount: 1 }, { source: 'env', target: 'pan', amount: 1 },
      { source: 'env', target: 'level', amount: -40, enabled: false }] });
  const time = { time: 1, noteStart: 0, bpm: 120 };
  assert.deepEqual(compileModulation(settings).sample(time), { ...emptyModulationValues(), pitch: 36, pan: 1 });
  settings.sources[0].enabled = false;
  assert.equal(compileModulation(settings).active, false);
});

test('tempo sync and phase origins are deterministic under arbitrary sampling order', () => {
  for (const waveform of ['sine', 'triangle', 'sample-hold', 'smooth-random']) {
    const settings = normalizeModulation({ sources: [{ id: 'lfo', type: 'lfo', waveform, sync: true, syncRate: '1/4', retrigger: 'note' }],
      routes: [{ source: 'lfo', target: 'pitch', amount: 12 }] });
    const matrix = compileModulation(settings);
    const a = matrix.sample({ time: 2.125, noteStart: 2, bpm: 120 });
    matrix.sample({ time: 99, noteStart: 0, bpm: 120 });
    assert.deepEqual(a, matrix.sample({ time: 2.125, noteStart: 2, bpm: 120 }));
    assert.deepEqual(a, matrix.sample({ time: 0.25, noteStart: 0, bpm: 60 }));
    if (waveform === 'sine') assert.equal(a.pitch, 12);
    const lfo = settings.sources[0];
    if (lfo.type === 'lfo') lfo.retrigger = 'song';
    assert.deepEqual(compileModulation(settings).sample({ time: 2.125, noteStart: 2.1, songStart: 2, bpm: 120 }), a);
  }
});

test('native rendering applies pitch, level, pan and filter routes and keeps bypass exact', async () => {
  const track = { sequence: '1', gain: -18, attack: 0, decay: 0, sustain: 1, release: 0.05, reverbWet: -96,
    waveform: 'sawtooth', partialGenerator: { type: 'waveform' as const }, filterEnabled: true, filterFrequency: 60 };
  const render = (modulation?: ReturnType<typeof normalizeModulation>) => renderWavChannels({ bpm: 240, tracks: [{ ...track, modulation }] });
  const plain = await render();
  const patch = (target: string, amount: number) => normalizeModulation({ sources: [{ id: 'e', type: 'envelope', attack: 0, decay: 0, sustain: 1 }],
    routes: [{ source: 'e', target, amount }] });
  assert.deepEqual(await render(patch('pitch', 0)), plain);
  for (const [target, amount] of [['pitch', 12], ['cutoff', 12], ['resonance', 8], ['level', -18]] as const) {
    const result = await render(patch(target, amount));
    assert.ok(result.left.every(Number.isFinite));
    assert.notDeepEqual(result.left, plain.left, target);
    assert.deepEqual(await render(patch(target, amount)), result);
  }
  const panned = await render(patch('pan', 1));
  const energy = (v: Float32Array) => v.reduce((n, x) => n + x * x, 0);
  assert.ok(energy(panned.right) > energy(panned.left) * 100, 'pan reaches the stereo output');
});
