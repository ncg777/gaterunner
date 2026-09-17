import { normalizeSynthEngine, type SynthMode, type NoiseEngineSettings, type ChoirEngineSettings } from '../src/audio/synthEngine.js';
import { createNativeEngineSource } from './nativeEngineSource.js';
import ToneMidi from '@tonejs/midi';
const { Midi } = ToneMidi;
import { PCS12 } from 'ultra-mega-enumerator';
import {
  getPitchEnvelopeMidiOffset,
  normalizePitchEnvelopeShape,
} from '../src/audio/pitchEnvelope.js';
import { getTrackFadeGain } from '../src/audio/trackFade.js';
import { createWaveshaperProcessor, lookupTransferCurve, TANH_CURVE } from '../src/audio/trackDistortion.js';
import { applyMasterClip } from '../src/audio/masterClip.js';
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
import { getEffectiveWaveform, normalizePartialGenerator, normalizeTrackPartialGenerator, type PartialGenerator } from '../src/audio/partialGenerator.js';
import { CHOIR_FORMANT_BANDS, getChoirFormantBandGainLinear } from '../src/audio/choir.js';
import {
  getModulatedPartialWavetablePosition,
  getPartialWavetableWeights,
  resolvePartialSourceSpectrum,
  resolvePartialWavetableConfigurationSource,
} from '../src/audio/partialWavetable.js';
import { preparePartialOscillator, preparePartialSpectrumOscillator, prepareModulatedSpectrumOscillator } from './partialOscillator.js';
import { normalizeNativeEffectSettings, applyNativeTrackEffects, applyNativeEcho, type NativeEffectSettings } from './nativeTrackEffects.js';
import { createSkewLfoState, getLfoFrequencyHz, sampleLfoAtTime } from '../src/audio/lfo.js';
import { createPinkNoiseImpulseChannels } from '../src/audio/reverbImpulse.js';
import { convolveInto } from './convolution.js';
import { planNativeVoices } from './nativeVoices.js';
import { sampleAmplitudeEnvelope, createNativePitchEnvelope, nativeUnisonGain } from './nativeEnvelope.js';
import { getPartialSpectrumGain } from '../src/audio/partialSpectrumGain.js';
import { createStereoFilter } from './biquad.js';
import { createNativeNoise, nativeKickCycles } from './nativeDrumVoice.js';
import { NativeEnvelopeAutomation, prepareNativeMonoEnvelopes } from './nativeEnvelopeAutomation.js';

export interface GenerateTrackOptions extends Partial<NativeEffectSettings> {
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
  synthMode?: SynthMode;
  noiseEngine?: NoiseEngineSettings;
  choirEngine?: ChoirEngineSettings;
  waveform?: string;
  /** Independent partial source; defaults to sine tonewheels, except legacy noise selects waveform. */
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
  /** Nine Hammond-style drawbar levels (0-8) used only by the tonewheel source. */
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
  /** Dry (unprocessed) level in dB (-96 to 12). */
  dry?: number;
  /** Reverb level in dB (-96 to 0). */
  wet?: number;
  /** Reverb high-pass cutoff as a MIDI note pitch (0-127). */
  lowCut?: number;
  /** Reverb low-pass cutoff as a MIDI note pitch (0-127). */
  highCut?: number;
}

