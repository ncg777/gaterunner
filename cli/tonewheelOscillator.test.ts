import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PULSE_DUTY,
  REED_HARMONICS,
  getFluteHarmonicAmplitude,
  getPulseHarmonicAmplitude,
  getReedHarmonicAmplitude,
  isReedWaveform,
} from '../src/audio/spectra.js';
import { sampleOscillator } from './tonewheelOscillator.js';

function sampleReference(
  phase: number,
  waveform: 'flute' | keyof typeof PULSE_DUTY | keyof typeof REED_HARMONICS,
): number {
  const harmonicCount = waveform === 'flute' ? 5
    : isReedWaveform(waveform) ? REED_HARMONICS[waveform].length : 32;
  let sample = 0;
  let energy = 0;
  for (let harmonic = 1; harmonic <= harmonicCount; harmonic += 1) {
    const amplitude = waveform === 'flute'
      ? getFluteHarmonicAmplitude(harmonic)
      : isReedWaveform(waveform) ? getReedHarmonicAmplitude(waveform, harmonic)
        : getPulseHarmonicAmplitude(PULSE_DUTY[waveform], harmonic);
    sample += amplitude * Math.sin(2 * Math.PI * harmonic * phase);
    energy += amplitude * amplitude;
  }
  return sample / Math.max(1, Math.sqrt(energy));
}

test('oscillator tables stay below the WAV numerical-equivalence threshold', () => {
  for (const waveform of ['flute', 'oboe', 'clarinet', 'saxophone', 'pulse-25', 'pulse-12'] as const) {
    let peakDifference = 0;
    for (let index = 0; index < 10000; index += 1) {
      const phase = (index + 0.371) / 10000;
      peakDifference = Math.max(
        peakDifference,
        Math.abs(sampleOscillator(phase, waveform) - sampleReference(phase, waveform)),
      );
    }
    assert.ok(peakDifference <= 1e-5, `${waveform} peak difference was ${peakDifference}`);
  }
});