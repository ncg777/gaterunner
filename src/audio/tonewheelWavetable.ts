import {
  createSkewLfoState,
  getLfoFrequencyHz,
  sampleLfoAtTime,
  type LfoSyncRateValue,
  type LfoWaveform,
} from './lfo.js';
import type { PartialSourceSnapshot } from './partialWavetable.js';

export const MAX_WAVETABLE_DIMENSIONS = 16;
export const MAX_WAVETABLE_CONFIGURATIONS = 64;
export const MAX_WAVETABLE_LFOS = 8;

export type TonewheelLfoPolarity = 'bipolar' | 'unipolar';
export type TonewheelLfoRetrigger = 'free' | 'note' | 'song';

export interface TonewheelWavetableLfo {
  name: string;
  enabled: boolean;
  waveform: LfoWaveform;
  sync: boolean;
  rateHz: number;
  syncRate: LfoSyncRateValue;
  phase: number;
  depth: number;
  polarity: TonewheelLfoPolarity;
  retrigger: TonewheelLfoRetrigger;
  smoothing: number;
  fmSource: number;
  fmAmount: number;
  routes: number[];
}

export interface TonewheelWavetableDimension {
  name: string;
  value: number;
}

export interface TonewheelConfiguration {
  name: string;
  position: number[];
  drawbars: number[];
  source?: PartialSourceSnapshot;
}

export interface TonewheelWavetable {
  enabled: boolean;
  dimensions: TonewheelWavetableDimension[];
  configurations: TonewheelConfiguration[];
  lfos: TonewheelWavetableLfo[];
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Shepard interpolation supports sparse configurations in any number of
 * dimensions without forcing users to author every corner of a hypercube.
 */
export function interpolateTonewheelDrawbars(
  wavetable: TonewheelWavetable,
  fallback: number[],
  position?: number[],
): number[] {
  if (!wavetable.enabled || wavetable.dimensions.length === 0 || wavetable.configurations.length === 0) {
    return fallback.slice();
  }

  const point = wavetable.dimensions.map((dimension, index) => clampUnit(position?.[index] ?? dimension.value));
  const distances = wavetable.configurations.map((configuration) => {
    const squaredDistance = point.reduce((sum, value, index) => {
      const delta = value - clampUnit(configuration.position[index] ?? 0);
      return sum + delta * delta;
    }, 0);
    return Math.sqrt(squaredDistance);
  });
  const exactIndex = distances.findIndex((distance) => distance < 1e-9);
  if (exactIndex >= 0) {
    return wavetable.configurations[exactIndex].drawbars.slice();
  }

  const weights = distances.map((distance) => 1 / (distance * distance));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  return fallback.map((fallbackValue, drawbarIndex) => (
    wavetable.configurations.reduce(
      (sum, configuration, index) => sum + (configuration.drawbars[drawbarIndex] ?? fallbackValue) * weights[index],
      0,
    ) / totalWeight
  ));
}

export interface TonewheelModulationTime {
  timeSeconds: number;
  bpm: number;
  noteStartSeconds?: number;
  songStartSeconds?: number;
}

function getRetriggeredTime(lfo: TonewheelWavetableLfo, timing: TonewheelModulationTime): number {
  const time = Math.max(0, timing.timeSeconds);
  if (lfo.retrigger === 'note') {
    return Math.max(0, time - (timing.noteStartSeconds ?? time));
  }
  if (lfo.retrigger === 'song') {
    return Math.max(0, time - (timing.songStartSeconds ?? 0));
  }
  return time;
}

function sampleSmoothedLfo(
  lfo: TonewheelWavetableLfo,
  localTime: number,
  frequencyHz: number,
  phaseOffset: number,
  seed: number,
): number {
  const state = createSkewLfoState(seed);
  const smoothingWindow = lfo.smoothing * Math.min(0.25, 0.25 / Math.max(frequencyHz, 0.01));
  if (smoothingWindow <= 0) {
    return sampleLfoAtTime(state, localTime, frequencyHz, lfo.waveform, lfo.phase + phaseOffset);
  }
  let total = 0;
  for (let tap = 0; tap < 4; tap += 1) {
    total += sampleLfoAtTime(
      state,
      Math.max(0, localTime - smoothingWindow * tap / 3),
      frequencyHz,
      lfo.waveform,
      lfo.phase + phaseOffset,
    );
  }
  return total / 4;
}

/** Resolve the animated point in N-dimensional wavetable space at an absolute transport time. */
export function getModulatedTonewheelPosition(
  wavetable: Pick<TonewheelWavetable, 'enabled' | 'dimensions' | 'lfos'>,
  timing: TonewheelModulationTime,
): number[] {
  const position = wavetable.dimensions.map((dimension) => clampUnit(dimension.value));
  if (!wavetable.enabled || (wavetable.lfos ?? []).length === 0) {
    return position;
  }

  const outputs: number[] = [];
  (wavetable.lfos ?? []).slice(0, MAX_WAVETABLE_LFOS).forEach((lfo, lfoIndex) => {
    if (!lfo.enabled || lfo.depth === 0) {
      outputs.push(0);
      return;
    }
    const frequencyHz = getLfoFrequencyHz({
      sync: lfo.sync,
      rateHz: lfo.rateHz,
      syncRate: lfo.syncRate,
      bpm: timing.bpm,
    });
    const fmOutput = lfo.fmSource >= 0 && lfo.fmSource < lfoIndex ? outputs[lfo.fmSource] ?? 0 : 0;
    const localTime = getRetriggeredTime(lfo, timing);
    let output = sampleSmoothedLfo(
      lfo,
      localTime,
      frequencyHz,
      fmOutput * lfo.fmAmount,
      0x9e3779b9 ^ Math.imul(lfoIndex + 1, 0x85ebca6b),
    );
    if (lfo.polarity === 'unipolar') {
      output = output * 0.5 + 0.5;
    }
    outputs.push(output);
    position.forEach((value, dimensionIndex) => {
      position[dimensionIndex] = clampUnit(value + output * lfo.depth * (lfo.routes[dimensionIndex] ?? 0));
    });
  });
  return position;
}

export function interpolateModulatedTonewheelDrawbars(
  wavetable: TonewheelWavetable,
  fallback: number[],
  timing: TonewheelModulationTime,
): number[] {
  return interpolateTonewheelDrawbars(wavetable, fallback, getModulatedTonewheelPosition(wavetable, timing));
}