export interface GenerateOptions extends Partial<NativeEffectSettings> {
  synthMode?: SynthMode;
  noiseEngine?: NoiseEngineSettings;
  choirEngine?: ChoirEngineSettings;
  /** Tempo in beats per minute (1-499). Default: 90 */
  bpm?: number;
  /** Concert pitch frequency of A4 in Hz (380-500). Default: 440 */
  a4?: number;
  /** Output trim in dB (-96 to 12) applied to the whole mix before the master soft clipper. Default: 0 */
  masterGain?: number;
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
  /** Waveform-source selection used when tracks is omitted. Legacy noise selects that source automatically. */
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
  a4: number;
  masterGain: number;
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
  masterGain: number;
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
  return track.delay * track.numerator * (60 / bpm) + track.phase * (60 / (bpm * track.denominator));
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
    ...normalizeSynthEngine(options),
    ...normalizeNativeEffectSettings(options),
    name: 'Track 1',
    trackKind: 'melodic',
    drumLanes: [],
    drumVelocityBits: 1,
    numerator: clamp(options.numerator ?? 4, 1, 16),
    denominator: clamp(options.denominator ?? 5, 1, 16),
    waveform: options.waveform ?? 'sine',
    partialGenerator: normalizeTrackPartialGenerator(options.partialGenerator, options.waveform ?? 'sine'),
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
    ...normalizeNativeEffectSettings(track),
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
    ...normalizeSynthEngine({ ...track, synthMode: track.synthMode ?? options.synthMode, noiseEngine: track.noiseEngine ?? options.noiseEngine, choirEngine: track.choirEngine ?? options.choirEngine, waveform: track.waveform ?? fallbackTrack.waveform, partialGenerator: track.partialGenerator ?? options.partialGenerator }),
    partialGenerator: normalizeTrackPartialGenerator(track.partialGenerator ?? options.partialGenerator, track.waveform ?? fallbackTrack.waveform),
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
    dry: clamp(reverb.dry ?? 0, -96, 12),
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
    masterGain: clamp(options.masterGain ?? 0, -96, 12),
    activationMasks: parseBitmaskSequenceInput(options.bitmaskSequenceInput).masks,
    tracks: trackData,
    reverb: normalizeReverb(options),
  };
}

function createChoirProcessor(waveform: string, sampleRate: number): (input: number) => number {
  if (waveform !== 'choir-ah' && waveform !== 'choir-oh') return input => input;
  const filters = CHOIR_FORMANT_BANDS[waveform].map(band => {
    const omega = 2 * Math.PI * Math.min(band.frequency, sampleRate * 0.45) / sampleRate;
    const alpha = Math.sin(omega) / (2 * Math.max(0.5, band.frequency / Math.max(20, band.bandwidth)));
    const b0 = alpha / (1 + alpha);
    const a1 = -2 * Math.cos(omega) / (1 + alpha);
    const a2 = (1 - alpha) / (1 + alpha);
    const gain = getChoirFormantBandGainLinear(band.gainDb);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    return (input: number) => {
      const output = b0 * (input - x2) - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = input;
      y2 = y1;
      y1 = output;
      return output * gain;
    };
  });
  return input => filters.reduce((sum, filter) => sum + filter(input), 0);
}

