import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POSITION_FUNCTIONS, normalizePartialBank, compileBankPosition, bankExpressionError, bankBandGain } from '../audio/partialBank.js';
import { compileModulation, emptyModulationValues, normalizeModulation } from '../audio/modulation.js';
import { normalizePresetTrackData, clonePresetTrackData } from '../presets.js';
import { normalizeSynthEngine } from '../audio/synthEngine.js';
import { normalizePartialGenerator } from '../audio/partialGenerator.js';
import { createPartialBankOscillator } from '../../cli/partialBankOscillator.js';
import { renderWavChannels } from '../../cli/generate.js';

test('all position functions are finite, anchored and bounded, including extreme parameters', () => {
  for (const [type, definition] of Object.entries(POSITION_FUNCTIONS)) {
    for (const extreme of ['min', 'max', 'value'] as const) {
      const raw = { type, ...Object.fromEntries(definition.parameters.map((p, i) => [['a', 'b', 'c'][i], p[extreme]])) };
      const f = compileBankPosition(normalizePartialBank({ position: raw }));
      for (let n = 0.5; n <= 64; n += 0.5) {
        const r = f(n, emptyModulationValues());
        assert.ok(Number.isFinite(r) && r >= 0 && r <= 256, `${type}/${extreme}/${n}: ${r}`);
      }
      assert.equal(f(1, emptyModulationValues()), 1, type);
    }
  }
});

test('functions produce fractional positions and morph in musical pitch distance', () => {
  const settings = normalizePartialBank({ position: { type: 'power', a: 0.5 }, target: { type: 'square' } });
  const zero = emptyModulationValues();
  assert.equal(compileBankPosition(settings)(2, zero), Math.SQRT2);
  const middle = compileBankPosition({ ...settings, morph: 0.5 })(2, zero);
  assert.ok(Math.abs(middle - Math.sqrt(Math.SQRT2 * 4)) < 1e-12);
  assert.equal(compileBankPosition(settings)(2, { ...zero, positionA: 0.5 }), 2);
  assert.equal(compileBankPosition(settings)(2, { ...zero, positionMorph: 1 }), 4);
});

test('expressions reject arbitrary code and invalid runtime ratios silence the slot', () => {
  assert.ok(bankExpressionError('globalThis.alert(1)'));
  assert.ok(bankExpressionError('n + mystery'));
  assert.equal(bankExpressionError('n^a + b*(n-1) + c'), null);
  const custom = (expression: string) => compileBankPosition(normalizePartialBank({ position: { type: 'custom', expression } }));
  assert.equal(custom('sqrt(-n)')(3, emptyModulationValues()), 0);
  assert.equal(custom('-n')(3, emptyModulationValues()), 0);
  assert.equal(custom('n^a')(3, { ...emptyModulationValues(), positionA: 0.5 }), 3 ** 1.5);
});

test('seeded irregularity is repeatable and changing its depth retains the pattern', () => {
  const f = (seed: number, a: number) => compileBankPosition(normalizePartialBank({ anchor: false, position: { type: 'jitter', seed, a } }));
  const m = emptyModulationValues();
  for (let n = 1; n < 16; n++) {
    assert.equal(f(23, 100)(n, m), f(23, 100)(n, m));
    assert.notEqual(f(23, 100)(n, m), f(24, 100)(n, m));
    assert.ok(Math.abs(Math.log2(f(23, 200)(n, m) / n) - 2 * Math.log2(f(23, 100)(n, m) / n)) < 1e-12);
  }
});

test('new engine settings and routes survive normalization, cloning and JSON', () => {
  const track = normalizePresetTrackData({ synthMode: 'partial-bank', partialBank: { position: { type: 'ripple', a: 71, b: 2, c: 0.4 }, morph: 0.3 },
    modulation: { sources: [{ id: 'lfo', type: 'lfo' }], routes: [{ source: 'lfo', target: 'positionA', amount: 20 }] } });
  const clone = clonePresetTrackData(track);
  assert.equal(clone.synthMode, 'partial-bank');
  clone.partialBank!.position.a = 400;
  assert.equal(track.partialBank!.position.a, 71);
  assert.deepEqual(normalizeSynthEngine(JSON.parse(JSON.stringify(track))), normalizeSynthEngine(track));
  assert.equal(track.modulation!.routes[0].target, 'positionA');
});

