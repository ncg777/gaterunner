import {
  cloneWaveshaperSettings,
  normalizeWaveshaperSettings,
  type WaveshaperSettings,
} from './audio/waveshaper.js';
import {
  DEFAULT_PITCH_ENVELOPE_SHAPE,
  normalizePitchEnvelopeShape,
  PITCH_ENVELOPE_SHAPE_MAX,
  PITCH_ENVELOPE_SHAPE_MIN,
} from './audio/pitchEnvelope.js';
import {
  GLIDE_CURVE_OPTIONS,
  GLIDE_MODE_OPTIONS,
  type GlideCurve,
  type GlideMode,
} from './audio/glide.js';
import {
  CUSTOM_TIME_WARP_CURVE,
  DEFAULT_TIME_WARP_CURVE,
  TIME_WARP_CURVE_VALUES,
  TIME_WARP_QUANTIZE_OPTIONS,
} from './audio/timeWarp.js';
import {
  cloneDrumLanes,
  normalizeDrumLanes,
  normalizeDrumVelocityBits,
  type DrumLane,
} from './domain/rhythmTrack.js';
import { normalizeBitmaskSequenceInput } from './trackActivation.js';
import {
  MAX_WAVETABLE_CONFIGURATIONS,
  MAX_WAVETABLE_DIMENSIONS,
  MAX_WAVETABLE_LFOS,
  type TonewheelConfiguration,
  type TonewheelWavetable,
  type TonewheelWavetableDimension,
  type TonewheelWavetableLfo,
} from './audio/tonewheelWavetable.js';
import {
  LFO_FREE_RATE_MAX_HZ,
  LFO_FREE_RATE_MIN_HZ,
  LFO_SYNC_RATE_VALUES,
  LFO_WAVEFORM_VALUES,
  type LfoSyncRateValue,
  type LfoWaveform,
} from './audio/lfo.js';
export type TrackKind = 'melodic' | 'rhythmic';

/** Upper bound for per-track polyphony; 1 switches the track to the monophonic glide engine. */
export const MAX_TRACK_POLYPHONY = 16;

export interface PresetTrackData {
  id: string;
  name: string;
  trackKind: TrackKind;
  drumLanes: DrumLane[];
  drumVelocityBits: number;
  numerator: number;
  denominator: number;
  phase: number;
  waveform: string;
  sequenceInput: string;
  octave: number;
  lengthFactor: number;
  /** Fixed duration added to every note, measured in this track's quantization steps. */
  lengthOffset: number;
  midiChannel: number;
  gain: number;
  velocityMultiplier: number;
  delay: number;
  /** Optional track fade-in duration in bars. 0 disables the fade. */
  fadeIn: number;
  /** Optional track fade-out duration in bars. 0 disables the fade. */
  fadeOut: number;
  /** Silence before the sequence within each repeat, measured in bars. */
  paddingBefore: number;
  /** Silence after the sequence within each repeat, measured in bars. */
  paddingAfter: number;
  repeats: number;
  timeWarpEnabled: boolean;
  timeWarpCurve: string;
  timeWarpExpression: string;
  /** Number of equal chunks the pattern is split into, with the warp curve applied locally to each chunk (1-64). */
  timeWarpRepeats: number;
  /** 0-100 blend between identity and selected warp curve. */
  timeWarpAmount: number;
  /** 0 disables quantization; 1,2,4,8 quantize by per-step subdivisions. */
  timeWarpQuantize: number;
  /** If true, warped end times redefine note durations. */
  timeWarpNoteLengths: boolean;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  /** Pitch envelope attack time in seconds. */
  pitchEnvelopeAttack: number;
  /** Pitch envelope decay time in seconds. */
  pitchEnvelopeDecay: number;
  /** Pitch envelope sustain level (0-1). */
  pitchEnvelopeSustain: number;
  /** Pitch envelope release time in seconds. */
  pitchEnvelopeRelease: number;
  /** Pitch envelope depth in MIDI pitches (can be negative). */
  pitchEnvelopeAmount: number;
  /** Exponential steepness for pitch envelope segments (0 = linear). */
  pitchEnvelopeShape: number;
  /** Maximum simultaneous voices (1-16). 1 makes the track monophonic. */
  polyphony: number;
  /** Glide time in seconds, or seconds per octave when glideConstantRate is set. 0 disables glide. */
  glideTime: number;
  /** 'legato' glides only between overlapping notes; 'always' glides between every note. */
  glideMode: GlideMode;
  /** Constant-rate glide, so wide leaps take proportionally longer than small ones. */
  glideConstantRate: boolean;
  glideCurve: GlideCurve;
  /** True legato: overlapping monophonic notes do not retrigger the envelopes. */
  monoLegato: boolean;
  unisonVoices: number;
  unisonDetune: number;
  tonewheelDrawbars: number[];
  tonewheelWavetable: TonewheelWavetable;
  breathEnabled: boolean;
  breathLevel: number;
  breathHarmonic: number;
  tremoloEnabled: boolean;
  tremoloFrequency: number;
  tremoloDepth: number;
  tremoloSpread: number;
  vibratoEnabled: boolean;
  vibratoFrequency: number;
  vibratoDepth: number;
  filterEnabled: boolean;
  filterType: string;
  filterFrequency: number;
  filterRolloff: number;
  filterQ: number;
  filterGain: number;
  filterKeyFollow: number;
  filterEnvelopeAttack: number;
  filterEnvelopeDecay: number;
  filterEnvelopeSustain: number;
  filterEnvelopeRelease: number;
  filterEnvelopeAmount: number;
  /** When true, an LFO offsets the filter cutoff, sampled at each note start. */
  filterLfoEnabled: boolean;
  /** Tempo-sync the filter LFO to BPM note divisions when true; otherwise use free Hz. */
  filterLfoSync: boolean;
  /** Free-running filter LFO rate in Hz (0.01–20). */
  filterLfoRateHz: number;
  /** Tempo-synced filter LFO rate as a note division (e.g. 1/4, 1/8T). */
  filterLfoRate: ModulationRateValue;
  /** Bipolar filter LFO depth in MIDI pitches applied to the cutoff. */
  filterLfoAmount: number;
  /** Filter LFO shape. */
  filterLfoWaveform: SkewLfoWaveformValue;
  /** Normalized filter LFO start phase in [0, 1). */
  filterLfoInitPhase: number;
  limiterGain: number;
  waveshaper: WaveshaperSettings;
  echoEnabled: boolean;
  echoDelay: EchoDelayValue;
  echoFeedback: number;
  echoWet: number;
  echoPingPong: boolean;
  chorusEnabled: boolean;
  chorusRate: ModulationRateValue;
  chorusDelay: number;
  chorusDepth: number;
  chorusSpread: number;
  chorusFeedback: number;
  chorusWet: number;
  flangerEnabled: boolean;
  flangerRate: ModulationRateValue;
  flangerDelay: number;
  flangerDepth: number;
  flangerFeedback: number;
  flangerWet: number;
  phaserEnabled: boolean;
  phaserRate: ModulationRateValue;
  phaserCenter: number;
  phaserDepth: number;
  phaserStages: number;
  phaserFeedback: number;
  phaserQ: number;
  phaserWet: number;
  reverbWet: number;
}

export type EchoDelayValue = typeof ECHO_DELAY_OPTIONS[number];
export type ModulationRateValue = typeof MODULATION_RATE_OPTIONS[number];
export type SkewLfoWaveformValue = typeof SKEW_LFO_WAVEFORM_OPTIONS[number]['value'];
export { DEFAULT_PITCH_ENVELOPE_SHAPE, PITCH_ENVELOPE_SHAPE_MAX, PITCH_ENVELOPE_SHAPE_MIN };

export const SKEW_LFO_WAVEFORM_OPTIONS = [
  { title: 'Sine', value: 'sine' },
  { title: 'Triangle', value: 'triangle' },
  { title: 'Saw Up', value: 'saw-up' },
  { title: 'Saw Down', value: 'saw-down' },
  { title: 'Square', value: 'square' },
  { title: 'Sample & Hold', value: 'sample-hold' },
] as const;

