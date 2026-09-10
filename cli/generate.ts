import ToneMidi from '@tonejs/midi';
const { Midi } = ToneMidi;
import { PCS12 } from 'ultra-mega-enumerator';
import {
  getPitchEnvelopeLevel,
  getPitchEnvelopeMidiOffset,
  normalizePitchEnvelopeShape,
} from '../src/audio/pitchEnvelope.js';
import { getTrackFadeGain } from '../src/audio/trackFade.js';
import { createWaveshaperProcessor, lookupTransferCurve, TANH_CURVE } from '../src/audio/trackDistortion.js';
import { normalizeWaveshaperSettings, type WaveshaperSettings } from '../src/audio/waveshaper.js';
import { getStepDurations } from '../src/audio/stepDurations.js';
import {
  DEFAULT_TIME_WARP_CURVE,
  quantizeNormalizedTime,
  resolveTimeWarpFunction,
  TIME_WARP_CURVE_VALUES,
  TIME_WARP_QUANTIZE_OPTIONS,
  warpNormalizedTime,
} from '../src/audio/timeWarp.js';
import {
  gateEventByActivation,
  parseBitmaskSequenceInput,
} from '../src/trackActivation.js';
import {
  decodeRhythmSequence,
  normalizeDrumLanes,
  normalizeDrumVelocityBits,
  type DrumLane,
  type DrumVoiceId,
} from '../src/domain/rhythmTrack.js';
import {
  createMonoGlideState,
  getGlideFrequency,
  isMonophonic,
  limitPolyphony,
  planMonoGlide,
  GLIDE_CURVE_OPTIONS,
  GLIDE_MODE_OPTIONS,
  type GlideCurve,
  type GlideMode,
  type GlidePlan,
} from '../src/audio/glide.js';
import { renderDrumHitIntoBuffers } from './drumWav.js';
import {
  interpolateModulatedTonewheelDrawbars,
  interpolateTonewheelDrawbars,
  type TonewheelWavetable,
} from '../src/audio/tonewheelWavetable.js';
import {
  BREATH_FILTER_Q,
} from '../src/audio/spectra.js';
import { encodeWavFromChannelsSync } from '../src/audio/wav.js';
import { prepareTonewheel, sampleTonewheel } from './tonewheelOscillator.js';
import { normalizePartialGenerator, type PartialGenerator } from '../src/audio/partialGenerator.js';
import { preparePartialOscillator } from './partialOscillator.js';

export interface GenerateTrackOptions {
  /** Optional display name for the track. */
  name?: string;
  /** Track encoding and playback kind. Legacy and omitted values are melodic. */
  trackKind?: 'melodic' | 'rhythmic';
  /** Ordered GM drum lanes used when trackKind is rhythmic. */
  drumLanes?: DrumLane[];
  /** Super Beatbox-style velocity bits assigned to each rhythmic lane. */
  drumVelocityBits?: number;
  /** Time signature numerator (1-16). Kept for parity with app presets. */
  numerator?: number;
  /** Time signature denominator (1-16). Controls this track quantization step size. */
  denominator?: number;
  /** Oscillator shape metadata (not used by MIDI export). */
  waveform?: string;
  /** Optional procedural harmonic weighting; omitted values retain legacy tonewheel synthesis. */
  partialGenerator?: PartialGenerator;
  /** @deprecated Legacy generator values are accepted and normalized to tonewheel. */
  generatorType?: string;
  /** @deprecated Legacy FM settings are ignored. */
  fmSynth?: unknown;
  /** @deprecated Legacy virtual-analog settings are ignored. */
  virtualAnalogSynth?: unknown;
  /** Add one filtered pink-noise breath layer per melodic note event. */
  breathEnabled?: boolean;
  /** Breath layer level in dB (-60 to 0). */
  breathLevel?: number;
  /** Breath filter center as a multiple of the event's mean note frequency (0.5-8). */
  breathHarmonic?: number;
  /** Space-separated integers to encode as notes, e.g. "1 2 4 8 16". */
  sequence?: string;
  /** Octave shift (0-10). */
  octave?: number;
  /** Note length as percentage of quantization step (0-400). */
  lengthFactor?: number;
  /** Fixed duration added to every note, measured in quantization steps (0-64). */
  lengthOffset?: number;
  /** MIDI channel (1-16). */
  midiChannel?: number;
  /** Audio level in dB (-96 to +24). */
  gain?: number;
  limiterGain?: number;
  waveshaper?: WaveshaperSettings;
  /** Velocity multiplier (0-4), clamped to 1 after velocity math. */
  velocityMultiplier?: number;
  /** Number of bars to wait before the track starts (0-64). */
  delay?: number;
  /** Fade-in duration in bars (0-64). 0 disables the fade. */
  fadeIn?: number;
  /** Fade-out duration in bars (0-64). 0 disables the fade. */
  fadeOut?: number;
  /** Silence before the sequence in every repeat, measured in bars (0-64). */
  paddingBefore?: number;
  /** Silence after the sequence in every repeat, measured in bars (0-64). */
  paddingAfter?: number;
  /** Number of repetitions of the pattern (1-64). */
  repeats?: number;
  timeWarpEnabled?: boolean;
  timeWarpCurve?: string;
  timeWarpExpression?: string;
  /** Number of equal chunks the pattern is split into, with the warp curve applied locally to each chunk (1-64). */
  timeWarpRepeats?: number;
  timeWarpAmount?: number;
  timeWarpQuantize?: number;
  timeWarpNoteLengths?: boolean;
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
  pitchEnvelopeAttack?: number;
  pitchEnvelopeDecay?: number;
  pitchEnvelopeSustain?: number;
  pitchEnvelopeRelease?: number;
  /** Pitch envelope depth in MIDI pitches. */
  pitchEnvelopeAmount?: number;
  /** Exponential steepness for pitch envelope segments (0 = linear). */
  pitchEnvelopeShape?: number;
  /** Maximum simultaneous voices (1-16). 1 makes the track monophonic. */
  polyphony?: number;
  /** Glide time in seconds, or seconds per octave when glideConstantRate is set. 0 disables glide. */
  glideTime?: number;
  /** 'legato' glides only between overlapping notes; 'always' glides between every note. */
  glideMode?: GlideMode;
  glideConstantRate?: boolean;
  glideCurve?: GlideCurve;
  /** True legato: overlapping monophonic notes do not retrigger the envelopes. */
  monoLegato?: boolean;
  unisonVoices?: number;
  unisonDetune?: number;
  /** Nine Hammond-style drawbar levels (0-8) used by the tonewheel waveform. */
  tonewheelDrawbars?: number[];
  /** Sparse multidimensional tonewheel configurations and current morph position. */
  tonewheelWavetable?: TonewheelWavetable;
  tremoloEnabled?: boolean;
  tremoloFrequency?: number;
  tremoloDepth?: number;
  vibratoEnabled?: boolean;
  vibratoFrequency?: number;
  vibratoDepth?: number;
  filterEnabled?: boolean;
  filterType?: string;
  /** Filter cutoff as a MIDI note pitch (0-127). */
  filterFrequency?: number;
  filterQ?: number;
  filterGain?: number;
  filterKeyFollow?: number;
  filterEnvelopeAttack?: number;
  filterEnvelopeDecay?: number;
  filterEnvelopeSustain?: number;
  filterEnvelopeRelease?: number;
  filterEnvelopeAmount?: number;
  echoEnabled?: boolean;
  echoDelay?: EchoDelayValue | number;
  echoFeedback?: number;
  /** Echo level in dB (-96 to 0). */
  echoWet?: number;
  echoPingPong?: boolean;
  /** Reverb send level in dB (-96 to 0). */
  reverbWet?: number;
}

type EchoDelayValue = typeof ECHO_DELAY_OPTIONS[number];

const ECHO_DELAY_OPTIONS = [
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
] as const;

const ECHO_DELAY_VALUES = new Set<string>(ECHO_DELAY_OPTIONS);
const MAX_POLYPHONY = 16;
const DEFAULT_TONEWHEEL_DRAWBARS = [0, 0, 0, 8, 0, 0, 0, 0, 0];
const TIME_WARP_QUANTIZE_VALUES = new Set<number>(TIME_WARP_QUANTIZE_OPTIONS);
const WAV_EXPORT_SAMPLE_RATE = 48000;

function normalizeTimeWarpCurve(value: string | undefined): string {
  return value && TIME_WARP_CURVE_VALUES.has(value) ? value : DEFAULT_TIME_WARP_CURVE;
}

function normalizeTimeWarpQuantize(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return TIME_WARP_QUANTIZE_VALUES.has(value) ? value : fallback;
}

