import {
  generatePartialSpectrum,
  getEffectiveWaveform,
  type PartialGenerator,
} from '../src/audio/partialGenerator.js';

const TABLE_SIZE = 65536;
const CACHE_LIMIT = 32;
const tables = new Map<string, Float64Array>();
const harmonicTables = new Map<number, Float64Array>();

/** Sparse changing spectra reuse the original table's harmonic samples. */
export function prepareModulatedSpectrumOscillator(spectrum: readonly number[]) {
  const partials = spectrum.flatMap((amplitude, index) => {
    if (amplitude === 0) return [];
    const harmonic = index + 1;
    let table = harmonicTables.get(harmonic);
    if (!table) {
      table = new Float64Array(TABLE_SIZE + 1);
      for (let sample = 0; sample < TABLE_SIZE; sample += 1) {
        table[sample] = Math.sin(2 * Math.PI * harmonic * sample / TABLE_SIZE);
      }
      table[TABLE_SIZE] = table[0];
      if (harmonicTables.size >= 16) harmonicTables.delete(harmonicTables.keys().next().value!);
      harmonicTables.set(harmonic, table);
    }
    return [{ harmonic, amplitude, table }];
  });
  return (phase: number, frequency = 0, sampleRate = 48000): number => {
    const limit = frequency > 0 ? Math.max(0, Math.ceil(sampleRate / (2 * frequency)) - 1) : spectrum.length;
    const position = (phase - Math.floor(phase)) * TABLE_SIZE;
    const index = Math.floor(position);
    let lower = 0;
    let upper = 0;
    for (const partial of partials) {
      if (partial.harmonic > limit) break;
      lower += partial.amplitude * partial.table[index];
      upper += partial.amplitude * partial.table[index + 1];
    }
    // Sum endpoints before interpolation, exactly as the full combined table did.
    return lower + (upper - lower) * (position - index);
  };
}

/** Sample any shared half-fundamental spectrum with phase/frequency on that same basis. */
export function preparePartialSpectrumOscillator(
  spectrum: readonly number[],
  cacheKey: string,
): (phase: number, frequency?: number, sampleRate?: number) => number {
  let lastPartialCount = -1;
  let lastFrequency = Number.NaN;
  let lastSampleRate = Number.NaN;
  let samples: Float64Array;
  return (phase: number, frequency = 0, sampleRate = 48000) => {
    if (frequency !== lastFrequency || sampleRate !== lastSampleRate) {
      const partialLimit = frequency > 0
        ? Math.max(0, Math.ceil(sampleRate / (2 * frequency)) - 1) : spectrum.length;
      const partialCount = Math.min(spectrum.length, partialLimit);
      if (partialCount === 0) return 0;
      if (partialCount !== lastPartialCount) {
        const bandKey = `spectrum|${cacheKey}|${partialCount}`;
        let table = tables.get(bandKey);
        if (!table) {
          table = new Float64Array(TABLE_SIZE + 1);
          for (let partial = 1; partial <= partialCount; partial += 1) {
            const amplitude = spectrum[partial - 1];
            if (amplitude === 0) continue;
            for (let index = 0; index < TABLE_SIZE; index += 1) {
              table[index] += amplitude * Math.sin(2 * Math.PI * partial * index / TABLE_SIZE);
            }
          }
          table[TABLE_SIZE] = table[0];
          if (tables.size >= CACHE_LIMIT) tables.delete(tables.keys().next().value!);
          tables.set(bandKey, table);
        }
        samples = table;
        lastPartialCount = partialCount;
      }
      lastFrequency = frequency;
      lastSampleRate = sampleRate;
    }
    const position = (phase - Math.floor(phase)) * TABLE_SIZE;
    const index = Math.floor(position);
    return samples[index] + (samples[index + 1] - samples[index]) * (position - index);
  };
}

/** Waveform and procedural sources use the same half-fundamental spectrum as the browser. */
export function preparePartialOscillator(
  generator: Exclude<PartialGenerator, { type: 'tonewheel' }>,
  waveform: string,
): (phase: number, frequency?: number, sampleRate?: number) => number {
  const key = `${getEffectiveWaveform(generator, waveform)}|${JSON.stringify(generator)}`;
  const spectrum = generatePartialSpectrum(generator, waveform);
  let lastHarmonic = -1;
  let lastFrequency = Number.NaN;
  let lastSampleRate = Number.NaN;
  let samples: Float64Array;
  return (phase: number, frequency = 0, sampleRate = 48000) => {
    if (frequency !== lastFrequency || sampleRate !== lastSampleRate) {
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
      lastFrequency = frequency;
      lastSampleRate = sampleRate;
    }
    const position = (phase - Math.floor(phase)) * TABLE_SIZE;
    const index = Math.floor(position);
    return samples[index] + (samples[index + 1] - samples[index]) * (position - index);
  };
}
