import assert from 'node:assert/strict';
import test from 'node:test';
import { getPartialSpectrumGain, getRealtimePartialSpectrumGain } from '../audio/partialSpectrumGain.js';

function reference(spectrum: readonly number[], size: number) {
  let peak = 0;
  for (let sample = 0; sample < size; sample += 1) {
    let value = 0;
    for (let index = 0; index < spectrum.length; index += 1) {
      value += spectrum[index] * Math.sin(2 * Math.PI * (index + 1) * sample / size);
    }
    peak = Math.max(peak, Math.abs(value));
  }
  return peak;
}

test('cached sine bases preserve both peak grids exactly and do not leak scratch state', () => {
  const spectra = [[], [0], [1], [0, -2, 0.75],
    Array.from({ length: 128 }, (_, index) => Math.sin(index * 1.7) / (index + 1)),
    Array.from({ length: 129 }, (_, index) => index === 128 ? -0.5 : 0), [0, 0], [0.125]];
  for (const spectrum of spectra) {
    assert.equal(getPartialSpectrumGain(spectrum), reference(spectrum, 8192));
    assert.equal(getRealtimePartialSpectrumGain(spectrum), reference(spectrum, 4099));
  }
  const mutable = [1, 0.5];
  getRealtimePartialSpectrumGain(mutable);
  mutable[0] = -0.25;
  assert.equal(getRealtimePartialSpectrumGain(mutable), reference(mutable, 4099));
});