export interface GenerateReverbOptions {
  enabled?: boolean;
  decay?: number;
  preDelay?: number;
  /** Reverb level in dB (-96 to 0). */
  wet?: number;
  /** Reverb high-pass cutoff as a MIDI note pitch (0-127). */
  lowCut?: number;
  /** Reverb low-pass cutoff as a MIDI note pitch (0-127). */
  highCut?: number;
}

export interface GenerateOptions {
  /** Tempo in beats per minute (1-499). Default: 90 */
  bpm?: number;
  /** Concert pitch frequency of A4 in Hz (380-500). Default: 440 */
  a4?: number;
  /** Legacy single-track numerator (1-16). Used when tracks is omitted. */
  numerator?: number;
  /** Legacy single-track denominator (1-16). Used when tracks is omitted. */
  denominator?: number;
  /** Forte number (pitch-class set identifier), e.g. "5-35.05". Default: "5-35.05" */
  forte?: string;
  /**
   * Optional song-level track activation sequence B: whitespace-separated
   * nonnegative decimal bitmasks. Blank disables gating. Bit 0 = first track.
   */
  bitmaskSequenceInput?: string;
  /** Legacy single-track sequence used when tracks is omitted. */
  sequence?: string;
  /** Legacy single-track octave used when tracks is omitted. */
  octave?: number;
  /** Legacy single-track length factor used when tracks is omitted. */
  lengthFactor?: number;
  /** Legacy single-track fixed note length in steps used when tracks is omitted. */
  lengthOffset?: number;
  /** Legacy single-track midi channel used when tracks is omitted. */
  midiChannel?: number;
  /** Legacy single-track audio gain in dB used when tracks is omitted. */
  gain?: number;
  limiterGain?: number;
  waveshaper?: WaveshaperSettings;
  /** Legacy single-track waveform metadata used when tracks is omitted. */
  waveform?: string;
  partialGenerator?: PartialGenerator;
  /** Legacy single-track delay in bars used when tracks is omitted. */
  delay?: number;
  /** Legacy single-track fade-in duration in bars used when tracks is omitted. */
  fadeIn?: number;
  /** Legacy single-track fade-out duration in bars used when tracks is omitted. */
  fadeOut?: number;
  /** Legacy single-track padding before every repeated sequence, in bars. */
  paddingBefore?: number;
  /** Legacy single-track padding after every repeated sequence, in bars. */
  paddingAfter?: number;
  /** Legacy single-track number of pattern repetitions used when tracks is omitted. */
  repeats?: number;
  timeWarpEnabled?: boolean;
  timeWarpCurve?: string;
  timeWarpExpression?: string;
  timeWarpRepeats?: number;
  timeWarpAmount?: number;
  timeWarpQuantize?: number;
  timeWarpNoteLengths?: boolean;
  /** Multi-track definition. If omitted, legacy single-track fields are used. */
  tracks?: GenerateTrackOptions[];
  reverb?: GenerateReverbOptions;
}

export interface WavRenderTiming {
  stage: 'render' | 'encode';
  milliseconds: number;
}

export interface WavRenderOptions {
  threads?: number;
  onTiming?: (timing: WavRenderTiming) => void;
}

let pcs12Initialized = false;

type NormalizedTrack = Required<Omit<GenerateTrackOptions, 'generatorType' | 'fmSynth' | 'virtualAnalogSynth'>>;
export type NormalizedReverb = Required<GenerateReverbOptions>;

export interface WavChannelRenderResult {
  left: Float32Array | Float64Array;
  right: Float32Array | Float64Array;
  reverbLeft: Float32Array | Float64Array | null;
  reverbRight: Float32Array | Float64Array | null;
  sampleRate: number;
  reverb: NormalizedReverb;
}

interface TrackRenderData {
  track: NormalizedTrack;
  quant: number;
  actualNotes: number[][];
  noteVelocities?: number[][];
  drumVoiceIds?: DrumVoiceId[][];
}

interface TrackScheduledEvent {
  time: number;
  duration: number;
  velocity: number;
  notes: number[];
  noteVelocities?: number[];
  drumVoiceIds?: DrumVoiceId[];
  order: number;
}

interface PreparedRenderData {
  bpm: number;
  a4: number;
  activationMasks: bigint[];
  tracks: TrackRenderData[];
  reverb: NormalizedReverb;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeEchoDelay(value: EchoDelayValue | number | undefined, fallback: EchoDelayValue | number): EchoDelayValue | number {
  if (typeof value === 'string' && ECHO_DELAY_VALUES.has(value)) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return clamp(value, 0.01, 4);
  }
  return fallback;
}

function getEchoDelaySeconds(bpm: number, delay: EchoDelayValue | number): number {
  if (typeof delay === 'number') {
    return delay;
  }

  const match = delay.match(/^1\/(\d+)([DT])?$/);
  if (!match) {
    return 60 / bpm;
  }

  const denominator = Number.parseInt(match[1], 10);
  const modifier = match[2];
  const quarterNoteSeconds = 60 / bpm;
  const wholeNoteSeconds = quarterNoteSeconds * 4;
  const modifierRatio = modifier === 'D' ? 1.5 : modifier === 'T' ? 2 / 3 : 1;
  return (wholeNoteSeconds / denominator) * modifierRatio;
}

function getLoopDurationSecondsFromTrackLengths(prepared: PreparedRenderData): number {
  const entries = prepared.tracks.filter((entry) => entry.actualNotes.length > 0);
  if (entries.length === 0) {
    return 1;
  }

  const maxDuration = Math.max(
    ...entries.map((entry) => (
      getTrackDelaySeconds(prepared.bpm, entry.track)
      + entry.track.repeats * getTrackRepeatDurationSeconds(prepared.bpm, entry)
    )),
  );

  return Math.max(entries[0].quant, maxDuration);
}

function getTrackDelaySeconds(bpm: number, track: NormalizedTrack): number {
  return track.delay * track.numerator * (60 / bpm);
}

function getTrackRepeatDurationSeconds(bpm: number, entry: TrackRenderData): number {
  const barSeconds = entry.track.numerator * (60 / bpm);
  return (entry.track.paddingBefore + entry.track.paddingAfter) * barSeconds
    + entry.actualNotes.length * entry.quant;
}

function parseSequence(sequenceInput: string): number[] {
  return sequenceInput
    .trim()
    .split(/\s+/)
    .map((n: string) => Number.parseInt(n.trim(), 10))
    .filter((n: number) => !Number.isNaN(n));
}

function buildTrackEvents(
  entry: TrackRenderData,
  bpm: number,
  totalLoopDuration: number,
  trackIndex: number,
  activationMasks: readonly bigint[],
): TrackScheduledEvent[] {
  if (entry.actualNotes.length === 0 || !Number.isFinite(totalLoopDuration) || !(totalLoopDuration > 0)) {
    return [];
  }

  const trackPeriod = entry.actualNotes.length * entry.quant;
  if (trackPeriod <= 0) {
    return [];
  }

  const delaySeconds = getTrackDelaySeconds(bpm, entry.track);
  const barSeconds = entry.track.numerator * (60 / bpm);
  const paddingBeforeSeconds = entry.track.paddingBefore * barSeconds;
  const repeatPeriod = getTrackRepeatDurationSeconds(bpm, entry);
  const warpAmount = entry.track.timeWarpEnabled ? entry.track.timeWarpAmount / 100 : 0;
  const warpEnabled = entry.track.timeWarpEnabled && warpAmount > 0;
  const warpResolution = resolveTimeWarpFunction(entry.track.timeWarpCurve, entry.track.timeWarpExpression);
  const warpChunks = entry.track.timeWarpEnabled ? Math.max(1, Math.floor(entry.track.timeWarpRepeats)) : 1;
  const chunkPeriod = trackPeriod / warpChunks;
  const quantizeDivisions = entry.track.timeWarpQuantize > 0
    ? Math.max(1, Math.round((entry.actualNotes.length / warpChunks) * entry.track.timeWarpQuantize))
    : 0;
  if (![entry.quant, trackPeriod, delaySeconds, paddingBeforeSeconds, repeatPeriod, chunkPeriod].every(Number.isFinite)
    || !(chunkPeriod > 0)) {
    return [];
  }
  const events: TrackScheduledEvent[] = [];
  const stepDurations = getStepDurations(entry.actualNotes);
  let order = 0;

  for (let repeat = 0; repeat < entry.track.repeats; repeat += 1) {
    const loopStart = delaySeconds + repeat * repeatPeriod + paddingBeforeSeconds;
    if (!Number.isFinite(loopStart)) {
      continue;
    }
    for (let i = 0; i < entry.actualNotes.length; i += 1) {
      const notes = entry.actualNotes[i];
      if (notes.length === 0) {
        continue;
      }

      const durSteps = stepDurations[i];
      const baseDuration = ((durSteps * entry.track.lengthFactor) / 100.0 + entry.track.lengthOffset) * entry.quant;
      if (!Number.isFinite(baseDuration)) {
        continue;
      }
      const localTime = i * entry.quant;
      const chunkIndex = Math.min(warpChunks - 1, Math.floor(localTime / chunkPeriod));
      const chunkStart = loopStart + chunkIndex * chunkPeriod;
      let eventTime = loopStart + localTime;
      let duration = baseDuration;

      if (warpEnabled) {
        const startNormalized = (localTime - chunkIndex * chunkPeriod) / chunkPeriod;
        const endNormalized = Math.min(1, startNormalized + (baseDuration / chunkPeriod));
        let warpedStart = warpNormalizedTime(startNormalized, warpResolution.fn, warpAmount);
        let warpedEnd = warpNormalizedTime(endNormalized, warpResolution.fn, warpAmount);

        if (quantizeDivisions > 0) {
          warpedStart = quantizeNormalizedTime(warpedStart, quantizeDivisions);
          warpedEnd = quantizeNormalizedTime(warpedEnd, quantizeDivisions);
        }

        eventTime = chunkStart + warpedStart * chunkPeriod;
        if (entry.track.timeWarpNoteLengths) {
          duration = Math.max(0.0005, Math.abs(warpedEnd - warpedStart) * chunkPeriod);
        }
      }

      if (!Number.isFinite(eventTime) || !Number.isFinite(duration)
        || eventTime < 0 || eventTime >= totalLoopDuration || duration <= 0) {
        continue;
      }

      const gated = gateEventByActivation({
        time: eventTime,
        duration,
        trackIndex,
        loopDuration: totalLoopDuration,
        masks: activationMasks,
      });
      if (!gated || !Number.isFinite(gated.time) || !Number.isFinite(gated.duration)
        || gated.time < 0 || gated.duration <= 0) {
        continue;
      }

      events.push({
        time: gated.time,
        duration: gated.duration,
        velocity: Math.min(1, 0.5 * Math.sqrt(1.0 / notes.length) * entry.track.velocityMultiplier),
        notes,
        noteVelocities: entry.noteVelocities?.[i]?.map((velocity) => Math.min(1, velocity * entry.track.velocityMultiplier)),
        drumVoiceIds: entry.drumVoiceIds?.[i],
        order,
      });
      order += 1;
    }
  }

  if (warpEnabled) {
    events.sort((left, right) => (left.time === right.time ? left.order - right.order : left.time - right.time));
  }

  return events;
}

