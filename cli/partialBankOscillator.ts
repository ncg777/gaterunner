import { bankBandGain, compileBankPosition, normalizeBankAmplitudes, type PartialBankSettings } from '../src/audio/partialBank.js';
import { spectralSpectrumAtTime, type SpectralSourceSettings } from '../src/audio/spectralModulation.js';
import { emptyModulationValues, type compileModulation, type ModulationTime } from '../src/audio/modulation.js';

const size = 65536;
const sine = Float64Array.from({ length: size + 1 }, (_, i) => Math.sin(2 * Math.PI * i / size));
type Timing = Omit<ModulationTime, 'time'>;
/** Stateful independent phases are essential: fractional ratios cannot reuse the carrier's wrapped phase. */
export function createPartialBankOscillator(source: SpectralSourceSettings, bank: PartialBankSettings,
  matrix: ReturnType<typeof compileModulation>, initialTiming: Timing) {
  const position = compileBankPosition(bank), values = emptyModulationValues();
  const phases = new Float64Array(128), started = new Uint8Array(128);
  let timing = initialTiming, step = -Infinity;
  let lastTime: number | undefined, lastFrequency = 0;
  let left: number[] = [], right: number[] = [], ratiosLeft: number[] = [], ratiosRight: number[] = [];
  const frame = (time: number) => {
    const t = { ...timing, time }, m = matrix.sample(t, values);
    return { amplitudes: normalizeBankAmplitudes(spectralSpectrumAtTime(source, m, t)),
      ratios: Array.from({ length: 128 }, (_, i) => position((i + 1) / 2, m)) };
  };
  return {
    setTiming(next: Timing) { timing = next; step = -Infinity; },
    sample(frequency: number, time: number, sampleRate: number) {
      const gap = lastTime === undefined ? 0 : Math.max(0, time - lastTime - 1 / sampleRate);
      if (gap > 1 / sampleRate) for (let i = 0; i < 128; i++) {
        phases[i] = (phases[i] + gap * lastFrequency * (ratiosRight[i] ?? 0)) % 1;
      }
      const control = Math.max(0, (time - timing.noteStart) * 200), current = Math.floor(control);
      if (current !== step) {
        const a = current === step + 1 ? { amplitudes: right, ratios: ratiosRight } : frame(timing.noteStart + current / 200);
        const b = frame(timing.noteStart + (current + 1) / 200);
        left = a.amplitudes; ratiosLeft = a.ratios; right = b.amplitudes; ratiosRight = b.ratios; step = current;
      }
      const mix = control - current;
      let sum = 0;
      for (let i = 0; i < 128; i++) {
        const a = left[i] ?? 0, amplitude = a + ((right[i] ?? 0) - a) * mix;
        if (!started[i] && amplitude === 0) continue;
        started[i] = 1;
        const ratio = ratiosLeft[i] + (ratiosRight[i] - ratiosLeft[i]) * mix;
        const hz = frequency * ratio;
        const p = phases[i] * size, index = Math.floor(p);
        sum += amplitude * (sine[index] + (sine[index + 1] - sine[index]) * (p - index))
          * (ratio > 0 ? bankBandGain(hz, sampleRate) : 0);
        phases[i] = (phases[i] + hz / sampleRate) % 1;
      }
      lastTime = time; lastFrequency = frequency;
      return sum;
    },
  };
}