function renderBreathNoise(left: Float32Array, right: Float32Array, sampleRate: number,
  track: NormalizedTrack, events: readonly TrackScheduledEvent[], a4: number, seed: number): void {
  // The browser owns one NoiseSynth and one filter per track, even on polyphonic tracks.
  const filters = createStereoFilter({ filterEnabled: true, filterType: 'bandpass', filterQ: BREATH_FILTER_Q,
    filterGain: 0, filterRolloff: -12 }, sampleRate);
  let noiseLeft = createNativeNoise('pink', seed), noiseRight = createNativeNoise('pink', seed ^ 0x7f4a7c15);
  const amplitude = new NativeEnvelopeAutomation(track, 'amplitude', sampleRate);
  for (const event of events) {
    if (!event.notes.length) continue;
    amplitude.attack(event.time, event.velocity);
    amplitude.release(event.time + event.duration);
  }
  let centerFrequency = 1000, eventIndex = 0;
  const gain = dbToGain(track.breathLevel);
  for (let frame = 0; frame < left.length; frame++) {
    const time = frame / sampleRate;
    while (eventIndex < events.length && Math.floor(events[eventIndex].time * sampleRate) <= frame) {
      const event = events[eventIndex++];
      if (!event.notes.length) continue;
      const meanFrequency = event.notes.reduce((sum, note) => sum + midiToFrequency(note, a4), 0) / event.notes.length / 2;
      centerFrequency = clamp(meanFrequency * track.breathHarmonic, 20, sampleRate * 0.45);
      noiseLeft = createNativeNoise('pink', seed ^ event.order);
      noiseRight = createNativeNoise('pink', seed ^ event.order ^ 0x7f4a7c15);
    }
    const level = amplitude.sample(time);
    left[frame] += filters[0](level > 0 ? noiseLeft() * level : 0, centerFrequency) * gain;
    right[frame] += filters[1](level > 0 ? noiseRight() * level : 0, centerFrequency) * gain;
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

function midiToFrequency(midi: number, a4 = 440): number {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

function createFilterCutoff(track: NormalizedTrack, midiNotes: number[], duration: number, a4: number, start = 0, bpm = 120,
  noteStarts: readonly number[] = []): (elapsed: number) => number {
  if (!track.filterEnabled) {
    return () => 0;
  }
  const baseMidi = getFilterMidi(track, midiNotes);
  const base = midiToFrequency(baseMidi, a4);
  const modulate = (cutoff: (elapsed: number) => number): ((elapsed: number) => number) => {
    if (!track.filterLfoEnabled || track.filterLfoAmount === 0) return cutoff;
    const state = createSkewLfoState();
    const frequencyHz = getLfoFrequencyHz({ sync: track.filterLfoSync,
      rateHz: track.filterLfoRateHz, syncRate: track.filterLfoRate, bpm });
    const minimumFrequency = midiToFrequency(0, a4);
    const maximumFrequency = midiToFrequency(127, a4);
    let noteIndex = 0;
    return elapsed => {
      const frequency = cutoff(elapsed);
      const time = start + Math.max(0, elapsed);
      while (noteIndex + 1 < noteStarts.length && noteStarts[noteIndex + 1]! <= time) noteIndex += 1;
      // Native songs begin at zero; every active voice shares the latest track event.
      const localTime = track.filterLfoRetrigger === 'note'
        ? Math.max(0, time - (noteStarts[noteIndex] ?? start)) : time;
      const offset = sampleLfoAtTime(state, localTime, frequencyHz,
        track.filterLfoWaveform, track.filterLfoInitPhase) * track.filterLfoAmount;
      return clamp(frequency * Math.pow(2, offset / 12), minimumFrequency, maximumFrequency);
    };
  };
  if (track.filterEnvelopeAmount === 0) return modulate(() => base);
  const peak = midiToFrequency(clamp(baseMidi + track.filterEnvelopeAmount, 0, 127), a4);
  const sustain = midiToFrequency(clamp(baseMidi + track.filterEnvelopeAmount * track.filterEnvelopeSustain, 0, 127), a4);
  const minimum = track.trackKind === 'rhythmic' ? 0.005 : 1 / WAV_EXPORT_SAMPLE_RATE;
  const attack = Math.max(minimum, track.filterEnvelopeAttack);
  const decay = Math.max(minimum, track.filterEnvelopeDecay);
  const release = Math.max(minimum, track.filterEnvelopeRelease);
  const heldCutoff = (elapsed: number) => elapsed < attack ? base + (peak - base) * elapsed / attack
    : elapsed < attack + decay ? peak + (sustain - peak) * (elapsed - attack) / decay : sustain;
  const gateCutoff = heldCutoff(duration);
  return modulate(elapsed => elapsed <= duration ? heldCutoff(Math.max(0, elapsed))
    : gateCutoff + (base - gateCutoff) * Math.min(1, (elapsed - duration) / release));
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

function createReverbCutFilter(type: 'highpass' | 'lowpass', frequency: number, sampleRate: number): (sample: number) => number {
  const [process] = createStereoFilter({ filterEnabled: true, filterType: type, filterQ: 1, filterGain: 0, filterRolloff: -12 }, sampleRate);
  return sample => process(sample, frequency);
}

function applyReverbSend(left: Float32Array, right: Float32Array, sendLeft: Float32Array, sendRight: Float32Array, reverb: NormalizedReverb, sampleRate: number, a4: number): void {
  if (!reverb.enabled || reverb.wet <= -96) {
    return;
  }

  // Filter the send before convolution, as in the browser reverb bus.
  const lowCut = [
    createReverbCutFilter('highpass', midiToFrequency(reverb.lowCut, a4), sampleRate),
    createReverbCutFilter('highpass', midiToFrequency(reverb.lowCut, a4), sampleRate),
  ];
  const highCut = [
    createReverbCutFilter('lowpass', midiToFrequency(reverb.highCut, a4), sampleRate),
    createReverbCutFilter('lowpass', midiToFrequency(reverb.highCut, a4), sampleRate),
  ];
  for (let frame = 0; frame < sendLeft.length; frame += 1) {
    sendLeft[frame] = highCut[0](lowCut[0](sendLeft[frame]));
    sendRight[frame] = highCut[1](lowCut[1](sendRight[frame]));
  }

  const impulses = createPinkNoiseImpulseChannels(reverb.decay, reverb.preDelay, sampleRate);
  const wetGain = dbToGain(reverb.wet);
  convolveInto(sendLeft, impulses[0], left, wetGain);
  convolveInto(sendRight, impulses[1], right, wetGain);
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
  return renderPreparedWavChannels(await prepareRenderData(options), selectedTrackIndex);
}

/** A worker/session owns an immutable prepared project and reuses it across tracks. */
export async function createWavRenderSession(options: GenerateOptions) {
  const prepared = await prepareRenderData(structuredClone(options));
  const frames = Math.ceil((getLoopDurationSecondsFromTrackLengths(prepared)
    + getRenderTrailSeconds(prepared)) * WAV_EXPORT_SAMPLE_RATE);
  return {
    // Conservative peak: result, track, send and drum echo buffers, plus runtime.
    estimatedTrackBytes: frames * 72 + 64 * 1024 * 1024,
    renderTrack: (index: number) => renderPreparedWavChannels(prepared, index),
  };
}

function renderPreparedWavChannels(
  prepared: PreparedRenderData,
  selectedTrackIndex?: number,
): WavChannelRenderResult {
  const hasNotes = prepared.tracks.some((entry) => entry.actualNotes.some((notes) => notes.length > 0));
  if (!hasNotes) {
    return {
      left: new Float32Array(1),
      right: new Float32Array(1),
      reverbLeft: null,
      reverbRight: null,
      sampleRate: WAV_EXPORT_SAMPLE_RATE,
      a4: prepared.a4,
      masterGain: prepared.masterGain,
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
    && prepared.tracks.some((entry) => entry.track.reverbWet > -96)
    // Preserve the tiny -96 dB contribution when another track enables the bus.
    // Only a track without notes is guaranteed to have an empty send buffer.
    && (selectedTrackIndex === undefined
      || prepared.tracks[selectedTrackIndex]?.actualNotes.some(notes => notes.length > 0));
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
    const filterNoteStarts = events.map(event => event.time).sort((a, b) => a - b);
    const isDrumTrack = entry.track.trackKind === 'rhythmic';
    const drumEchoLeft = isDrumTrack && entry.track.echoEnabled && entry.track.echoWet > -96 ? new Float32Array(frameCount) : null;
    const drumEchoRight = drumEchoLeft ? new Float32Array(frameCount) : null;
    const drumReverbLeft = isDrumTrack && hasReverbSend && entry.track.reverbWet > -96 ? new Float32Array(frameCount) : null;
    const drumReverbRight = drumReverbLeft ? new Float32Array(frameCount) : null;
    const engine = normalizeSynthEngine(entry.track);
    const isAdditive = engine.synthMode === 'additive';
    const monoEngineSources = new Map<number, ReturnType<typeof createNativeEngineSource>>();
    const partialGenerator = normalizePartialGenerator(entry.track.partialGenerator);
    const fallbackSource = {
      partialGenerator,
      waveform: entry.track.waveform,
      tonewheelDrawbars: entry.track.tonewheelDrawbars,
    };
    const hasGenericWavetable = isAdditive && entry.track.tonewheelWavetable.enabled
      && entry.track.tonewheelWavetable.configurations.some((configuration) => configuration.source);
    const genericWavetableOscillators = hasGenericWavetable
      ? entry.track.tonewheelWavetable.configurations.map((configuration) => {
        const source = resolvePartialWavetableConfigurationSource(configuration, fallbackSource);
        return preparePartialSpectrumOscillator(resolvePartialSourceSpectrum(source), JSON.stringify(source));
      })
      : [];
    const staticWavetableWeights = hasGenericWavetable
      ? getPartialWavetableWeights(entry.track.tonewheelWavetable)
      : [];
    const staticTonewheelDrawbars = partialGenerator.type === 'tonewheel' && !hasGenericWavetable
      ? interpolateTonewheelDrawbars(entry.track.tonewheelWavetable, entry.track.tonewheelDrawbars)
      : [];
    const prepareTonewheelSpectrumOscillator = (drawbars: number[], modulated = false) => {
      const spectrum = resolvePartialSourceSpectrum({
        partialGenerator: { type: 'tonewheel' }, waveform: 'sine', tonewheelDrawbars: drawbars,
      });
      const oscillator = (modulated ? prepareModulatedSpectrumOscillator : preparePartialSpectrumOscillator)(
        spectrum, 'tonewheel|' + drawbars.join(','));
      const peak = getPartialSpectrumGain(spectrum);
      return (phase: number, frequency = 0, rate = sampleRate) => peak > 0 ? oscillator(phase, frequency, rate) / peak : 0;
    };
    const staticTonewheelOscillator = partialGenerator.type === 'tonewheel' && !hasGenericWavetable
      ? prepareTonewheelSpectrumOscillator(staticTonewheelDrawbars)
      : null;
    const waveform = hasGenericWavetable ? 'sine' : getEffectiveWaveform(partialGenerator, entry.track.waveform);
    const partialOscillator = !isDrumTrack && partialGenerator.type !== 'tonewheel' && !hasGenericWavetable
      ? preparePartialOscillator(partialGenerator, waveform)
      : null;
    const hasTonewheelModulation = isAdditive && partialGenerator.type === 'tonewheel' && !hasGenericWavetable
      && entry.track.tonewheelWavetable.enabled
      && entry.track.tonewheelWavetable.lfos.some((lfo) => (
        lfo.enabled && lfo.depth !== 0 && lfo.routes.some((route) => route !== 0)
      ));
    const hasGenericWavetableModulation = hasGenericWavetable
      && entry.track.tonewheelWavetable.lfos.some((lfo) => (
        lfo.enabled && lfo.depth !== 0 && lfo.routes.some((route) => route !== 0)
      ));
    const hasPitchEnvelope = entry.track.pitchEnvelopeAmount !== 0;
    const trackGain = dbToGain(entry.track.gain);
    const drumParameters = new Map(entry.track.drumLanes.map((lane) => [lane.voiceId, lane.parameters]));
    const drumXorGroups = new Map(entry.track.drumLanes.map((lane) => [lane.voiceId, lane.xorGroup]));
    const nextGroupHitTimes = new Map<number, number[]>();
    const nextVoiceHitTimes = new Map<DrumVoiceId, number[]>();
    for (const scheduled of events) {
      for (const voiceId of scheduled.drumVoiceIds ?? []) {
        const voiceTimes = nextVoiceHitTimes.get(voiceId) ?? [];
        voiceTimes.push(scheduled.time);
        nextVoiceHitTimes.set(voiceId, voiceTimes);
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
    const voiceEvents = planNativeVoices(events, entry.track.polyphony, entry.track.monoLegato);
    const monoPhases = new Map<number, number>();
    let monoFrame = 0;
    let monoIncrement = 0;
    const monoEnvelopes = isMonoTrack ? prepareNativeMonoEnvelopes(voiceEvents, entry.track, sampleRate) : null;
    let kickState: { time: number; phase: number } | undefined;

    for (const [eventIndex, event] of events.entries()) {
      const start = event.time;
      const pitchEnvelope = createNativePitchEnvelope(entry.track, start, sampleRate);
      const duration = event.duration;
      const notes = event.notes;
      const noteAmplitude = event.velocity;

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
          let oscillatorPhase: number | undefined;
          if (voiceId === 'kick') {
            oscillatorPhase = kickState ? kickState.phase + nativeKickCycles(start - kickState.time, parameters)
              : start * Number(parameters.tune ?? 55);
            kickState = { time: start, phase: oscillatorPhase % 1 };
          }
          renderDrumHitIntoBuffers({
            left: trackLeft,
            right: trackRight,
            startFrame,
            sampleRate,
            duration,
            velocity: noteVelocities[noteIndex] ?? event.velocity,
            voiceId,
            parameters,
            oscillatorPhase,
            chokeUntil: laterGroupHit === undefined ? undefined : laterGroupHit - start,
            retriggerUntil: (() => {
              const next = findNextHitTime(nextVoiceHitTimes.get(voiceId), start + 1e-6);
              return next === undefined ? undefined : next - start;
            })(),
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
      const voiceEvent = voiceEvents[eventIndex];
      // Timing is shared by every chord/unison voice in this event. Band limits
      // remain per voice when sampling; these caches die at the end of the event.
      const modulatedOscillators = new Map<number, ReturnType<typeof prepareModulatedSpectrumOscillator>>();
      const modulatedWeights = new Map<number, number[]>();
      const voicedNotes = voiceEvent.notes;
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

      for (const [noteIndex, midiNote] of voicedNotes.entries()) {
        const voiceCount = isAdditive ? entry.track.unisonVoices : 1;
        const noteDuration = isMonoTrack ? duration : voiceEvent.noteDurations[noteIndex];
        const voiceEndFrame = Math.min(frameCount, Math.ceil(Math.min(voiceEvent.stopTime,
          start + noteDuration + Math.max(0.005, voiceRelease) + (entry.track.filterEnabled ? 2 : 0)) * sampleRate));

        for (let voice = 0; voice < voiceCount; voice += 1) {
          const detuneOffset = voiceCount === 1 ? 0 : ((voice / (voiceCount - 1)) - 0.5) * entry.track.unisonDetune;
          const frequency = midiToFrequency(midiNote + detuneOffset / 100, prepared.a4);
          const usesHalfFundamentalSpectrum = hasGenericWavetable || partialGenerator.type === 'tonewheel';
          const phaseIncrement = frequency / sampleRate / (usesHalfFundamentalSpectrum ? 2 : 1);
          const voiceGain = (isMonoTrack ? 1 : noteAmplitude) * nativeUnisonGain(voiceCount);
          // Voices start together and diverge at their detuned frequencies.
          // Spreading initial phases evenly cancels harmonics at low/zero detune.
          const initialPhase = 0;
          let phase = isMonoTrack ? ((monoPhases.get(voice) ?? initialPhase) + Math.max(0, startFrame - monoFrame) * monoIncrement) % 1 : initialPhase;
          let tonewheelOscillator = staticTonewheelOscillator;
          let wavetableWeights = staticWavetableWeights;
          const choir = createChoirProcessor(isAdditive ? waveform : 'sine', sampleRate);
          const engineSource = isAdditive ? null : (isMonoTrack ? monoEngineSources.get(voice) : undefined)
            ?? createNativeEngineSource(engine, sampleRate, (trackIndex + 1) * 65537 + startFrame + noteIndex * 97 + voice);
          if (isMonoTrack && engineSource) monoEngineSources.set(voice, engineSource);
          const [voiceFilter] = createStereoFilter(entry.track, sampleRate);
          const voiceCutoff = createFilterCutoff(entry.track, [midiNote], noteDuration, prepared.a4, start, prepared.bpm,
            filterNoteStarts);
          for (let frame = startFrame; frame < voiceEndFrame; frame += 1) {
            const t = (frame - startFrame) / sampleRate;
            if (hasTonewheelModulation && (frame - startFrame) % 64 === 0) {
              tonewheelOscillator = modulatedOscillators.get(frame) ?? prepareTonewheelSpectrumOscillator(
                interpolateModulatedTonewheelDrawbars(
                  entry.track.tonewheelWavetable,
                  entry.track.tonewheelDrawbars,
                  {
                    timeSeconds: frame / sampleRate,
                    noteStartSeconds: start,
                    bpm: prepared.bpm,
                  },
                ), true,
              );
              modulatedOscillators.set(frame, tonewheelOscillator);
            }
            if (hasGenericWavetableModulation && (frame - startFrame) % 64 === 0) {
              wavetableWeights = modulatedWeights.get(frame) ?? getPartialWavetableWeights(
                entry.track.tonewheelWavetable,
                getModulatedPartialWavetablePosition(entry.track.tonewheelWavetable, {
                  timeSeconds: frame / sampleRate,
                  noteStartSeconds: start,
                  bpm: prepared.bpm,
                }),
              );
              modulatedWeights.set(frame, wavetableWeights);
            }
            const env = monoEnvelopes ? monoEnvelopes.amplitude.sample(frame / sampleRate) : sampleAmplitudeEnvelope(t, noteDuration, entry.track);

            const pitchEnvelopeRatio = hasPitchEnvelope
              ? Math.pow(
                2,
                getPitchEnvelopeMidiOffset(entry.track, monoEnvelopes ? monoEnvelopes.pitch.sample(frame / sampleRate)
                  : pitchEnvelope(t, noteDuration)) / 12,
              )
              : 1;
            const glideRatio = glidePlan && glidePlan.seconds > 0
              ? getGlideFrequency(glidePlan, t) / glidePlan.toFrequency : 1;
            const playbackFrequency = frequency * pitchEnvelopeRatio * glideRatio;
            const engineElapsed = (frame / sampleRate) - voiceEvent.envelopeStart;
            const oscillatorSample = engineSource
              ? engineSource(playbackFrequency, engineElapsed, start + noteDuration - voiceEvent.envelopeStart, frame / sampleRate)
              : genericWavetableOscillators.length > 0
              ? genericWavetableOscillators.reduce((sum, oscillator, configurationIndex) => (
                sum + oscillator(phase, playbackFrequency / 2, sampleRate) * (wavetableWeights[configurationIndex] ?? 0)
              ), 0)
              : partialOscillator
                ? partialOscillator(phase, playbackFrequency, sampleRate)
                : tonewheelOscillator?.(phase, playbackFrequency / 2, sampleRate) ?? 0;
            const sample = choir(voiceFilter(oscillatorSample * voiceGain * env, voiceCutoff(t)));
            trackLeft[frame] += sample;
            trackRight[frame] += sample;

            phase += phaseIncrement * pitchEnvelopeRatio * glideRatio;
            if (phase >= 1) {
              phase -= Math.floor(phase);
            }
          }
          if (isMonoTrack) monoPhases.set(voice, phase);
        }
        if (isMonoTrack) monoFrame = voiceEndFrame;
      }
      if (isMonoTrack) {
        monoIncrement = midiToFrequency(voicedNotes[0], prepared.a4) / sampleRate
          / (hasGenericWavetable || partialGenerator.type === 'tonewheel' ? 2 : 1);
      }

    }

    if (!isDrumTrack && isAdditive && entry.track.breathEnabled) {
      renderBreathNoise(trackLeft, trackRight, sampleRate, entry.track, events, prepared.a4,
        0x9e3779b9 ^ (trackIndex << 12));
    }
    const echoDelaySeconds = getEchoDelaySeconds(prepared.bpm, entry.track.echoDelay);
    if (drumEchoLeft && drumEchoRight) {
      applyNativeEcho(drumEchoLeft, drumEchoRight, entry.track, sampleRate, echoDelaySeconds, trackLeft, trackRight);
    }
    const shapeLeft = createWaveshaperProcessor(entry.track.waveshaper, sampleRate);
    const shapeRight = createWaveshaperProcessor(entry.track.waveshaper, sampleRate);
    const limiterGain = dbToGain(entry.track.limiterGain);
    for (let frame = 0; frame < frameCount; frame += 1) {
      trackLeft[frame] = Math.fround(lookupTransferCurve(TANH_CURVE, Math.fround(shapeLeft(trackLeft[frame]) * limiterGain))) * trackGain;
      trackRight[frame] = Math.fround(lookupTransferCurve(TANH_CURVE, Math.fround(shapeRight(trackRight[frame]) * limiterGain))) * trackGain;
    }
    applyNativeTrackEffects(trackLeft, trackRight, entry.track, sampleRate, prepared.bpm, prepared.a4);
    if (!isDrumTrack) applyNativeEcho(trackLeft, trackRight, entry.track, sampleRate, echoDelaySeconds);
    const [filterLeft, filterRight] = createStereoFilter({ ...entry.track, filterEnabled: isDrumTrack && entry.track.filterEnabled }, sampleRate);
    const filterEvents = events.slice().sort((left, right) => left.time - right.time || left.order - right.order);
    let filterEventIndex = 0;
    let filterStart = 0;
    let filterCutoff = createFilterCutoff(entry.track, [], 0, prepared.a4, 0, prepared.bpm);
    const barSeconds = entry.track.numerator * (60 / prepared.bpm);
    const trackStartSeconds = getTrackDelaySeconds(prepared.bpm, entry.track);
    const activeDurationSeconds = entry.track.repeats * getTrackRepeatDurationSeconds(prepared.bpm, entry);
    const fadeInSeconds = entry.track.fadeIn * barSeconds;
    const fadeOutSeconds = entry.track.fadeOut * barSeconds;
    const hasTrackFade = fadeInSeconds > 0 || fadeOutSeconds > 0;
    const sendWet = hasReverbSend ? dbToGain(entry.track.reverbWet) : 0;
    // With no filter or fade, mixing needs no event scheduling, cutoff evaluation
    // or per-channel callbacks. Keep Float32 writes and send summation unchanged.
    if ((!entry.track.filterEnabled || !isDrumTrack) && !hasTrackFade) {
      for (let frame = 0; frame < frameCount; frame += 1) {
        left[frame] += trackLeft[frame];
        right[frame] += trackRight[frame];
        if (reverbLeft && reverbRight && sendWet > 0) {
          reverbLeft[frame] += (isDrumTrack ? (drumReverbLeft?.[frame] ?? 0) * trackGain : trackLeft[frame]) * sendWet;
          reverbRight[frame] += (isDrumTrack ? (drumReverbRight?.[frame] ?? 0) * trackGain : trackRight[frame]) * sendWet;
        }
      }
      return;
    }
    for (let frame = 0; frame < frameCount; frame += 1) {
      const time = frame / sampleRate;
      while (filterEventIndex < filterEvents.length && filterEvents[filterEventIndex].time <= time) {
        const event = filterEvents[filterEventIndex++];
        filterStart = event.time;
        filterCutoff = createFilterCutoff(entry.track,
          entry.track.trackKind === 'rhythmic' ? event.notes : limitPolyphony(event.notes, entry.track.polyphony),
          event.duration, prepared.a4, event.time, prepared.bpm);
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

  return { left, right, reverbLeft, reverbRight, sampleRate, a4: prepared.a4, masterGain: prepared.masterGain, reverb: prepared.reverb };
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
  // Dry trim first, so the wet return keeps the balance the app's reverb controls describe.
  const dryGain = dbToGain(mix.reverb.dry);
  if (dryGain !== 1) {
    for (let frame = 0; frame < left.length; frame += 1) {
      left[frame] *= dryGain;
      right[frame] *= dryGain;
    }
  }
  if (mix.reverbLeft && mix.reverbRight) {
    applyReverbSend(left, right, mix.reverbLeft as Float32Array, mix.reverbRight as Float32Array, mix.reverb, mix.sampleRate, mix.a4);
  }
  // Same master stage as the browser: output trim, then the shared soft-clip curve.
  const masterGain = dbToGain(mix.masterGain);
  for (let frame = 0; frame < left.length; frame += 1) {
    left[frame] = applyMasterClip(left[frame] * masterGain);
    right[frame] = applyMasterClip(right[frame] * masterGain);
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
  const bytes = encodeWavFromChannelsSync(rendered.channels, rendered.sampleRate);
  renderOptions.onTiming?.({ stage: 'encode', milliseconds: performance.now() - encodeStarted });
  return bytes;
}