function normalizeTonewheelDrawbars(value: unknown): number[] {
  const raw = Array.isArray(value) ? value : [];
  return DEFAULT_TONEWHEEL_DRAWBARS.map((fallback, index) => {
    const drawbar = raw[index];
    return typeof drawbar === 'number' && Number.isFinite(drawbar) ? clamp(drawbar, 0, 8) : fallback;
  });
}

function normalizeTracks(options: GenerateOptions): NormalizedTrack[] {
  const fallbackTrack: NormalizedTrack = {
    name: 'Track 1',
    trackKind: 'melodic',
    drumLanes: [],
    drumVelocityBits: 1,
    numerator: clamp(options.numerator ?? 4, 1, 16),
    denominator: clamp(options.denominator ?? 5, 1, 16),
    waveform: options.waveform ?? 'sine',
    partialGenerator: normalizePartialGenerator(options.partialGenerator),
    breathEnabled: false,
    breathLevel: -18,
    breathHarmonic: 2,
    sequence: options.sequence ?? '1 2 4 8 16',
    octave: clamp(options.octave ?? 6, 0, 10),
    lengthFactor: clamp(options.lengthFactor ?? 100, 0, 400),
    lengthOffset: clamp(options.lengthOffset ?? 0, 0, 64),
    midiChannel: clamp(options.midiChannel ?? 1, 1, 16),
    gain: clamp(options.gain ?? 0, -96, 24),
    limiterGain: Number.isFinite(options.limiterGain) ? clamp(options.limiterGain!, -48, 72) : 0,
    waveshaper: normalizeWaveshaperSettings(options.waveshaper),
    velocityMultiplier: 1,
    delay: clamp(options.delay ?? 0, 0, 64),
    fadeIn: clamp(options.fadeIn ?? 0, 0, 64),
    fadeOut: clamp(options.fadeOut ?? 0, 0, 64),
    paddingBefore: clamp(options.paddingBefore ?? 0, 0, 64),
    paddingAfter: clamp(options.paddingAfter ?? 0, 0, 64),
    repeats: clamp(options.repeats ?? 1, 1, 64),
    timeWarpEnabled: Boolean(options.timeWarpEnabled ?? false),
    timeWarpCurve: normalizeTimeWarpCurve(options.timeWarpCurve),
    timeWarpExpression: typeof options.timeWarpExpression === 'string' ? options.timeWarpExpression.slice(0, 512) : '',
    timeWarpRepeats: clamp(options.timeWarpRepeats ?? 1, 1, 64),
    timeWarpAmount: clamp(options.timeWarpAmount ?? 100, 0, 100),
    timeWarpQuantize: normalizeTimeWarpQuantize(options.timeWarpQuantize, 0),
    timeWarpNoteLengths: Boolean(options.timeWarpNoteLengths ?? true),
    attack: 0.01,
    decay: 0,
    sustain: 1,
    release: 0.12,
    pitchEnvelopeAttack: 0.01,
    pitchEnvelopeDecay: 0.1,
    pitchEnvelopeSustain: 0,
    pitchEnvelopeRelease: 0.2,
    pitchEnvelopeAmount: 0,
    pitchEnvelopeShape: 0,
    polyphony: 8,
    glideTime: 0,
    glideMode: 'legato',
    glideConstantRate: false,
    glideCurve: 'exponential',
    monoLegato: true,
    unisonVoices: 1,
    unisonDetune: 12,
    tonewheelDrawbars: DEFAULT_TONEWHEEL_DRAWBARS.slice(),
    tonewheelWavetable: {
      enabled: false,
      dimensions: [],
      configurations: [],
      lfos: [],
    },
    tremoloEnabled: false,
    tremoloFrequency: 5,
    tremoloDepth: 0.35,
    vibratoEnabled: false,
    vibratoFrequency: 5,
    vibratoDepth: 0.08,
    filterEnabled: false,
    filterType: 'lowpass',
    filterFrequency: 119,
    filterQ: 1,
    filterGain: 0,
    filterKeyFollow: 0,
    filterEnvelopeAttack: 0,
    filterEnvelopeDecay: 0,
    filterEnvelopeSustain: 1,
    filterEnvelopeRelease: 0,
    filterEnvelopeAmount: 0,
    echoEnabled: false,
    echoDelay: '1/4',
    echoFeedback: 0.25,
    echoWet: -12,
    echoPingPong: true,
    reverbWet: -14,
  };

  const incoming = options.tracks;
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return [fallbackTrack];
  }

  return incoming.map((track, index) => ({
    name: track.name?.trim() ? track.name.trim() : `Track ${index + 1}`,
    trackKind: track.trackKind === 'rhythmic' ? 'rhythmic' : 'melodic',
    drumLanes: track.trackKind === 'rhythmic' ? normalizeDrumLanes(track.drumLanes) : [],
    drumVelocityBits: normalizeDrumVelocityBits(track.drumVelocityBits, fallbackTrack.drumVelocityBits),
    numerator: clamp(track.numerator ?? fallbackTrack.numerator, 1, 16),
    denominator: clamp(track.denominator ?? fallbackTrack.denominator, 1, 16),
    waveform: track.waveform ?? fallbackTrack.waveform,
    breathEnabled: Boolean(track.breathEnabled ?? fallbackTrack.breathEnabled),
    breathLevel: clamp(track.breathLevel ?? fallbackTrack.breathLevel, -60, 0),
    breathHarmonic: clamp(track.breathHarmonic ?? fallbackTrack.breathHarmonic, 0.5, 8),
    sequence: track.sequence ?? fallbackTrack.sequence,
    octave: clamp(track.octave ?? fallbackTrack.octave, 0, 10),
    lengthFactor: clamp(track.lengthFactor ?? fallbackTrack.lengthFactor, 0, 400),
    lengthOffset: clamp(track.lengthOffset ?? fallbackTrack.lengthOffset, 0, 64),
    midiChannel: clamp(track.midiChannel ?? (track.trackKind === 'rhythmic' ? 10 : clamp(index + 1, 1, 16)), 1, 16),
    gain: clamp(track.gain ?? fallbackTrack.gain, -96, 24),
    limiterGain: Number.isFinite(track.limiterGain)
      ? clamp(track.limiterGain!, -48, 72) : fallbackTrack.limiterGain,
    waveshaper: normalizeWaveshaperSettings(track.waveshaper ?? fallbackTrack.waveshaper),
    velocityMultiplier: clamp(track.velocityMultiplier ?? fallbackTrack.velocityMultiplier, 0, 4),
    delay: clamp(track.delay ?? fallbackTrack.delay, 0, 64),
    fadeIn: clamp(track.fadeIn ?? fallbackTrack.fadeIn, 0, 64),
    fadeOut: clamp(track.fadeOut ?? fallbackTrack.fadeOut, 0, 64),
    paddingBefore: clamp(track.paddingBefore ?? fallbackTrack.paddingBefore, 0, 64),
    paddingAfter: clamp(track.paddingAfter ?? fallbackTrack.paddingAfter, 0, 64),
    repeats: clamp(track.repeats ?? fallbackTrack.repeats, 1, 64),
    timeWarpEnabled: Boolean(track.timeWarpEnabled ?? fallbackTrack.timeWarpEnabled),
    timeWarpCurve: normalizeTimeWarpCurve(track.timeWarpCurve ?? fallbackTrack.timeWarpCurve),
    timeWarpExpression: typeof track.timeWarpExpression === 'string' ? track.timeWarpExpression.slice(0, 512) : fallbackTrack.timeWarpExpression,
    timeWarpRepeats: clamp(track.timeWarpRepeats ?? fallbackTrack.timeWarpRepeats, 1, 64),
    timeWarpAmount: clamp(track.timeWarpAmount ?? fallbackTrack.timeWarpAmount, 0, 100),
    timeWarpQuantize: normalizeTimeWarpQuantize(track.timeWarpQuantize, fallbackTrack.timeWarpQuantize),
    timeWarpNoteLengths: Boolean(track.timeWarpNoteLengths ?? fallbackTrack.timeWarpNoteLengths),
    attack: clamp(track.attack ?? fallbackTrack.attack, 0, 10),
    decay: clamp(track.decay ?? fallbackTrack.decay, 0, 10),
    sustain: clamp(track.sustain ?? fallbackTrack.sustain, 0, 1),
    release: clamp(track.release ?? fallbackTrack.release, 0, 20),
    pitchEnvelopeAttack: clamp(track.pitchEnvelopeAttack ?? fallbackTrack.pitchEnvelopeAttack, 0, 10),
    pitchEnvelopeDecay: clamp(track.pitchEnvelopeDecay ?? fallbackTrack.pitchEnvelopeDecay, 0, 10),
    pitchEnvelopeSustain: clamp(track.pitchEnvelopeSustain ?? fallbackTrack.pitchEnvelopeSustain, 0, 1),
    pitchEnvelopeRelease: clamp(track.pitchEnvelopeRelease ?? fallbackTrack.pitchEnvelopeRelease, 0, 20),
    pitchEnvelopeAmount: clamp(track.pitchEnvelopeAmount ?? fallbackTrack.pitchEnvelopeAmount, -48, 48),
    pitchEnvelopeShape: normalizePitchEnvelopeShape(track.pitchEnvelopeShape, fallbackTrack.pitchEnvelopeShape),
    polyphony: clamp(track.polyphony ?? fallbackTrack.polyphony, 1, MAX_POLYPHONY),
    glideTime: clamp(track.glideTime ?? fallbackTrack.glideTime, 0, 5),
    glideMode: GLIDE_MODE_OPTIONS.includes(track.glideMode as GlideMode) ? track.glideMode as GlideMode : fallbackTrack.glideMode,
    glideConstantRate: Boolean(track.glideConstantRate ?? fallbackTrack.glideConstantRate),
    glideCurve: GLIDE_CURVE_OPTIONS.includes(track.glideCurve as GlideCurve) ? track.glideCurve as GlideCurve : fallbackTrack.glideCurve,
    monoLegato: Boolean(track.monoLegato ?? fallbackTrack.monoLegato),
    unisonVoices: clamp(track.unisonVoices ?? fallbackTrack.unisonVoices, 1, 8),
    unisonDetune: clamp(track.unisonDetune ?? fallbackTrack.unisonDetune, 0, 100),
    tonewheelDrawbars: normalizeTonewheelDrawbars(track.tonewheelDrawbars),
    partialGenerator: normalizePartialGenerator(track.partialGenerator),
    tonewheelWavetable: track.tonewheelWavetable ?? fallbackTrack.tonewheelWavetable,
    tremoloEnabled: Boolean(track.tremoloEnabled ?? fallbackTrack.tremoloEnabled),
    tremoloFrequency: clamp(track.tremoloFrequency ?? fallbackTrack.tremoloFrequency, 0.01, 40),
    tremoloDepth: clamp(track.tremoloDepth ?? fallbackTrack.tremoloDepth, 0, 1),
    vibratoEnabled: Boolean(track.vibratoEnabled ?? fallbackTrack.vibratoEnabled),
    vibratoFrequency: clamp(track.vibratoFrequency ?? fallbackTrack.vibratoFrequency, 0.01, 40),
    vibratoDepth: clamp(track.vibratoDepth ?? fallbackTrack.vibratoDepth, 0, 1),
    filterEnabled: Boolean(track.filterEnabled ?? fallbackTrack.filterEnabled),
    filterType: track.filterType ?? fallbackTrack.filterType,
    filterFrequency: clamp(track.filterFrequency ?? fallbackTrack.filterFrequency, 0, 127),
    filterQ: clamp(track.filterQ ?? fallbackTrack.filterQ, 0.0001, 30),
    filterGain: clamp(track.filterGain ?? fallbackTrack.filterGain, -48, 48),
    filterKeyFollow: clamp(track.filterKeyFollow ?? fallbackTrack.filterKeyFollow, -200, 200),
    filterEnvelopeAttack: clamp(track.filterEnvelopeAttack ?? fallbackTrack.filterEnvelopeAttack, 0, 10),
    filterEnvelopeDecay: clamp(track.filterEnvelopeDecay ?? fallbackTrack.filterEnvelopeDecay, 0, 10),
    filterEnvelopeSustain: clamp(track.filterEnvelopeSustain ?? fallbackTrack.filterEnvelopeSustain, 0, 1),
    filterEnvelopeRelease: clamp(track.filterEnvelopeRelease ?? fallbackTrack.filterEnvelopeRelease, 0, 20),
    filterEnvelopeAmount: clamp(track.filterEnvelopeAmount ?? fallbackTrack.filterEnvelopeAmount, -127, 127),
    echoEnabled: Boolean(track.echoEnabled ?? fallbackTrack.echoEnabled),
    echoDelay: normalizeEchoDelay(track.echoDelay, fallbackTrack.echoDelay),
    echoFeedback: clamp(track.echoFeedback ?? fallbackTrack.echoFeedback, 0, 0.95),
    echoWet: clamp(track.echoWet ?? fallbackTrack.echoWet, -96, 0),
    echoPingPong: Boolean(track.echoPingPong ?? fallbackTrack.echoPingPong),
    reverbWet: clamp(track.reverbWet ?? fallbackTrack.reverbWet, -96, 0),
  }));
}

