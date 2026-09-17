/**
 * General-purpose tempo-syncable LFO used for modulation controls.
 * Output range is always [-1, 1].
 */

export const LFO_WAVEFORM_OPTIONS = [
  { title: 'Sine', value: 'sine' },
  { title: 'Triangle', value: 'triangle' },
  { title: 'Saw Up', value: 'saw-up' },
  { title: 'Saw Down', value: 'saw-down' },
  { title: 'Square', value: 'square' },
  { title: 'Sample & Hold', value: 'sample-hold' },
  { title: 'Smooth Random', value: 'smooth-random' },
] as const;

export type LfoWaveform = typeof LFO_WAVEFORM_OPTIONS[number]['value'];

export const LFO_PHASE_MODE_OPTIONS = [
  { title: 'Free running', value: 'free' },
  { title: 'Retrigger on note event (track-wide)', value: 'note' },
  { title: 'Retrigger when song is played', value: 'song' },
] as const;

export type LfoPhaseMode = typeof LFO_PHASE_MODE_OPTIONS[number]['value'];

export const LFO_WAVEFORM_VALUES = new Set<string>(LFO_WAVEFORM_OPTIONS.map((option) => option.value));

export const LFO_FREE_RATE_MIN_HZ = 0.01;
export const LFO_FREE_RATE_MAX_HZ = 20;

/** Note-division cycle lengths for tempo-synced LFOs (matches modulation rates plus long sweeps). */
export const LFO_SYNC_RATE_OPTIONS = [
  '16/1',
  '8/1',
  '4/1',
  '2/1',
  '1/1',
  '1/1D',
  '1/1T',
  '1/2',
  '1/2D',
  '1/2T',
  '1/4',
  '1/4D',
  '1/4T',
  '1/8',
  '1/8D',
  '1/8T',
  '1/16',
  '1/16D',
  '1/16T',
  '1/32',
  '1/32D',
  '1/32T',
] as const;

export type LfoSyncRateValue = typeof LFO_SYNC_RATE_OPTIONS[number];

export const LFO_SYNC_RATE_VALUES = new Set<string>(LFO_SYNC_RATE_OPTIONS);

export interface SkewLfoState {
  /** Normalized phase accumulator in [0, 1). */
  phase: number;
  /** Held S&H value in [-1, 1]. */
  holdValue: number;
  /** Mulberry32-style PRNG state for S&H. */
  seed: number;
}

/** Wrap any phase into the half-open unit interval [0, 1). */
export function wrapLfoPhase(phase: number): number {
  if (!Number.isFinite(phase)) {
    return 0;
  }
  return phase - Math.floor(phase);
}

export function createSkewLfoState(seed = 0x9e3779b9, initPhase = 0): SkewLfoState {
  return {
    phase: wrapLfoPhase(initPhase),
    holdValue: 0,
    seed: seed >>> 0 || 0x9e3779b9,
  };
}

