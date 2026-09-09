import {
  PULSE_DUTY,
  REED_HARMONICS,
  getFluteHarmonicAmplitude,
  getPulseHarmonicAmplitude,
  getReedHarmonicAmplitude,
  isPulseWaveform,
  isReedWaveform,
} from '../src/audio/spectra.js';

const TONEWHEEL_RATIOS = [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8];
const OSCILLATOR_TABLE_SIZE = 65536;
const oscillatorTables = new Map<string, Float64Array>();

function sampleAdditiveOscillator(phase: number, waveform: string): number {
  const harmonicCount = waveform === 'flute' ? 5
    : isReedWaveform(waveform) ? REED_HARMONICS[waveform].length : 32;
  let sample = 0;
  let energy = 0;
  for (let harmonic = 1; harmonic <= harmonicCount; harmonic += 1) {
    const amplitude = waveform === 'flute'
      ? getFluteHarmonicAmplitude(harmonic)
      : isReedWaveform(waveform) ? getReedHarmonicAmplitude(waveform, harmonic)
        : getPulseHarmonicAmplitude(PULSE_DUTY[waveform as keyof typeof PULSE_DUTY], harmonic);
    sample += amplitude * Math.sin(2 * Math.PI * harmonic * phase);
    energy += amplitude * amplitude;
  }
  return sample / Math.max(1, Math.sqrt(energy));
}

function getOscillatorTable(waveform: string): Float64Array {
  const cached = oscillatorTables.get(waveform);
  if (cached) {
    return cached;
  }

  const table = new Float64Array(OSCILLATOR_TABLE_SIZE + 1);
  for (let index = 0; index < OSCILLATOR_TABLE_SIZE; index += 1) {
    table[index] = sampleAdditiveOscillator(index / OSCILLATOR_TABLE_SIZE, waveform);
  }
  table[OSCILLATOR_TABLE_SIZE] = table[0];
  oscillatorTables.set(waveform, table);
  return table;
}

export function sampleOscillator(phase: number, waveform: string): number {
  if (waveform === 'flute' || isReedWaveform(waveform) || isPulseWaveform(waveform)) {
    const table = getOscillatorTable(waveform);
    const tablePosition = phase * OSCILLATOR_TABLE_SIZE;
    const index = Math.floor(tablePosition);
    const fraction = tablePosition - index;
    return table[index] + (table[index + 1] - table[index]) * fraction;
  }

  switch (waveform) {
    case 'square':
      return phase < 0.5 ? 1 : -1;
    case 'triangle':
      return 1 - 4 * Math.abs(phase - 0.5);
    case 'sawtooth':
      return 2 * phase - 1;
    case 'sine':
    default:
      return Math.sin(2 * Math.PI * phase);
  }
}

export function prepareTonewheel(drawbars: number[]): Array<{ amplitude: number; ratio: number }> {
  const activeDrawbars = drawbars
    .map((drawbar, index) => ({ amplitude: drawbar / 8, ratio: TONEWHEEL_RATIOS[index] }))
    .filter(({ amplitude }) => amplitude !== 0);
  const normalizer = Math.max(
    1,
    Math.sqrt(activeDrawbars.reduce((sum, { amplitude }) => sum + amplitude * amplitude, 0)),
  );
  return activeDrawbars.map(({ amplitude, ratio }) => ({ amplitude: amplitude / normalizer, ratio }));
}

export function sampleTonewheel(
  phase: number,
  waveform: string,
  tonewheel: Array<{ amplitude: number; ratio: number }>,
): number {
  let sample = 0;
  for (const { amplitude, ratio } of tonewheel) {
    sample += amplitude * sampleOscillator((phase * ratio) % 1, waveform);
  }
  return sample;
}