function normalizeReverb(options: GenerateOptions): NormalizedReverb {
  const reverb = options.reverb ?? {};
  return {
    enabled: Boolean(reverb.enabled ?? true),
    decay: clamp(reverb.decay ?? 3, 0.1, 30),
    preDelay: clamp(reverb.preDelay ?? 0.02, 0, 1),
    wet: clamp(reverb.wet ?? -7, -96, 0),
    lowCut: clamp(reverb.lowCut ?? 39, 0, 127),
    highCut: clamp(reverb.highCut ?? 119, 0, 127),
  };
}

async function ensurePcs12Initialized(): Promise<void> {
  if (!pcs12Initialized) {
    await PCS12.init();
    pcs12Initialized = true;
  }
}

async function prepareRenderData(options: GenerateOptions): Promise<PreparedRenderData> {
  await ensurePcs12Initialized();

  const bpm = options.bpm ?? 90;
  const a4 = clamp(options.a4 ?? 440, 380, 500);
  const forte = options.forte ?? '5-35.05';
  const tracks = normalizeTracks(options);

  const pitchClassSet = PCS12.parseForte(forte);
  if (!pitchClassSet) {
    throw new Error(`Invalid Forte number: ${forte}`);
  }

  const pitches: number[] = pitchClassSet.asSequence() || [];
  const scale: number[] = [];

  for (const n of pitches) {
    for (let i = 0; i <= 10; i += 1) {
      const t = n + 12 * i;
      if (t < 128) {
        scale.push(t);
      }
    }
  }
  scale.sort((a, b) => a - b);

  const pitchClassCount: number = pitchClassSet.getK() ?? 0;
  const trackData: TrackRenderData[] = tracks.map((track) => {
    if (track.trackKind === 'rhythmic') {
      const rhythmSteps = decodeRhythmSequence(track.sequence, track.drumLanes, track.drumVelocityBits);
      return {
        track,
        quant: 60.0 / (bpm * track.denominator),
        actualNotes: rhythmSteps.map((step) => step.map((hit) => hit.midi)),
        noteVelocities: rhythmSteps.map((step) => step.map((hit) => hit.velocity)),
        drumVoiceIds: rhythmSteps.map((step) => step.map((hit) => hit.voiceId)),
      };
    }

    const sequence = parseSequence(track.sequence);
    const actualNotes: number[][] = sequence.map((n: number) => {
      const bits = Math.abs(n).toString(2).split('').reverse();
      const sign = Math.sign(n) || 1;
      return scale.filter((_: number, idx: number) => {
        const bitIndex = sign * (idx - track.octave * pitchClassCount);
        return bitIndex >= 0 && bitIndex < bits.length && bits[bitIndex] === '1';
      });
    });

    return {
      track,
      quant: 60.0 / (bpm * track.denominator),
      actualNotes,
    };
  });

  return {
    bpm,
    a4,
    activationMasks: parseBitmaskSequenceInput(options.bitmaskSequenceInput).masks,
    tracks: trackData,
    reverb: normalizeReverb(options),
  };
}

