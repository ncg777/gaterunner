import {
  generatePartialSpectrum,
  normalizePartialWaveform,
  normalizePartialGenerator,
  type NormalizedPartialGenerator,
  type PartialGenerator,
} from './partialGenerator.js';
import { DEFAULT_TONEWHEEL_DRAWBARS } from './tonewheelSpectrum.js';
import { getPartialSpectrumGain } from './partialSpectrumGain.js';
import {
  getModulatedTonewheelPosition,
  type TonewheelModulationTime,
  type TonewheelWavetableDimension,
  type TonewheelWavetableLfo,
} from './tonewheelWavetable.js';

export {
  MAX_WAVETABLE_CONFIGURATIONS,
  MAX_WAVETABLE_DIMENSIONS,
  MAX_WAVETABLE_LFOS,
} from './tonewheelWavetable.js';

export type PartialWavetableDimension = TonewheelWavetableDimension;
export type PartialWavetableLfo = TonewheelWavetableLfo;
export type PartialWavetableModulationTime = TonewheelModulationTime;

export interface PartialSourceSnapshot {
  partialGenerator: PartialGenerator;
  waveform: string;
  tonewheelDrawbars: number[];
}

export interface NormalizedPartialSourceSnapshot extends Omit<PartialSourceSnapshot, 'partialGenerator'> {
  partialGenerator: NormalizedPartialGenerator;
}

export interface PartialWavetableConfiguration {
  name: string;
  position: number[];
  drawbars?: number[];
  source?: PartialSourceSnapshot;
}

export interface PartialWavetable {
  enabled: boolean;
  dimensions: PartialWavetableDimension[];
  configurations: PartialWavetableConfiguration[];
  lfos: PartialWavetableLfo[];
}

const spectrumCache = new Map<string, number[]>();
const SPECTRUM_CACHE_LIMIT = 256;

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function normalizePartialSourceSnapshot(value: PartialSourceSnapshot): NormalizedPartialSourceSnapshot {
  const partialGenerator = normalizePartialGenerator(value.partialGenerator);
  return {
    partialGenerator,
    waveform: normalizePartialWaveform(value.waveform),
    tonewheelDrawbars: DEFAULT_TONEWHEEL_DRAWBARS.map((fallback, index) => {
      const drawbar = value.tonewheelDrawbars[index];
      return typeof drawbar === 'number' && Number.isFinite(drawbar)
        ? Math.max(0, Math.min(8, drawbar))
        : fallback;
    }),
  };
}

export function getPartialWavetableWeights(
  wavetable: Pick<PartialWavetable, 'enabled' | 'dimensions' | 'configurations'>,
  position?: number[],
): number[] {
  if (!wavetable.enabled || wavetable.dimensions.length === 0 || wavetable.configurations.length === 0) {
    return [];
  }

  const point = wavetable.dimensions.map((dimension, index) => clampUnit(position?.[index] ?? dimension.value));
  const squaredDistances = wavetable.configurations.map((configuration) => point.reduce((sum, value, index) => {
    const delta = value - clampUnit(configuration.position[index] ?? 0);
    return sum + delta * delta;
  }, 0));
  const exactIndex = squaredDistances.findIndex((distance) => distance < 1e-18);
  if (exactIndex >= 0) {
    return squaredDistances.map((_, index) => index === exactIndex ? 1 : 0);
  }

  const inverseDistances = squaredDistances.map((distance) => 1 / distance);
  const total = inverseDistances.reduce((sum, weight) => sum + weight, 0);
  return inverseDistances.map((weight) => weight / total);
}

export function resolvePartialSourceSpectrum(value: PartialSourceSnapshot): number[] {
  const source = normalizePartialSourceSnapshot(value);
  const key = `${source.waveform}|${JSON.stringify(source.partialGenerator)}|${source.tonewheelDrawbars.join(',')}`;
  const cached = spectrumCache.get(key);
  if (cached) return cached;

  let spectrum = generatePartialSpectrum(
    source.partialGenerator,
    source.waveform,
    source.tonewheelDrawbars,
  );
  if (source.partialGenerator.type === 'tonewheel') {
    const peak = getPartialSpectrumGain(spectrum);
    if (peak > 0) spectrum = spectrum.map((amplitude) => amplitude / peak);
  }
  let length = spectrum.length;
  while (length > 1 && spectrum[length - 1] === 0) length -= 1;
  const trimmed = length === spectrum.length ? spectrum : spectrum.slice(0, length);
  if (spectrumCache.size >= SPECTRUM_CACHE_LIMIT) spectrumCache.clear();
  spectrumCache.set(key, trimmed);
  return trimmed;
}

export function resolvePartialWavetableConfigurationSource(
  configuration: PartialWavetableConfiguration,
  fallback: PartialSourceSnapshot,
): PartialSourceSnapshot {
  return configuration.source ?? {
    partialGenerator: { type: 'tonewheel' },
    waveform: 'sine',
    tonewheelDrawbars: configuration.drawbars ?? fallback.tonewheelDrawbars,
  };
}

export function blendPartialWavetableSpectra(
  wavetable: PartialWavetable,
  fallback: PartialSourceSnapshot,
  position?: number[],
): number[] {
  const weights = getPartialWavetableWeights(wavetable, position);
  if (weights.length === 0) return resolvePartialSourceSpectrum(fallback);

  const spectra = wavetable.configurations.map((configuration) => resolvePartialSourceSpectrum(
    resolvePartialWavetableConfigurationSource(configuration, fallback),
  ));
  const length = Math.max(1, ...spectra.map((spectrum) => spectrum.length));
  return Array.from({ length }, (_, partialIndex) => spectra.reduce((sum, spectrum, configurationIndex) => (
    sum + (spectrum[partialIndex] ?? 0) * weights[configurationIndex]
  ), 0));
}

export function getModulatedPartialWavetablePosition(
  wavetable: PartialWavetable,
  timing: PartialWavetableModulationTime,
): number[] {
  return getModulatedTonewheelPosition(wavetable, timing);
}

export function blendModulatedPartialWavetableSpectra(
  wavetable: PartialWavetable,
  fallback: PartialSourceSnapshot,
  timing: PartialWavetableModulationTime,
): number[] {
  return blendPartialWavetableSpectra(wavetable, fallback, getModulatedPartialWavetablePosition(wavetable, timing));
}