import {
  generatePartialSpectrum,
  getEffectiveWaveform,
  type PartialGenerator,
} from '../src/audio/partialGenerator.js';

const TABLE_SIZE = 65536;
const CACHE_LIMIT = 32;
const tables = new Map<string, Float64Array>();

/** Waveform and procedural sources use the same half-fundamental spectrum as the browser. */
export function preparePartialOscillator(
  generator: Exclude<PartialGenerator, { type: 'tonewheel' }>,
  waveform: string,
): (phase: number, frequency?: number, sampleRate?: number) => number {
  const key = `${getEffectiveWaveform(generator, waveform)}|${JSON.stringify(generator)}`;
  const spectrum = generatePartialSpectrum(generator, waveform);
  let lastHarmonic = -1;
  let samples: Float64Array;
  return (phase: number, frequency = 0, sampleRate = 48000) => {
    const harmonicLimit = frequency > 0
      ? Math.max(0, Math.ceil(sampleRate / (2 * frequency)) - 1) : spectrum.length / 2;
    const maximumHarmonic = Math.min(spectrum.length / 2, harmonicLimit);
    if (maximumHarmonic === 0) return 0;
    if (maximumHarmonic !== lastHarmonic) {
      const bandKey = `${key}|${maximumHarmonic}`;
      let table = tables.get(bandKey);
      if (!table) {
        table = new Float64Array(TABLE_SIZE + 1);
        for (let harmonic = 1; harmonic <= maximumHarmonic; harmonic += 1) {
          const amplitude = spectrum[2 * harmonic - 1];
          if (amplitude === 0) continue;
          for (let index = 0; index < TABLE_SIZE; index += 1) {
            table[index] += amplitude * Math.sin(2 * Math.PI * harmonic * index / TABLE_SIZE);
          }
        }
        table[TABLE_SIZE] = table[0];
        if (tables.size >= CACHE_LIMIT) {
          tables.delete(tables.keys().next().value!);
        }
        tables.set(bandKey, table);
      }
      samples = table;
      lastHarmonic = maximumHarmonic;
    }
    const position = (phase - Math.floor(phase)) * TABLE_SIZE;
    const index = Math.floor(position);
    return samples[index] + (samples[index + 1] - samples[index]) * (position - index);
  };
}