function nextRandom(state: SkewLfoState): number {
  // Mulberry32
  let t = (state.seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return u * 2 - 1;
}

/** Evaluate an LFO shape at normalized phase without advancing state (except S&H needs hold). */
export function sampleLfoWaveform(phase: number, waveform: LfoWaveform, holdValue = 0): number {
  const p = phase - Math.floor(phase);
  switch (waveform) {
    case 'triangle':
      return 1 - 4 * Math.abs(p - 0.5);
    case 'saw-up':
      return 2 * p - 1;
    case 'saw-down':
      return 1 - 2 * p;
    case 'square':
      return p < 0.5 ? 1 : -1;
    case 'sample-hold':
    case 'smooth-random':
      return holdValue;
    case 'sine':
    default:
      return Math.sin(2 * Math.PI * p);
  }
}

/**
 * Advance the LFO by one sample and return the bipolar output in [-1, 1].
 * Sample & Hold picks a new value exactly once when phase wraps past 0.
 */
export function advanceSkewLfo(
  state: SkewLfoState,
  phaseIncrement: number,
  waveform: LfoWaveform,
): number {
  const previousPhase = state.phase;
  let nextPhase = previousPhase + phaseIncrement;
  if (nextPhase >= 1 || nextPhase < 0) {
    // Count wrap events so very large increments still re-trigger S&H once per wrap.
    const wraps = Math.floor(nextPhase) - Math.floor(previousPhase);
    if ((waveform === 'sample-hold' || waveform === 'smooth-random') && wraps !== 0) {
      state.holdValue = nextRandom(state);
    }
    nextPhase -= Math.floor(nextPhase);
  }
  state.phase = nextPhase;

  if ((waveform === 'sample-hold' || waveform === 'smooth-random')
    && previousPhase === 0 && state.holdValue === 0 && phaseIncrement > 0) {
    // First sample of a fresh S&H LFO: seed an initial held value.
    state.holdValue = nextRandom(state);
  }

  return sampleLfoWaveform(state.phase, waveform, state.holdValue);
}

/** Convert a note-division rate string (e.g. "1/4D", "4/1") into cycle length in seconds. */
export function getLfoSyncRateSeconds(rate: string, bpm: number): number {
  const match = rate.match(/^(\d+)\/(\d+)([DT])?$/);
  const safeBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : 120;
  if (!match) {
    return 60 / safeBpm;
  }

  const numerator = Number.parseInt(match[1], 10);
  const denominator = Number.parseInt(match[2], 10);
  const modifier = match[3];
  const wholeNoteSeconds = (60 / safeBpm) * 4;
  const modifierRatio = modifier === 'D' ? 1.5 : modifier === 'T' ? 2 / 3 : 1;
  return (wholeNoteSeconds * numerator / denominator) * modifierRatio;
}

export function getLfoSyncRateHz(rate: string, bpm: number): number {
  return 1 / Math.max(0.001, getLfoSyncRateSeconds(rate, bpm));
}

export function getLfoFrequencyHz(options: {
  sync: boolean;
  rateHz: number;
  syncRate: string;
  bpm: number;
}): number {
  if (options.sync) {
    return getLfoSyncRateHz(options.syncRate, options.bpm);
  }
  const rate = options.rateHz;
  if (!Number.isFinite(rate)) {
    return LFO_FREE_RATE_MIN_HZ;
  }
  if (rate < LFO_FREE_RATE_MIN_HZ) {
    return LFO_FREE_RATE_MIN_HZ;
  }
  if (rate > LFO_FREE_RATE_MAX_HZ) {
    return LFO_FREE_RATE_MAX_HZ;
  }
  return rate;
}

export function getLfoPhaseIncrement(frequencyHz: number, sampleRate: number): number {
  const sr = sampleRate > 0 ? sampleRate : 44100;
  return Math.max(0, frequencyHz) / sr;
}

/** Control-rate helper: sample LFO at an absolute time without mutating S&H incorrectly across jumps. */
export function sampleLfoAtTime(
  state: SkewLfoState,
  timeSeconds: number,
  frequencyHz: number,
  waveform: LfoWaveform,
  initPhase = 0,
): number {
  const safeFrequency = Math.max(0, frequencyHz);
  const phase = safeFrequency * Math.max(0, timeSeconds) + wrapLfoPhase(initPhase);
  const wrapped = wrapLfoPhase(phase);

  if (waveform === 'sample-hold' || waveform === 'smooth-random') {
    const randomAtCycle = (cycleIndex: number): number => {
      let seed = (state.seed ^ Math.imul(cycleIndex + 1, 0x9e3779b9)) >>> 0;
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      return u * 2 - 1;
    };
    const cycleIndex = Math.floor(phase);
    const current = randomAtCycle(cycleIndex);
    if (waveform === 'sample-hold') {
      return current;
    }
    const next = randomAtCycle(cycleIndex + 1);
    const blend = wrapped * wrapped * (3 - 2 * wrapped);
    return current + (next - current) * blend;
  }

  return sampleLfoWaveform(wrapped, waveform, state.holdValue);
}