export const ECHO_DELAY_OPTIONS = [
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

/** Note-division cycle lengths for tempo-synced LFOs, from very slow sweeps to fast warble. */
export const MODULATION_RATE_OPTIONS = [
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
] as const;

/** Classic phaser pedals use an even number of first-order allpass poles. */
export const PHASER_STAGE_OPTIONS = [2, 4, 6, 8, 10, 12] as const;
export const PHASER_MAX_SWEEP_OCTAVES = 5;

export const WAVEFORM_OPTIONS = [
  { title: 'Sine', value: 'sine' },
  { title: 'Square', value: 'square' },
  { title: 'Triangle', value: 'triangle' },
  { title: 'Sawtooth', value: 'sawtooth' },
  { title: 'Flute', value: 'flute' },
  { title: 'Oboe', value: 'oboe' },
  { title: 'Clarinet', value: 'clarinet' },
  { title: 'Saxophone', value: 'saxophone' },
  { title: 'Pulse 25%', value: 'pulse-25' },
  { title: 'Pulse 12.5%', value: 'pulse-12' },
  { title: 'Choir Ah', value: 'choir-ah' },
  { title: 'Choir Oh', value: 'choir-oh' },
  { title: 'Pink Noise', value: 'pink-noise' },
  { title: 'Brown Noise', value: 'brown-noise' },
  { title: 'Helmholtz Resonator', value: 'helmholtz' },
  { title: 'Formant Resonance', value: 'formant' },
  { title: 'Duct Resonance', value: 'duct' },
  { title: 'Aeolian Turbulence', value: 'aeolian' },
  { title: 'Stochastic Bandpass', value: 'stochastic-bandpass' },
] as const;

export const DEFAULT_TONEWHEEL_DRAWBARS = [0, 0, 0, 8, 0, 0, 0, 0, 0];
export const TONEWHEEL_DRAWBAR_LABELS = ["16'", "5 1/3'", "8'", "4'", "2 2/3'", "2'", "1 3/5'", "1 1/3'", "1'"];

export interface PresetReverbData {
  enabled: boolean;
  decay: number;
  preDelay: number;
  dry: number;
  wet: number;
  lowCut: number;
  highCut: number;
}

export interface PresetData {
  bpm: number;
  /** Concert pitch frequency of A4 in Hz (default 440). */
  a4: number;
  forte: string;
  /**
   * Optional song-level track activation sequence B: whitespace-separated
   * nonnegative decimal bitmasks. Blank disables gating. Bit 0 = first track.
   */
  bitmaskSequenceInput: string;
  tracks: PresetTrackData[];
  reverb: PresetReverbData;
}

export interface NamedPreset {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  folderId: string | null;
  data: PresetData;
}

export interface PresetFolder {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  parentFolderId: string | null;
}

export interface PresetLibrary {
  version: 2;
  migratedLegacy: boolean;
  selectedPresetId: string | null;
  folders: PresetFolder[];
  presets: NamedPreset[];
}

export interface SinglePresetExport {
  version: 2;
  kind: 'single-preset';
  exportedAt: string;
  preset: NamedPreset;
}

export interface PresetLibraryExport {
  version: 2;
  kind: 'preset-library';
  exportedAt: string;
  selectedPresetId: string | null;
  folders: PresetFolder[];
  presets: NamedPreset[];
}

export interface SinglePresetImportPayload {
  version: 1 | 2;
  kind: 'single-preset';
  exportedAt: string;
  preset: NamedPreset;
}

export interface PresetLibraryImportPayload {
  version: 1 | 2;
  kind: 'preset-library';
  exportedAt: string;
  selectedPresetId: string | null;
  folders: PresetFolder[];
  presets: NamedPreset[];
}

export type PresetImportPayload = SinglePresetImportPayload | PresetLibraryImportPayload;

export interface MergeImportedPresetsResult {
  presets: NamedPreset[];
  importedPresets: NamedPreset[];
  selectedPresetId: string | null;
}

export interface MergeImportedPresetLibraryResult {
  library: PresetLibrary;
  importedFolders: PresetFolder[];
  importedPresets: NamedPreset[];
  selectedPresetId: string | null;
}

export interface DeleteFolderRecursiveResult {
  library: PresetLibrary;
  deletedFolderIds: string[];
  deletedPresetIds: string[];
  selectedPresetId: string | null;
}

export interface DeletePresetResult {
  library: PresetLibrary;
  deletedPreset: NamedPreset | null;
  selectedPresetId: string | null;
}

export const DEFAULT_PRESET_TRACK_DATA: PresetTrackData = {
  id: 'track-1',
  name: 'Track 1',
  trackKind: 'melodic',
  drumLanes: [],
  drumVelocityBits: 1,
  numerator: 4,
  denominator: 4,
  phase: 0,
  waveform: 'sine',
  sequenceInput: '1 2 4 8',
  octave: 4,
  lengthFactor: 100,
  lengthOffset: 0,
  midiChannel: 1,
  gain: -6,
  velocityMultiplier: 1,
  delay: 0,
  fadeIn: 0,
  fadeOut: 0,
  paddingBefore: 0,
  paddingAfter: 0,
  repeats: 1,
  timeWarpEnabled: false,
  timeWarpCurve: DEFAULT_TIME_WARP_CURVE,
  timeWarpExpression: '',
  timeWarpRepeats: 1,
  timeWarpAmount: 100,
  timeWarpQuantize: 0,
  timeWarpNoteLengths: true,
  attack: 0.01,
  decay: 0,
  sustain: 1,
  release: 0.12,
  pitchEnvelopeAttack: 0.01,
  pitchEnvelopeDecay: 0.1,
  pitchEnvelopeSustain: 0,
  pitchEnvelopeRelease: 0.2,
  pitchEnvelopeAmount: 0,
  pitchEnvelopeShape: DEFAULT_PITCH_ENVELOPE_SHAPE,
  polyphony: 8,
  glideTime: 0,
  glideMode: 'legato',
  glideConstantRate: false,
  glideCurve: 'exponential',
  monoLegato: true,
  unisonVoices: 1,
  unisonDetune: 0,
  tonewheelDrawbars: DEFAULT_TONEWHEEL_DRAWBARS.slice(),
  tonewheelWavetable: {
    enabled: false,
    dimensions: [],
    configurations: [],
    lfos: [],
  },
  breathEnabled: false,
  breathLevel: -18,
  breathHarmonic: 2,
  tremoloEnabled: false,
  tremoloFrequency: 5,
  tremoloDepth: 0.35,
  tremoloSpread: 180,
  vibratoEnabled: false,
  vibratoFrequency: 5,
  vibratoDepth: 0.08,
  filterEnabled: false,
  filterType: 'lowpass',
  filterFrequency: 119,
  filterRolloff: -24,
  filterQ: 1,
  filterGain: 0,
  filterKeyFollow: 0,
  filterEnvelopeAttack: 0,
  filterEnvelopeDecay: 0,
  filterEnvelopeSustain: 1,
  filterEnvelopeRelease: 0,
  filterEnvelopeAmount: 0,
  filterLfoEnabled: false,
  filterLfoSync: true,
  filterLfoRateHz: 0.5,
  filterLfoRate: '1/4',
  filterLfoAmount: 12,
  filterLfoWaveform: 'sine',
  filterLfoInitPhase: 0,
  limiterGain: 0,
  waveshaper: normalizeWaveshaperSettings(undefined),
  echoEnabled: false,
  echoDelay: '1/4',
  echoFeedback: 0.25,
  echoWet: -12,
  echoPingPong: true,
  chorusEnabled: false,
  chorusRate: '1/1',
  chorusDelay: 3.5,
  chorusDepth: 0.5,
  chorusSpread: 180,
  chorusFeedback: 0,
  chorusWet: -6,
  flangerEnabled: false,
  flangerRate: '2/1',
  flangerDelay: 4,
  flangerDepth: 0.6,
  flangerFeedback: 0.5,
  flangerWet: -6,
  phaserEnabled: false,
  phaserRate: '2/1',
  phaserCenter: 76,
  phaserDepth: 70,
  phaserStages: 4,
  phaserFeedback: 0.3,
  phaserQ: 0.5,
  phaserWet: -6,
  reverbWet: -14,
};

export const DEFAULT_PRESET_DATA: PresetData = {
  bpm: 90,
  a4: 440,
  forte: '5-35.05',
  bitmaskSequenceInput: '',
  tracks: [DEFAULT_PRESET_TRACK_DATA],
  reverb: {
  enabled: true,
  decay: 8,
  preDelay: 0.04,
  dry: 0,
  wet: -2,
  lowCut: 39,
  highCut: 112,
  },
};

const STORAGE_KEY_V2 = 'ss3k_preset_library_v2';
const STORAGE_KEY_V1 = 'ss3k_preset_library_v1';
const ROOT_FOLDER_ID = null;
const LEGACY_KEYS = {
  bpm: 'ss3k_bpm',
  numerator: 'ss3k_numerator',
  denominator: 'ss3k_denominator',
  waveform: 'ss3k_waveform',
  sequenceInput: 'ss3k_sequence',
  octave: 'ss3k_octave',
  lengthFactor: 'ss3k_lengthFactor',
  forte: 'ss3k_forte',
} as const;

const WAVEFORMS = new Set<string>(WAVEFORM_OPTIONS.map((option) => option.value));
const FILTER_TYPES = new Set(['lowpass', 'highpass', 'bandpass', 'lowshelf', 'highshelf', 'notch', 'allpass', 'peaking']);
const FILTER_ROLLOFFS = new Set([-12, -24, -48, -96]);
const ECHO_DELAY_VALUES = new Set<string>(ECHO_DELAY_OPTIONS);
const MODULATION_RATE_VALUES = new Set<string>(MODULATION_RATE_OPTIONS);
const SKEW_LFO_WAVEFORM_VALUES = new Set<string>(SKEW_LFO_WAVEFORM_OPTIONS.map((option) => option.value));
const PHASER_STAGES = new Set<number>(PHASER_STAGE_OPTIONS);
const TIME_WARP_QUANTIZE_VALUES = new Set<number>(TIME_WARP_QUANTIZE_OPTIONS);

type LegacyTrackFields = {
  numerator?: number;
  denominator?: number;
  waveform?: string;
  sequenceInput?: string;
  octave?: number;
  lengthFactor?: number;
  midiChannel?: number;
  gain?: number;
  delay?: number;
  repeats?: number;
};

type LegacyNamedPreset = Omit<NamedPreset, 'folderId'>;
type LegacyPresetLibrary = {
  version?: 1;
  migratedLegacy?: boolean;
  selectedPresetId?: string | null;
  presets?: LegacyNamedPreset[];
};

function isoNow(): string {
  return new Date().toISOString();
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `preset-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function createTrackId(index: number): string {
  return `track-${index + 1}-${Math.random().toString(16).slice(2, 8)}`;
}

function parseInteger(value: string | null | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeWaveform(value: unknown): PresetTrackData['waveform'] {
  if (value === 'tonewheel') {
    return 'sine';
  }
  return typeof value === 'string' && WAVEFORMS.has(value) ? value : DEFAULT_PRESET_TRACK_DATA.waveform;
}

function normalizeTonewheelDrawbars(value: unknown): number[] {
  const raw = Array.isArray(value) ? value : [];
  return DEFAULT_TONEWHEEL_DRAWBARS.map((fallback, index) => clamp(parseNumber(raw[index], fallback), 0, 8));
}

function normalizeTonewheelWavetable(value: unknown): TonewheelWavetable {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<TonewheelWavetable>;
  const rawDimensions = Array.isArray(raw.dimensions) ? raw.dimensions : [];
  const dimensions: TonewheelWavetableDimension[] = rawDimensions
    .slice(0, MAX_WAVETABLE_DIMENSIONS)
    .map((value, index) => {
      const dimension = (typeof value === 'object' && value !== null ? value : {}) as Partial<TonewheelWavetableDimension>;
      const name = typeof dimension.name === 'string' ? dimension.name.trim().slice(0, 40) : '';
      return {
        name: name || `Morph ${index + 1}`,
        value: clamp(parseNumber(dimension.value, 0), 0, 1),
      };
    });
  const rawConfigurations = Array.isArray(raw.configurations) ? raw.configurations : [];
  const configurations: TonewheelConfiguration[] = rawConfigurations
    .slice(0, MAX_WAVETABLE_CONFIGURATIONS)
    .map((value, index) => {
      const configuration = (typeof value === 'object' && value !== null ? value : {}) as Partial<TonewheelConfiguration>;
      const name = typeof configuration.name === 'string' ? configuration.name.trim().slice(0, 40) : '';
      const rawPosition = Array.isArray(configuration.position) ? configuration.position : [];
      return {
        name: name || `Configuration ${index + 1}`,
        position: dimensions.map((_, dimensionIndex) => clamp(parseNumber(rawPosition[dimensionIndex], 0), 0, 1)),
        drawbars: normalizeTonewheelDrawbars(configuration.drawbars),
      };
    });
  const rawLfos = Array.isArray(raw.lfos) ? raw.lfos : [];
  const lfos: TonewheelWavetableLfo[] = rawLfos
    .slice(0, MAX_WAVETABLE_LFOS)
    .map((value, index) => {
      const lfo = (typeof value === 'object' && value !== null ? value : {}) as Partial<TonewheelWavetableLfo>;
      const name = typeof lfo.name === 'string' ? lfo.name.trim().slice(0, 40) : '';
      const waveform = typeof lfo.waveform === 'string' && LFO_WAVEFORM_VALUES.has(lfo.waveform)
        ? lfo.waveform as LfoWaveform
        : 'sine';
      const syncRate = typeof lfo.syncRate === 'string' && LFO_SYNC_RATE_VALUES.has(lfo.syncRate)
        ? lfo.syncRate as LfoSyncRateValue
        : '1/4';
      const polarity = lfo.polarity === 'unipolar' ? 'unipolar' : 'bipolar';
      const rawRetrigger = lfo.retrigger as string | undefined;
      const retrigger = rawRetrigger === 'note' || rawRetrigger === 'song' || rawRetrigger === 'bar'
        ? rawRetrigger === 'bar' ? 'song' : rawRetrigger
        : 'free';
      const fmSource = clamp(parseInteger(String(lfo.fmSource ?? -1), -1), -1, index - 1);
      const rawRoutes = Array.isArray(lfo.routes) ? lfo.routes : [];
      return {
        name: name || `Vector LFO ${index + 1}`,
        enabled: Boolean(lfo.enabled ?? true),
        waveform,
        sync: Boolean(lfo.sync ?? true),
        rateHz: clamp(parseNumber(lfo.rateHz, 0.5), LFO_FREE_RATE_MIN_HZ, LFO_FREE_RATE_MAX_HZ),
        syncRate,
        phase: clamp(parseNumber(lfo.phase, 0), 0, 0.999999),
        depth: clamp(parseNumber(lfo.depth, 0.25), 0, 1),
        polarity,
        retrigger,
        smoothing: clamp(parseNumber(lfo.smoothing, 0), 0, 1),
        fmSource,
        fmAmount: clamp(parseNumber(lfo.fmAmount, 0), -4, 4),
        routes: dimensions.map((_, dimensionIndex) => clamp(parseNumber(rawRoutes[dimensionIndex], 0), -1, 1)),
      };
    });

  return {
    enabled: Boolean(raw.enabled) && dimensions.length > 0 && configurations.length > 0,
    dimensions,
    configurations,
    lfos,
  };
}

function normalizeFilterType(value: unknown): PresetTrackData['filterType'] {
  return typeof value === 'string' && FILTER_TYPES.has(value) ? value : DEFAULT_PRESET_TRACK_DATA.filterType;
}

function normalizeFilterRolloff(value: unknown): PresetTrackData['filterRolloff'] {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return FILTER_ROLLOFFS.has(parsed) ? parsed : DEFAULT_PRESET_TRACK_DATA.filterRolloff;
}

function normalizeEchoDelay(value: unknown): EchoDelayValue {
  return typeof value === 'string' && ECHO_DELAY_VALUES.has(value) ? value as EchoDelayValue : DEFAULT_PRESET_TRACK_DATA.echoDelay;
}

function normalizeModulationRate(value: unknown, fallback: ModulationRateValue): ModulationRateValue {
  return typeof value === 'string' && MODULATION_RATE_VALUES.has(value) ? value as ModulationRateValue : fallback;
}

function normalizeSkewLfoWaveform(value: unknown): SkewLfoWaveformValue {
  return typeof value === 'string' && SKEW_LFO_WAVEFORM_VALUES.has(value)
    ? value as SkewLfoWaveformValue
    : 'sine';
}

function normalizeGlideMode(value: unknown): GlideMode {
  return GLIDE_MODE_OPTIONS.includes(value as GlideMode)
    ? value as GlideMode
    : DEFAULT_PRESET_TRACK_DATA.glideMode;
}

function normalizeGlideCurve(value: unknown): GlideCurve {
  return GLIDE_CURVE_OPTIONS.includes(value as GlideCurve)
    ? value as GlideCurve
    : DEFAULT_PRESET_TRACK_DATA.glideCurve;
}

function normalizePhaserStages(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return PHASER_STAGES.has(parsed) ? parsed : DEFAULT_PRESET_TRACK_DATA.phaserStages;
}

type LegacyPhaserFields = {
  phaserCenter?: number;
  phaserDepth?: number;
  phaserFeedback?: number;
  phaserOctaves?: number;
  phaserBaseFrequency?: number;
};

/**
 * Older presets stored the sweep as octaves plus a base MIDI note that had almost
 * no audible effect; the base note maps directly onto the new center control
 * while the octaves value is handled by normalizePhaserDepth.
 */
function normalizePhaserCenter(raw: LegacyPhaserFields): number {
  if (typeof raw.phaserCenter === 'number' && Number.isFinite(raw.phaserCenter)) {
    return clamp(raw.phaserCenter, 0, 127);
  }
  const legacyBase = parseNumber(raw.phaserBaseFrequency, Number.NaN);
  if (Number.isFinite(legacyBase)) {
    return clamp(legacyBase, 0, 127);
  }
  return DEFAULT_PRESET_TRACK_DATA.phaserCenter;
}

function normalizePhaserDepth(raw: LegacyPhaserFields): number {
  if (typeof raw.phaserDepth === 'number' && Number.isFinite(raw.phaserDepth)) {
    return clamp(raw.phaserDepth, 0, 100);
  }
  const legacyOctaves = parseNumber(raw.phaserOctaves, Number.NaN);
  if (Number.isFinite(legacyOctaves)) {
    return clamp((legacyOctaves / PHASER_MAX_SWEEP_OCTAVES) * 100, 0, 100);
  }
  return DEFAULT_PRESET_TRACK_DATA.phaserDepth;
}

function normalizePhaserFeedback(raw: LegacyPhaserFields): number {
  return clamp(parseNumber(raw.phaserFeedback, DEFAULT_PRESET_TRACK_DATA.phaserFeedback), 0, 0.95);
}

function normalizeTimeWarpCurve(value: unknown): string {
  return typeof value === 'string' && TIME_WARP_CURVE_VALUES.has(value)
    ? value
    : DEFAULT_PRESET_TRACK_DATA.timeWarpCurve;
}

function normalizeTimeWarpExpression(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_PRESET_TRACK_DATA.timeWarpExpression;
  }
  return value.slice(0, 512);
}

function normalizeTimeWarpQuantize(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return TIME_WARP_QUANTIZE_VALUES.has(parsed) ? parsed : DEFAULT_PRESET_TRACK_DATA.timeWarpQuantize;
}

export function clonePresetReverbData(reverb: PresetReverbData): PresetReverbData {
  return {
    enabled: reverb.enabled,
    decay: reverb.decay,
    preDelay: reverb.preDelay,
    dry: reverb.dry,
    wet: reverb.wet,
    lowCut: reverb.lowCut,
    highCut: reverb.highCut,
  };
}

export function clonePresetFolder(folder: PresetFolder): PresetFolder {
  return {
    id: folder.id,
    name: folder.name,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
    parentFolderId: folder.parentFolderId,
  };
}

export function normalizePresetReverbData(value: unknown): PresetReverbData {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<PresetReverbData>;
  return {
    enabled: raw.enabled ?? DEFAULT_PRESET_DATA.reverb.enabled,
    decay: clamp(parseNumber(raw.decay, DEFAULT_PRESET_DATA.reverb.decay), 0.1, 30),
    preDelay: clamp(parseNumber(raw.preDelay, DEFAULT_PRESET_DATA.reverb.preDelay), 0, 1),
    dry: clamp(parseNumber(raw.dry, DEFAULT_PRESET_DATA.reverb.dry), -96, 12),
    wet: clamp(parseNumber(raw.wet, DEFAULT_PRESET_DATA.reverb.wet), -96, 12),
    lowCut: clamp(parseNumber(raw.lowCut, DEFAULT_PRESET_DATA.reverb.lowCut), 0, 127),
    highCut: clamp(parseNumber(raw.highCut, DEFAULT_PRESET_DATA.reverb.highCut), 0, 127),
  };
}

export function sanitizeTrackName(name: string | null | undefined, fallbackIndex = 0): string {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : `Track ${fallbackIndex + 1}`;
}

export function clonePresetTrackData(track: PresetTrackData): PresetTrackData {
  return {
    id: track.id,
    name: track.name,
    trackKind: track.trackKind,
    drumLanes: cloneDrumLanes(track.drumLanes),
    drumVelocityBits: track.drumVelocityBits,
    numerator: track.numerator,
    denominator: track.denominator,
    phase: track.phase,
    waveform: track.waveform,
    sequenceInput: track.sequenceInput,
    octave: track.octave,
    lengthFactor: track.lengthFactor,
    lengthOffset: track.lengthOffset,
    midiChannel: track.midiChannel,
    gain: track.gain,
    velocityMultiplier: track.velocityMultiplier,
    delay: track.delay,
    fadeIn: track.fadeIn,
    fadeOut: track.fadeOut,
    paddingBefore: track.paddingBefore,
    paddingAfter: track.paddingAfter,
    repeats: track.repeats,
    timeWarpEnabled: track.timeWarpEnabled,
    timeWarpCurve: track.timeWarpCurve,
    timeWarpExpression: track.timeWarpExpression,
    timeWarpRepeats: track.timeWarpRepeats,
    timeWarpAmount: track.timeWarpAmount,
    timeWarpQuantize: track.timeWarpQuantize,
    timeWarpNoteLengths: track.timeWarpNoteLengths,
    attack: track.attack,
    decay: track.decay,
    sustain: track.sustain,
    release: track.release,
    pitchEnvelopeAttack: track.pitchEnvelopeAttack,
    pitchEnvelopeDecay: track.pitchEnvelopeDecay,
    pitchEnvelopeSustain: track.pitchEnvelopeSustain,
    pitchEnvelopeRelease: track.pitchEnvelopeRelease,
    pitchEnvelopeAmount: track.pitchEnvelopeAmount,
    pitchEnvelopeShape: track.pitchEnvelopeShape,
    polyphony: track.polyphony,
    glideTime: track.glideTime,
    glideMode: track.glideMode,
    glideConstantRate: track.glideConstantRate,
    glideCurve: track.glideCurve,
    monoLegato: track.monoLegato,
    unisonVoices: track.unisonVoices,
    unisonDetune: track.unisonDetune,
    tonewheelDrawbars: track.tonewheelDrawbars.slice(),
    tonewheelWavetable: {
      enabled: track.tonewheelWavetable.enabled,
      dimensions: track.tonewheelWavetable.dimensions.map((dimension) => ({ ...dimension })),
      configurations: track.tonewheelWavetable.configurations.map((configuration) => ({
        name: configuration.name,
        position: configuration.position.slice(),
        drawbars: configuration.drawbars.slice(),
      })),
      lfos: (track.tonewheelWavetable.lfos ?? []).map((lfo) => ({
        ...lfo,
        routes: lfo.routes.slice(),
      })),
    },
    breathEnabled: track.breathEnabled,
    breathLevel: track.breathLevel,
    breathHarmonic: track.breathHarmonic,
    tremoloEnabled: track.tremoloEnabled,
    tremoloFrequency: track.tremoloFrequency,
    tremoloDepth: track.tremoloDepth,
    tremoloSpread: track.tremoloSpread,
    vibratoEnabled: track.vibratoEnabled,
    vibratoFrequency: track.vibratoFrequency,
    vibratoDepth: track.vibratoDepth,
    filterEnabled: track.filterEnabled,
    filterType: track.filterType,
    filterFrequency: track.filterFrequency,
    filterRolloff: track.filterRolloff,
    filterQ: track.filterQ,
    filterGain: track.filterGain,
    filterKeyFollow: track.filterKeyFollow,
    filterEnvelopeAttack: track.filterEnvelopeAttack,
    filterEnvelopeDecay: track.filterEnvelopeDecay,
    filterEnvelopeSustain: track.filterEnvelopeSustain,
    filterEnvelopeRelease: track.filterEnvelopeRelease,
    filterEnvelopeAmount: track.filterEnvelopeAmount,
    filterLfoEnabled: track.filterLfoEnabled,
    filterLfoSync: track.filterLfoSync,
    filterLfoRateHz: track.filterLfoRateHz,
    filterLfoRate: track.filterLfoRate,
    filterLfoAmount: track.filterLfoAmount,
    filterLfoWaveform: track.filterLfoWaveform,
    filterLfoInitPhase: track.filterLfoInitPhase,
    limiterGain: track.limiterGain,
    waveshaper: cloneWaveshaperSettings(track.waveshaper),
    echoEnabled: track.echoEnabled,
    echoDelay: track.echoDelay,
    echoFeedback: track.echoFeedback,
    echoWet: track.echoWet,
    echoPingPong: track.echoPingPong,
    chorusEnabled: track.chorusEnabled,
    chorusRate: track.chorusRate,
    chorusDelay: track.chorusDelay,
    chorusDepth: track.chorusDepth,
    chorusSpread: track.chorusSpread,
    chorusFeedback: track.chorusFeedback,
    chorusWet: track.chorusWet,
    flangerEnabled: track.flangerEnabled,
    flangerRate: track.flangerRate,
    flangerDelay: track.flangerDelay,
    flangerDepth: track.flangerDepth,
    flangerFeedback: track.flangerFeedback,
    flangerWet: track.flangerWet,
    phaserEnabled: track.phaserEnabled,
    phaserRate: track.phaserRate,
    phaserCenter: track.phaserCenter,
    phaserDepth: track.phaserDepth,
    phaserStages: track.phaserStages,
    phaserFeedback: track.phaserFeedback,
    phaserQ: track.phaserQ,
    phaserWet: track.phaserWet,
    reverbWet: track.reverbWet,
  };
}

export function normalizePresetTrackData(value: unknown, index = 0): PresetTrackData {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<PresetTrackData>;

  return {
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : createTrackId(index),
    name: sanitizeTrackName(raw.name, index),
    trackKind: raw.trackKind === 'rhythmic' ? 'rhythmic' : DEFAULT_PRESET_TRACK_DATA.trackKind,
    drumLanes: raw.trackKind === 'rhythmic' ? normalizeDrumLanes(raw.drumLanes) : [],
    drumVelocityBits: normalizeDrumVelocityBits(raw.drumVelocityBits, DEFAULT_PRESET_TRACK_DATA.drumVelocityBits),
    numerator: clamp(parseInteger(raw.numerator?.toString(), DEFAULT_PRESET_TRACK_DATA.numerator), 1, 16),
    denominator: clamp(parseInteger(raw.denominator?.toString(), DEFAULT_PRESET_TRACK_DATA.denominator), 1, 16),
    phase: clamp(parseNumber(raw.phase, DEFAULT_PRESET_TRACK_DATA.phase), 0, 1),
    waveform: normalizeWaveform(raw.waveform),
    sequenceInput: typeof raw.sequenceInput === 'string' ? raw.sequenceInput : DEFAULT_PRESET_TRACK_DATA.sequenceInput,
    octave: clamp(parseInteger(raw.octave?.toString(), DEFAULT_PRESET_TRACK_DATA.octave), 0, 10),
    lengthFactor: clamp(parseInteger(raw.lengthFactor?.toString(), DEFAULT_PRESET_TRACK_DATA.lengthFactor), 0, 400),
    lengthOffset: clamp(parseNumber(raw.lengthOffset, DEFAULT_PRESET_TRACK_DATA.lengthOffset), 0, 64),
    midiChannel: clamp(parseInteger(raw.midiChannel?.toString(), DEFAULT_PRESET_TRACK_DATA.midiChannel), 1, 16),
    gain: clamp(parseNumber(raw.gain, DEFAULT_PRESET_TRACK_DATA.gain), -96, 24),
    velocityMultiplier: clamp(parseNumber(raw.velocityMultiplier, DEFAULT_PRESET_TRACK_DATA.velocityMultiplier), 0, 4),
    delay: clamp(parseInteger(raw.delay?.toString(), DEFAULT_PRESET_TRACK_DATA.delay), 0, 64),
    fadeIn: clamp(parseNumber(raw.fadeIn, DEFAULT_PRESET_TRACK_DATA.fadeIn), 0, 64),
    fadeOut: clamp(parseNumber(raw.fadeOut, DEFAULT_PRESET_TRACK_DATA.fadeOut), 0, 64),
    paddingBefore: clamp(parseNumber(raw.paddingBefore, DEFAULT_PRESET_TRACK_DATA.paddingBefore), 0, 64),
    paddingAfter: clamp(parseNumber(raw.paddingAfter, DEFAULT_PRESET_TRACK_DATA.paddingAfter), 0, 64),
    repeats: clamp(parseInteger(raw.repeats?.toString(), DEFAULT_PRESET_TRACK_DATA.repeats), 1, 64),
    timeWarpEnabled: Boolean(raw.timeWarpEnabled ?? DEFAULT_PRESET_TRACK_DATA.timeWarpEnabled),
    timeWarpCurve: normalizeTimeWarpCurve(raw.timeWarpCurve),
    timeWarpExpression: normalizeTimeWarpExpression(raw.timeWarpExpression),
    timeWarpRepeats: clamp(parseInteger(raw.timeWarpRepeats?.toString(), DEFAULT_PRESET_TRACK_DATA.timeWarpRepeats), 1, 64),
    timeWarpAmount: clamp(parseNumber(raw.timeWarpAmount, DEFAULT_PRESET_TRACK_DATA.timeWarpAmount), 0, 100),
    timeWarpQuantize: normalizeTimeWarpQuantize(raw.timeWarpQuantize),
    timeWarpNoteLengths: Boolean(raw.timeWarpNoteLengths ?? DEFAULT_PRESET_TRACK_DATA.timeWarpNoteLengths),
    attack: clamp(parseNumber(raw.attack, DEFAULT_PRESET_TRACK_DATA.attack), 0, 10),
    decay: clamp(parseNumber(raw.decay, DEFAULT_PRESET_TRACK_DATA.decay), 0, 10),
    sustain: clamp(parseNumber(raw.sustain, DEFAULT_PRESET_TRACK_DATA.sustain), 0, 1),
    release: clamp(parseNumber(raw.release, DEFAULT_PRESET_TRACK_DATA.release), 0, 20),
    pitchEnvelopeAttack: clamp(parseNumber(raw.pitchEnvelopeAttack, DEFAULT_PRESET_TRACK_DATA.pitchEnvelopeAttack), 0, 10),
    pitchEnvelopeDecay: clamp(parseNumber(raw.pitchEnvelopeDecay, DEFAULT_PRESET_TRACK_DATA.pitchEnvelopeDecay), 0, 10),
    pitchEnvelopeSustain: clamp(parseNumber(raw.pitchEnvelopeSustain, DEFAULT_PRESET_TRACK_DATA.pitchEnvelopeSustain), 0, 1),
    pitchEnvelopeRelease: clamp(parseNumber(raw.pitchEnvelopeRelease, DEFAULT_PRESET_TRACK_DATA.pitchEnvelopeRelease), 0, 20),
    pitchEnvelopeAmount: clamp(parseNumber(raw.pitchEnvelopeAmount, DEFAULT_PRESET_TRACK_DATA.pitchEnvelopeAmount), -48, 48),
    pitchEnvelopeShape: normalizePitchEnvelopeShape(raw.pitchEnvelopeShape, DEFAULT_PRESET_TRACK_DATA.pitchEnvelopeShape),
    polyphony: clamp(parseInteger(raw.polyphony?.toString(), DEFAULT_PRESET_TRACK_DATA.polyphony), 1, MAX_TRACK_POLYPHONY),
    glideTime: clamp(parseNumber(raw.glideTime, DEFAULT_PRESET_TRACK_DATA.glideTime), 0, 5),
    glideMode: normalizeGlideMode(raw.glideMode),
    glideConstantRate: Boolean(raw.glideConstantRate ?? DEFAULT_PRESET_TRACK_DATA.glideConstantRate),
    glideCurve: normalizeGlideCurve(raw.glideCurve),
    monoLegato: Boolean(raw.monoLegato ?? DEFAULT_PRESET_TRACK_DATA.monoLegato),
    unisonVoices: clamp(parseInteger(raw.unisonVoices?.toString(), DEFAULT_PRESET_TRACK_DATA.unisonVoices), 1, 8),
    unisonDetune: clamp(parseNumber(raw.unisonDetune, DEFAULT_PRESET_TRACK_DATA.unisonDetune), 0, 100),
    tonewheelDrawbars: normalizeTonewheelDrawbars(raw.tonewheelDrawbars),
    tonewheelWavetable: normalizeTonewheelWavetable(raw.tonewheelWavetable),
    breathEnabled: Boolean(raw.breathEnabled ?? DEFAULT_PRESET_TRACK_DATA.breathEnabled),
    breathLevel: clamp(parseNumber(raw.breathLevel, DEFAULT_PRESET_TRACK_DATA.breathLevel), -60, 0),
    breathHarmonic: clamp(parseNumber(raw.breathHarmonic, DEFAULT_PRESET_TRACK_DATA.breathHarmonic), 0.5, 8),
    tremoloEnabled: Boolean(raw.tremoloEnabled ?? DEFAULT_PRESET_TRACK_DATA.tremoloEnabled),
    tremoloFrequency: clamp(parseNumber(raw.tremoloFrequency, DEFAULT_PRESET_TRACK_DATA.tremoloFrequency), 0.01, 40),
    tremoloDepth: clamp(parseNumber(raw.tremoloDepth, DEFAULT_PRESET_TRACK_DATA.tremoloDepth), 0, 1),
    tremoloSpread: clamp(parseNumber(raw.tremoloSpread, DEFAULT_PRESET_TRACK_DATA.tremoloSpread), 0, 360),
    vibratoEnabled: Boolean(raw.vibratoEnabled ?? DEFAULT_PRESET_TRACK_DATA.vibratoEnabled),
    vibratoFrequency: clamp(parseNumber(raw.vibratoFrequency, DEFAULT_PRESET_TRACK_DATA.vibratoFrequency), 0.01, 40),
    vibratoDepth: clamp(parseNumber(raw.vibratoDepth, DEFAULT_PRESET_TRACK_DATA.vibratoDepth), 0, 1),
    filterEnabled: Boolean(raw.filterEnabled ?? DEFAULT_PRESET_TRACK_DATA.filterEnabled),
    filterType: normalizeFilterType(raw.filterType),
    filterFrequency: clamp(parseNumber(raw.filterFrequency, DEFAULT_PRESET_TRACK_DATA.filterFrequency), 0, 127),
    filterRolloff: normalizeFilterRolloff(raw.filterRolloff),
    filterQ: clamp(parseNumber(raw.filterQ, DEFAULT_PRESET_TRACK_DATA.filterQ), 0.0001, 30),
    filterGain: clamp(parseNumber(raw.filterGain, DEFAULT_PRESET_TRACK_DATA.filterGain), -48, 48),
    filterKeyFollow: clamp(parseNumber(raw.filterKeyFollow, DEFAULT_PRESET_TRACK_DATA.filterKeyFollow), -200, 200),
    filterEnvelopeAttack: clamp(parseNumber(raw.filterEnvelopeAttack, DEFAULT_PRESET_TRACK_DATA.filterEnvelopeAttack), 0, 10),
    filterEnvelopeDecay: clamp(parseNumber(raw.filterEnvelopeDecay, DEFAULT_PRESET_TRACK_DATA.filterEnvelopeDecay), 0, 10),
    filterEnvelopeSustain: clamp(parseNumber(raw.filterEnvelopeSustain, DEFAULT_PRESET_TRACK_DATA.filterEnvelopeSustain), 0, 1),
    filterEnvelopeRelease: clamp(parseNumber(raw.filterEnvelopeRelease, DEFAULT_PRESET_TRACK_DATA.filterEnvelopeRelease), 0, 20),
    filterEnvelopeAmount: clamp(parseNumber(raw.filterEnvelopeAmount, DEFAULT_PRESET_TRACK_DATA.filterEnvelopeAmount), -127, 127),
    filterLfoEnabled: Boolean(raw.filterLfoEnabled ?? DEFAULT_PRESET_TRACK_DATA.filterLfoEnabled),
    filterLfoSync: Boolean(raw.filterLfoSync ?? DEFAULT_PRESET_TRACK_DATA.filterLfoSync),
    filterLfoRateHz: clamp(parseNumber(raw.filterLfoRateHz, DEFAULT_PRESET_TRACK_DATA.filterLfoRateHz), 0.01, 20),
    filterLfoRate: normalizeModulationRate(raw.filterLfoRate, DEFAULT_PRESET_TRACK_DATA.filterLfoRate),
    filterLfoAmount: clamp(parseNumber(raw.filterLfoAmount, DEFAULT_PRESET_TRACK_DATA.filterLfoAmount), -48, 48),
    filterLfoWaveform: normalizeSkewLfoWaveform(raw.filterLfoWaveform),
    filterLfoInitPhase: clamp(parseNumber(raw.filterLfoInitPhase, DEFAULT_PRESET_TRACK_DATA.filterLfoInitPhase), 0, 0.999999),
    limiterGain: clamp(parseNumber(raw.limiterGain, DEFAULT_PRESET_TRACK_DATA.limiterGain), -48, 72),
    waveshaper: normalizeWaveshaperSettings(raw.waveshaper),
    echoEnabled: Boolean(raw.echoEnabled ?? DEFAULT_PRESET_TRACK_DATA.echoEnabled),
    echoDelay: normalizeEchoDelay(raw.echoDelay),
    echoFeedback: clamp(parseNumber(raw.echoFeedback, DEFAULT_PRESET_TRACK_DATA.echoFeedback), 0, 0.95),
    echoWet: clamp(parseNumber(raw.echoWet, DEFAULT_PRESET_TRACK_DATA.echoWet), -96, 0),
    echoPingPong: Boolean(raw.echoPingPong ?? DEFAULT_PRESET_TRACK_DATA.echoPingPong),
    chorusEnabled: Boolean(raw.chorusEnabled ?? DEFAULT_PRESET_TRACK_DATA.chorusEnabled),
    chorusRate: normalizeModulationRate(raw.chorusRate, DEFAULT_PRESET_TRACK_DATA.chorusRate),
    chorusDelay: clamp(parseNumber(raw.chorusDelay, DEFAULT_PRESET_TRACK_DATA.chorusDelay), 0.5, 20),
    chorusDepth: clamp(parseNumber(raw.chorusDepth, DEFAULT_PRESET_TRACK_DATA.chorusDepth), 0, 1),
    chorusSpread: clamp(parseNumber(raw.chorusSpread, DEFAULT_PRESET_TRACK_DATA.chorusSpread), 0, 180),
    chorusFeedback: clamp(parseNumber(raw.chorusFeedback, DEFAULT_PRESET_TRACK_DATA.chorusFeedback), 0, 0.95),
    chorusWet: clamp(parseNumber(raw.chorusWet, DEFAULT_PRESET_TRACK_DATA.chorusWet), -96, 0),
    flangerEnabled: Boolean(raw.flangerEnabled ?? DEFAULT_PRESET_TRACK_DATA.flangerEnabled),
    flangerRate: normalizeModulationRate(raw.flangerRate, DEFAULT_PRESET_TRACK_DATA.flangerRate),
    flangerDelay: clamp(parseNumber(raw.flangerDelay, DEFAULT_PRESET_TRACK_DATA.flangerDelay), 0.1, 20),
    flangerDepth: clamp(parseNumber(raw.flangerDepth, DEFAULT_PRESET_TRACK_DATA.flangerDepth), 0, 1),
    flangerFeedback: clamp(parseNumber(raw.flangerFeedback, DEFAULT_PRESET_TRACK_DATA.flangerFeedback), 0, 0.95),
    flangerWet: clamp(parseNumber(raw.flangerWet, DEFAULT_PRESET_TRACK_DATA.flangerWet), -96, 0),
    phaserEnabled: Boolean(raw.phaserEnabled ?? DEFAULT_PRESET_TRACK_DATA.phaserEnabled),
    phaserRate: normalizeModulationRate(raw.phaserRate, DEFAULT_PRESET_TRACK_DATA.phaserRate),
    phaserCenter: normalizePhaserCenter(raw),
    phaserDepth: normalizePhaserDepth(raw),
    phaserStages: normalizePhaserStages(raw.phaserStages),
    phaserFeedback: normalizePhaserFeedback(raw),
    phaserQ: clamp(parseNumber(raw.phaserQ, DEFAULT_PRESET_TRACK_DATA.phaserQ), 0.01, 30),
    phaserWet: clamp(parseNumber(raw.phaserWet, DEFAULT_PRESET_TRACK_DATA.phaserWet), -96, 0),
    reverbWet: clamp(parseNumber(raw.reverbWet, DEFAULT_PRESET_TRACK_DATA.reverbWet), -96, 0),
  };
}

function areDrumLanesEqual(left: readonly DrumLane[], right: readonly DrumLane[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((leftLane, laneIndex) => {
    const rightLane = right[laneIndex];
    if (leftLane.voiceId !== rightLane.voiceId || leftLane.xorGroup !== rightLane.xorGroup) {
      return false;
    }

    const leftParameters = leftLane.parameters;
    const rightParameters = rightLane.parameters;
    const leftNames = Object.keys(leftParameters);
    const rightNames = Object.keys(rightParameters);
    return leftNames.length === rightNames.length
      && leftNames.every((name) => leftParameters[name] === rightParameters[name]);
  });
}

function normalizeLegacyTrack(value: LegacyTrackFields): PresetTrackData {
  return normalizePresetTrackData({
    id: 'track-1',
    name: 'Track 1',
    numerator: value.numerator,
    denominator: value.denominator,
    waveform: value.waveform,
    sequenceInput: value.sequenceInput,
    octave: value.octave,
    lengthFactor: value.lengthFactor,
    midiChannel: value.midiChannel,
    gain: value.gain,
    delay: value.delay,
    repeats: value.repeats,
  }, 0);
}

export function clonePresetData(data: PresetData): PresetData {
  return {
    bpm: data.bpm,
    a4: data.a4,
    forte: data.forte,
    bitmaskSequenceInput: data.bitmaskSequenceInput,
    tracks: data.tracks.map((track) => clonePresetTrackData(track)),
    reverb: clonePresetReverbData(data.reverb),
  };
}

/** Appends deep-cloned source tracks while preserving the current song settings. */
export function mergePresetTracks(current: PresetData, source: PresetData): PresetData {
  const merged = clonePresetData(current);
  const trackIds = new Set(merged.tracks.map((track) => track.id));
  const trackNames = new Set(merged.tracks.map((track) => track.name));
  const importedTracks = source.tracks.map((sourceTrack, index) => {
    const track = clonePresetTrackData(sourceTrack);
    const generatedId = createTrackId(merged.tracks.length + index);
    let uniqueId = generatedId;
    let suffix = 2;
    while (trackIds.has(uniqueId)) {
      uniqueId = `${generatedId}-${suffix}`;
      suffix += 1;
    }
    trackIds.add(uniqueId);

    return {
      ...track,
      id: uniqueId,
      name: ensureUniqueName(trackNames, track.name, (name) => sanitizeTrackName(name, merged.tracks.length + index)),
    };
  });

  return {
    ...merged,
    tracks: [...merged.tracks, ...importedTracks],
  };
}

export function normalizePresetData(value: unknown): PresetData {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<PresetData> & {
    numerator?: number;
    denominator?: number;
    waveform?: string;
    sequenceInput?: string;
    octave?: number;
    lengthFactor?: number;
    midiChannel?: number;
    gain?: number;
  };

  const tracks = Array.isArray(raw.tracks)
    ? raw.tracks.map((track, index) => normalizePresetTrackData(track, index))
    : [];

  return {
    bpm: clamp(parseInteger(raw.bpm?.toString(), DEFAULT_PRESET_DATA.bpm), 1, 499),
    a4: clamp(parseNumber(raw.a4, DEFAULT_PRESET_DATA.a4), 380, 500),
    forte: typeof raw.forte === 'string' && raw.forte.trim().length > 0 ? raw.forte : DEFAULT_PRESET_DATA.forte,
    bitmaskSequenceInput: normalizeBitmaskSequenceInput(
      raw.bitmaskSequenceInput ?? (raw as { b?: unknown }).b,
    ),
    tracks: tracks.length > 0 ? tracks : [normalizeLegacyTrack(raw)],
    reverb: normalizePresetReverbData(raw.reverb),
  };
}

export function arePresetDataEqual(left: PresetData, right: PresetData): boolean {
  if (left.bpm !== right.bpm
    || left.a4 !== right.a4
    || left.forte !== right.forte
    || left.bitmaskSequenceInput !== right.bitmaskSequenceInput
    || left.tracks.length !== right.tracks.length
    || left.reverb.enabled !== right.reverb.enabled
    || left.reverb.decay !== right.reverb.decay
    || left.reverb.preDelay !== right.reverb.preDelay
    || left.reverb.dry !== right.reverb.dry
    || left.reverb.wet !== right.reverb.wet
    || left.reverb.lowCut !== right.reverb.lowCut
    || left.reverb.highCut !== right.reverb.highCut) {
    return false;
  }

  for (let index = 0; index < left.tracks.length; index += 1) {
    const leftTrack = left.tracks[index];
    const rightTrack = right.tracks[index];
    if (leftTrack.id !== rightTrack.id
      || leftTrack.name !== rightTrack.name
      || leftTrack.trackKind !== rightTrack.trackKind
      || leftTrack.drumVelocityBits !== rightTrack.drumVelocityBits
      || !areDrumLanesEqual(leftTrack.drumLanes, rightTrack.drumLanes)
      || leftTrack.numerator !== rightTrack.numerator
      || leftTrack.denominator !== rightTrack.denominator
      || leftTrack.phase !== rightTrack.phase
      || leftTrack.waveform !== rightTrack.waveform
      || leftTrack.sequenceInput !== rightTrack.sequenceInput
      || leftTrack.octave !== rightTrack.octave
      || leftTrack.lengthFactor !== rightTrack.lengthFactor
      || leftTrack.lengthOffset !== rightTrack.lengthOffset
      || leftTrack.midiChannel !== rightTrack.midiChannel
      || leftTrack.gain !== rightTrack.gain
      || leftTrack.velocityMultiplier !== rightTrack.velocityMultiplier
      || leftTrack.delay !== rightTrack.delay
      || leftTrack.fadeIn !== rightTrack.fadeIn
      || leftTrack.fadeOut !== rightTrack.fadeOut
      || leftTrack.paddingBefore !== rightTrack.paddingBefore
      || leftTrack.paddingAfter !== rightTrack.paddingAfter
      || leftTrack.repeats !== rightTrack.repeats
      || leftTrack.timeWarpEnabled !== rightTrack.timeWarpEnabled
      || leftTrack.timeWarpCurve !== rightTrack.timeWarpCurve
      || leftTrack.timeWarpExpression !== rightTrack.timeWarpExpression
      || leftTrack.timeWarpRepeats !== rightTrack.timeWarpRepeats
      || leftTrack.timeWarpAmount !== rightTrack.timeWarpAmount
      || leftTrack.timeWarpQuantize !== rightTrack.timeWarpQuantize
      || leftTrack.timeWarpNoteLengths !== rightTrack.timeWarpNoteLengths
      || leftTrack.attack !== rightTrack.attack
      || leftTrack.decay !== rightTrack.decay
      || leftTrack.sustain !== rightTrack.sustain
      || leftTrack.release !== rightTrack.release
      || leftTrack.pitchEnvelopeAttack !== rightTrack.pitchEnvelopeAttack
      || leftTrack.pitchEnvelopeDecay !== rightTrack.pitchEnvelopeDecay
      || leftTrack.pitchEnvelopeSustain !== rightTrack.pitchEnvelopeSustain
      || leftTrack.pitchEnvelopeRelease !== rightTrack.pitchEnvelopeRelease
      || leftTrack.pitchEnvelopeAmount !== rightTrack.pitchEnvelopeAmount
      || leftTrack.pitchEnvelopeShape !== rightTrack.pitchEnvelopeShape
      || leftTrack.polyphony !== rightTrack.polyphony
      || leftTrack.glideTime !== rightTrack.glideTime
      || leftTrack.glideMode !== rightTrack.glideMode
      || leftTrack.glideConstantRate !== rightTrack.glideConstantRate
      || leftTrack.glideCurve !== rightTrack.glideCurve
      || leftTrack.monoLegato !== rightTrack.monoLegato
      || leftTrack.unisonVoices !== rightTrack.unisonVoices
      || leftTrack.unisonDetune !== rightTrack.unisonDetune
      || leftTrack.tonewheelDrawbars.some((drawbar, drawbarIndex) => drawbar !== rightTrack.tonewheelDrawbars[drawbarIndex])
      || leftTrack.breathEnabled !== rightTrack.breathEnabled
      || leftTrack.breathLevel !== rightTrack.breathLevel
      || leftTrack.breathHarmonic !== rightTrack.breathHarmonic
      || leftTrack.tremoloEnabled !== rightTrack.tremoloEnabled
      || leftTrack.tremoloFrequency !== rightTrack.tremoloFrequency
      || leftTrack.tremoloDepth !== rightTrack.tremoloDepth
      || leftTrack.tremoloSpread !== rightTrack.tremoloSpread
      || leftTrack.vibratoEnabled !== rightTrack.vibratoEnabled
      || leftTrack.vibratoFrequency !== rightTrack.vibratoFrequency
      || leftTrack.vibratoDepth !== rightTrack.vibratoDepth
      || leftTrack.filterEnabled !== rightTrack.filterEnabled
      || leftTrack.filterType !== rightTrack.filterType
      || leftTrack.filterFrequency !== rightTrack.filterFrequency
      || leftTrack.filterRolloff !== rightTrack.filterRolloff
      || leftTrack.filterQ !== rightTrack.filterQ
      || leftTrack.filterGain !== rightTrack.filterGain
      || leftTrack.filterKeyFollow !== rightTrack.filterKeyFollow
      || leftTrack.filterEnvelopeAttack !== rightTrack.filterEnvelopeAttack
      || leftTrack.filterEnvelopeDecay !== rightTrack.filterEnvelopeDecay
      || leftTrack.filterEnvelopeSustain !== rightTrack.filterEnvelopeSustain
      || leftTrack.filterEnvelopeRelease !== rightTrack.filterEnvelopeRelease
      || leftTrack.filterEnvelopeAmount !== rightTrack.filterEnvelopeAmount
      || leftTrack.filterLfoEnabled !== rightTrack.filterLfoEnabled
      || leftTrack.filterLfoSync !== rightTrack.filterLfoSync
      || leftTrack.filterLfoRateHz !== rightTrack.filterLfoRateHz
      || leftTrack.filterLfoRate !== rightTrack.filterLfoRate
      || leftTrack.filterLfoAmount !== rightTrack.filterLfoAmount
      || leftTrack.filterLfoWaveform !== rightTrack.filterLfoWaveform
      || leftTrack.filterLfoInitPhase !== rightTrack.filterLfoInitPhase
      || leftTrack.limiterGain !== rightTrack.limiterGain
      || JSON.stringify(leftTrack.waveshaper) !== JSON.stringify(rightTrack.waveshaper)
      || leftTrack.echoEnabled !== rightTrack.echoEnabled
      || leftTrack.echoDelay !== rightTrack.echoDelay
      || leftTrack.echoFeedback !== rightTrack.echoFeedback
      || leftTrack.echoWet !== rightTrack.echoWet
      || leftTrack.echoPingPong !== rightTrack.echoPingPong
      || leftTrack.chorusEnabled !== rightTrack.chorusEnabled
      || leftTrack.chorusRate !== rightTrack.chorusRate
      || leftTrack.chorusDelay !== rightTrack.chorusDelay
      || leftTrack.chorusDepth !== rightTrack.chorusDepth
      || leftTrack.chorusSpread !== rightTrack.chorusSpread
      || leftTrack.chorusFeedback !== rightTrack.chorusFeedback
      || leftTrack.chorusWet !== rightTrack.chorusWet
      || leftTrack.flangerEnabled !== rightTrack.flangerEnabled
      || leftTrack.flangerRate !== rightTrack.flangerRate
      || leftTrack.flangerDelay !== rightTrack.flangerDelay
      || leftTrack.flangerDepth !== rightTrack.flangerDepth
      || leftTrack.flangerFeedback !== rightTrack.flangerFeedback
      || leftTrack.flangerWet !== rightTrack.flangerWet
      || leftTrack.phaserEnabled !== rightTrack.phaserEnabled
      || leftTrack.phaserRate !== rightTrack.phaserRate
      || leftTrack.phaserCenter !== rightTrack.phaserCenter
      || leftTrack.phaserDepth !== rightTrack.phaserDepth
      || leftTrack.phaserStages !== rightTrack.phaserStages
      || leftTrack.phaserFeedback !== rightTrack.phaserFeedback
      || leftTrack.phaserQ !== rightTrack.phaserQ
      || leftTrack.phaserWet !== rightTrack.phaserWet
      || leftTrack.reverbWet !== rightTrack.reverbWet) {
      return false;
    }
  }

  return true;
}

export function createNamedPreset(name: string, data: PresetData, createdAt = isoNow()): NamedPreset {
  const normalizedData = normalizePresetData(data);

  return {
    id: createId(),
    name: sanitizePresetName(name),
    createdAt,
    updatedAt: createdAt,
    folderId: ROOT_FOLDER_ID,
    data: normalizedData,
  };
}

export function createPresetFolder(name: string, parentFolderId: string | null = ROOT_FOLDER_ID, createdAt = isoNow()): PresetFolder {
  return {
    id: createId(),
    name: sanitizeFolderName(name),
    createdAt,
    updatedAt: createdAt,
    parentFolderId,
  };
}

export function sanitizePresetName(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : 'Untitled preset';
}

export function sanitizeFolderName(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : 'Untitled folder';
}

function normalizeNamedPreset(value: unknown, index: number): NamedPreset {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<NamedPreset> & Partial<LegacyNamedPreset>;
  const createdAt = typeof raw.createdAt === 'string' && raw.createdAt.length > 0 ? raw.createdAt : isoNow();
  const updatedAt = typeof raw.updatedAt === 'string' && raw.updatedAt.length > 0 ? raw.updatedAt : createdAt;

  return {
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : `imported-${index + 1}-${createId()}`,
    name: sanitizePresetName(raw.name),
    createdAt,
    updatedAt,
    folderId: typeof raw.folderId === 'string' && raw.folderId.length > 0 ? raw.folderId : ROOT_FOLDER_ID,
    data: normalizePresetData(raw.data),
  };
}

function normalizePresetFolder(value: unknown, index: number): PresetFolder {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<PresetFolder>;
  const createdAt = typeof raw.createdAt === 'string' && raw.createdAt.length > 0 ? raw.createdAt : isoNow();
  const updatedAt = typeof raw.updatedAt === 'string' && raw.updatedAt.length > 0 ? raw.updatedAt : createdAt;

  return {
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : `folder-${index + 1}-${createId()}`,
    name: sanitizeFolderName(raw.name),
    createdAt,
    updatedAt,
    parentFolderId: typeof raw.parentFolderId === 'string' && raw.parentFolderId.length > 0 ? raw.parentFolderId : ROOT_FOLDER_ID,
  };
}

function dedupeFolderIds(folders: PresetFolder[], blockedIds: Set<string>): PresetFolder[] {
  const seen = new Set<string>();
  return folders.map((folder) => {
    let id = folder.id;
    while (seen.has(id) || blockedIds.has(id)) {
      id = `folder-${createId()}`;
    }
    seen.add(id);
    blockedIds.add(id);
    return id === folder.id ? folder : { ...folder, id };
  });
}

function dedupePresetIds(presets: NamedPreset[], blockedIds: Set<string>): NamedPreset[] {
  const seen = new Set<string>();
  return presets.map((preset) => {
    let id = preset.id;
    while (seen.has(id) || blockedIds.has(id)) {
      id = `preset-${createId()}`;
    }
    seen.add(id);
    blockedIds.add(id);
    return id === preset.id ? preset : { ...preset, id };
  });
}

function repairFolderGraph(folders: PresetFolder[]): PresetFolder[] {
  const folderIds = new Set(folders.map((folder) => folder.id));
  const cleaned = folders.map((folder) => ({
    ...folder,
    parentFolderId: folder.parentFolderId && folderIds.has(folder.parentFolderId) && folder.parentFolderId !== folder.id
      ? folder.parentFolderId
      : ROOT_FOLDER_ID,
  }));

  const parentById = new Map(cleaned.map((folder) => [folder.id, folder.parentFolderId]));
  const fixedParentById = new Map(parentById);

  for (const folder of cleaned) {
    const visited = new Set<string>([folder.id]);
    let cursor = parentById.get(folder.id) ?? ROOT_FOLDER_ID;

    while (cursor) {
      if (visited.has(cursor)) {
        fixedParentById.set(folder.id, ROOT_FOLDER_ID);
        break;
      }
      visited.add(cursor);
      cursor = parentById.get(cursor) ?? ROOT_FOLDER_ID;
    }
  }

  return cleaned.map((folder) => {
    const nextParent = fixedParentById.get(folder.id) ?? ROOT_FOLDER_ID;
    return nextParent === folder.parentFolderId ? folder : { ...folder, parentFolderId: nextParent };
  });
}

function normalizeLibraryFromParts(
  rawFolders: unknown[],
  rawPresets: unknown[],
  selectedPresetId: string | null | undefined,
  migratedLegacy: boolean,
): PresetLibrary | null {
  let folders = rawFolders.map((folder, index) => normalizePresetFolder(folder, index));
  let presets = rawPresets.map((preset, index) => normalizeNamedPreset(preset, index));

  const blockedIds = new Set<string>();
  folders = dedupeFolderIds(folders, blockedIds);
  presets = dedupePresetIds(presets, blockedIds);

  folders = repairFolderGraph(folders);
  const validFolderIds = new Set(folders.map((folder) => folder.id));
  presets = presets.map((preset) => ({
    ...preset,
    folderId: preset.folderId && validFolderIds.has(preset.folderId) ? preset.folderId : ROOT_FOLDER_ID,
  }));

  if (presets.length === 0) {
    return null;
  }

  const resolvedSelectedPresetId = typeof selectedPresetId === 'string' && presets.some((preset) => preset.id === selectedPresetId)
    ? selectedPresetId
    : presets[0].id;

  return {
    version: 2,
    migratedLegacy,
    selectedPresetId: resolvedSelectedPresetId,
    folders,
    presets,
  };
}

function normalizeLibrary(value: unknown): PresetLibrary | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const raw = value as Partial<PresetLibrary> & LegacyPresetLibrary & Record<string, unknown>;
  const rawPresets = Array.isArray(raw.presets) ? raw.presets : [];
  const rawFolders = Array.isArray(raw.folders) ? raw.folders : [];

  const library = normalizeLibraryFromParts(rawFolders, rawPresets, raw.selectedPresetId ?? null, Boolean(raw.migratedLegacy));
  if (library) {
    return library;
  }

  // Fall back to v1 shape if folders were absent and presets were malformed in v2 coercion.
  if ((raw.version === 1 || !('folders' in raw)) && Array.isArray(raw.presets)) {
    return normalizeLibraryFromParts([], raw.presets, raw.selectedPresetId ?? null, Boolean(raw.migratedLegacy));
  }

  return null;
}

function cloneLibrary(library: PresetLibrary): PresetLibrary {
  return {
    version: 2,
    migratedLegacy: library.migratedLegacy,
    selectedPresetId: library.selectedPresetId,
    folders: library.folders.map((folder) => clonePresetFolder(folder)),
    presets: library.presets.map((preset) => ({ ...preset, data: clonePresetData(preset.data) })),
  };
}

function withNormalizedLibrary(library: PresetLibrary): PresetLibrary {
  return normalizeLibrary(library) ?? createDefaultLibrary();
}

export function listChildFolders(library: PresetLibrary, parentFolderId: string | null): PresetFolder[] {
  return library.folders.filter((folder) => folder.parentFolderId === parentFolderId);
}

export function listFolderPresets(library: PresetLibrary, folderId: string | null): NamedPreset[] {
  return library.presets.filter((preset) => preset.folderId === folderId);
}

export function getFolderById(library: PresetLibrary, folderId: string | null): PresetFolder | null {
  if (!folderId) {
    return null;
  }
  return library.folders.find((folder) => folder.id === folderId) ?? null;
}

export function getFolderPath(library: PresetLibrary, folderId: string | null): PresetFolder[] {
  if (!folderId) {
    return [];
  }

  const byId = new Map(library.folders.map((folder) => [folder.id, folder]));
  const path: PresetFolder[] = [];
  const visited = new Set<string>();
  let cursor = byId.get(folderId) ?? null;

  while (cursor && !visited.has(cursor.id)) {
    path.unshift(cursor);
    visited.add(cursor.id);
    cursor = cursor.parentFolderId ? byId.get(cursor.parentFolderId) ?? null : null;
  }

  return path;
}

export function getFolderDescendantIds(library: PresetLibrary, folderId: string): string[] {
  const childrenByParent = new Map<string, string[]>();
  for (const folder of library.folders) {
    if (!folder.parentFolderId) {
      continue;
    }
    const existing = childrenByParent.get(folder.parentFolderId) ?? [];
    existing.push(folder.id);
    childrenByParent.set(folder.parentFolderId, existing);
  }

  const descendants: string[] = [];
  const stack = [...(childrenByParent.get(folderId) ?? [])];
  const visited = new Set<string>();

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);
    descendants.push(current);
    for (const child of childrenByParent.get(current) ?? []) {
      if (!visited.has(child)) {
        stack.push(child);
      }
    }
  }

  return descendants;
}

export function isFolderDescendant(library: PresetLibrary, folderId: string, possibleDescendantId: string | null): boolean {
  if (!possibleDescendantId) {
    return false;
  }
  if (possibleDescendantId === folderId) {
    return true;
  }
  return getFolderDescendantIds(library, folderId).includes(possibleDescendantId);
}

function ensureUniqueName(existingNames: Set<string>, baseName: string, fallback: (value: string) => string): string {
  const candidate = fallback(baseName);
  if (!existingNames.has(candidate)) {
    existingNames.add(candidate);
    return candidate;
  }

  let suffix = 2;
  while (existingNames.has(`${candidate} (${suffix})`)) {
    suffix += 1;
  }

  const uniqueName = `${candidate} (${suffix})`;
  existingNames.add(uniqueName);
  return uniqueName;
}

export function buildUniquePresetNameInFolder(
  library: PresetLibrary,
  baseName: string,
  folderId: string | null,
  excludedPresetId?: string,
): string {
  const names = new Set(
    library.presets
      .filter((preset) => preset.folderId === folderId && preset.id !== excludedPresetId)
      .map((preset) => preset.name),
  );
  return ensureUniqueName(names, baseName, sanitizePresetName);
}

export function buildUniqueFolderName(
  library: PresetLibrary,
  baseName: string,
  parentFolderId: string | null,
  excludedFolderId?: string,
): string {
  const names = new Set(
    library.folders
      .filter((folder) => folder.parentFolderId === parentFolderId && folder.id !== excludedFolderId)
      .map((folder) => folder.name),
  );
  return ensureUniqueName(names, baseName, sanitizeFolderName);
}

function createDefaultLibrary(): PresetLibrary {
  const preset = createNamedPreset('Default', DEFAULT_PRESET_DATA);

  return {
    version: 2,
    migratedLegacy: false,
    selectedPresetId: preset.id,
    folders: [],
    presets: [preset],
  };
}

function hasLegacyPreset(): boolean {
  return Object.values(LEGACY_KEYS).some((key) => localStorage.getItem(key) !== null);
}

function readLegacyPresetData(): PresetData {
  return normalizePresetData({
    bpm: localStorage.getItem(LEGACY_KEYS.bpm),
    numerator: localStorage.getItem(LEGACY_KEYS.numerator),
    denominator: localStorage.getItem(LEGACY_KEYS.denominator),
    waveform: localStorage.getItem(LEGACY_KEYS.waveform),
    sequenceInput: localStorage.getItem(LEGACY_KEYS.sequenceInput),
    octave: localStorage.getItem(LEGACY_KEYS.octave),
    lengthFactor: localStorage.getItem(LEGACY_KEYS.lengthFactor),
    forte: localStorage.getItem(LEGACY_KEYS.forte),
  });
}

function migrateLegacyPreset(): PresetLibrary | null {
  if (!hasLegacyPreset()) {
    return null;
  }

  const migratedPreset = createNamedPreset('Migrated preset', readLegacyPresetData());

  return {
    version: 2,
    migratedLegacy: true,
    selectedPresetId: migratedPreset.id,
    folders: [],
    presets: [migratedPreset],
  };
}

export function loadPresetLibrary(): PresetLibrary {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_V2);
    if (stored) {
      const parsed = JSON.parse(stored) as unknown;
      const library = normalizeLibrary(parsed);
      if (library) {
        return library;
      }
    }

    const legacyStored = localStorage.getItem(STORAGE_KEY_V1);
    if (legacyStored) {
      const parsedLegacy = JSON.parse(legacyStored) as unknown;
      const library = normalizeLibrary(parsedLegacy);
      if (library) {
        savePresetLibrary(library);
        return library;
      }
    }
  } catch (error) {
    console.warn('Failed to read stored preset library, resetting to defaults.', error);
  }

  const migratedLibrary = migrateLegacyPreset();
  const library = migratedLibrary ?? createDefaultLibrary();
  savePresetLibrary(library);
  return library;
}

export function savePresetLibrary(library: PresetLibrary): void {
  const normalizedLibrary = withNormalizedLibrary(library);
  localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(normalizedLibrary));
}

export function getSelectedPreset(library: PresetLibrary): NamedPreset {
  return library.presets.find((preset) => preset.id === library.selectedPresetId) ?? library.presets[0];
}

export function updatePresetData(preset: NamedPreset, data: PresetData): NamedPreset {
  return {
    ...preset,
    updatedAt: isoNow(),
    data: normalizePresetData(data),
  };
}

export function buildDraftFromUrl(search: string, baseData: PresetData): PresetData {
  const params = new URLSearchParams(search);
  const firstTrack = baseData.tracks[0] ?? DEFAULT_PRESET_TRACK_DATA;

  return normalizePresetData({
    bpm: params.get('bpm') ?? baseData.bpm,
    a4: params.get('a4') ?? baseData.a4,
    forte: params.get('forte') ?? baseData.forte,
    bitmaskSequenceInput: params.get('b') ?? baseData.bitmaskSequenceInput,
    tracks: [
      {
        ...firstTrack,
        numerator: params.get('numerator') ?? firstTrack.numerator,
        denominator: params.get('denominator') ?? firstTrack.denominator,
        phase: params.get('phase') ?? firstTrack.phase,
        waveform: params.get('waveform') ?? firstTrack.waveform,
        sequenceInput: params.get('sequence') ?? firstTrack.sequenceInput,
        octave: params.get('octave') ?? firstTrack.octave,
        lengthFactor: params.get('lengthFactor') ?? firstTrack.lengthFactor,
        lengthOffset: params.get('lengthOffset') ?? firstTrack.lengthOffset,
        delay: params.get('delay') ?? firstTrack.delay,
        repeats: params.get('repeats') ?? firstTrack.repeats,
        timeWarpEnabled: params.get('timeWarpEnabled') ?? firstTrack.timeWarpEnabled,
        timeWarpCurve: params.get('timeWarpCurve') ?? firstTrack.timeWarpCurve,
        timeWarpExpression: params.get('timeWarpExpression') ?? firstTrack.timeWarpExpression,
        timeWarpRepeats: params.get('timeWarpRepeats') ?? firstTrack.timeWarpRepeats,
        timeWarpAmount: params.get('timeWarpAmount') ?? firstTrack.timeWarpAmount,
        timeWarpQuantize: params.get('timeWarpQuantize') ?? firstTrack.timeWarpQuantize,
        timeWarpNoteLengths: params.get('timeWarpNoteLengths') ?? firstTrack.timeWarpNoteLengths,
      },
      ...baseData.tracks.slice(1),
    ],
    reverb: baseData.reverb,
  });
}

export function hasUrlPresetOverrides(search: string): boolean {
  const params = new URLSearchParams(search);

  return ['bpm', 'a4', 'numerator', 'denominator', 'phase', 'waveform', 'sequence', 'octave', 'lengthFactor', 'lengthOffset', 'forte', 'delay', 'repeats', 'timeWarpEnabled', 'timeWarpCurve', 'timeWarpExpression', 'timeWarpRepeats', 'timeWarpAmount', 'timeWarpQuantize', 'timeWarpNoteLengths', 'b']
    .some((key) => params.has(key));
}

export function buildSinglePresetExport(preset: NamedPreset): SinglePresetExport {
  // Single-preset exports are portable and do not depend on library folder topology.
  const normalizedPreset = normalizeNamedPreset({ ...preset, folderId: ROOT_FOLDER_ID }, 0);
  return {
    version: 2,
    kind: 'single-preset',
    exportedAt: isoNow(),
    preset: normalizedPreset,
  };
}

export function buildPresetLibraryExport(library: PresetLibrary): PresetLibraryExport {
  const normalizedLibrary = withNormalizedLibrary(library);
  return {
    version: 2,
    kind: 'preset-library',
    exportedAt: isoNow(),
    selectedPresetId: normalizedLibrary.selectedPresetId,
    folders: normalizedLibrary.folders.map((folder, index) => normalizePresetFolder(folder, index)),
    presets: normalizedLibrary.presets.map((preset, index) => normalizeNamedPreset(preset, index)),
  };
}

export function parsePresetImportPayload(text: string): PresetImportPayload {
  const parsed = JSON.parse(text) as unknown;

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Preset file must contain a JSON object.');
  }

  const raw = parsed as Record<string, unknown>;
  if (raw.version !== 1 && raw.version !== 2) {
    throw new Error('Unsupported preset file version.');
  }

  if (raw.kind === 'single-preset') {
    const normalizedPreset = normalizeNamedPreset(raw.preset, 0);
    return {
      version: raw.version,
      kind: 'single-preset',
      exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : isoNow(),
      preset: raw.version === 1 ? { ...normalizedPreset, folderId: ROOT_FOLDER_ID } : normalizedPreset,
    };
  }

  if (raw.kind === 'preset-library') {
    if (!Array.isArray(raw.presets) || raw.presets.length === 0) {
      throw new Error('Preset library files must contain at least one preset.');
    }

    const folders = raw.version === 2 && Array.isArray(raw.folders)
      ? raw.folders
      : [];

    const normalizedLibrary = normalizeLibraryFromParts(
      folders,
      raw.presets,
      typeof raw.selectedPresetId === 'string' ? raw.selectedPresetId : null,
      false,
    );
    if (!normalizedLibrary) {
      throw new Error('Preset library import file has invalid content.');
    }

    return {
      version: raw.version,
      kind: 'preset-library',
      exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : isoNow(),
      selectedPresetId: normalizedLibrary.selectedPresetId,
      folders: normalizedLibrary.folders,
      presets: normalizedLibrary.presets,
    };
  }

  throw new Error('Unrecognized preset file format.');
}

export function mergeImportedPresets(
  existingPresets: NamedPreset[],
  importedPresets: NamedPreset[],
  preferredSelectedPresetId: string | null = null,
): MergeImportedPresetsResult {
  const existingNames = new Set(existingPresets.map((preset) => preset.name));
  const existingIds = new Set(existingPresets.map((preset) => preset.id));
  const imported: NamedPreset[] = [];
  const idMap = new Map<string, string>();

  for (const preset of importedPresets) {
    const normalizedPreset = normalizeNamedPreset(preset, imported.length);
    let nextId = normalizedPreset.id;
    if (existingIds.has(nextId)) {
      nextId = createId();
    }
    existingIds.add(nextId);

    const mergedPreset: NamedPreset = {
      ...normalizedPreset,
      id: nextId,
      name: ensureUniqueName(existingNames, normalizedPreset.name, sanitizePresetName),
      folderId: ROOT_FOLDER_ID,
    };

    idMap.set(normalizedPreset.id, nextId);
    imported.push(mergedPreset);
  }

  const selectedPresetId = preferredSelectedPresetId
    ? (idMap.get(preferredSelectedPresetId) ?? imported[0]?.id ?? null)
    : (imported[0]?.id ?? null);

  return {
    presets: [...existingPresets, ...imported],
    importedPresets: imported,
    selectedPresetId,
  };
}

export function createFolder(library: PresetLibrary, name: string, parentFolderId: string | null): { library: PresetLibrary; folder: PresetFolder } {
  const normalized = withNormalizedLibrary(library);
  const validatedParent = parentFolderId && normalized.folders.some((folder) => folder.id === parentFolderId)
    ? parentFolderId
    : ROOT_FOLDER_ID;

  const folder = createPresetFolder(buildUniqueFolderName(normalized, name, validatedParent), validatedParent);
  const nextLibrary = withNormalizedLibrary({
    ...normalized,
    folders: [...normalized.folders, folder],
  });

  return {
    library: nextLibrary,
    folder,
  };
}

export function renameFolder(library: PresetLibrary, folderId: string, name: string): PresetLibrary {
  const normalized = withNormalizedLibrary(library);
  const target = normalized.folders.find((folder) => folder.id === folderId);
  if (!target) {
    return normalized;
  }

  const uniqueName = buildUniqueFolderName(normalized, name, target.parentFolderId, target.id);
  return withNormalizedLibrary({
    ...normalized,
    folders: normalized.folders.map((folder) => folder.id === target.id
      ? { ...folder, name: uniqueName, updatedAt: isoNow() }
      : folder),
  });
}

export function moveFolder(library: PresetLibrary, folderId: string, parentFolderId: string | null): PresetLibrary {
  const normalized = withNormalizedLibrary(library);
  const target = normalized.folders.find((folder) => folder.id === folderId);
  if (!target) {
    return normalized;
  }

  if (parentFolderId === folderId || isFolderDescendant(normalized, folderId, parentFolderId)) {
    return normalized;
  }

  const validatedParent = parentFolderId && normalized.folders.some((folder) => folder.id === parentFolderId)
    ? parentFolderId
    : ROOT_FOLDER_ID;
  const uniqueName = buildUniqueFolderName(normalized, target.name, validatedParent, target.id);

  return withNormalizedLibrary({
    ...normalized,
    folders: normalized.folders.map((folder) => folder.id === target.id
      ? { ...folder, parentFolderId: validatedParent, name: uniqueName, updatedAt: isoNow() }
      : folder),
  });
}

export function renamePreset(library: PresetLibrary, presetId: string, name: string): PresetLibrary {
  const normalized = withNormalizedLibrary(library);
  const target = normalized.presets.find((preset) => preset.id === presetId);
  if (!target) {
    return normalized;
  }

  const uniqueName = buildUniquePresetNameInFolder(normalized, name, target.folderId, target.id);
  return withNormalizedLibrary({
    ...normalized,
    presets: normalized.presets.map((preset) => preset.id === target.id
      ? { ...preset, name: uniqueName, updatedAt: isoNow() }
      : preset),
  });
}

export function movePresetToFolder(library: PresetLibrary, presetId: string, folderId: string | null): PresetLibrary {
  const normalized = withNormalizedLibrary(library);
  const target = normalized.presets.find((preset) => preset.id === presetId);
  if (!target) {
    return normalized;
  }

  const validatedFolderId = folderId && normalized.folders.some((folder) => folder.id === folderId)
    ? folderId
    : ROOT_FOLDER_ID;
  const uniqueName = buildUniquePresetNameInFolder(normalized, target.name, validatedFolderId, target.id);

  return withNormalizedLibrary({
    ...normalized,
    presets: normalized.presets.map((preset) => preset.id === target.id
      ? { ...preset, folderId: validatedFolderId, name: uniqueName, updatedAt: isoNow() }
      : preset),
  });
}

export function deletePreset(library: PresetLibrary, presetId: string): DeletePresetResult {
  const normalized = withNormalizedLibrary(library);
  const deletedPreset = normalized.presets.find((preset) => preset.id === presetId) ?? null;
  if (!deletedPreset) {
    return {
      library: normalized,
      deletedPreset: null,
      selectedPresetId: normalized.selectedPresetId,
    };
  }

  const remaining = normalized.presets.filter((preset) => preset.id !== presetId);
  const nextPresets = remaining.length > 0
    ? remaining
    : [createNamedPreset('Default', DEFAULT_PRESET_DATA)];
  const nextSelectedPresetId = nextPresets.some((preset) => preset.id === normalized.selectedPresetId)
    ? normalized.selectedPresetId
    : nextPresets[0].id;

  return {
    library: withNormalizedLibrary({
      ...normalized,
      presets: nextPresets,
      selectedPresetId: nextSelectedPresetId,
    }),
    deletedPreset,
    selectedPresetId: nextSelectedPresetId,
  };
}

export function deleteFolderRecursive(library: PresetLibrary, folderId: string): DeleteFolderRecursiveResult {
  const normalized = withNormalizedLibrary(library);
  if (!normalized.folders.some((folder) => folder.id === folderId)) {
    return {
      library: normalized,
      deletedFolderIds: [],
      deletedPresetIds: [],
      selectedPresetId: normalized.selectedPresetId,
    };
  }

  const deletedFolderIds = [folderId, ...getFolderDescendantIds(normalized, folderId)];
  const folderSet = new Set(deletedFolderIds);
  const deletedPresetIds = normalized.presets
    .filter((preset) => preset.folderId && folderSet.has(preset.folderId))
    .map((preset) => preset.id);
  const deletedPresetSet = new Set(deletedPresetIds);
  const nextFolders = normalized.folders.filter((folder) => !folderSet.has(folder.id));
  const remaining = normalized.presets.filter((preset) => !deletedPresetSet.has(preset.id));
  const nextPresets = remaining.length > 0
    ? remaining
    : [createNamedPreset('Default', DEFAULT_PRESET_DATA)];
  const nextSelectedPresetId = nextPresets.some((preset) => preset.id === normalized.selectedPresetId)
    ? normalized.selectedPresetId
    : nextPresets[0].id;

  return {
    library: withNormalizedLibrary({
      ...normalized,
      folders: nextFolders,
      presets: nextPresets,
      selectedPresetId: nextSelectedPresetId,
    }),
    deletedFolderIds,
    deletedPresetIds,
    selectedPresetId: nextSelectedPresetId,
  };
}

export function mergeImportedPresetLibrary(
  existingLibrary: PresetLibrary,
  imported: PresetLibraryImportPayload,
  options?: {
    preferredSelectedPresetId?: string | null;
    singlePresetDestinationFolderId?: string | null;
  },
): MergeImportedPresetLibraryResult {
  const normalizedExisting = withNormalizedLibrary(existingLibrary);
  const importedLibrary = withNormalizedLibrary({
    version: 2,
    migratedLegacy: false,
    selectedPresetId: imported.selectedPresetId,
    folders: imported.folders,
    presets: imported.presets,
  });

  const usedIds = new Set<string>([
    ...normalizedExisting.folders.map((folder) => folder.id),
    ...normalizedExisting.presets.map((preset) => preset.id),
  ]);

  const folderIdMap = new Map<string, string>();
  const importedFolders: PresetFolder[] = [];
  for (const folder of importedLibrary.folders) {
    let nextId = folder.id;
    while (usedIds.has(nextId)) {
      nextId = `folder-${createId()}`;
    }
    usedIds.add(nextId);
    folderIdMap.set(folder.id, nextId);
    importedFolders.push({ ...folder, id: nextId });
  }

  const existingWithFolders: PresetLibrary = {
    ...normalizedExisting,
    folders: [...normalizedExisting.folders],
    presets: [...normalizedExisting.presets],
  };

  const remappedFolders = importedFolders.map((folder) => {
    const mappedParentId = folder.parentFolderId
      ? (folderIdMap.get(folder.parentFolderId) ?? ROOT_FOLDER_ID)
      : ROOT_FOLDER_ID;
    const name = buildUniqueFolderName(existingWithFolders, folder.name, mappedParentId);
    const nextFolder: PresetFolder = {
      ...folder,
      parentFolderId: mappedParentId,
      name,
    };
    existingWithFolders.folders.push(nextFolder);
    return nextFolder;
  });

  const presetIdMap = new Map<string, string>();
  const importedPresets: NamedPreset[] = [];
  for (const preset of importedLibrary.presets) {
    let nextId = preset.id;
    while (usedIds.has(nextId)) {
      nextId = `preset-${createId()}`;
    }
    usedIds.add(nextId);

    const mappedFolderId = options?.singlePresetDestinationFolderId !== undefined
      ? options.singlePresetDestinationFolderId
      : (preset.folderId ? folderIdMap.get(preset.folderId) ?? ROOT_FOLDER_ID : ROOT_FOLDER_ID);
    const validFolderId = mappedFolderId && existingWithFolders.folders.some((folder) => folder.id === mappedFolderId)
      ? mappedFolderId
      : ROOT_FOLDER_ID;
    const name = buildUniquePresetNameInFolder(existingWithFolders, preset.name, validFolderId);

    const nextPreset: NamedPreset = {
      ...preset,
      id: nextId,
      folderId: validFolderId,
      name,
    };
    existingWithFolders.presets.push(nextPreset);
    importedPresets.push(nextPreset);
    presetIdMap.set(preset.id, nextId);
  }

  const preferredSelectedPresetId = options?.preferredSelectedPresetId ?? imported.selectedPresetId;
  const selectedPresetId = preferredSelectedPresetId
    ? (presetIdMap.get(preferredSelectedPresetId) ?? importedPresets[0]?.id ?? null)
    : (importedPresets[0]?.id ?? null);

  const nextLibrary = withNormalizedLibrary({
    ...existingWithFolders,
    selectedPresetId: selectedPresetId ?? existingWithFolders.selectedPresetId,
  });

  return {
    library: nextLibrary,
    importedFolders: remappedFolders,
    importedPresets,
    selectedPresetId,
  };
}
