import { emptyModulationValues, type compileModulation, type ModulationTime } from '../src/audio/modulation.js';
import { spectralSpectrumAtTime, type SpectralSourceSettings } from '../src/audio/spectralModulation.js';

/** Interpolate coefficients at the browser's 200 Hz control rate, retaining audio-rate phase. */
export function createSpectralOscillator(settings: SpectralSourceSettings,
  matrix: ReturnType<typeof compileModulation>, timing: Omit<ModulationTime, 'time'>) {
  let step = -Infinity;
  let left: number[] = [], right: number[] = [];
  const values = emptyModulationValues();
  return (phase: number, frequency: number, time: number, sampleRate: number) => {
    const position = Math.max(0, (time - timing.noteStart) * 200);
    const current = Math.floor(position);
    if (current !== step) {
      const a = { ...timing, time: timing.noteStart + current / 200 };
      const b = { ...timing, time: a.time + 1 / 200 };
      left = current === step + 1 ? right : spectralSpectrumAtTime(settings, matrix.sample(a, values), a);
      right = spectralSpectrumAtTime(settings, matrix.sample(b, values), b);
      step = current;
    }
    const blend = position - current;
    const limit = Math.min(Math.max(left.length, right.length), Math.ceil(sampleRate / (2 * frequency)) - 1);
    // Recurrence evaluates all harmonics with two trig calls, without allocating wavetable caches.
    const angle = 2 * Math.PI * phase, sine = Math.sin(angle), cosine = Math.cos(angle);
    let sinN = sine, cosN = cosine, sum = 0;
    for (let i = 0; i < limit; i++) {
      const a = left[i] ?? 0;
      sum += (a + ((right[i] ?? 0) - a) * blend) * sinN;
      const next = sinN * cosine + cosN * sine;
      cosN = cosN * cosine - sinN * sine;
      sinN = next;
    }
    return sum;
  };
}