function getAdsrLevel(
  elapsed: number,
  gateDuration: number,
  envelope: { attack: number; decay: number; sustain: number; release: number },
): number {
  let level: number;
  if (envelope.attack > 0 && elapsed < envelope.attack) {
    level = elapsed / envelope.attack;
  } else if (envelope.decay > 0 && elapsed < envelope.attack + envelope.decay) {
    level = 1 - ((elapsed - envelope.attack) / envelope.decay) * (1 - envelope.sustain);
  } else {
    level = envelope.sustain;
  }
  if (elapsed > gateDuration) {
    const releaseProgress = (elapsed - gateDuration) / Math.max(envelope.release, 0.001);
    level *= Math.max(0, 1 - releaseProgress);
  }
  return clamp(level, 0, 1);
}

interface BreathRenderState {
  seed: number;
  pink: [number, number, number];
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

function nextPinkNoise(state: BreathRenderState): number {
  let seed = state.seed;
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  state.seed = seed >>> 0;
  const white = (state.seed / 0xFFFFFFFF) * 2 - 1;
  state.pink[0] = 0.99765 * state.pink[0] + white * 0.099046;
  state.pink[1] = 0.963 * state.pink[1] + white * 0.2965164;
  state.pink[2] = 0.57 * state.pink[2] + white * 1.0526913;
  return clamp((state.pink[0] + state.pink[1] + state.pink[2] + white * 0.1848) * 0.11, -1, 1);
}

function renderBreathNoise(
  left: Float32Array,
  right: Float32Array,
  startFrame: number,
  endFrame: number,
  sampleRate: number,
  duration: number,
  track: NormalizedTrack,
  notes: number[],
  a4: number,
  seed: number,
): void {
  const meanFrequency = notes.reduce((sum, note) => sum + midiToFrequency(note, a4), 0) / notes.length;
  const centerFrequency = clamp(meanFrequency * track.breathHarmonic, 20, sampleRate * 0.45);
  const omega = 2 * Math.PI * centerFrequency / sampleRate;
  const alpha = Math.sin(omega) / (2 * BREATH_FILTER_Q);
  const denominator = 1 + alpha;
  const b0 = alpha / denominator;
  const b2 = -b0;
  const a1 = -2 * Math.cos(omega) / denominator;
  const a2 = (1 - alpha) / denominator;
  const state: BreathRenderState = {
    seed: (seed >>> 0) || 1,
    pink: [0, 0, 0],
    x1: 0,
    x2: 0,
    y1: 0,
    y2: 0,
  };
  const gain = dbToGain(track.breathLevel) * Math.SQRT1_2;

  for (let frame = startFrame; frame < endFrame; frame += 1) {
    const elapsed = (frame - startFrame) / sampleRate;
    const input = nextPinkNoise(state);
    const filtered = b0 * input + b2 * state.x2 - a1 * state.y1 - a2 * state.y2;
    state.x2 = state.x1;
    state.x1 = input;
    state.y2 = state.y1;
    state.y1 = filtered;
    const sample = filtered * gain * getAdsrLevel(elapsed, duration, track);
    left[frame] += sample;
    right[frame] += sample;
  }
}

function getRenderTrailSeconds(prepared: PreparedRenderData): number {
  const releaseTrail = Math.max(
    0,
    ...prepared.tracks.map((entry) => Math.max(
      entry.track.release,
      entry.track.pitchEnvelopeRelease,
    )),
  );
  const echoTrail = Math.max(
    0,
    ...prepared.tracks.map((entry) => entry.track.echoEnabled ? getEchoDelaySeconds(prepared.bpm, entry.track.echoDelay) * (1 + entry.track.echoFeedback * 8) : 0),
  );
  const hasReverbSend = prepared.reverb.enabled
    && prepared.reverb.wet > -96
    && prepared.tracks.some((entry) => entry.track.reverbWet > -96);
  const reverbTrail = hasReverbSend ? prepared.reverb.preDelay + prepared.reverb.decay : 0;
  return Math.max(2, releaseTrail, echoTrail, reverbTrail);
}

function getFilterMidi(track: NormalizedTrack, midiNotes: number[]): number {
  if (!track.filterEnabled || midiNotes.length === 0 || track.filterKeyFollow === 0) {
    return track.filterFrequency;
  }

  const averageMidi = midiNotes.reduce((sum, note) => sum + note, 0) / midiNotes.length;
  return clamp(track.filterFrequency + (averageMidi - 69) * track.filterKeyFollow / 100, 0, 127);
}

function getFilterEnvelopePreReleaseLevel(track: NormalizedTrack, elapsed: number): number {
  if (elapsed < track.filterEnvelopeAttack && track.filterEnvelopeAttack > 0) {
    return elapsed / track.filterEnvelopeAttack;
  }

  const decayElapsed = elapsed - track.filterEnvelopeAttack;
  if (decayElapsed < track.filterEnvelopeDecay && track.filterEnvelopeDecay > 0) {
    return 1 - ((decayElapsed / track.filterEnvelopeDecay) * (1 - track.filterEnvelopeSustain));
  }

  return track.filterEnvelopeSustain;
}

function getFilterEnvelopeLevel(track: NormalizedTrack, elapsed: number, noteDuration: number): number {
  if (!track.filterEnabled || track.filterEnvelopeAmount === 0) {
    return 0;
  }

  const gateDuration = Math.max(0, noteDuration);
  const safeElapsed = Math.max(0, elapsed);
  const preReleaseLevel = getFilterEnvelopePreReleaseLevel(track, Math.min(safeElapsed, gateDuration));
  if (safeElapsed <= gateDuration) {
    return preReleaseLevel;
  }

  if (track.filterEnvelopeRelease <= 0) {
    return 0;
  }

  return preReleaseLevel * Math.max(0, 1 - ((safeElapsed - gateDuration) / track.filterEnvelopeRelease));
}

function midiToFrequency(midi: number, a4 = 440): number {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

function createFilterCutoff(track: NormalizedTrack, midiNotes: number[], duration: number, a4: number): (elapsed: number) => number {
  if (!track.filterEnabled) {
    return () => 0;
  }
  const baseMidi = getFilterMidi(track, midiNotes);
  if (track.filterEnvelopeAmount === 0) {
    const frequency = midiToFrequency(clamp(baseMidi, 0, 127), a4);
    return () => frequency;
  }
  return (elapsed) => midiToFrequency(clamp(
    baseMidi + track.filterEnvelopeAmount * getFilterEnvelopeLevel(track, elapsed, duration),
    0,
    127,
  ), a4);
}

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

function findNextHitTime(times: readonly number[] | undefined, after: number): number | undefined {
  if (!times) {
    return undefined;
  }
  let low = 0;
  let high = times.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (times[middle] <= after) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return times[low];
}

function createSimpleFilter(track: NormalizedTrack, sampleRate: number): (sample: number, cutoff: number) => number {
  if (!track.filterEnabled) {
    return (sample) => sample;
  }

  const quality = clamp(Number.isFinite(track.filterQ) ? track.filterQ : 1, 0.0001, 30);
  const amplitude = Math.pow(10, clamp(Number.isFinite(track.filterGain) ? track.filterGain : 0, -48, 48) / 40);
  let input1 = 0;
  let input2 = 0;
  let output1 = 0;
  let output2 = 0;
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let a1 = 0;
  let a2 = 0;
  let previousCutoff = Number.NaN;
  return (sample, cutoff) => {
    const frequency = clamp(Number.isFinite(cutoff) ? cutoff : 20, 20, sampleRate * 0.49);
    if (frequency !== previousCutoff) {
      const omega = 2 * Math.PI * frequency / sampleRate;
      const cosine = Math.cos(omega);
      const sine = Math.sin(omega);
      const alpha = sine / (2 * quality);
      const shelfTerm = Math.sqrt(2 * amplitude) * sine;
      let a0 = 1 + alpha;
      a1 = -2 * cosine;
      a2 = 1 - alpha;
      switch (track.filterType) {
        case 'highpass':
          b0 = (1 + cosine) / 2;
          b1 = -(1 + cosine);
          b2 = b0;
          break;
        case 'bandpass':
          b0 = alpha;
          b1 = 0;
          b2 = -alpha;
          break;
        case 'notch':
          b0 = 1;
          b1 = -2 * cosine;
          b2 = 1;
          break;
        case 'peaking':
          b0 = 1 + alpha * amplitude;
          b1 = -2 * cosine;
          b2 = 1 - alpha * amplitude;
          a0 = 1 + alpha / amplitude;
          a2 = 1 - alpha / amplitude;
          break;
        case 'lowshelf':
          b0 = amplitude * (amplitude + 1 - (amplitude - 1) * cosine + shelfTerm);
          b1 = 2 * amplitude * (amplitude - 1 - (amplitude + 1) * cosine);
          b2 = amplitude * (amplitude + 1 - (amplitude - 1) * cosine - shelfTerm);
          a0 = amplitude + 1 + (amplitude - 1) * cosine + shelfTerm;
          a1 = -2 * (amplitude - 1 + (amplitude + 1) * cosine);
          a2 = amplitude + 1 + (amplitude - 1) * cosine - shelfTerm;
          break;
        case 'highshelf':
          b0 = amplitude * (amplitude + 1 + (amplitude - 1) * cosine + shelfTerm);
          b1 = -2 * amplitude * (amplitude - 1 + (amplitude + 1) * cosine);
          b2 = amplitude * (amplitude + 1 + (amplitude - 1) * cosine - shelfTerm);
          a0 = amplitude + 1 - (amplitude - 1) * cosine + shelfTerm;
          a1 = 2 * (amplitude - 1 - (amplitude + 1) * cosine);
          a2 = amplitude + 1 - (amplitude - 1) * cosine - shelfTerm;
          break;
        case 'allpass':
          b0 = 1 - alpha;
          b1 = -2 * cosine;
          b2 = 1 + alpha;
          break;
        case 'lowpass':
        default:
          b0 = (1 - cosine) / 2;
          b1 = 1 - cosine;
          b2 = b0;
          break;
      }
      b0 /= a0;
      b1 /= a0;
      b2 /= a0;
      a1 /= a0;
      a2 /= a0;
      previousCutoff = frequency;
    }
    const output = b0 * sample + b1 * input1 + b2 * input2 - a1 * output1 - a2 * output2;
    input2 = input1;
    input1 = sample;
    output2 = output1;
    output1 = output;
    return output;
  };
}

function applyFeedbackEcho(left: Float32Array, right: Float32Array, track: NormalizedTrack, sampleRate: number, delaySeconds: number): void {
  if (!track.echoEnabled || track.echoWet <= -96) {
    return;
  }

  const delayFrames = Math.max(1, Math.round(delaySeconds * sampleRate));
  const wetGain = dbToGain(track.echoWet);
  for (let frame = delayFrames; frame < left.length; frame += 1) {
    const echoLeft = (track.echoPingPong ? right[frame - delayFrames] : left[frame - delayFrames]) * track.echoFeedback;
    const echoRight = (track.echoPingPong ? left[frame - delayFrames] : right[frame - delayFrames]) * track.echoFeedback;
    left[frame] += echoLeft * wetGain;
    right[frame] += echoRight * wetGain;
  }
}

function applyDrumEchoReturn(left: Float32Array, right: Float32Array, track: NormalizedTrack, sampleRate: number, delaySeconds: number, returnLeft: Float32Array, returnRight: Float32Array): void {
  const delayFrames = Math.max(1, Math.round(delaySeconds * sampleRate));
  const wetGain = dbToGain(track.echoWet);
  for (let frame = delayFrames; frame < left.length; frame += 1) {
    const echoLeft = track.echoPingPong ? right[frame - delayFrames] : left[frame - delayFrames];
    const echoRight = track.echoPingPong ? left[frame - delayFrames] : right[frame - delayFrames];
    left[frame] += echoLeft * track.echoFeedback;
    right[frame] += echoRight * track.echoFeedback;
    returnLeft[frame] += echoLeft * wetGain;
    returnRight[frame] += echoRight * wetGain;
  }
}

function applyReverbSend(left: Float32Array, right: Float32Array, sendLeft: Float32Array, sendRight: Float32Array, reverb: NormalizedReverb, sampleRate: number): void {
  if (!reverb.enabled || reverb.wet <= -96) {
    return;
  }

  const preDelayFrames = Math.round(reverb.preDelay * sampleRate);
  const decayFrames = Math.max(1, Math.round(reverb.decay * sampleRate));
  const taps = [0.029, 0.037, 0.041, 0.053, 0.071, 0.089, 0.113, 0.137].map((delay, index) => {
    const frames = preDelayFrames + Math.round(delay * sampleRate);
    return {
      frames,
      gain: Math.exp(-frames / decayFrames),
      pan: index % 2 === 0 ? 0.65 : 0.35,
    };
  });
  const wetGain = dbToGain(reverb.wet);
  for (let frame = 0; frame < left.length; frame += 1) {
    let wetLeft = 0;
    let wetRight = 0;
    for (const tap of taps) {
      const sourceFrame = frame - tap.frames;
      if (sourceFrame < 0) {
        continue;
      }

      wetLeft += (sendLeft[sourceFrame] * tap.pan + sendRight[sourceFrame] * (1 - tap.pan)) * tap.gain;
      wetRight += (sendRight[sourceFrame] * tap.pan + sendLeft[sourceFrame] * (1 - tap.pan)) * tap.gain;
    }
    left[frame] += wetLeft * wetGain;
    right[frame] += wetRight * wetGain;
  }
}

/**
 * Generate a MIDI file from the given options.
 * Returns the raw MIDI bytes as a Uint8Array.
 */
export async function generateMidi(options: GenerateOptions): Promise<Uint8Array> {
  const prepared = await prepareRenderData(options);
  const hasNotes = prepared.tracks.some((entry) => entry.actualNotes.some((notes) => notes.length > 0));
  if (!hasNotes) {
    return new Midi().toArray();
  }

  const midi = new Midi();
  midi.header.setTempo(prepared.bpm);
  const totalLoopDuration = getLoopDurationSecondsFromTrackLengths(prepared);

  prepared.tracks.forEach((entry, trackIndex) => {
    const events = buildTrackEvents(
      entry,
      prepared.bpm,
      totalLoopDuration,
      trackIndex,
      prepared.activationMasks,
    );
    if (events.length === 0) {
      return;
    }

    const track = midi.addTrack();
    track.channel = entry.track.midiChannel - 1;
    if (entry.track.trackKind !== 'rhythmic' && isMonophonic(entry.track.polyphony) && entry.track.glideTime > 0) {
      // GM portamento: CC65 switches it on, CC5 is the glide time as a 0-1 fraction of the 5 s range.
      track.addCC({ number: 65, value: 1, time: 0 });
      track.addCC({ number: 5, value: Math.min(1, entry.track.glideTime / 5), time: 0 });
    }

    for (const event of events) {
      const notes = entry.track.trackKind === 'rhythmic'
        ? event.notes
        : limitPolyphony(event.notes, entry.track.polyphony);
      for (let noteIndex = 0; noteIndex < notes.length; noteIndex += 1) {
        const note = notes[noteIndex];
        track.addNote({
          midi: note,
          time: event.time,
          duration: event.duration,
          velocity: event.noteVelocities?.[noteIndex] ?? event.velocity,
        });
      }
    }
  });

  return midi.toArray();
}

export async function renderWavChannels(
  options: GenerateOptions,
  selectedTrackIndex?: number,
): Promise<WavChannelRenderResult> {
  const prepared = await prepareRenderData(options);
  const hasNotes = prepared.tracks.some((entry) => entry.actualNotes.some((notes) => notes.length > 0));
  if (!hasNotes) {
    return {
      left: new Float32Array(1),
      right: new Float32Array(1),
      reverbLeft: null,
      reverbRight: null,
      sampleRate: WAV_EXPORT_SAMPLE_RATE,
      reverb: prepared.reverb,
    };
  }

  const sampleRate = WAV_EXPORT_SAMPLE_RATE;
  const totalDuration = getLoopDurationSecondsFromTrackLengths(prepared);
  const renderDuration = totalDuration + getRenderTrailSeconds(prepared);

  const frameCount = Math.ceil(renderDuration * sampleRate);
  const left = selectedTrackIndex === undefined ? new Float32Array(frameCount) : new Float64Array(frameCount);
  const right = selectedTrackIndex === undefined ? new Float32Array(frameCount) : new Float64Array(frameCount);
  const hasReverbSend = prepared.reverb.enabled
    && prepared.reverb.wet > -96
    && prepared.tracks.some((entry) => entry.track.reverbWet > -96);
  const reverbLeft = hasReverbSend
    ? (selectedTrackIndex === undefined ? new Float32Array(frameCount) : new Float64Array(frameCount))
    : null;
  const reverbRight = hasReverbSend
    ? (selectedTrackIndex === undefined ? new Float32Array(frameCount) : new Float64Array(frameCount))
    : null;

  prepared.tracks.forEach((entry, trackIndex) => {
    if (selectedTrackIndex !== undefined && trackIndex !== selectedTrackIndex) {
      return;
    }
    const events = buildTrackEvents(
      entry,
      prepared.bpm,
      totalDuration,
      trackIndex,
      prepared.activationMasks,
    );
    if (events.length === 0) {
      return;
    }

    const trackLeft = new Float32Array(frameCount);
    const trackRight = new Float32Array(frameCount);
    const isDrumTrack = entry.track.trackKind === 'rhythmic';
    const drumEchoLeft = isDrumTrack && entry.track.echoEnabled && entry.track.echoWet > -96 ? new Float32Array(frameCount) : null;
    const drumEchoRight = drumEchoLeft ? new Float32Array(frameCount) : null;
    const drumReverbLeft = isDrumTrack && hasReverbSend && entry.track.reverbWet > -96 ? new Float32Array(frameCount) : null;
    const drumReverbRight = drumReverbLeft ? new Float32Array(frameCount) : null;
    const staticTonewheel = prepareTonewheel(interpolateTonewheelDrawbars(
      entry.track.tonewheelWavetable,
      entry.track.tonewheelDrawbars,
    ));
    const partialGenerator = normalizePartialGenerator(entry.track.partialGenerator);
    const isNoiseWaveform = entry.track.waveform === 'pink-noise' || entry.track.waveform === 'brown-noise';
    const partialOscillator = !isDrumTrack && !isNoiseWaveform && partialGenerator.type !== 'tonewheel'
      ? preparePartialOscillator(partialGenerator, entry.track.waveform)
      : null;
    const hasTonewheelModulation = partialOscillator === null
      && entry.track.tonewheelWavetable.enabled
      && entry.track.tonewheelWavetable.lfos.some((lfo) => (
        lfo.enabled && lfo.depth !== 0 && lfo.routes.some((route) => route !== 0)
      ));
    const hasPitchEnvelope = entry.track.pitchEnvelopeAmount !== 0;
    const trackGain = dbToGain(entry.track.gain);
    const drumParameters = new Map(entry.track.drumLanes.map((lane) => [lane.voiceId, lane.parameters]));
    const drumXorGroups = new Map(entry.track.drumLanes.map((lane) => [lane.voiceId, lane.xorGroup]));
    const nextGroupHitTimes = new Map<number, number[]>();
    for (const scheduled of events) {
      for (const voiceId of scheduled.drumVoiceIds ?? []) {
        const group = drumXorGroups.get(voiceId) ?? 0;
        if (group === 0) {
          continue;
        }
        const times = nextGroupHitTimes.get(group) ?? [];
        times.push(scheduled.time);
        nextGroupHitTimes.set(group, times);
      }
    }
    const isMonoTrack = entry.track.trackKind !== 'rhythmic' && isMonophonic(entry.track.polyphony);
    const glideState = createMonoGlideState();

    for (const event of events) {
      const start = event.time;
      const duration = event.duration;
      const notes = event.notes;
      const noteAmplitude = event.velocity * 0.12;

      if (entry.track.trackKind === 'rhythmic') {
        const startFrame = Math.max(0, Math.floor(start * sampleRate));
        const noteVelocities = event.noteVelocities ?? notes.map(() => event.velocity);
        for (let noteIndex = 0; noteIndex < notes.length; noteIndex += 1) {
          const voiceId = event.drumVoiceIds?.[noteIndex];
          const parameters = voiceId ? drumParameters.get(voiceId) : undefined;
          if (!voiceId || !parameters) {
            continue;
          }

          const group = drumXorGroups.get(voiceId) ?? 0;
          const laterGroupHit = group === 0
            ? undefined
            : findNextHitTime(nextGroupHitTimes.get(group), start + 1e-9);
          const echoSend = typeof parameters.echoSend === 'number' && parameters.echoSend > -96
            ? dbToGain(parameters.echoSend) : 0;
          const reverbSend = typeof parameters.reverbSend === 'number' && parameters.reverbSend > -96
            ? dbToGain(parameters.reverbSend) : 0;
          renderDrumHitIntoBuffers({
            left: trackLeft,
            right: trackRight,
            startFrame,
            sampleRate,
            duration,
            velocity: noteVelocities[noteIndex] ?? event.velocity,
            voiceId,
            parameters,
            chokeUntil: laterGroupHit === undefined ? undefined : laterGroupHit - start,
            onSample: drumEchoLeft || drumReverbLeft ? (frame, leftSample, rightSample) => {
              if (drumEchoLeft && drumEchoRight) {
                drumEchoLeft[frame] += leftSample * echoSend;
                drumEchoRight[frame] += rightSample * echoSend;
              }
              if (drumReverbLeft && drumReverbRight) {
                drumReverbLeft[frame] += leftSample * reverbSend;
                drumReverbRight[frame] += rightSample * reverbSend;
              }
            } : undefined,
          });
        }
        continue;
      }

      const startFrame = Math.max(0, Math.floor(start * sampleRate));
      const voiceRelease = entry.track.release;
      const endFrame = Math.min(frameCount, Math.ceil((start + duration + voiceRelease) * sampleRate));
      const voicedNotes = limitPolyphony(notes, entry.track.polyphony);
      // High-note priority already picked the winner, so the glide follows a single pitch.
      const glidePlan: GlidePlan | null = isMonoTrack && voicedNotes.length > 0
        ? planMonoGlide(
          glideState,
          midiToFrequency(voicedNotes[0], prepared.a4),
          start,
          start + duration,
          {
            time: entry.track.glideTime,
            mode: entry.track.glideMode,
            constantRate: entry.track.glideConstantRate,
            curve: entry.track.glideCurve,
            legato: entry.track.monoLegato,
          },
        )
        : null;

      for (const midiNote of voicedNotes) {
      const voiceCount = entry.track.unisonVoices;

          for (let voice = 0; voice < voiceCount; voice += 1) {
            const detuneOffset = voiceCount === 1 ? 0 : ((voice / (voiceCount - 1)) - 0.5) * entry.track.unisonDetune;
            const frequency = midiToFrequency(midiNote + detuneOffset / 100, prepared.a4);
            const phaseIncrement = frequency / sampleRate;
            const voicePan = voiceCount === 1 ? 0.5 : voice / (voiceCount - 1);
            const voiceGain = noteAmplitude / Math.sqrt(voiceCount);
            const leftPan = Math.cos(voicePan * Math.PI / 2);
            const rightPan = Math.sin(voicePan * Math.PI / 2);
            let phase = 0;
            let tonewheel = staticTonewheel;
            for (let frame = startFrame; frame < endFrame; frame += 1) {
              const t = (frame - startFrame) / sampleRate;
              if (hasTonewheelModulation && (frame - startFrame) % 64 === 0) {
                tonewheel = prepareTonewheel(interpolateModulatedTonewheelDrawbars(
                  entry.track.tonewheelWavetable,
                  entry.track.tonewheelDrawbars,
                  {
                    timeSeconds: frame / sampleRate,
                    noteStartSeconds: start,
                    bpm: prepared.bpm,
                  },
                ));
              }
              const releaseTime = duration - t;

              let env = 1;
              if (entry.track.attack > 0 && t < entry.track.attack) {
                env = t / entry.track.attack;
              } else if (entry.track.decay > 0) {
                const decayElapsed = t - entry.track.attack;
                if (decayElapsed >= 0 && decayElapsed < entry.track.decay) {
                  env = 1 - ((decayElapsed / entry.track.decay) * (1 - entry.track.sustain));
                } else if (t >= entry.track.attack + entry.track.decay) {
                  env = entry.track.sustain;
                }
              } else if (t >= entry.track.attack) {
                env = entry.track.sustain;
              }
              if (releaseTime < voiceRelease) {
                env = Math.min(env, Math.max(0, (releaseTime + voiceRelease) / Math.max(voiceRelease, 0.001)));
              }
              if (t > duration + voiceRelease) {
                env = 0;
              }

              const vibrato = entry.track.vibratoEnabled
                ? Math.pow(2, Math.sin(2 * Math.PI * entry.track.vibratoFrequency * t) * entry.track.vibratoDepth / 12)
                : 1;
              const pitchEnvelopeRatio = hasPitchEnvelope
                ? Math.pow(
                  2,
                  getPitchEnvelopeMidiOffset(entry.track, getPitchEnvelopeLevel(entry.track, t, duration)) / 12,
                )
                : 1;
              const oscillatorSample = partialOscillator
                ? partialOscillator(phase, frequency * vibrato * pitchEnvelopeRatio * (
                  glidePlan && glidePlan.seconds > 0 ? getGlideFrequency(glidePlan, t) / glidePlan.toFrequency : 1
                ), sampleRate)
                : sampleTonewheel(phase, entry.track.waveform, tonewheel);
              const sample = oscillatorSample * voiceGain * env;
              trackLeft[frame] += sample * leftPan;
              trackRight[frame] += sample * rightPan;

              phase += phaseIncrement * vibrato * pitchEnvelopeRatio * (
                glidePlan && glidePlan.seconds > 0 ? getGlideFrequency(glidePlan, t) / glidePlan.toFrequency : 1
              );
              if (phase >= 1) {
                phase -= Math.floor(phase);
              }
            }
          }
        }
        if (entry.track.breathEnabled && voicedNotes.length > 0) {
          renderBreathNoise(
            trackLeft,
            trackRight,
            startFrame,
            endFrame,
            sampleRate,
            duration,
            entry.track,
            voicedNotes,
            prepared.a4,
            0x9E3779B9 ^ event.order ^ (trackIndex << 12),
          );
        }
    }

    const echoDelaySeconds = getEchoDelaySeconds(prepared.bpm, entry.track.echoDelay);
    if (drumEchoLeft && drumEchoRight) {
      applyDrumEchoReturn(drumEchoLeft, drumEchoRight, entry.track, sampleRate, echoDelaySeconds, trackLeft, trackRight);
    }
    const shapeLeft = createWaveshaperProcessor(entry.track.waveshaper, sampleRate);
    const shapeRight = createWaveshaperProcessor(entry.track.waveshaper, sampleRate);
    const limiterGain = dbToGain(entry.track.limiterGain);
    for (let frame = 0; frame < frameCount; frame += 1) {
      const elapsed = frame / sampleRate;
      const tremolo = entry.track.tremoloEnabled
        ? 1 - entry.track.tremoloDepth * (0.5 + 0.5 * Math.sin(2 * Math.PI * entry.track.tremoloFrequency * elapsed))
        : 1;
      trackLeft[frame] = Math.fround(lookupTransferCurve(TANH_CURVE, Math.fround(shapeLeft(trackLeft[frame]) * limiterGain))) * trackGain * tremolo;
      trackRight[frame] = Math.fround(lookupTransferCurve(TANH_CURVE, Math.fround(shapeRight(trackRight[frame]) * limiterGain))) * trackGain * tremolo;
    }
    if (!isDrumTrack) applyFeedbackEcho(trackLeft, trackRight, entry.track, sampleRate, echoDelaySeconds);
    const filterLeft = createSimpleFilter(entry.track, sampleRate);
    const filterRight = createSimpleFilter(entry.track, sampleRate);
    const filterEvents = events.slice().sort((left, right) => left.time - right.time || left.order - right.order);
    let filterEventIndex = 0;
    let filterStart = 0;
    let filterCutoff = createFilterCutoff(entry.track, [], 0, prepared.a4);
    const barSeconds = entry.track.numerator * (60 / prepared.bpm);
    const trackStartSeconds = getTrackDelaySeconds(prepared.bpm, entry.track);
    const activeDurationSeconds = entry.track.repeats * getTrackRepeatDurationSeconds(prepared.bpm, entry);
    const fadeInSeconds = entry.track.fadeIn * barSeconds;
    const fadeOutSeconds = entry.track.fadeOut * barSeconds;
    const hasTrackFade = fadeInSeconds > 0 || fadeOutSeconds > 0;
    const sendWet = hasReverbSend ? dbToGain(entry.track.reverbWet) : 0;
    for (let frame = 0; frame < frameCount; frame += 1) {
      const time = frame / sampleRate;
      while (filterEventIndex < filterEvents.length && filterEvents[filterEventIndex].time <= time) {
        const event = filterEvents[filterEventIndex++];
        filterStart = event.time;
        filterCutoff = createFilterCutoff(entry.track,
          entry.track.trackKind === 'rhythmic' ? event.notes : limitPolyphony(event.notes, entry.track.polyphony),
          event.duration, prepared.a4);
      }
      const cutoff = filterCutoff(time - filterStart);
      const fadeGain = hasTrackFade
        ? getTrackFadeGain(
          frame / sampleRate - trackStartSeconds,
          activeDurationSeconds,
          fadeInSeconds,
          fadeOutSeconds,
        )
        : 1;
      const trackLeftSample = filterLeft(trackLeft[frame], cutoff) * fadeGain;
      const trackRightSample = filterRight(trackRight[frame], cutoff) * fadeGain;
      left[frame] += trackLeftSample;
      right[frame] += trackRightSample;
      if (reverbLeft && reverbRight && sendWet > 0) {
        reverbLeft[frame] += (isDrumTrack ? (drumReverbLeft?.[frame] ?? 0) * trackGain * fadeGain : trackLeftSample) * sendWet;
        reverbRight[frame] += (isDrumTrack ? (drumReverbRight?.[frame] ?? 0) * trackGain * fadeGain : trackRightSample) * sendWet;
      }
    }
  });

  return { left, right, reverbLeft, reverbRight, sampleRate, reverb: prepared.reverb };
}

async function combineWavChannelRenders(
  results: AsyncIterable<WavChannelRenderResult> | Iterable<WavChannelRenderResult>,
): Promise<{ channels: Float32Array[]; sampleRate: number }> {
  let mix: WavChannelRenderResult | undefined;
  for await (const result of results) {
    if (!mix) {
      mix = {
        ...result,
        left: result.left instanceof Float32Array ? result.left : new Float32Array(result.left),
        right: result.right instanceof Float32Array ? result.right : new Float32Array(result.right),
        reverbLeft: result.reverbLeft ? new Float32Array(result.reverbLeft) : null,
        reverbRight: result.reverbRight ? new Float32Array(result.reverbRight) : null,
      };
      continue;
    }
    if (result.reverbLeft && result.reverbRight && !mix.reverbLeft) {
      mix.reverbLeft = new Float32Array(mix.left.length);
      mix.reverbRight = new Float32Array(mix.left.length);
    }
    for (let frame = 0; frame < mix.left.length; frame += 1) {
      mix.left[frame] += result.left[frame];
      mix.right[frame] += result.right[frame];
      if (mix.reverbLeft && mix.reverbRight && result.reverbLeft && result.reverbRight) {
        mix.reverbLeft[frame] += result.reverbLeft[frame];
        mix.reverbRight[frame] += result.reverbRight[frame];
      }
    }
  }

  if (!mix) {
    return { channels: [new Float32Array(1), new Float32Array(1)], sampleRate: WAV_EXPORT_SAMPLE_RATE };
  }
  const left = mix.left as Float32Array;
  const right = mix.right as Float32Array;
  if (mix.reverbLeft && mix.reverbRight) {
    applyReverbSend(left, right, mix.reverbLeft as Float32Array, mix.reverbRight as Float32Array, mix.reverb, mix.sampleRate);
  }
  return { channels: [left, right], sampleRate: mix.sampleRate };
}

/**
 * Render a WAV file from the given options.
 * Returns raw WAV bytes as a Uint8Array.
 */
export async function generateWav(
  options: GenerateOptions,
  renderOptions: WavRenderOptions = {},
): Promise<Uint8Array> {
  const renderStarted = performance.now();
  const trackCount = Array.isArray(options.tracks) && options.tracks.length > 0 ? options.tracks.length : 1;
  let rendered: { channels: Float32Array[]; sampleRate: number };
  if (trackCount === 1) {
    rendered = await combineWavChannelRenders([await renderWavChannels(options)]);
  } else {
    try {
      const { iterateWavChannelRenders } = await import('./renderPool.js');
      rendered = await combineWavChannelRenders(iterateWavChannelRenders(options, trackCount, renderOptions.threads));
    } catch {
      rendered = await combineWavChannelRenders([await renderWavChannels(options)]);
    }
  }
  renderOptions.onTiming?.({ stage: 'render', milliseconds: performance.now() - renderStarted });

  const encodeStarted = performance.now();
  const bytes = encodeWavFromChannelsSync(rendered.channels, rendered.sampleRate, { dither: false });
  renderOptions.onTiming?.({ stage: 'encode', milliseconds: performance.now() - encodeStarted });
  return bytes;
}
