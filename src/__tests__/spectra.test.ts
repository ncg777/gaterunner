import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PULSE_DUTY,
  REED_HARMONICS,
  getFluteHarmonicAmplitude,
  getPulseHarmonicAmplitude,
  getReedHarmonicAmplitude,
  isPulseWaveform,
  isReedWaveform,
} from '../audio/spectra.js';
import { normalizePresetData, WAVEFORM_OPTIONS } from '../presets.js';

test('flute spectrum is compact and fundamental-led', () => {
  assert.equal(getFluteHarmonicAmplitude(1), 1);
  assert.ok(getFluteHarmonicAmplitude(2) < getFluteHarmonicAmplitude(1));
  assert.equal(getFluteHarmonicAmplitude(6), 0);
  assert.equal(getFluteHarmonicAmplitude(0), 0);
});

test('pulse spectra use fixed duty cycles and reject unrelated waveforms', () => {
  assert.equal(isPulseWaveform('pulse-25'), true);
  assert.equal(isPulseWaveform('pulse-12'), true);
  assert.equal(isPulseWaveform('square'), false);
  assert.ok(Math.abs(getPulseHarmonicAmplitude(PULSE_DUTY['pulse-25'], 4)) < Number.EPSILON);
  assert.ok(getPulseHarmonicAmplitude(PULSE_DUTY['pulse-12'], 1) > 0);
});

test('reed spectra are finite, bounded and distinct', () => {
  for (const waveform of ['oboe', 'clarinet', 'saxophone'] as const) {
    assert.equal(isReedWaveform(waveform), true);
    assert.equal(getReedHarmonicAmplitude(waveform, 1), 1);
    assert.equal(getReedHarmonicAmplitude(waveform, 0), 0);
    assert.equal(getReedHarmonicAmplitude(waveform, -1), 0);
    assert.equal(getReedHarmonicAmplitude(waveform, 1.5), 0);
    assert.equal(getReedHarmonicAmplitude(waveform, 13), 0);
    assert.ok(REED_HARMONICS[waveform].every((amplitude) => Number.isFinite(amplitude) && amplitude > 0));
  }
  assert.equal(isReedWaveform('flute'), false);
  assert.equal(isReedWaveform('toString'), false);
  assert.equal(isReedWaveform('__proto__'), false);
  assert.ok(getReedHarmonicAmplitude('oboe', 3) > getReedHarmonicAmplitude('oboe', 2));
  assert.ok(getReedHarmonicAmplitude('clarinet', 3) > 10 * getReedHarmonicAmplitude('clarinet', 2));
  assert.ok(getReedHarmonicAmplitude('saxophone', 2) > getReedHarmonicAmplitude('saxophone', 3));
});

test('reed waveforms are selectable and survive preset serialization', () => {
  for (const waveform of ['oboe', 'clarinet', 'saxophone']) {
    assert.ok(WAVEFORM_OPTIONS.some((option) => option.value === waveform));
    const preset = normalizePresetData({ tracks: [{ waveform }] });
    assert.equal(preset.tracks[0].waveform, waveform);
    assert.equal(normalizePresetData(JSON.parse(JSON.stringify(preset))).tracks[0].waveform, waveform);
  }
});