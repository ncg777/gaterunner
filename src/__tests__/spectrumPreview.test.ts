import assert from 'node:assert/strict';
import test from 'node:test';
import { getSpectrumPreview } from '../audio/spectrumPreview.js';

test('preview displays signed partial magnitudes in musical-fundamental bins', () => {
  const { peak, bars } = getSpectrumPreview([0, -1, 0, 0.1, 0, 0.01]);
  assert.equal(peak, 1);
  assert.deepEqual(bars.map(({ harmonic, decibels }) => [harmonic, decibels]),
    [[1, 0], [2, -20], [3, -40]]);
  assert.equal(bars[0].y, 16);
  assert.ok(bars.every(({ x, y }) => x > 48 && x <= 624 && y >= 16 && y < 120));
});

test('preview auto-scales quiet and very large spectra identically', () => {
  const positions = (scale: number) => getSpectrumPreview([scale, scale / 100]).bars.map(({ y }) => y);
  assert.deepEqual(positions(1e-100), positions(1));
  assert.deepEqual(positions(1e100), positions(1));
});

test('preview distinguishes silence from coefficients at or below the display floor', () => {
  assert.deepEqual(getSpectrumPreview([]), { peak: 0, bars: [] });
  assert.deepEqual(getSpectrumPreview([0, 0, NaN, Infinity]), { peak: 0, bars: [] });
  const { bars } = getSpectrumPreview([1, 0.001, 0.0001, 0]);
  assert.equal(bars.length, 2);
  assert.equal(bars[1].decibels, -60);
  assert.ok(bars[1].y < 120);
});
