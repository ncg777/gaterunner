import { GeneratorDSP } from '../generatorDSP.js';
import type { GeneratorSample } from '../generatorDSP.js';
import { isGeneratorMode } from '../generatorSettings.js';
import { compileModulation, emptyModulationValues, type ModulationTime } from '../modulation.js';
import type { EngineLayerSettings } from '../synthEngine.js';
import { createNativeEngineSource } from './nativeEngineSource.js';
import { createSpectralOscillator } from './spectralOscillator.js';
import { createPartialBankOscillator } from './partialBankOscillator.js';
import { nativeUnisonGain } from './nativeEnvelope.js';

/** The second source has its own unison, spectrum, motion and phase, shared across A's unison voices. */
export function createNativeModulator(settings: EngineLayerSettings, sampleRate: number, seed: number,
  initialTiming: Omit<ModulationTime, 'time'>, asset?: GeneratorSample) {
  const matrix = compileModulation(settings.modulation), values = emptyModulationValues();
  let timing = initialTiming, lastFrame: number | undefined, lastFrequency = 0;
  const count = settings.synthMode === 'additive' || settings.synthMode === 'partial-bank' ? settings.unisonVoices : 1;
  const voices = Array.from({ length: count }, (_, i) => ({
    phase: 0,
    ratio: 2 ** ((count === 1 ? 0 : (i / (count - 1) - 0.5) * settings.unisonDetune) / 1200),
    spectrum: createSpectralOscillator(settings, matrix, timing),
    bank: createPartialBankOscillator(settings, settings.partialBank, matrix, timing),
    generator: isGeneratorMode(settings.synthMode) ? new GeneratorDSP(settings.synthMode, settings.generatorEngines, sampleRate, asset) : null,
    engine: settings.synthMode === 'choir' || settings.synthMode === 'resonant-noise' ? createNativeEngineSource(settings, sampleRate, seed + i) : null,
  }));
  let pendingAttack = true, preservePhase = false;
  let nextTiming: Omit<ModulationTime, 'time'> | undefined, retriggerNext = true;
  const sampleFrame = (frequency: number, time: number) => {
    // An unmodulated layer keeps its initial zero offsets. Avoid walking every
    // modulation target for every audio sample (including mono silence gaps).
    if (matrix.active) matrix.sample({ ...timing, time }, values);
    let sum = 0;
    for (const voice of voices) {
      const hz = frequency * voice.ratio * 2 ** (values.pitch / 12);
      if (pendingAttack) voice.generator?.attack(hz, preservePhase);
      sum += voice.generator ? voice.generator.sample(hz, time - timing.noteStart, (timing.releaseTime ?? Infinity) - timing.noteStart, values)
        : voice.engine ? voice.engine(hz, time - timing.noteStart, (timing.releaseTime ?? Infinity) - timing.noteStart, time)
        : settings.synthMode === 'partial-bank' ? voice.bank.sample(hz, time, sampleRate)
        : voice.spectrum(voice.phase, hz / 2, time, sampleRate);
      voice.phase = (voice.phase + hz / (2 * sampleRate)) % 1;
    }
    pendingAttack = false;
    return Math.max(-1, Math.min(1, sum * nativeUnisonGain(count) * 10 ** (values.level / 20)));
  };
  return {
    setTiming(next: Omit<ModulationTime, 'time'>, retrigger = true) {
      nextTiming = next; retriggerNext = retrigger;
    },
    sample(frequency: number, time: number) {
      const frame = Math.round(time * sampleRate);
      // Mono sources continue through silence; preserve phase and generator/filter history.
      if (lastFrame !== undefined) for (let gap = lastFrame + 1; gap < frame; gap++) sampleFrame(lastFrequency, gap / sampleRate);
      if (nextTiming) {
        timing = nextTiming;
        voices.forEach(voice => {
          voice.bank.setTiming(timing);
          voice.spectrum = createSpectralOscillator(settings, matrix, timing);
        });
        preservePhase = lastFrame !== undefined;
        pendingAttack = retriggerNext;
        nextTiming = undefined;
      }
      const sample = sampleFrame(frequency, time);
      lastFrame = frame; lastFrequency = frequency;
      return sample;
    },
  };
}