const sampleRate = 24000;
function oscillator(position: unknown, modulation: unknown = {}, count = 2) {
  const track = normalizePresetTrackData({ synthMode: 'partial-bank', waveform: 'sawtooth',
    partialGenerator: { type: 'waveform', harmonicCount: count }, partialBank: { position }, modulation });
  return createPartialBankOscillator({ ...track, partialGenerator: normalizePartialGenerator(track.partialGenerator) },
    track.partialBank!, compileModulation(normalizeModulation(modulation)), { noteStart: 0, bpm: 120 });
}
function magnitude(samples: Float64Array, hz: number) {
  let re = 0, im = 0;
  samples.forEach((v, i) => { re += v * Math.cos(2 * Math.PI * hz * i / sampleRate); im += v * Math.sin(2 * Math.PI * hz * i / sampleRate); });
  return Math.hypot(re, im);
}
test('native oscillator emits an actual fractional partial, with no carrier-wrap discontinuity', () => {
  const bank = oscillator({ type: 'linear', a: 1.37 });
  const samples = Float64Array.from({ length: sampleRate }, (_, i) => bank.sample(100, i / sampleRate, sampleRate));
  assert.ok(magnitude(samples, 237) > magnitude(samples, 200) * 1000);
  assert.ok(magnitude(samples, 100) > magnitude(samples, 237));
  assert.ok(samples.every(Number.isFinite));
  // Analytic sum at a point after many fundamental wraps; the second partial keeps its own phase.
  const i = 5321, t = i / sampleRate;
  const expected = -(Math.sin(2 * Math.PI * 100 * t) + 0.5 * Math.sin(2 * Math.PI * 237 * t)) / Math.sqrt(1.25);
  assert.ok(Math.abs(samples[i] - expected) < 1e-6, `${samples[i]} versus ${expected}`);
});

test('position modulation moves partials while preserving finite continuous samples', () => {
  const bank = oscillator({ type: 'linear', a: 1 }, {
    sources: [{ id: 'env', type: 'envelope', attack: 0.4, decay: 0, sustain: 1 }],
    routes: [{ source: 'env', target: 'positionA', amount: 0.5 }],
  });
  const samples = Float64Array.from({ length: sampleRate }, (_, i) => bank.sample(100, i / sampleRate, sampleRate));
  assert.ok(samples.every(Number.isFinite));
  assert.ok(magnitude(samples.slice(sampleRate / 2), 250) > magnitude(samples.slice(sampleRate / 2), 200) * 100);
  let jump = 0;
  for (let i = 1; i < samples.length; i++) jump = Math.max(jump, Math.abs(samples[i] - samples[i - 1]));
  assert.ok(jump < 0.07, `phase discontinuity: ${jump}`);
});

test('band limiting fades high partials and preserves a finite waveform at extreme pitch', () => {
  assert.equal(bankBandGain(12000, sampleRate), 0);
  assert.equal(bankBandGain(11400, sampleRate), 0.5);
  const bank = oscillator({ type: 'square' }, {}, 64);
  const samples = Float64Array.from({ length: 1200 }, (_, i) => bank.sample(14000, i / sampleRate, sampleRate));
  assert.ok(samples.every(v => v === 0));
});

test('full CLI pipeline renders the new engine, including mono glide and unison', async () => {
  const base = { bpm: 240, reverb: { enabled: false }, tracks: [{ sequence: '1 3', waveform: 'sawtooth', gain: -18,
    partialGenerator: { type: 'waveform' as const, harmonicCount: 4 }, release: 0.02, synthMode: 'partial-bank' as const }] };
  const straight = await renderWavChannels(base);
  const shifted = await renderWavChannels({ ...base, tracks: [{ ...base.tracks[0], polyphony: 1, unisonVoices: 2,
    glideTime: 0.05, ...normalizeSynthEngine({ synthMode: 'partial-bank', partialBank: { position: { type: 'power', a: 1.2 } } }) }] });
  assert.ok(straight.left.some(v => Math.abs(v) > 0.001));
  assert.ok(shifted.left.every(Number.isFinite));
  assert.notDeepEqual(straight.left, shifted.left);
});
