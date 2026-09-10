import {
  generatePartialSpectrum,
  type PartialGenerator,
} from '../src/audio/partialGenerator.js';

const TABLE_SIZE = 65536;
const CACHE_LIMIT = 32;
const tables = new Map<string, Float64Array>();

/** Static procedural sources use the same half-fundamental spectrum as the browser. */
export function preparePartialOscillator(
  generator: Exclude<PartialGenerator, { type: 'tonewheel' }>,
  waveform: string,
): (phase: number) => number {
  const key = `${waveform}|${JSON.stringify(generator)}`;
  let table = tables.get(key);
  if (!table) {
    const spectrum = generatePartialSpectrum(generator, waveform);
    table = new Float64Array(TABLE_SIZE + 1);
    for (let bin = 1; bin < spectrum.length; bin += 2) {
      const amplitude = spectrum[bin];
      if (amplitude === 0) continue;
      const harmonic = (bin + 1) / 2;
      for (let index = 0; index < TABLE_SIZE; index += 1) {
        table[index] += amplitude * Math.sin(2 * Math.PI * harmonic * index / TABLE_SIZE);
      }
    }
    table[TABLE_SIZE] = table[0];
    if (tables.size >= CACHE_LIMIT) {
      tables.delete(tables.keys().next().value!);
    }
    tables.set(key, table);
  }
  const samples = table;
  return (phase) => {
    const position = (phase - Math.floor(phase)) * TABLE_SIZE;
    const index = Math.floor(position);
    return samples[index] + (samples[index + 1] - samples[index]) * (position - index);
  };
}
