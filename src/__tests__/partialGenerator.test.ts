import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generatePartialSpectrum,
  normalizePartialGenerator,
} from '../audio/partialGenerator.js';

test('generates normalized sequence spectra', () => {
    const spectrum = generatePartialSpectrum({
      type: 'sequence',
      sequence: 'fibonacci',
      mapping: 'normalize',
      exponent: 1,
      mask: 'none',
      tilt: 0,
    }, 5);

    assert.deepEqual(spectrum.ratios, [1, 2, 3, 4, 5]);
    assert.ok((spectrum.amplitudes[0] ?? 0) > 0);
    assert.ok(Math.abs(Math.sqrt(spectrum.amplitudes.reduce((sum, value) => sum + value * value, 0)) - 1) < 1e-9);
});

test('supports binary masks and safely normalizes unknown input', () => {
    const spectrum = generatePartialSpectrum({
      type: 'binary',
      operation: 'parity',
      mapping: 'normalize',
      exponent: 1,
      tilt: 0,
    }, 4);

    assert.deepEqual(spectrum.amplitudes, [
      1 / Math.sqrt(3),
      1 / Math.sqrt(3),
      0,
      1 / Math.sqrt(3),
    ]);
    assert.deepEqual(normalizePartialGenerator({ type: 'unexpected' }), { type: 'tonewheel' });
});
