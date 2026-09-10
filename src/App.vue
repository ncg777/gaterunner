<template>
  <v-app class="app-shell">
    <v-main class="workspace-main">
      <div ref="controlDeck" class="control-deck">
        <div class="control-deck-header">
          <v-btn
            class="control-deck-toggle"
            icon
            variant="flat"
            size="small"
            color="surface"
            :title="controlDeckCollapsed ? 'Show controls' : 'Hide controls'"
            @click="toggleControlDeck"
          >
            <v-icon>{{ controlDeckCollapsed ? 'mdi-chevron-down' : 'mdi-chevron-up' }}</v-icon>
          </v-btn>

          <div class="brand-group">
            <h1 class="app-title">GateRunner</h1>
            <span class="version-pill">v{{ appVersion }}</span>
          </div>

          <div class="header-actions">
            <v-btn
              class="header-icon-btn play-toggle-btn"
              icon
              variant="flat"
              size="small"
              :color="isRunning ? 'error' : 'success'"
              :title="isRunning ? 'Stop' : 'Play'"
              :disabled="isStarting"
              @click="toggleSequencer"
            >
              <v-icon>{{ isRunning ? 'mdi-stop' : 'mdi-play' }}</v-icon>
            </v-btn>
            <v-menu v-model="transportMenuOpen" location="bottom end" :close-on-content-click="false">
              <template #activator="{ props }">
                <v-btn
                  v-bind="props"
                  class="header-icon-btn"
                  icon
                  variant="tonal"
                  color="primary"
                  size="small"
                  title="Global actions"
                >
                  <v-icon>mdi-dots-vertical</v-icon>
                </v-btn>
              </template>
              <v-list density="compact" class="transport-action-menu">
                <v-list-item
                  title="Download MIDI"
                  prepend-icon="mdi-music-note"
                  :disabled="isExporting"
                  @click="downloadMIDI"
                />
                <v-list-item
                  :title="isExporting && exportFormat === 'wav' ? 'Rendering WAV...' : 'Download WAV'"
                  prepend-icon="mdi-waveform"
                  :disabled="isExporting"
                  @click="downloadWAV"
                />
                <v-divider class="my-1" />
                <v-list-subheader>MIDI</v-list-subheader>
                <v-list-item class="midi-menu-item" :ripple="false">
                  <template #prepend>
                    <v-icon>mdi-midi-port</v-icon>
                  </template>
                  <template #default>
                    <v-switch
                      v-model="useMidiOutput"
                      label="MIDI Output"
                      hide-details
                      density="compact"
                      inset
                      class="midi-menu-switch"
                      @update:modelValue="updateMidiMode"
                    />
                  </template>
                </v-list-item>
                <v-list-item v-if="useMidiOutput" class="midi-menu-item" :ripple="false">
                  <template #prepend>
                    <v-icon>mdi-usb-port</v-icon>
                  </template>
                  <template #default>
                    <v-select
                      v-model="selectedMidiDevice"
                      :items="midiDevices"
                      label="MIDI Device"
                      hide-details
                      density="compact"
                      variant="outlined"
                      class="midi-menu-device-select"
                      @update:modelValue="updateMidiDevice"
                    />
                  </template>
                </v-list-item>
              </v-list>
            </v-menu>

            <v-btn
              icon
              variant="text"
              size="small"
              class="toolbar-icon-btn header-icon-btn"
              title="Help"
              @click="showHelp = true"
            >
              <v-icon>mdi-help-circle</v-icon>
            </v-btn>
          </div>
        </div>

        <PresetManager
          ref="presetManager"
          :initial-library="initialPresetLibrary"
          :initial-dirty="isDirty"
          :draft-data="draftData"
          :apply-draft-data="applyDraftData"
          :confirm-discard-changes="confirmDiscardChanges"
          :ask-for-confirmation="askForConfirmation"
          :ask-for-text-input="askForTextInput"
          :show-notice="showNotice"
          @dirty-change="handlePresetDirtyChange"
        />

        <div v-show="!controlDeckCollapsed" class="toolbar-panel dependent-settings-panel">
          <div class="dependent-settings-row">
            <div class="forte-control-top">
              <v-autocomplete
                label="Forte number"
                v-model="forte"
                :items="allChords"
                placeholder="Forte number..."
                hide-details
                density="compact"
                variant="outlined"
                prepend-inner-icon="mdi-piano"
                @update:modelValue="handleDraftChange"
              />
            </div>
            <div class="tempo-control">
              <EditableSlider
                :label="'Tempo (' + bpm + ' BPM)'"
                :min="1"
                :step="1"
                :max="499"
                v-model="bpm"
                @update:modelValue="handleDraftChange"
              />
            </div>
            <div class="a4-control">
              <EditableSlider
                :label="'A4 (' + Number(a4).toFixed(1) + ' Hz)'"
                :min="380"
                :step="0.1"
                :max="500"
                v-model="a4"
                @update:modelValue="handleDraftChange"
              />
            </div>
          </div>
        </div>

        <div v-show="!controlDeckCollapsed" class="track-rack">
          <div class="track-rack-summary">
            <button
              type="button"
              class="track-rack-toggle"
              aria-controls="track-rack-panel"
              :aria-expanded="trackStripExpanded ? 'true' : 'false'"
              :title="trackStripExpanded ? 'Show track editor' : 'Show track overview'"
              @click="trackStripExpanded = !trackStripExpanded"
            >
              <v-icon size="18">{{ trackStripExpanded ? 'mdi-chevron-down' : 'mdi-chevron-right' }}</v-icon>
              <v-icon size="17" class="track-rack-icon">mdi-timeline-clock-outline</v-icon>
              <span class="track-rack-label">Tracks</span>
              <span class="track-rack-count">{{ tracks.length }}</span>
              <span class="track-rack-divider" aria-hidden="true"></span>
              <span class="track-rack-current">{{ currentTrack?.name ?? 'No track selected' }}</span>
            </button>

            <v-menu location="bottom end">
              <template #activator="{ props }">
                <v-btn
                  v-bind="props"
                  class="track-rack-add"
                  icon
                  size="x-small"
                  variant="text"
                  color="secondary"
                  title="Add track"
                >
                  <v-icon size="17">mdi-plus</v-icon>
                </v-btn>
              </template>
              <v-list density="compact">
                <v-list-item title="Add melodic track" prepend-icon="mdi-sine-wave" @click="addTrack('melodic')" />
                <v-list-item title="Add rhythmic track" prepend-icon="mdi-metronome" @click="addTrack('rhythmic')" />
              </v-list>
            </v-menu>
          </div>
        </div>
      </div>

      <div class="control-deck-spacer" :style="{ height: `${controlDeckHeight + 12}px` }"></div>

      <section
        v-show="trackStripExpanded"
        id="track-rack-panel"
        class="track-workspace"
        aria-label="Track overview"
      >
        <TrackStrip
          :tracks="tracks"
          :selected-track-id="selectedTrackId"
          :track-mix-states="trackMixStates"
          :bitmask-sequence-input="bitmaskSequenceInput"
          :loop-duration-seconds="loopDurationSeconds"
          :bpm="bpm"
          @select-track="handleTrackSelection"
          @track-name-input="handleTrackNameInput"
          @commit-track-name="commitTrackName"
          @toggle-muted="toggleTrackMuted"
          @toggle-soloed="toggleTrackSoloed"
          @duplicate-track="duplicateTrack"
          @remove-track="removeTrack"
          @bitmask-sequence-input="handleBitmaskSequenceInput"
        />
      </section>

      <EditorSurface
        v-show="!trackStripExpanded"
        :track="currentTrack"
        :reverb="reverbSettings"
        :bpm="bpm"
        @track-change="handleTrackDraftChange"
        @reverb-change="handleReverbDraftChange"
      />

      <ExportProgressDialog
        :visible="isExporting"
        :format="exportFormat"
        :progress="exportProgress"
        :status="exportStatus"
      />

      <v-dialog v-model="showConfirmDialog" max-width="460px" persistent>
        <v-card class="rename-dialog-card">
          <v-card-title class="text-h6">{{ confirmDialogTitle }}</v-card-title>
          <v-card-text>{{ confirmDialogMessage }}</v-card-text>
          <v-card-actions>
            <v-spacer></v-spacer>
            <v-btn variant="text" @click="resolveConfirmDialog(false)">Cancel</v-btn>
            <v-btn color="error" @click="resolveConfirmDialog(true)">{{ confirmDialogConfirmLabel }}</v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>

      <v-dialog v-model="showInputDialog" max-width="460px" persistent>
        <v-card class="rename-dialog-card">
          <v-card-title class="text-h6">{{ inputDialogTitle }}</v-card-title>
          <v-card-text>
            <v-text-field
              v-model="inputDialogValue"
              :label="inputDialogLabel"
              density="comfortable"
              variant="outlined"
              autofocus
              @keydown.enter.prevent="resolveInputDialog(true)"
            />
          </v-card-text>
          <v-card-actions>
            <v-spacer></v-spacer>
            <v-btn variant="text" @click="resolveInputDialog(false)">Cancel</v-btn>
            <v-btn color="primary" @click="resolveInputDialog(true)" :disabled="inputDialogValue.trim().length === 0">{{ inputDialogConfirmLabel }}</v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>

      <HelpDialog v-model="showHelp" :app-version="appVersion" />
    </v-main>
    <v-snackbar
      v-model="showPlaybackError"
      :timeout="5000"
      color="error"
      location="top"
    >
      {{ playbackErrorMessage }}
      <template #actions>
        <v-btn variant="text" @click="showPlaybackError = false">Close</v-btn>
      </template>
    </v-snackbar>

    <v-snackbar
      v-model="showAppNotice"
      :timeout="3000"
      :color="appNoticeColor"
      location="top"
    >
      {{ appNoticeMessage }}
      <template #actions>
        <v-btn variant="text" @click="showAppNotice = false">Close</v-btn>
      </template>
    </v-snackbar>
  </v-app>
</template>

<script lang="ts">
import pkg from '../package.json';
const appVersion = pkg.version;
import { defineComponent, markRaw } from 'vue';
import EditableSlider from './components/EditableSlider.vue';
import EditorSurface from './components/EditorSurface.vue';
import ExportProgressDialog from './components/ExportProgressDialog.vue';
import HelpDialog from './components/HelpDialog.vue';
import PresetManager from './components/PresetManager.vue';
import TrackStrip from './components/TrackStrip.vue';
import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import { PCS12 } from 'ultra-mega-enumerator';
import {
  createReverbAudioChain,
  disposeReverbAudioChain,
  updateReverbAudioChain,
  setReverbOutputEnabled,
  type ReverbAudioChain,
} from './audio/reverb';
import { encodeWavFromChannels } from './audio/wav';
import { renderOfflineAudio } from './audio/offlineRender';
import { buildTrackFadeEnvelope } from './audio/trackFade';
import { getStepDurations } from './audio/stepDurations';
import { Phaser } from './audio/phaser';
import { TANH_CURVE } from './audio/trackDistortion';
import {
  createWaveshaperAudioChain,
  updateWaveshaperAudioChain,
  disposeWaveshaperAudioChain,
  type WaveshaperAudioChain,
} from './audio/waveshaperEffect';
import { setTremoloSpread } from './audio/tremolo';
import {
  createSkewLfoState,
  getLfoFrequencyHz,
  sampleLfoAtTime,
  type LfoWaveform,
} from './audio/lfo';
import { getChoirFormantBandGainLinear } from './audio/choir';
import { PitchEnvelopeSynth } from './audio/pitchEnvelopeSynth';
import { MonoGlideSynth } from './audio/monoGlideSynth';
import { isMonophonic, limitPolyphony, type GlideCurve, type GlideMode } from './audio/glide';
import { claimVoices, getSynthVoiceCount, prewarmVoicePool, retainVoicePool, type SoundingNote } from './audio/voicePool';
import { createDrumInstrument, type DrumInstrument } from './audio/drumKit';
import { interpolateModulatedTonewheelDrawbars } from './audio/tonewheelWavetable';
import { generatePartialSpectrum, normalizePartialGenerator } from './audio/partialGenerator';
import {
  BREATH_FILTER_Q,
} from './audio/spectra';
import {
  quantizeNormalizedTime,
  resolveTimeWarpFunction,
  warpNormalizedTime,
} from './audio/timeWarp';
import {
  DEFAULT_PRESET_DATA,
  DEFAULT_PRESET_TRACK_DATA,
  PHASER_MAX_SWEEP_OCTAVES,
  arePresetDataEqual,
  buildDraftFromUrl,
  clonePresetData,
  clonePresetTrackData,
  getSelectedPreset,
  hasUrlPresetOverrides,
  loadPresetLibrary,
  normalizePresetData,
  normalizePresetTrackData,
  sanitizeTrackName,
  type EchoDelayValue,
  type ModulationRateValue,
  type PresetData,
  type PresetLibrary,
  type PresetReverbData,
  type PresetTrackData,
  type TrackKind,
} from './presets';
import {
  decodeRhythmSequence,
  buildDrumChokeMap,
  type DrumVoiceId,
  type RhythmHit,
} from './domain/rhythmTrack';
import {
  gateEventByActivation,
  parseBitmaskSequenceInput,
} from './trackActivation';

interface ChoirFormantPath {
  filter: Tone.Filter;
  gain: Tone.Gain;
}

interface ChoirFormantBank {
  input: Tone.Gain;
  output: Tone.Gain;
  formants: ChoirFormantPath[];
}

/** Tracks run either the pooled polyphonic engine or the single-voice glide engine. */
type TonewheelPolySynth = Tone.PolySynth<PitchEnvelopeSynth>;
type TrackSynth = TonewheelPolySynth | MonoGlideSynth;

/**
 * Per-track audio graph. Everything that is not always in the signal path is created
 * lazily the first time the track needs it, so a plain track (and every rhythm track)
 * only pays for the handful of nodes it actually uses instead of allocating the full
 * effect rack up front.
 */
interface TrackAudioChain {
  synth: TrackSynth | null;
  synthGain: Tone.Gain | null;
  noiseSynth: Tone.NoiseSynth | null;
  breathFilter: Tone.Filter | null;
  breathGain: Tone.Gain | null;
  filter: Tone.Filter | null;
  choir: ChoirFormantBank | null;
  sourceBus: Tone.Gain;
  waveshaper: WaveshaperAudioChain | null;
  limiterGain: Tone.Gain;
  limiter: Tone.WaveShaper;
  tremolo: Tone.Tremolo | null;
  vibrato: Tone.Vibrato | null;
  chorus: Tone.Chorus | null;
  flanger: Tone.FeedbackDelay | null;
  flangerLfo: Tone.LFO | null;
  phaser: Phaser | null;
  phaserStages: number;
  phaserCenterFrequency: number;
  echo: Tone.FeedbackDelay | Tone.PingPongDelay | null;
  echoPingPong: boolean;
  maxDelay: number;
  echoReturnGain: Tone.Gain;
  dryGain: Tone.Gain;
  reverbSend: Tone.Gain;
  drumReverbFadeGain: Tone.Gain;
  drumReverbTrackGain: Tone.Gain;
  outputGain: Tone.Gain;
  fadeGain: Tone.Gain;
  mixGain: Tone.Gain;
  drumInstruments: Record<string, DrumInstrument>;
  drumSignature: string;
  drumParameterSignature: string;
  drumChokeMap: Map<DrumVoiceId, DrumVoiceId[]>;
  drumRebuildTimer: number | null;
  routingSignature: string;
  voiceSignature: string;
  wavetableLfoLoop: Tone.Loop | null;
  lastAppliedPartials: number[] | null;
  modulationTrack: PresetTrackData | null;
  modulationNoteStartSeconds: number;
  /** Notes the polyphonic engine is currently holding, oldest first, for voice stealing. */
  soundingNotes: SoundingNote[];
}

const ENVELOPE_SMOOTHING_SECONDS = 0.005;
const CHOIR_FORMANT_FILTER_COUNT = 5;
/** Upper bound for the flanger delay line; the sweep never exceeds twice the 20 ms maximum base delay. */
const FLANGER_MAX_DELAY_SECONDS = 0.05;
const WAV_EXPORT_SAMPLE_RATE = 48000;
/** Deterministic S&H seed for the filter-cutoff LFO (sampled per note start). */
const FILTER_LFO_STATE = createSkewLfoState();

/** Reusable static spectra, keyed by waveform and normalized generator settings. */
const partialSpectrumCache = new Map<string, number[]>();
const PARTIAL_SPECTRUM_CACHE_LIMIT = 1024;

interface FormantBand {
  frequency: number;
  bandwidth: number;
  gainDb: number;
}

const CHOIR_FORMANT_BANDS: Record<'choir-ah' | 'choir-oh', readonly FormantBand[]> = {
  'choir-ah': [
    { frequency: 730, bandwidth: 90, gainDb: 0 },
    { frequency: 1090, bandwidth: 110, gainDb: -4 },
    { frequency: 2440, bandwidth: 140, gainDb: -8 },
    { frequency: 3400, bandwidth: 220, gainDb: -14 },
    { frequency: 4500, bandwidth: 280, gainDb: -20 },
  ],
  'choir-oh': [
    { frequency: 450, bandwidth: 70, gainDb: 0 },
    { frequency: 800, bandwidth: 90, gainDb: -5 },
    { frequency: 2830, bandwidth: 130, gainDb: -12 },
    { frequency: 3500, bandwidth: 200, gainDb: -18 },
    { frequency: 4500, bandwidth: 260, gainDb: -24 },
  ],
};

type NoiseWaveform = 'pink-noise' | 'brown-noise';
type ChoirWaveform = keyof typeof CHOIR_FORMANT_BANDS;

export interface TrackMixState {
  muted: boolean;
  soloed: boolean;
}

interface TrackScheduledEvent {
  time: number;
  duration: number;
  velocity: number;
  notes: number[];
  noteVelocities?: number[];
  drumVoiceIds?: DrumVoiceId[];
  step: number;
  order: number;
}

function buildInitialState() {
  const presetLibrary = loadPresetLibrary();
  const selectedPreset = getSelectedPreset(presetLibrary);
  const draft = buildDraftFromUrl(window.location.search, selectedPreset.data);
  const selectedTrackId = draft.tracks[0]?.id ?? null;

  return {
    presetLibrary,
    selectedPresetId: selectedPreset.id,
    selectedPresetFolderId: selectedPreset.folderId,
    selectedTrackId,
    isDirty: hasUrlPresetOverrides(window.location.search) || !arePresetDataEqual(draft, selectedPreset.data),
    draft,
  };
}

const initialState = buildInitialState();

export default defineComponent({
  name: 'App',
  components: {
    EditableSlider,
    EditorSurface,
    ExportProgressDialog,
    HelpDialog,
    PresetManager,
    TrackStrip,
  },
  data() {
    return {
      bpm: initialState.draft.bpm,
      a4: initialState.draft.a4,
      forte: initialState.draft.forte,
      bitmaskSequenceInput: initialState.draft.bitmaskSequenceInput,
      tracks: initialState.draft.tracks.map((track) => clonePresetTrackData(track)) as PresetTrackData[],
      trackMixStates: {} as Record<string, TrackMixState>,
      selectedTrackId: initialState.selectedTrackId as string | null,
      reverbEnabled: initialState.draft.reverb.enabled,
      reverbDecay: initialState.draft.reverb.decay,
      reverbPreDelay: initialState.draft.reverb.preDelay,
      reverbDry: initialState.draft.reverb.dry,
      reverbWet: initialState.draft.reverb.wet,
      reverbLowCut: initialState.draft.reverb.lowCut,
      reverbHighCut: initialState.draft.reverb.highCut,
      allChords: [] as string[],
      isRunning: false,
      isStarting: false,
      playbackErrorMessage: '',
      showPlaybackError: false,
      audioContextResumeHandler: null as (() => void) | null,
      trackLoops: markRaw({}) as Record<string, Tone.Part<TrackScheduledEvent>>,
      trackFadeLoops: markRaw({}) as Record<string, Tone.Part<{ time: number }>>,
      showHelp: false,
      trackSynths: markRaw({}) as Record<string, TrackAudioChain>,
      reverbChain: null as ReverbAudioChain | null,
      useMidiOutput: false,
      midiDevices: [] as string[],
      selectedMidiDevice: null as string | null,
      midiAccess: null as MIDIAccess | null,
      midiOutput: null as MIDIOutput | null,
      appVersion: appVersion,
      initialPresetLibrary: initialState.presetLibrary as PresetLibrary,
      isDirty: initialState.isDirty,
      showConfirmDialog: false,
      confirmDialogTitle: 'Confirm',
      confirmDialogMessage: '',
      confirmDialogConfirmLabel: 'Confirm',
      confirmDialogResolver: null as ((value: boolean) => void) | null,
      showInputDialog: false,
      inputDialogTitle: 'Input',
      inputDialogLabel: 'Value',
      inputDialogConfirmLabel: 'Save',
      inputDialogValue: '',
      inputDialogResolver: null as ((value: string | null) => void) | null,
      showAppNotice: false,
      appNoticeMessage: '',
      appNoticeColor: 'info',
      isExporting: false,
      exportFormat: null as 'midi' | 'wav' | null,
      exportProgress: 0,
      exportStatus: '',
      transportMenuOpen: false,
      controlDeckHeight: 0,
      controlDeckCollapsed: false,
      trackStripExpanded: false,
      controlDeckResizeObserver: null as ResizeObserver | null,
      rebuildTrackLoopsTimer: null as number | null,
    };
  },
  computed: {
    currentTrack(): PresetTrackData | null {
      return this.tracks.find((track) => track.id === this.selectedTrackId) ?? this.tracks[0] ?? null;
    },
    reverbSettings() {
      return {
        enabled: this.reverbEnabled,
        decay: this.reverbDecay,
        preDelay: this.reverbPreDelay,
        dry: this.reverbDry,
        wet: this.reverbWet,
        lowCut: this.reverbLowCut,
        highCut: this.reverbHighCut,
      };
    },
    noteRange(): { min: number, max: number } {
      const allNotes = this.allTrackActualNotes.flatMap((entry) => entry.notes.flat());
      if (allNotes.length === 0) return { min: 0, max: 127 };
      const min = Math.min(...allNotes);
      const max = Math.max(...allNotes);
      // Add some padding
      const padding = Math.max(3, Math.floor((max - min) * 0.1));
      return { 
        min: Math.max(0, min - padding), 
        max: Math.min(127, max + padding) 
      };
    },
    scale(): number[] {
      const s = PCS12.parseForte(this.forte);
      const p = s?.asSequence() ?? [];
      const o: number[] = [];
      
      for (const n of p) {
        for (let i = 0; i <= 10; i += 1) {
          const t = n + (12 * i);
          if(t < 128) o.push(t);
        }
      }
      o.sort((a, b) => a - b);
      return o; 
    },
    allTrackActualNotes(): Array<{ track: PresetTrackData; notes: number[][]; noteVelocities?: number[][]; drumVoiceIds?: DrumVoiceId[][]; trackIndex: number }> {
      return this.tracks.map((track, trackIndex) => {
        if (track.trackKind === 'rhythmic') {
          const rhythmSteps = this.getRhythmSteps(track);
          return {
            track,
            trackIndex,
            notes: rhythmSteps.map((step) => step.map((hit) => hit.midi)),
            noteVelocities: rhythmSteps.map((step) => step.map((hit) => hit.velocity)),
            drumVoiceIds: rhythmSteps.map((step) => step.map((hit) => hit.voiceId)),
          };
        }

        return {
          track,
          trackIndex,
          notes: this.computeActualNotes(track),
        };
      });
    },
    /**
     * Deep-clones + normalizes the whole preset, so it is cached instead of being
     * rebuilt on every render of the template that passes it to the preset manager.
     */
    draftData(): PresetData {
      return this.getDraftData();
    },
    activationMasks(): bigint[] {
      return parseBitmaskSequenceInput(this.bitmaskSequenceInput).masks;
    },
    /** Scheduled parts resolve their live track per event; a map keeps that O(1). */
    trackById(): Map<string, PresetTrackData> {
      return new Map(this.tracks.map((track) => [track.id, track]));
    },
    /**
     * Solo/mute resolution is consulted for every scheduled event, so it is resolved
     * once per mix-state change instead of rescanning every track per note.
     */
    audibleTrackIds(): Set<string> {
      const anySoloed = this.tracks.some((track) => this.trackMixStates[track.id]?.soloed);
      const audible = new Set<string>();
      for (const track of this.tracks) {
        const state = this.trackMixStates[track.id];
        if (!state?.muted && (!anySoloed || state?.soloed)) {
          audible.add(track.id);
        }
      }
      return audible;
    },
    loopDurationSeconds(): number {
      return this.getLoopDurationSecondsFromTrackLengths();
    },
  },
  methods: {
    getTrackQuant(track: PresetTrackData): number {
      return 60.0 / (this.bpm * track.denominator);
    },
    getTrackBarSeconds(track: PresetTrackData): number {
      return track.numerator * (60.0 / this.bpm);
    },
    getTrackDelaySeconds(track: PresetTrackData): number {
      return track.delay * this.getTrackBarSeconds(track) + track.phase * this.getTrackQuant(track);
    },
    getTrackPatternDuration(track: PresetTrackData, trackNotes: number[][]): number {
      return trackNotes.length * this.getTrackQuant(track);
    },
    getTrackRepeatDuration(track: PresetTrackData, trackNotes: number[][]): number {
      return this.getTrackPatternDuration(track, trackNotes)
        + (track.paddingBefore + track.paddingAfter) * this.getTrackBarSeconds(track);
    },
    getTrackTotalDuration(track: PresetTrackData, trackNotes: number[][]): number {
      return this.getTrackDelaySeconds(track) + track.repeats * this.getTrackRepeatDuration(track, trackNotes);
    },
    getLoopDurationSecondsFromTrackLengths(): number {
      const entries = this.allTrackActualNotes.filter((entry) => entry.notes.length > 0);
      if (entries.length === 0) {
        return 1;
      }

      const maxDuration = Math.max(
        ...entries.map((entry) => this.getTrackTotalDuration(entry.track, entry.notes)),
      );

      return Math.max(this.getTrackQuant(entries[0].track), maxDuration);
    },
    parseSequence(sequenceInput: string): number[] {
      return sequenceInput
        .trim()
        .split(/\s+/)
        .map((n: string) => Number.parseInt(n.trim(), 10))
        .filter((n: number) => !Number.isNaN(n));
    },
    getRhythmSteps(track: PresetTrackData): RhythmHit[][] {
      return decodeRhythmSequence(track.sequenceInput, track.drumLanes, track.drumVelocityBits);
    },
    computeActualNotes(track: PresetTrackData): number[][] {
      if (track.trackKind === 'rhythmic') {
        return this.getRhythmSteps(track).map((step) => step.map((hit) => hit.midi));
      }

      const s = PCS12.parseForte(this.forte);
      if (!s) {
        return [];
      }

      const k = s.getK() ?? 0;
      const sequence = this.parseSequence(track.sequenceInput);

      return sequence.map((n: number) => {
        const bits = Math.abs(n).toString(2).split('').reverse();
        const sign = Math.sign(n) || 1;

        return this.scale.filter((_, idx) => {
          const bitIndex = sign * (idx - track.octave * k);
          return bitIndex >= 0 && bitIndex < bits.length && bits[bitIndex] === '1';
        });
      });
    },
    handleTrackSelection(nextTrackId: string | null) {
      if (!nextTrackId) {
        return;
      }

      this.selectedTrackId = nextTrackId;
    },
    buildUniqueTrackName(baseName: string, excludedTrackId?: string): string {
      const existingNames = new Set(
        this.tracks
          .filter((track) => track.id !== excludedTrackId)
          .map((track) => track.name),
      );
      const sanitizedBaseName = sanitizeTrackName(baseName, this.tracks.length);
      if (!existingNames.has(sanitizedBaseName)) {
        return sanitizedBaseName;
      }

      let suffix = 2;
      while (existingNames.has(`${sanitizedBaseName} (${suffix})`)) {
        suffix += 1;
      }

      return `${sanitizedBaseName} (${suffix})`;
    },
    nextTrackChannel(): number {
      const used = new Set(this.tracks.map((track) => track.midiChannel));
      for (let channel = 1; channel <= 16; channel += 1) {
        if (!used.has(channel)) {
          return channel;
        }
      }
      return 1;
    },
    addTrack(trackKind: TrackKind = 'melodic') {
      const nextTrack = normalizePresetTrackData({
        ...DEFAULT_PRESET_TRACK_DATA,
        id: undefined,
        trackKind,
        name: this.buildUniqueTrackName(trackKind === 'rhythmic' ? `Rhythm ${this.tracks.length + 1}` : `Track ${this.tracks.length + 1}`),
        sequenceInput: '',
        midiChannel: trackKind === 'rhythmic' ? 10 : this.nextTrackChannel(),
      }, this.tracks.length);

      this.tracks = [...this.tracks, nextTrack];
      this.trackMixStates = {
        ...this.trackMixStates,
        [nextTrack.id]: { muted: false, soloed: false },
      };
      this.selectedTrackId = nextTrack.id;
      this.handleDraftChange();
    },
    duplicateTrack(trackId: string) {
      const sourceTrack = this.tracks.find((track) => track.id === trackId);
      if (!sourceTrack) {
        return;
      }

      const sourceIndex = this.tracks.findIndex((track) => track.id === trackId);
      const duplicatedTrack = normalizePresetTrackData({
        ...clonePresetTrackData(sourceTrack),
        id: undefined,
        name: this.buildUniqueTrackName(`${sourceTrack.name} (copy)`),
      }, this.tracks.length);

      this.tracks = [
        ...this.tracks.slice(0, sourceIndex + 1),
        duplicatedTrack,
        ...this.tracks.slice(sourceIndex + 1),
      ];
      this.trackMixStates = {
        ...this.trackMixStates,
        [duplicatedTrack.id]: { muted: false, soloed: false },
      };
      this.selectedTrackId = duplicatedTrack.id;
      this.handleDraftChange();
    },
    handleTrackNameInput(trackId: string, nextName: string) {
      this.tracks = this.tracks.map((track) => track.id === trackId ? { ...track, name: nextName } : track);
      this.refreshDirtyState();
    },
    commitTrackName(trackId: string) {
      const track = this.tracks.find((entry) => entry.id === trackId);
      if (!track) {
        return;
      }

      const nextName = this.buildUniqueTrackName(track.name, track.id);
      this.tracks = this.tracks.map((entry) => entry.id === trackId ? { ...entry, name: nextName } : entry);
      this.refreshDirtyState();
    },
    async removeTrack(trackId: string) {
      const trackToRemove = this.tracks.find((track) => track.id === trackId);
      if (!trackToRemove || this.tracks.length <= 1) {
        return;
      }

      const confirmed = await this.askForConfirmation('Delete Track', `Delete track "${trackToRemove.name}"?`, 'Delete');
      if (!confirmed) {
        return;
      }

      const removedIndex = this.tracks.findIndex((track) => track.id === trackId);
      const nextTracks = this.tracks.filter((track) => track.id !== trackId);
      this.tracks = nextTracks;
      const nextTrackMixStates: Record<string, TrackMixState> = {};
      for (const track of nextTracks) {
        const state = this.trackMixStates[track.id];
        if (state) {
          nextTrackMixStates[track.id] = state;
        }
      }
      this.trackMixStates = nextTrackMixStates;
      if (this.selectedTrackId === trackId) {
        this.selectedTrackId = nextTracks[Math.max(0, removedIndex - 1)]?.id ?? nextTracks[0]?.id ?? null;
      }
      this.handleDraftChange();
    },
    getTrackMixState(trackId: string): TrackMixState {
      return this.trackMixStates[trackId] ?? { muted: false, soloed: false };
    },
    isTrackMuted(trackId: string): boolean {
      return this.getTrackMixState(trackId).muted;
    },
    isTrackSoloed(trackId: string): boolean {
      return this.getTrackMixState(trackId).soloed;
    },
    isTrackAudible(trackId: string): boolean {
      return this.audibleTrackIds.has(trackId);
    },
    applyTrackMixState(track: PresetTrackData, chain: TrackAudioChain) {
      const audible = this.isTrackAudible(track.id);
      chain.mixGain.gain.value = audible ? 1 : 0;
      chain.drumReverbTrackGain.gain.value = audible ? this.dbToGain(track.gain) : 0;
    },
    updateTrackMixStates() {
      for (const track of this.tracks) {
        const chain = this.trackSynths[track.id];
        if (chain) {
          this.applyTrackMixState(track, chain);
        }
      }
    },
    toggleTrackMuted(trackId: string) {
      const state = this.getTrackMixState(trackId);
      this.trackMixStates = {
        ...this.trackMixStates,
        [trackId]: { ...state, muted: !state.muted },
      };
      this.updateTrackMixStates();
      this.scheduleTrackLoopRebuild();
    },
    toggleTrackSoloed(trackId: string) {
      const state = this.getTrackMixState(trackId);
      this.trackMixStates = {
        ...this.trackMixStates,
        [trackId]: { ...state, soloed: !state.soloed },
      };
      this.updateTrackMixStates();
      this.scheduleTrackLoopRebuild();
    },
    async removeCurrentTrack() {
      const currentTrack = this.currentTrack;
      if (!currentTrack || this.tracks.length <= 1) {
        return;
      }

      await this.removeTrack(currentTrack.id);
    },
    async renameCurrentTrack() {
      const currentTrack = this.currentTrack;
      if (!currentTrack) {
        return;
      }

      const suggestedName = this.buildUniqueTrackName(currentTrack.name, currentTrack.id);
      const requestedName = await this.askForTextInput({
        title: `Rename ${currentTrack.name}`,
        label: 'Track name',
        initialValue: suggestedName,
        confirmLabel: 'Rename',
      });
      if (requestedName === null) {
        return;
      }

      const nextName = this.buildUniqueTrackName(requestedName, currentTrack.id);
      if (nextName === currentTrack.name) {
        return;
      }

      this.tracks = this.tracks.map((track) => track.id === currentTrack.id ? { ...track, name: nextName } : track);
      this.handleDraftChange();
    },
    showNotice(message: string, color: 'info' | 'success' | 'warning' | 'error' = 'info') {
      this.appNoticeMessage = message;
      this.appNoticeColor = color;
      this.showAppNotice = true;
    },
    askForConfirmation(title: string, message: string, confirmLabel = 'Confirm'): Promise<boolean> {
      this.confirmDialogTitle = title;
      this.confirmDialogMessage = message;
      this.confirmDialogConfirmLabel = confirmLabel;
      this.showConfirmDialog = true;

      return new Promise((resolve) => {
        this.confirmDialogResolver = resolve;
      });
    },
    resolveConfirmDialog(value: boolean) {
      const resolver = this.confirmDialogResolver;
      this.confirmDialogResolver = null;
      this.showConfirmDialog = false;
      resolver?.(value);
    },
    askForTextInput(options: { title: string; label: string; initialValue: string; confirmLabel?: string }): Promise<string | null> {
      this.inputDialogTitle = options.title;
      this.inputDialogLabel = options.label;
      this.inputDialogValue = options.initialValue;
      this.inputDialogConfirmLabel = options.confirmLabel ?? 'Save';
      this.showInputDialog = true;

      return new Promise((resolve) => {
        this.inputDialogResolver = resolve;
      });
    },
    resolveInputDialog(submit: boolean) {
      const resolver = this.inputDialogResolver;
      this.inputDialogResolver = null;
      const value = submit ? this.inputDialogValue.trim() : null;
      this.showInputDialog = false;
      resolver?.(value && value.length > 0 ? value : null);
      this.inputDialogValue = '';
    },
    handleTrackDraftChange(nextTrack: PresetTrackData) {
      const previousTrack = this.currentTrack ? clonePresetTrackData(this.currentTrack) : null;
      const normalizedTrack = normalizePresetTrackData(nextTrack);
      this.tracks = this.tracks.map((track) => track.id === normalizedTrack.id ? normalizedTrack : track);
      const updatedTrack = this.currentTrack;
      this.refreshDirtyState();

      if (!updatedTrack) {
        return;
      }

      if (this.isRunning && previousTrack && this.didTrackTimingChange(previousTrack, updatedTrack)) {
        this.scheduleTrackLoopRebuild();
      }

      this.updateSynths(updatedTrack.id, false);
    },
    getTrackVelocity(notes: number[], velocityMultiplier: number): number {
      if (notes.length === 0) {
        return 0;
      }
      return Math.min(1, 0.5 * Math.sqrt(1.0 / notes.length) * velocityMultiplier);
    },
    buildTrackEvents(
      track: PresetTrackData,
      trackNotes: number[][],
      totalLoopDuration: number,
      trackIndex = 0,
      noteVelocities?: number[][],
      drumVoiceIds?: DrumVoiceId[][],
    ): TrackScheduledEvent[] {
      if (trackNotes.length === 0 || !Number.isFinite(totalLoopDuration) || !(totalLoopDuration > 0)) {
        return [];
      }

      const trackQuant = this.getTrackQuant(track);
      const trackPeriod = trackNotes.length * trackQuant;
      if (trackPeriod <= 0) {
        return [];
      }

      const delaySeconds = this.getTrackDelaySeconds(track);
      const paddingBeforeSeconds = track.paddingBefore * this.getTrackBarSeconds(track);
      const repeatPeriod = this.getTrackRepeatDuration(track, trackNotes);
      const warpAmount = track.timeWarpEnabled ? track.timeWarpAmount / 100 : 0;
      const warpEnabled = track.timeWarpEnabled && warpAmount > 0;
      const warpResolution = resolveTimeWarpFunction(track.timeWarpCurve, track.timeWarpExpression);
      const warpChunks = track.timeWarpEnabled ? Math.max(1, Math.floor(track.timeWarpRepeats)) : 1;
      const chunkPeriod = trackPeriod / warpChunks;
      const quantizeDivisions = track.timeWarpQuantize > 0
        ? Math.max(1, Math.round((trackNotes.length / warpChunks) * track.timeWarpQuantize))
        : 0;
      if (![trackQuant, trackPeriod, delaySeconds, paddingBeforeSeconds, repeatPeriod, chunkPeriod].every(Number.isFinite)
        || !(chunkPeriod > 0)) {
        return [];
      }
      const activationMasks = this.activationMasks;
      const events: TrackScheduledEvent[] = [];
      const stepDurations = getStepDurations(trackNotes);
      let order = 0;

      for (let repeat = 0; repeat < track.repeats; repeat += 1) {
        const loopStart = delaySeconds + repeat * repeatPeriod + paddingBeforeSeconds;
        if (!Number.isFinite(loopStart)) {
          continue;
        }
        for (let i = 0; i < trackNotes.length; i += 1) {
          const notes = trackNotes[i];
          if (notes.length === 0) {
            continue;
          }

          const durSteps = stepDurations[i];
          const baseDuration = ((durSteps * track.lengthFactor / 100.0) + track.lengthOffset) * trackQuant;
          if (!Number.isFinite(baseDuration)) {
            continue;
          }
          const localTime = i * trackQuant;
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
            if (track.timeWarpNoteLengths) {
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
            velocity: this.getTrackVelocity(notes, track.velocityMultiplier),
            notes,
            noteVelocities: noteVelocities?.[i]?.map((velocity) => Math.min(1, velocity * track.velocityMultiplier)),
            drumVoiceIds: drumVoiceIds?.[i],
            step: i,
            order,
          });
          order += 1;
        }
      }

      if (warpEnabled) {
        events.sort((left, right) => (left.time === right.time ? left.order - right.order : left.time - right.time));
      }

      return events;
    },
    handleBitmaskSequenceInput(nextValue: string) {
      this.bitmaskSequenceInput = nextValue;
      this.refreshDirtyState();
      if (this.isRunning) {
        this.scheduleTrackLoopRebuild();
      }
    },
    midiToFrequency(midi: number): number {
      return this.a4 * Math.pow(2, (midi - 69) / 12);
    },
    dbToGain(db: number): number {
      return Math.pow(10, db / 20);
    },
    clampNormalRange(value: number): number {
      return Math.max(0, Math.min(1, value));
    },
    didTrackTimingChange(previous: PresetTrackData, next: PresetTrackData): boolean {
      return previous.numerator !== next.numerator
        || previous.denominator !== next.denominator
        || previous.phase !== next.phase
        || previous.delay !== next.delay
        || previous.fadeIn !== next.fadeIn
        || previous.fadeOut !== next.fadeOut
        || previous.paddingBefore !== next.paddingBefore
        || previous.paddingAfter !== next.paddingAfter
        || previous.repeats !== next.repeats
        || previous.sequenceInput !== next.sequenceInput
        || previous.octave !== next.octave
        || previous.lengthFactor !== next.lengthFactor
        || previous.lengthOffset !== next.lengthOffset
        || previous.velocityMultiplier !== next.velocityMultiplier
        || previous.timeWarpEnabled !== next.timeWarpEnabled
        || previous.timeWarpCurve !== next.timeWarpCurve
        || previous.timeWarpExpression !== next.timeWarpExpression
        || previous.timeWarpRepeats !== next.timeWarpRepeats
        || previous.timeWarpAmount !== next.timeWarpAmount
        || previous.timeWarpQuantize !== next.timeWarpQuantize
        || previous.timeWarpNoteLengths !== next.timeWarpNoteLengths
        || previous.trackKind !== next.trackKind
        || previous.drumVelocityBits !== next.drumVelocityBits
        || previous.drumLanes.map((lane) => `${lane.voiceId}:${lane.xorGroup}`).join(',')
          !== next.drumLanes.map((lane) => `${lane.voiceId}:${lane.xorGroup}`).join(',');
    },
    chokeDrumXorGroup(
      chain: TrackAudioChain,
      voiceId: DrumVoiceId | undefined,
      time: number,
    ) {
      if (!voiceId) {
        return;
      }
      const members = chain.drumChokeMap.get(voiceId);
      if (!members) {
        return;
      }
      for (const otherVoiceId of members) {
        chain.drumInstruments[otherVoiceId]?.choke(time);
      }
    },
    dbToWetMix(db: number): number {
      return this.clampNormalRange(this.dbToGain(db));
    },
    setWavExportProgress(progress: number, status: string) {
      this.exportProgress = progress < 0 ? -1 : Math.max(0, Math.min(100, Math.round(progress)));
      this.exportStatus = status;
    },
    startExport(format: 'midi' | 'wav', status: string) {
      this.isExporting = true;
      this.exportFormat = format;
      this.exportProgress = 0;
      this.exportStatus = status;
    },
    finishExport() {
      this.isExporting = false;
      this.exportFormat = null;
      this.exportProgress = 0;
      this.exportStatus = '';
    },
    updateControlDeckHeight() {
      const deck = this.$refs.controlDeck as HTMLElement | undefined;
      if (!deck) {
        return;
      }

      this.controlDeckHeight = Math.ceil(deck.getBoundingClientRect().height);
    },
    toggleControlDeck() {
      this.controlDeckCollapsed = !this.controlDeckCollapsed;
      this.$nextTick(() => {
        this.updateControlDeckHeight();
      });
    },
    getRenderDurationSeconds(): number {
      const echoTrail = Math.max(
        0,
        ...this.tracks.map((track) => track.echoEnabled ? this.getEchoDelaySeconds(track.echoDelay) * (1 + track.echoFeedback * 8) : 0),
      );
      const releaseTrail = Math.max(0, ...this.tracks.map((track) => Math.max(track.release, track.pitchEnvelopeRelease)));
      const hasReverbSend = this.reverbEnabled && this.reverbWet > -96 && this.tracks.some((track) => track.reverbWet > -96);
      const reverbTrail = hasReverbSend ? this.reverbPreDelay + this.reverbDecay : 0;
      return this.getLoopDurationSecondsFromTrackLengths() + Math.max(2, releaseTrail, echoTrail, reverbTrail);
    },
    trackOfflineRenderProgress(
      offlineContext: Tone.OfflineContext,
      renderDuration: number,
      onProgress: (ratio: number) => void | Promise<void>,
    ) {
      const contextProxy = offlineContext.rawContext as unknown as {
        suspend?: (when: number) => Promise<void>;
        resume?: () => Promise<void>;
        _nativeOfflineAudioContext?: OfflineAudioContext;
      };
      const rawContext = contextProxy._nativeOfflineAudioContext ?? contextProxy;
      const suspend = rawContext.suspend;
      const resume = rawContext.resume;
      if (typeof suspend !== 'function' || typeof resume !== 'function') {
        return;
      }

      // OfflineAudioContext only accepts suspend times aligned to 128-sample
      // render quanta, so quantize each checkpoint before scheduling it.
      const sampleRate = offlineContext.sampleRate;
      const quantum = 128 / sampleRate;
      const steps = 40;
      const totalQuanta = Math.floor(renderDuration / quantum);

      for (let step = 1; step < steps; step += 1) {
        const quantumIndex = Math.floor((totalQuanta * step) / steps);
        if (quantumIndex <= 0 || quantumIndex >= totalQuanta) {
          continue;
        }

        const ratio = step / steps;
        suspend.call(rawContext, quantumIndex * quantum).then(() => {
          try {
            void onProgress(ratio);
          } finally {
            return resume.call(rawContext);
          }
        }).catch(() => {
          // Ignore checkpoints the browser refuses to schedule.
        });
      }
    },
    async renderMixWav(): Promise<Uint8Array> {
      this.setWavExportProgress(8, 'Preparing render...');
      await this.$nextTick();

      const loopDuration = this.getLoopDurationSecondsFromTrackLengths();
      const renderDuration = this.getRenderDurationSeconds();
      const allTrackNotes = this.allTrackActualNotes;
      this.setWavExportProgress(22, 'Scheduling tracks...');

      const SCHEDULE_PROGRESS_START = 22;
      const RENDER_PROGRESS_START = 35;
      const RENDER_PROGRESS_END = 82;
      const ENCODE_PROGRESS_START = 85;
      const ENCODE_PROGRESS_END = 99;

      const schedulableTracks = allTrackNotes.filter((entry) => entry.notes.length > 0);
      let scheduledTracks = 0;

      const liveReverbChain = this.reverbChain;
      const liveTrackSynths = this.trackSynths;
      let offlineReverbChain: ReverbAudioChain | null = null;
      const offlineTrackChains: TrackAudioChain[] = [];
      let rendered: unknown;
      try {
        // Every voice must exist before startRendering(): Tone builds the native render
        // graph at that point, so anything scheduled later is silently left out.
        rendered = await renderOfflineAudio((offlineContext) => {
          try {
            this.trackOfflineRenderProgress(offlineContext, renderDuration, (ratio) => {
              this.setWavExportProgress(
                RENDER_PROGRESS_START + (RENDER_PROGRESS_END - RENDER_PROGRESS_START) * ratio,
                'Rendering audio...',
              );
            });

            this.reverbChain = null;
            this.trackSynths = markRaw({});
            this.getOrCreateReverbChain();
            offlineReverbChain = this.reverbChain;

            offlineContext.transport.stop();
            offlineContext.transport.seconds = 0;

            for (const entry of schedulableTracks) {
              scheduledTracks += 1;
              this.setWavExportProgress(
                SCHEDULE_PROGRESS_START
                  + (RENDER_PROGRESS_START - SCHEDULE_PROGRESS_START) * (scheduledTracks / schedulableTracks.length),
                'Scheduling tracks...',
              );

              const events = this.buildTrackEvents(
                entry.track,
                entry.notes,
                loopDuration,
                entry.trackIndex,
                entry.noteVelocities,
                entry.drumVoiceIds,
              );
              if (events.length === 0) {
                continue;
              }

              const chain = this.createTrackAudioChain({
                echoPingPong: entry.track.echoPingPong,
                maxDelay: this.getTrackEchoMaxDelay(entry.track),
                phaserStages: entry.track.phaserStages,
                phaserCenterFrequency: this.midiToFrequency(entry.track.phaserCenter),
              });
              offlineTrackChains.push(chain);
              this.trackSynths[`offline-${entry.track.id}`] = chain;
              this.updateTrackChainSettings(entry.track, chain);
              this.scheduleTrackFadeEnvelope(
                entry.track,
                entry.notes,
                chain.fadeGain.gain,
                this.getTrackDelaySeconds(entry.track),
                chain.drumReverbFadeGain.gain,
              );

              for (const event of events) {
                this.scheduleFilterEnvelope(entry.track, event.notes, event.time, event.duration, chain);
                if (entry.track.trackKind === 'rhythmic') {
                  const noteVelocities = event.noteVelocities ?? event.notes.map(() => event.velocity);
                  for (let noteIndex = 0; noteIndex < event.notes.length; noteIndex += 1) {
                    const voiceId = event.drumVoiceIds?.[noteIndex];
                    const instrument = voiceId ? chain.drumInstruments[voiceId] : undefined;
                    this.chokeDrumXorGroup(chain, voiceId, event.time);
                    instrument?.trigger(event.time, noteVelocities[noteIndex] ?? event.velocity, event.duration);
                  }
                } else {
                  this.triggerTrackVoice(entry.track, chain, event.notes, event.duration, event.time, event.velocity, event.time);
                }
              }
            }

            offlineContext.transport.start(0);
          } finally {
            this.reverbChain = liveReverbChain;
            this.trackSynths = liveTrackSynths;
          }
        }, renderDuration, 2, WAV_EXPORT_SAMPLE_RATE);
      } finally {
        this.reverbChain = liveReverbChain;
        this.trackSynths = liveTrackSynths;
        for (const chain of offlineTrackChains) {
          try {
            this.disposeTrackChain(chain);
          } catch {
          }
        }
        if (offlineReverbChain) {
          try {
            disposeReverbAudioChain(offlineReverbChain);
          } catch {
          }
        }
      }

      this.setWavExportProgress(ENCODE_PROGRESS_START, 'Encoding WAV...');
      await this.$nextTick();

      const audioBuffer = (rendered as { get?: () => AudioBuffer }).get
        ? (rendered as { get: () => AudioBuffer }).get()
        : (rendered as unknown as AudioBuffer);

      const channels: Float32Array[] = [];
      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
        channels.push(audioBuffer.getChannelData(channel));
      }

      let lastReportedProgress = ENCODE_PROGRESS_START;
      return encodeWavFromChannels(channels, audioBuffer.sampleRate, {
        onProgress: (ratio) => {
          const progress = ENCODE_PROGRESS_START + (ENCODE_PROGRESS_END - ENCODE_PROGRESS_START) * ratio;
          if (progress - lastReportedProgress < 1) {
            return;
          }
          lastReportedProgress = progress;
          this.setWavExportProgress(progress, 'Encoding WAV...');
        },
      });
    },
    getDraftData(): PresetData {
      return normalizePresetData({
        bpm: this.bpm,
        a4: this.a4,
        forte: this.forte,
        bitmaskSequenceInput: this.bitmaskSequenceInput,
        tracks: this.tracks.map((track) => clonePresetTrackData(track)),
        reverb: {
          enabled: this.reverbEnabled,
          decay: this.reverbDecay,
          preDelay: this.reverbPreDelay,
          dry: this.reverbDry,
          wet: this.reverbWet,
          lowCut: this.reverbLowCut,
          highCut: this.reverbHighCut,
        },
      });
    },
    applyDraftData(data: PresetData, options: { preserveTrackMixStates?: boolean } = {}) {
      const normalized = clonePresetData(normalizePresetData(data));
      const previousTrackMixStates = this.trackMixStates;
      this.bpm = normalized.bpm;
      this.a4 = normalized.a4;
      this.forte = normalized.forte;
      this.bitmaskSequenceInput = normalized.bitmaskSequenceInput;
      this.reverbEnabled = normalized.reverb.enabled;
      this.reverbDecay = normalized.reverb.decay;
      this.reverbPreDelay = normalized.reverb.preDelay;
      this.reverbDry = normalized.reverb.dry;
      this.reverbWet = normalized.reverb.wet;
      this.reverbLowCut = normalized.reverb.lowCut;
      this.reverbHighCut = normalized.reverb.highCut;

      const fallbackTrackId = normalized.tracks[0]?.id ?? null;
      const preferredTrackId = normalized.tracks.some((track) => track.id === this.selectedTrackId)
        ? this.selectedTrackId
        : fallbackTrackId;
      this.tracks = normalized.tracks.map((track) => clonePresetTrackData(track));
      this.trackMixStates = options.preserveTrackMixStates
        ? Object.fromEntries(
          normalized.tracks
            .filter((track) => previousTrackMixStates[track.id])
            .map((track) => [track.id, previousTrackMixStates[track.id]]),
        )
        : {};
      this.selectedTrackId = preferredTrackId;
      this.applyRealtimeSettings();
    },
    applyRealtimeSettings(options: { rebuildLoops?: boolean; createMissingChains?: boolean } = {}) {
      const rebuildLoops = options.rebuildLoops ?? true;
      const createMissingChains = options.createMissingChains ?? this.isRunning;
      Tone.getTransport().bpm.value = this.bpm;
      const signatureTrack = this.currentTrack ?? this.tracks[0];
      if (signatureTrack) {
        Tone.getTransport().timeSignature = [signatureTrack.numerator, signatureTrack.denominator];
      }
      this.updateSynths(undefined, createMissingChains);

      if (this.isRunning && rebuildLoops) {
        this.scheduleTrackLoopRebuild();
      }
    },
    refreshDirtyState() {
      const manager = this.$refs.presetManager as { syncDirtyState?: () => void } | undefined;
      manager?.syncDirtyState?.();
    },
    handlePresetDirtyChange(nextDirty: boolean) {
      this.isDirty = nextDirty;
    },
    handleDraftChange() {
      this.applyRealtimeSettings();
      this.refreshDirtyState();
    },
    handleReverbDraftChange(nextReverb: PresetReverbData) {
      this.reverbEnabled = nextReverb.enabled;
      this.reverbDecay = nextReverb.decay;
      this.reverbPreDelay = nextReverb.preDelay;
      this.reverbDry = nextReverb.dry;
      this.reverbWet = nextReverb.wet;
      this.reverbLowCut = nextReverb.lowCut;
      this.reverbHighCut = nextReverb.highCut;
      this.updateReverbChain();
      for (const track of this.tracks) {
        const chain = this.trackSynths[track.id];
        if (chain) {
          this.updateTrackChainSettings(track, chain);
        }
      }
      this.refreshDirtyState();
    },
    async confirmDiscardChanges(actionLabel: string): Promise<boolean> {
      if (!this.isDirty) {
        return true;
      }

      return this.askForConfirmation('Unsaved Changes', `You have unsaved changes. ${actionLabel}?`, 'Continue');
    },
    currentPresetFilenamePart() {
      const manager = this.$refs.presetManager as { currentPreset?: { name?: string } | null } | undefined;
      return (manager?.currentPreset?.name ?? 'preset').replace(/[^a-z0-9-_]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'preset';
    },
    formattedDate() {
      return (timestamp => `${new Date(timestamp).getUTCFullYear()}${String(new Date(timestamp).getUTCMonth() + 1).padStart(2, '0')}${String(new Date(timestamp).getUTCDate()).padStart(2, '0')}T${String(new Date(timestamp).getUTCHours()).padStart(2, '0')}${String(new Date(timestamp).getUTCMinutes()).padStart(2, '0')}${String(new Date(timestamp).getUTCSeconds()).padStart(2, '0')}Z`)(Date.now());
    },
    async initializeMidi() {
      try {
        const access = await navigator.requestMIDIAccess();
        this.midiAccess = access;
        
        this.midiDevices = Array.from(access.outputs.values()).map(output => output.name!);
        this.$nextTick(() => {
          this.updateControlDeckHeight();
        });
      } catch (error) {
        console.error("Failed to initialize MIDI:", error);
      }
    },
    updateMidiDevice() {
      const device = Array.from(this.midiAccess?.outputs.values() || []).find(output => output.name === this.selectedMidiDevice);
      this.midiOutput = device || null;
    },
    updateMidiMode() {
      if (this.useMidiOutput) {
        this.initializeMidi();
      } else {
        //this.midiOutput = null;
      }

      this.$nextTick(() => {
        this.updateControlDeckHeight();
      });
    },
    async playNoteWithMidi(note: number, velocity: number, duration: Tone.Unit.Seconds, when: number, midiChannel: number) {
      if (this.midiOutput!!) {
          const noteOn = [0x90 + midiChannel - 1, note, Math.round(velocity * 127)];
          const noteOff = [0x80 + midiChannel - 1, note, 0];

          // 'when' is in the AudioContext time coordinates; convert to Performance timeline
          const ctxNow = Tone.now();
          const nowMs = performance.now();
          // Schedule relative to now; clamp to 0 to avoid negative scheduling
          const delayMs = Math.max(0, (when - ctxNow) * 1000);
          const onTimeMs = nowMs + delayMs;
          const offTimeMs = onTimeMs + Number(duration) * 1000;

          this.midiOutput!.send(noteOn, onTimeMs);
          this.midiOutput!.send(noteOff, offTimeMs);
      }
    },
    getOrCreateReverbChain(): ReverbAudioChain {
      if (this.reverbChain) {
        return this.reverbChain as ReverbAudioChain;
      }

      this.reverbChain = createReverbAudioChain({
        decay: this.reverbDecay,
        preDelay: this.reverbPreDelay,
        lowCutFrequency: this.midiToFrequency(this.reverbLowCut),
        highCutFrequency: this.midiToFrequency(this.reverbHighCut),
      });
      return this.reverbChain as ReverbAudioChain;
    },
    getTrackEchoMaxDelay(track: PresetTrackData): number {
      return Math.max(1, this.getEchoDelaySeconds(track.echoDelay));
    },
    createTrackAudioChain(options: { echoPingPong?: boolean; maxDelay?: number; phaserStages?: number; phaserCenterFrequency?: number } = {}): TrackAudioChain {
      const echoPingPong = options.echoPingPong ?? true;
      const maxDelay = options.maxDelay ?? 1;
      const phaserStages = options.phaserStages ?? DEFAULT_PRESET_TRACK_DATA.phaserStages;
      const phaserCenterFrequency = options.phaserCenterFrequency ?? this.midiToFrequency(DEFAULT_PRESET_TRACK_DATA.phaserCenter);
      const sourceBus = markRaw(new Tone.Gain(1));
      const limiterGain = markRaw(new Tone.Gain(1));
      const limiter = markRaw(new Tone.WaveShaper(TANH_CURVE));
      const outputGain = markRaw(new Tone.Gain(1));
      const fadeGain = markRaw(new Tone.Gain(1));
      const mixGain = markRaw(new Tone.Gain(1));
      const echoReturnGain = markRaw(new Tone.Gain(1));
      const dryGain = markRaw(new Tone.Gain(1).toDestination());
      const reverbSend = markRaw(new Tone.Gain(0));
      const drumReverbFadeGain = markRaw(new Tone.Gain(1));
      const drumReverbTrackGain = markRaw(new Tone.Gain(1));

      // Only the always-on backbone is wired here; sources and effects join the chain
      // when routeTrackAudioChain runs for the track's current settings.
      mixGain.connect(dryGain);
      reverbSend.connect(this.getOrCreateReverbChain().lowCut);
      drumReverbFadeGain.connect(drumReverbTrackGain);
      drumReverbTrackGain.connect(reverbSend);

      // markRaw keeps Vue from deep-proxying the chain: the scheduler touches it on every
      // note, and standardized-audio-context also rejects proxied nodes on connect().
      return markRaw({
        synth: null,
        synthGain: null,
        noiseSynth: null,
        breathFilter: null,
        breathGain: null,
        filter: null,
        choir: null,
        sourceBus,
        waveshaper: null,
        limiterGain,
        limiter,
        tremolo: null,
        vibrato: null,
        chorus: null,
        flanger: null,
        flangerLfo: null,
        phaser: null,
        phaserStages,
        phaserCenterFrequency,
        echo: null,
        echoPingPong,
        maxDelay,
        echoReturnGain,
        dryGain,
        reverbSend,
        drumReverbFadeGain,
        drumReverbTrackGain,
        outputGain,
        fadeGain,
        mixGain,
        drumInstruments: {},
        drumSignature: '',
        drumParameterSignature: '',
        drumChokeMap: new Map<DrumVoiceId, DrumVoiceId[]>(),
        drumRebuildTimer: null,
        routingSignature: '',
        voiceSignature: '',
        wavetableLfoLoop: null,
        lastAppliedPartials: null,
        modulationTrack: null,
        modulationNoteStartSeconds: 0,
        soundingNotes: [],
      });
    },
    ensureTrackSynth(chain: TrackAudioChain, track: PresetTrackData): TrackSynth {
      if (!chain.synth) {
        if (isMonophonic(track.polyphony)) {
          chain.synth = markRaw(new MonoGlideSynth());
        } else {
          const synth = markRaw(new Tone.PolySynth(PitchEnvelopeSynth));
          const voiceCount = getSynthVoiceCount(track.polyphony);
          synth.maxPolyphony = voiceCount;
          // Reuse voices instead of letting Tone dispose and rebuild them every second.
          retainVoicePool(synth as unknown as Tone.PolySynth, voiceCount);
          prewarmVoicePool(synth as unknown as Tone.PolySynth, track.polyphony);
          chain.synth = synth;
        }
        chain.soundingNotes.length = 0;
        chain.synthGain = chain.synthGain ?? markRaw(new Tone.Gain(1));
        chain.routingSignature = '';
      }
      return chain.synth;
    },
    /**
     * Mono and poly are separate Tone instruments, so crossing one voice tears the old
     * engine down and lets `ensureTrackSynth` build the other one.
     */
    syncTrackSynthEngine(track: PresetTrackData, chain: TrackAudioChain) {
      if (!chain.synth) {
        return;
      }

      const isMono = chain.synth instanceof MonoGlideSynth;
      if (isMono === isMonophonic(track.polyphony)) {
        if (!isMono) {
          const synth = chain.synth as Tone.PolySynth;
          const voiceCount = getSynthVoiceCount(track.polyphony);
          synth.maxPolyphony = voiceCount;
          retainVoicePool(synth as unknown as Tone.PolySynth, voiceCount);
          prewarmVoicePool(synth as unknown as Tone.PolySynth, track.polyphony);
        }
        return;
      }

      chain.synth.disconnect();
      chain.synth.dispose();
      chain.synth = null;
      chain.lastAppliedPartials = null;
      chain.soundingNotes.length = 0;
      chain.voiceSignature = '';
      chain.routingSignature = '';
    },
    ensureTrackNoiseSynth(chain: TrackAudioChain): Tone.NoiseSynth {
      if (!chain.noiseSynth) {
        chain.noiseSynth = markRaw(new Tone.NoiseSynth({
          noise: { type: 'pink' },
          envelope: {
            attack: ENVELOPE_SMOOTHING_SECONDS,
            decay: ENVELOPE_SMOOTHING_SECONDS,
            sustain: 1,
            release: ENVELOPE_SMOOTHING_SECONDS,
          },
        }));
        chain.routingSignature = '';
      }
      return chain.noiseSynth;
    },
    ensureTrackBreathFilter(chain: TrackAudioChain): Tone.Filter {
      if (!chain.breathFilter) {
        chain.breathFilter = markRaw(new Tone.Filter({
          type: 'bandpass',
          frequency: 1000,
          Q: BREATH_FILTER_Q,
          rolloff: -12,
        }));
        chain.routingSignature = '';
      }
      return chain.breathFilter;
    },
    ensureTrackBreathGain(chain: TrackAudioChain): Tone.Gain {
      if (!chain.breathGain) {
        chain.breathGain = markRaw(new Tone.Gain(0));
        chain.routingSignature = '';
      }
      return chain.breathGain;
    },
    ensureTrackFilter(chain: TrackAudioChain): Tone.Filter {
      if (!chain.filter) {
        chain.filter = markRaw(new Tone.Filter());
        chain.routingSignature = '';
      }
      return chain.filter;
    },
    ensureTrackChoirBank(chain: TrackAudioChain): ChoirFormantBank {
      if (!chain.choir) {
        const input = markRaw(new Tone.Gain(1));
        const output = markRaw(new Tone.Gain(1));
        const formants = Array.from({ length: CHOIR_FORMANT_FILTER_COUNT }, () => {
          const formantFilter = markRaw(new Tone.Filter({
            type: 'bandpass',
            frequency: 1000,
            Q: 8,
            rolloff: -12,
          }));
          const formantGain = markRaw(new Tone.Gain(0));
          input.connect(formantFilter);
          formantFilter.connect(formantGain);
          formantGain.connect(output);
          return { filter: formantFilter, gain: formantGain } satisfies ChoirFormantPath;
        });
        chain.choir = markRaw({ input, output, formants });
        chain.routingSignature = '';
      }
      return chain.choir;
    },
    ensureTrackVibrato(chain: TrackAudioChain, track: PresetTrackData): Tone.Vibrato {
      if (!chain.vibrato) {
        chain.vibrato = markRaw(new Tone.Vibrato({
          frequency: track.vibratoFrequency,
          depth: this.clampNormalRange(track.vibratoDepth),
          wet: 1,
        }));
        chain.routingSignature = '';
      }
      return chain.vibrato;
    },
    ensureTrackTremolo(chain: TrackAudioChain, track: PresetTrackData): Tone.Tremolo {
      if (!chain.tremolo) {
        chain.tremolo = markRaw(new Tone.Tremolo({
          frequency: track.tremoloFrequency,
          depth: this.clampNormalRange(track.tremoloDepth),
          spread: track.tremoloSpread,
          wet: 1,
        }));
        chain.tremolo.start();
        chain.routingSignature = '';
      }
      return chain.tremolo;
    },
    ensureTrackChorus(chain: TrackAudioChain): Tone.Chorus {
      if (!chain.chorus) {
        chain.chorus = markRaw(new Tone.Chorus());
        chain.chorus.start();
        chain.routingSignature = '';
      }
      return chain.chorus;
    },
    ensureTrackFlanger(chain: TrackAudioChain): Tone.FeedbackDelay {
      if (!chain.flanger) {
        const flanger = markRaw(new Tone.FeedbackDelay({
          maxDelay: FLANGER_MAX_DELAY_SECONDS,
          delayTime: DEFAULT_PRESET_TRACK_DATA.flangerDelay / 1000,
          feedback: 0,
        }));
        const flangerLfo = markRaw(new Tone.LFO());
        // The LFO drives the delay line directly, so its output range is the absolute sweep in seconds.
        flangerLfo.connect(flanger.delayTime);
        flangerLfo.start();
        chain.flanger = flanger;
        chain.flangerLfo = flangerLfo;
        chain.routingSignature = '';
      }
      return chain.flanger;
    },
    ensureTrackPhaser(chain: TrackAudioChain): Phaser {
      if (!chain.phaser) {
        chain.phaser = markRaw(new Phaser({
          stages: chain.phaserStages,
          centerFrequency: chain.phaserCenterFrequency,
        }));
        chain.routingSignature = '';
      }
      return chain.phaser;
    },
    ensureTrackEcho(chain: TrackAudioChain): Tone.FeedbackDelay | Tone.PingPongDelay {
      if (!chain.echo) {
        chain.echo = markRaw(chain.echoPingPong
          ? new Tone.PingPongDelay({ maxDelay: chain.maxDelay })
          : new Tone.FeedbackDelay({ maxDelay: chain.maxDelay }));
        chain.routingSignature = '';
      }
      return chain.echo;
    },

    scheduleDrumInstrumentRebuild(track: PresetTrackData, chain: TrackAudioChain) {
      if (chain.drumRebuildTimer !== null) {
        window.clearTimeout(chain.drumRebuildTimer);
      }

      chain.drumRebuildTimer = window.setTimeout(() => {
        chain.drumRebuildTimer = null;
        const currentTrack = this.tracks.find((entry) => entry.id === track.id) ?? track;
        this.rebuildDrumInstruments(currentTrack, chain, true);
      }, 120);
    },
    routeDrumInstrument(track: PresetTrackData, chain: TrackAudioChain, instrument: DrumInstrument) {
      instrument.node.disconnect();
      instrument.echoSend.disconnect();
      instrument.reverbSend.disconnect();
      instrument.node.connect(chain.sourceBus);
      instrument.node.connect(instrument.echoSend);
      instrument.node.connect(instrument.reverbSend);
      if (track.echoEnabled) {
        instrument.echoSend.connect(this.ensureTrackEcho(chain));
      }
      instrument.reverbSend.connect(chain.drumReverbFadeGain);
    },
    rebuildDrumInstruments(track: PresetTrackData, chain: TrackAudioChain, force = false) {
      if (track.trackKind !== 'rhythmic') {
        if (chain.drumRebuildTimer !== null) {
          window.clearTimeout(chain.drumRebuildTimer);
          chain.drumRebuildTimer = null;
        }
        Object.values(chain.drumInstruments).forEach((instrument) => instrument.dispose());
        chain.drumInstruments = {};
        chain.drumChokeMap = new Map();
        chain.drumSignature = '';
        chain.drumParameterSignature = '';
        return;
      }

      const signature = JSON.stringify({
        lanes: track.drumLanes.map((lane) => lane.voiceId),
        velocityBits: track.drumVelocityBits,
      });
      const parameterSignature = JSON.stringify(track.drumLanes);
      if (!force && signature === chain.drumSignature) {
        if (parameterSignature !== chain.drumParameterSignature) {
          chain.drumChokeMap = buildDrumChokeMap(track.drumLanes);
        }
        let requiresRebuild = false;
        for (const lane of track.drumLanes) {
          const updated = chain.drumInstruments[lane.voiceId]?.update?.(lane.parameters);
          if (updated !== true) {
            requiresRebuild = true;
          }
        }
        if (requiresRebuild && parameterSignature !== chain.drumParameterSignature) {
          this.scheduleDrumInstrumentRebuild(track, chain);
        }
        chain.drumParameterSignature = parameterSignature;
        return;
      }

      if (chain.drumRebuildTimer !== null) {
        window.clearTimeout(chain.drumRebuildTimer);
        chain.drumRebuildTimer = null;
      }
      Object.values(chain.drumInstruments).forEach((instrument) => instrument.dispose());
      chain.drumInstruments = {};
      for (const lane of track.drumLanes) {
        // markRaw is required: Vue would otherwise deep-proxy the Tone/Web Audio nodes,
        // and standardized-audio-context rejects proxied nodes with InvalidStateError on connect().
        chain.drumInstruments[lane.voiceId] = markRaw(createDrumInstrument(lane.voiceId, lane.parameters));
      }
      chain.drumChokeMap = buildDrumChokeMap(track.drumLanes);
      if (chain.routingSignature) {
        Object.values(chain.drumInstruments).forEach((instrument) => this.routeDrumInstrument(track, chain, instrument));
      }
      chain.drumSignature = signature;
      chain.drumParameterSignature = parameterSignature;
    },
    getTrackRoutingSignature(track: PresetTrackData): string {
      return [
        track.trackKind,
        track.waveform,
        track.breathEnabled,
        track.vibratoEnabled,
        track.tremoloEnabled,
        track.chorusEnabled,
        track.flangerEnabled,
        track.phaserEnabled,
        track.echoEnabled,
        track.filterEnabled,
      ].join('|');
    },
    getOrCreateTrackChain(track: PresetTrackData): TrackAudioChain {
      const existing = this.trackSynths[track.id];
      if (existing) {
        return existing;
      }

      const chain = this.createTrackAudioChain({
        echoPingPong: track.echoPingPong,
        maxDelay: this.getTrackEchoMaxDelay(track),
        phaserStages: track.phaserStages,
        phaserCenterFrequency: this.midiToFrequency(track.phaserCenter),
      });
      this.trackSynths[track.id] = chain;
      this.updateTrackChainSettings(track, chain);
      return chain;
    },
    /**
     * Echo and phaser bake a few options into their constructor, so only those nodes are
     * rebuilt when the options change instead of tearing down the whole track chain.
     */
    syncTrackChainNodeOptions(track: PresetTrackData, chain: TrackAudioChain) {
      const maxDelay = this.getTrackEchoMaxDelay(track);
      if (chain.echoPingPong !== track.echoPingPong || chain.maxDelay < maxDelay) {
        chain.echoPingPong = track.echoPingPong;
        chain.maxDelay = Math.max(chain.maxDelay, maxDelay);
        if (chain.echo) {
          chain.echo.disconnect();
          chain.echo.dispose();
          chain.echo = null;
          chain.routingSignature = '';
        }
      }

      const phaserCenterFrequency = this.midiToFrequency(track.phaserCenter);
      if (chain.phaserStages !== track.phaserStages || chain.phaserCenterFrequency !== phaserCenterFrequency) {
        chain.phaserStages = track.phaserStages;
        chain.phaserCenterFrequency = phaserCenterFrequency;
        if (chain.phaser) {
          chain.phaser.disconnect();
          chain.phaser.dispose();
          chain.phaser = null;
          chain.routingSignature = '';
        }
      }
    },
    isChoirWaveform(waveform: string): waveform is ChoirWaveform {
      return waveform === 'choir-ah' || waveform === 'choir-oh';
    },
    isNoiseWaveform(waveform: string): waveform is NoiseWaveform {
      return waveform === 'pink-noise' || waveform === 'brown-noise';
    },
    getNoiseType(waveform: string): 'pink' | 'brown' {
      return waveform === 'brown-noise' ? 'brown' : 'pink';
    },
    getChoirFormantBands(waveform: string): readonly FormantBand[] {
      return this.isChoirWaveform(waveform) ? CHOIR_FORMANT_BANDS[waveform] : [];
    },
    updateChoirFormantBank(waveform: string, choirFormants: ChoirFormantPath[]) {
      const bands = this.getChoirFormantBands(waveform);

      choirFormants.forEach((path, index) => {
        const band = bands[index];
        if (!band) {
          path.gain.gain.value = 0;
          return;
        }

        const safeBandwidth = Math.max(20, band.bandwidth);
        path.filter.set({
          type: 'bandpass',
          frequency: band.frequency,
          Q: Math.max(0.5, band.frequency / safeBandwidth),
          rolloff: -12,
        });
        path.gain.gain.value = getChoirFormantBandGainLinear(band.gainDb);
      });
    },
    getOscillatorType(track: PresetTrackData): string {
      return track.unisonVoices > 1 ? 'fatcustom' : 'custom';
    },
    getTonewheelPartials(track: PresetTrackData, timeSeconds = 0, noteStartSeconds = 0): number[] {
      // Noise waveforms never use the additive oscillator path.
      if (this.isNoiseWaveform(track.waveform)) {
        return [1];
      }

      const generator = normalizePartialGenerator(track.partialGenerator);
      const animated = generator.type === 'tonewheel' && track.tonewheelWavetable.enabled
        && track.tonewheelWavetable.lfos.some((lfo) => (
          lfo.enabled && lfo.depth !== 0 && lfo.routes.some((route) => route !== 0)
        ));
      const drawbars = generator.type === 'tonewheel' ? interpolateModulatedTonewheelDrawbars(
        track.tonewheelWavetable,
        track.tonewheelDrawbars,
        {
          timeSeconds,
          noteStartSeconds,
          bpm: this.bpm,
        },
      ) : undefined;
      const key = `${track.waveform}|${JSON.stringify(generator)}|${drawbars?.join(',') ?? ''}`;
      const cached = animated ? undefined : partialSpectrumCache.get(key);
      if (cached) {
        return cached;
      }

      const partials = generatePartialSpectrum(generator, track.waveform, drawbars);
      // Trailing silent partials only make the periodic wave more expensive to build.
      let length = partials.length;
      while (length > 1 && partials[length - 1] === 0) {
        length -= 1;
      }
      const trimmed = length === partials.length ? partials : partials.slice(0, length);
      if (!animated) {
        if (partialSpectrumCache.size >= PARTIAL_SPECTRUM_CACHE_LIMIT) {
          partialSpectrumCache.clear();
        }
        partialSpectrumCache.set(key, trimmed);
      }
      return trimmed;
    },
    triggerTrackVoice(
      track: PresetTrackData,
      chain: TrackAudioChain,
      notes: number[],
      duration: Tone.Unit.Time,
      when: Tone.Unit.Time,
      velocity: number,
      modulationTimeSeconds?: number,
    ) {
      if (this.isNoiseWaveform(track.waveform)) {
        this.ensureTrackNoiseSynth(chain).triggerAttackRelease(duration, when, velocity);
        return;
      }

      const frequencies = this.getTrackPlaybackFrequencies(track, notes);
      const synth = this.ensureTrackSynth(chain, track);
      const modulationTime = modulationTimeSeconds ?? Tone.getTransport().getSecondsAtTime(when);
      chain.modulationNoteStartSeconds = modulationTime;
      this.applyTonewheelModulation(track, chain, modulationTime);
      if (track.breathEnabled && frequencies.length > 0) {
        const averageFrequency = frequencies.reduce((sum, frequency) => sum + frequency, 0) / frequencies.length;
        const maximumFrequency = chain.sourceBus.context.sampleRate * 0.45;
        this.ensureTrackBreathFilter(chain).frequency.setValueAtTime(
          Math.min(maximumFrequency, averageFrequency * track.breathHarmonic),
          synth.toSeconds(when),
        );
        this.ensureTrackNoiseSynth(chain).triggerAttackRelease(duration, when, velocity);
      }
      if (synth instanceof MonoGlideSynth) {
        synth.triggerNotes(frequencies, duration, when, velocity);
        return;
      }

      const voiced = limitPolyphony(frequencies, track.polyphony);
      const startTime = synth.toSeconds(when);
      const stolen = claimVoices(
        chain.soundingNotes,
        voiced,
        startTime,
        startTime + synth.toSeconds(duration),
        track.polyphony,
      );
      if (stolen.length > 0) {
        synth.triggerRelease(stolen, startTime);
      }
      synth.triggerAttackRelease(voiced, duration, when, velocity);
    },
    getTrackPlaybackFrequencies(track: PresetTrackData, notes: number[]): number[] {
      return notes.map((note) => this.midiToFrequency(note - 12));
    },
    getTrackFilterMidi(track: PresetTrackData, notes: number[] = []): number {
      if (!track.filterEnabled || notes.length === 0 || track.filterKeyFollow === 0) {
        return track.filterFrequency;
      }

      const averageMidi = notes.reduce((sum, note) => sum + note, 0) / notes.length;
      return Math.max(0, Math.min(127, track.filterFrequency + (averageMidi - 69) * track.filterKeyFollow / 100));
    },
    getTrackFilterFrequency(track: PresetTrackData, notes: number[] = []): number {
      return this.midiToFrequency(this.getTrackFilterMidi(track, notes));
    },
    /** Bipolar cutoff offset in MIDI pitches from the filter LFO, sampled at an absolute time. */
    getFilterLfoOffsetMidi(track: PresetTrackData, timeSeconds: number): number {
      if (!track.filterLfoEnabled || track.filterLfoAmount === 0) {
        return 0;
      }
      const frequencyHz = getLfoFrequencyHz({
        sync: track.filterLfoSync,
        rateHz: track.filterLfoRateHz,
        syncRate: track.filterLfoRate,
        bpm: this.bpm,
      });
      return sampleLfoAtTime(
        FILTER_LFO_STATE,
        timeSeconds,
        frequencyHz,
        track.filterLfoWaveform as LfoWaveform,
        track.filterLfoInitPhase,
      ) * track.filterLfoAmount;
    },
    scheduleFilterEnvelope(
      track: PresetTrackData,
      notes: number[],
      when: Tone.Unit.Seconds,
      noteDuration: number,
      chain: TrackAudioChain,
    ) {
      // A disabled filter is not part of the signal path, so there is nothing to automate.
      if (!track.filterEnabled) {
        return;
      }

      const filter = this.ensureTrackFilter(chain);
      const startTime = typeof when === 'number' ? when : Tone.Time(when).toSeconds();
      const baseMidi = Math.max(0, Math.min(127,
        this.getTrackFilterMidi(track, notes) + this.getFilterLfoOffsetMidi(track, startTime)));
      const baseFrequency = this.midiToFrequency(baseMidi);
      filter.frequency.cancelAndHoldAtTime(startTime);

      if (track.filterEnvelopeAmount === 0) {
        filter.frequency.linearRampToValueAtTime(baseFrequency, startTime + ENVELOPE_SMOOTHING_SECONDS);
        return;
      }

      const gateDuration = Math.max(0, noteDuration);
      const attack = Math.max(track.filterEnvelopeAttack, ENVELOPE_SMOOTHING_SECONDS);
      const decay = Math.max(track.filterEnvelopeDecay, ENVELOPE_SMOOTHING_SECONDS);
      const release = Math.max(track.filterEnvelopeRelease, ENVELOPE_SMOOTHING_SECONDS);
      const gateTime = startTime + gateDuration;
      const attackEnd = startTime + attack;
      const decayEnd = attackEnd + decay;
      const cutoffForLevel = (level: number): number => this.midiToFrequency(
        Math.max(0, Math.min(127, baseMidi + track.filterEnvelopeAmount * level)),
      );
      const peakFrequency = cutoffForLevel(1);
      const sustainFrequency = cutoffForLevel(track.filterEnvelopeSustain);

      filter.frequency.linearRampToValueAtTime(peakFrequency, attackEnd);
      filter.frequency.linearRampToValueAtTime(sustainFrequency, decayEnd);
      filter.frequency.cancelAndHoldAtTime(gateTime);
      filter.frequency.linearRampToValueAtTime(baseFrequency, gateTime + release);
    },
    getEchoDelaySeconds(delay: EchoDelayValue): number {
      const match = delay.match(/^1\/(\d+)([DT])?$/);
      if (!match) {
        return 60 / this.bpm;
      }

      const denominator = Number.parseInt(match[1], 10);
      const modifier = match[2];
      const quarterNoteSeconds = 60 / this.bpm;
      const wholeNoteSeconds = quarterNoteSeconds * 4;
      const modifierRatio = modifier === 'D' ? 1.5 : modifier === 'T' ? 2 / 3 : 1;
      return (wholeNoteSeconds / denominator) * modifierRatio;
    },
    getModulationRateSeconds(rate: ModulationRateValue): number {
      const match = rate.match(/^(\d+)\/(\d+)([DT])?$/);
      if (!match) {
        return 60 / this.bpm;
      }

      const numerator = Number.parseInt(match[1], 10);
      const denominator = Number.parseInt(match[2], 10);
      const modifier = match[3];
      const wholeNoteSeconds = (60 / this.bpm) * 4;
      const modifierRatio = modifier === 'D' ? 1.5 : modifier === 'T' ? 2 / 3 : 1;
      return (wholeNoteSeconds * numerator / denominator) * modifierRatio;
    },
    /** Tempo-synced LFO rate: one full modulation cycle per selected note division. */
    getModulationRateHz(rate: ModulationRateValue): number {
      return 1 / Math.max(0.001, this.getModulationRateSeconds(rate));
    },
    disposeTrackChain(chain: TrackAudioChain) {
      if (chain.drumRebuildTimer !== null) {
        window.clearTimeout(chain.drumRebuildTimer);
        chain.drumRebuildTimer = null;
      }
      Object.values(chain.drumInstruments).forEach((instrument) => instrument.dispose());
      chain.drumInstruments = {};
      chain.drumChokeMap = new Map();
      chain.synth?.dispose();
      chain.synthGain?.dispose();
      chain.noiseSynth?.dispose();
      chain.breathFilter?.dispose();
      chain.breathGain?.dispose();
      chain.filter?.dispose();
      if (chain.choir) {
        chain.choir.formants.forEach((path) => {
          path.filter.dispose();
          path.gain.dispose();
        });
        chain.choir.input.dispose();
        chain.choir.output.dispose();
      }
      chain.sourceBus.dispose();
      if (chain.waveshaper) disposeWaveshaperAudioChain(chain.waveshaper);
      chain.limiterGain.dispose();
      chain.limiter.dispose();
      chain.tremolo?.dispose();
      chain.vibrato?.dispose();
      chain.flangerLfo?.dispose();
      chain.chorus?.dispose();
      chain.flanger?.dispose();
      chain.phaser?.dispose();
      chain.wavetableLfoLoop?.dispose();
      chain.echo?.dispose();
      chain.echoReturnGain.dispose();
      chain.dryGain.dispose();
      chain.reverbSend.dispose();
      chain.drumReverbFadeGain.dispose();
      chain.drumReverbTrackGain.dispose();
      chain.outputGain.dispose();
      chain.fadeGain.dispose();
      chain.mixGain.dispose();
    },
    updateReverbChain() {
      const chain = this.getOrCreateReverbChain();
      updateReverbAudioChain(chain, {
        decay: this.reverbDecay,
        preDelay: this.reverbPreDelay,
        lowCutFrequency: this.midiToFrequency(this.reverbLowCut),
        highCutFrequency: this.midiToFrequency(this.reverbHighCut),
      });
      // A convolver keeps burning CPU on silence, so the tail is unplugged from the
      // destination whenever the reverb bus is switched off.
      setReverbOutputEnabled(chain, this.reverbEnabled);
    },
    routeTrackAudioChain(track: PresetTrackData, chain: TrackAudioChain) {
      const isNoise = this.isNoiseWaveform(track.waveform);
      const isChoir = this.isChoirWaveform(track.waveform);

      chain.synth?.disconnect();
      chain.synthGain?.disconnect();
      chain.noiseSynth?.disconnect();
      chain.breathFilter?.disconnect();
      chain.breathGain?.disconnect();
      if (chain.choir) {
        chain.choir.input.disconnect();
        chain.choir.output.disconnect();
        chain.choir.formants.forEach((path) => {
          path.filter.disconnect();
          path.gain.disconnect();
        });
        // Rebuild the parallel choir bank graph so choir mode can fan out cleanly.
        chain.choir.formants.forEach((path) => {
          chain.choir!.input.connect(path.filter);
          path.filter.connect(path.gain);
          path.gain.connect(chain.choir!.output);
        });
      }
      chain.sourceBus.disconnect();
      chain.waveshaper?.output.disconnect();
      chain.limiterGain.disconnect();
      chain.limiter.disconnect();
      chain.outputGain.disconnect();
      chain.vibrato?.disconnect();
      chain.tremolo?.disconnect();
      chain.chorus?.disconnect();
      chain.flanger?.disconnect();
      chain.phaser?.disconnect();
      chain.echo?.disconnect();
      chain.echoReturnGain.disconnect();
      chain.filter?.disconnect();
      chain.mixGain.disconnect();

      if (track.trackKind === 'rhythmic') {
        Object.values(chain.drumInstruments).forEach((instrument) => {
          this.routeDrumInstrument(track, chain, instrument);
        });
      } else if (isNoise) {
        this.ensureTrackNoiseSynth(chain).connect(chain.sourceBus);
      } else {
        const synth = this.ensureTrackSynth(chain, track);
        const synthGain = chain.synthGain!;
        const oscillatorTarget = isChoir ? this.ensureTrackChoirBank(chain).input : chain.sourceBus;
        synth.connect(synthGain);
        synthGain.connect(oscillatorTarget);
        if (isChoir) {
          chain.choir!.output.connect(chain.sourceBus);
        }
        if (track.breathEnabled) {
          this.ensureTrackNoiseSynth(chain).connect(this.ensureTrackBreathFilter(chain));
          chain.breathFilter!.connect(this.ensureTrackBreathGain(chain));
          chain.breathGain!.connect(chain.sourceBus);
        }
      }

      const signalChain: Tone.ToneAudioNode[] = [chain.limiterGain, chain.limiter, chain.outputGain];
      if (chain.waveshaper) {
        chain.sourceBus.connect(chain.waveshaper.input);
        chain.waveshaper.output.connect(chain.limiterGain);
      } else {
        chain.sourceBus.connect(chain.limiterGain);
      }
      if (track.vibratoEnabled && !isNoise) {
        signalChain.push(this.ensureTrackVibrato(chain, track));
      }
      if (track.tremoloEnabled) {
        signalChain.push(this.ensureTrackTremolo(chain, track));
      }
      if (track.chorusEnabled) {
        signalChain.push(this.ensureTrackChorus(chain));
      }
      if (track.flangerEnabled) {
        signalChain.push(this.ensureTrackFlanger(chain));
      }
      if (track.phaserEnabled) {
        signalChain.push(this.ensureTrackPhaser(chain));
      }
      if (track.echoEnabled && track.trackKind !== 'rhythmic') {
        signalChain.push(this.ensureTrackEcho(chain));
      }
      if (track.filterEnabled) {
        signalChain.push(this.ensureTrackFilter(chain));
      }
      signalChain.push(chain.fadeGain, chain.mixGain);
      Tone.connectSeries(...signalChain);
      chain.mixGain.connect(chain.dryGain);
      if (track.trackKind === 'rhythmic') {
        if (track.echoEnabled) {
          this.ensureTrackEcho(chain).connect(chain.echoReturnGain);
          chain.echoReturnGain.connect(chain.sourceBus);
        }
      } else {
        chain.mixGain.connect(chain.reverbSend);
      }
    },
    updateTrackChainSettings(track: PresetTrackData, chain: TrackAudioChain) {
      chain.modulationTrack = track;
      if (!chain.waveshaper && track.waveshaper.enabled) {
        chain.waveshaper = markRaw(createWaveshaperAudioChain(track.waveshaper));
        chain.routingSignature = '';
      } else if (chain.waveshaper) {
        updateWaveshaperAudioChain(chain.waveshaper, track.waveshaper);
      }
      this.rebuildDrumInstruments(track, chain);
      this.syncTrackChainNodeOptions(track, chain);
      const routingSignature = this.getTrackRoutingSignature(track);
      const isNoise = this.isNoiseWaveform(track.waveform);
      const envelope = {
        attackCurve: 'exponential' as const,
        attack: Math.max(track.attack, ENVELOPE_SMOOTHING_SECONDS),
        decay: Math.max(track.decay, ENVELOPE_SMOOTHING_SECONDS),
        decayCurve: 'exponential' as const,
        releaseCurve: 'exponential' as const,
        release: Math.max(track.release, ENVELOPE_SMOOTHING_SECONDS),
        sustain: track.sustain,
      };

      if (track.trackKind !== 'rhythmic') {
        this.syncTrackSynthEngine(track, chain);
        // Applying voice settings walks every pooled voice, so it is skipped whenever
        // nothing that feeds those settings actually changed.
        const voiceSignature = this.getTrackVoiceSignature(track);
        if (voiceSignature !== chain.voiceSignature) {
          chain.voiceSignature = voiceSignature;
          if (isNoise || track.breathEnabled) {
            this.ensureTrackNoiseSynth(chain).set({
              envelope,
              noise: {
                type: isNoise ? this.getNoiseType(track.waveform) : 'pink',
              },
            });
          }
          if (!isNoise) {
            const partials = this.getTonewheelPartials(track);
            const oscillatorOptions = {
              type: this.getOscillatorType(track) as Tone.ToneOscillatorType,
              count: track.unisonVoices,
              spread: track.unisonDetune,
              partials,
            } as unknown as Tone.PolySynthOptions<Tone.Synth<Tone.SynthOptions>>['options']['oscillator'];
            const voiceOptions = {
              envelope,
              oscillator: oscillatorOptions,
              pitchEnvelope: {
                attack: Math.max(track.pitchEnvelopeAttack, ENVELOPE_SMOOTHING_SECONDS),
                decay: Math.max(track.pitchEnvelopeDecay, ENVELOPE_SMOOTHING_SECONDS),
                sustain: track.pitchEnvelopeSustain,
                release: Math.max(track.pitchEnvelopeRelease, ENVELOPE_SMOOTHING_SECONDS),
              },
              pitchEnvelopeAmount: track.pitchEnvelopeAmount,
              pitchEnvelopeShape: track.pitchEnvelopeShape,
            } as Parameters<PitchEnvelopeSynth['set']>[0];
            // PolySynth.set typings only expose base SynthOptions; PitchEnvelopeSynth accepts the extras.
            const synth = this.ensureTrackSynth(chain, track);
            if (synth instanceof MonoGlideSynth) {
              synth.set(voiceOptions);
              synth.setGlide({
                time: track.glideTime,
                mode: track.glideMode as GlideMode,
                constantRate: track.glideConstantRate,
                curve: track.glideCurve as GlideCurve,
                legato: track.monoLegato,
              });
            } else {
              (synth as TonewheelPolySynth).set(voiceOptions as Parameters<TonewheelPolySynth['set']>[0]);
            }
            chain.lastAppliedPartials = partials;
            if (this.isChoirWaveform(track.waveform)) {
              this.updateChoirFormantBank(track.waveform, this.ensureTrackChoirBank(chain).formants);
            }
          }
          if (track.breathEnabled) {
            this.ensureTrackBreathGain(chain).gain.value = this.dbToGain(track.breathLevel);
          }
        }
        if (chain.synthGain) {
          const now = Tone.now();
          chain.synthGain.gain.cancelScheduledValues(now);
          chain.synthGain.gain.setValueAtTime(1, now);
        }
      }
      this.syncTonewheelModulationLoop(track, chain);

      if (track.filterEnabled) {
        this.ensureTrackFilter(chain).set({
          type: track.filterType as BiquadFilterType,
          frequency: this.midiToFrequency(track.filterFrequency),
          rolloff: track.filterRolloff as -12 | -24 | -48 | -96,
          Q: track.filterQ,
          gain: track.filterGain,
        });
      }
      chain.limiterGain.gain.value = this.dbToGain(track.limiterGain);
      if (track.tremoloEnabled) {
        const tremolo = this.ensureTrackTremolo(chain, track);
        tremolo.set({
          frequency: track.tremoloFrequency,
          depth: this.clampNormalRange(track.tremoloDepth),
          wet: 1,
        });
        setTremoloSpread(tremolo, track.tremoloSpread);
      }
      if (track.vibratoEnabled && !isNoise) {
        this.ensureTrackVibrato(chain, track).set({
          frequency: track.vibratoFrequency,
          depth: this.clampNormalRange(track.vibratoDepth),
          wet: 1,
        });
      }
      if (track.echoEnabled) {
        this.ensureTrackEcho(chain).set({
          // Tone rejects a delay time above the node's maxDelay, which would abort playback.
          delayTime: Math.min(this.getEchoDelaySeconds(track.echoDelay), chain.maxDelay),
          feedback: this.clampNormalRange(track.echoFeedback),
          wet: track.trackKind === 'rhythmic' ? 1 : this.dbToWetMix(track.echoWet),
        });
      }
      chain.echoReturnGain.gain.value = this.dbToGain(track.echoWet);
      if (track.chorusEnabled) {
        this.ensureTrackChorus(chain).set({
          frequency: this.getModulationRateHz(track.chorusRate),
          delayTime: track.chorusDelay,
          depth: this.clampNormalRange(track.chorusDepth),
          spread: track.chorusSpread,
          feedback: this.clampNormalRange(track.chorusFeedback),
          wet: this.dbToWetMix(track.chorusWet),
        });
      }
      if (track.flangerEnabled) {
        const flangerDelaySeconds = track.flangerDelay / 1000;
        const flangerSweepSeconds = flangerDelaySeconds * this.clampNormalRange(track.flangerDepth);
        const flanger = this.ensureTrackFlanger(chain);
        chain.flangerLfo!.set({
          frequency: this.getModulationRateHz(track.flangerRate),
          min: Math.max(0.00005, flangerDelaySeconds - flangerSweepSeconds),
          max: Math.min(FLANGER_MAX_DELAY_SECONDS, flangerDelaySeconds + flangerSweepSeconds),
        });
        flanger.set({
          feedback: this.clampNormalRange(track.flangerFeedback),
          wet: this.dbToWetMix(track.flangerWet),
        });
      }
      if (track.phaserEnabled) {
        this.ensureTrackPhaser(chain).apply({
          frequency: this.getModulationRateHz(track.phaserRate),
          sweepOctaves: (track.phaserDepth / 100) * PHASER_MAX_SWEEP_OCTAVES,
          Q: track.phaserQ,
          feedback: track.phaserFeedback,
          wet: this.dbToWetMix(track.phaserWet),
        });
      }
      chain.outputGain.gain.value = this.dbToGain(track.gain);
      this.applyTrackMixState(track, chain);
      chain.dryGain.gain.value = this.dbToGain(this.reverbDry);
      chain.reverbSend.gain.value = this.reverbEnabled ? this.dbToGain(track.reverbWet + this.reverbWet) : 0;
      const context = chain.sourceBus.context;
      if (!context.isOffline && context.lookAhead !== 0.4) {
        context.lookAhead = 0.4;
      }
      if (routingSignature !== chain.routingSignature) {
        this.routeTrackAudioChain(track, chain);
        chain.routingSignature = routingSignature;
        // Vibrato and tremolo start once at creation; rewiring must not reset their
        // phase or schedule a second oscillator at the beginning of an offline render.
        this.ensureTrackModulationRunning(chain);
      }
    },
    /**
     * Everything that feeds `synth.set()` / `noiseSynth.set()`. Applying voice settings
     * fans out across every pooled voice, so it only runs when this signature changes.
     */
    getTrackVoiceSignature(track: PresetTrackData): string {
      return [
        track.waveform,
        JSON.stringify(normalizePartialGenerator(track.partialGenerator)),
        track.tonewheelDrawbars,
        JSON.stringify(track.tonewheelWavetable),
        track.breathEnabled,
        track.breathLevel,
        track.breathHarmonic,
        track.unisonVoices,
        track.unisonDetune,
        track.attack,
        track.decay,
        track.sustain,
        track.release,
        track.pitchEnvelopeAttack,
        track.pitchEnvelopeDecay,
        track.pitchEnvelopeSustain,
        track.pitchEnvelopeRelease,
        track.pitchEnvelopeAmount,
        track.pitchEnvelopeShape,
        track.polyphony,
        track.glideTime,
        track.glideMode,
        track.glideConstantRate,
        track.glideCurve,
        track.monoLegato,
      ].join('|');
    },
    applyTonewheelModulation(track: PresetTrackData, chain: TrackAudioChain, timeSeconds: number) {
      if (!chain.synth || this.isNoiseWaveform(track.waveform)) {
        return;
      }
      const partials = this.getTonewheelPartials(track, timeSeconds, chain.modulationNoteStartSeconds);
      if (partials === chain.lastAppliedPartials) {
        return;
      }
      const oscillator = {
        type: this.getOscillatorType(track) as Tone.ToneOscillatorType,
        count: track.unisonVoices,
        spread: track.unisonDetune,
        partials,
      };
      if (chain.synth instanceof MonoGlideSynth) {
        chain.synth.set({ oscillator } as unknown as Parameters<PitchEnvelopeSynth['set']>[0]);
      } else {
        (chain.synth as TonewheelPolySynth).set({ oscillator } as Parameters<TonewheelPolySynth['set']>[0]);
      }
      chain.lastAppliedPartials = partials;
    },
    syncTonewheelModulationLoop(track: PresetTrackData, chain: TrackAudioChain) {
      const hasActiveRoutes = normalizePartialGenerator(track.partialGenerator).type === 'tonewheel'
        && track.tonewheelWavetable.enabled
        && (track.tonewheelWavetable.lfos ?? []).some((lfo) => (
          lfo.enabled && lfo.depth > 0 && lfo.routes.some((amount) => amount !== 0)
        ));
      if (!hasActiveRoutes || track.trackKind === 'rhythmic' || this.isNoiseWaveform(track.waveform)) {
        chain.wavetableLfoLoop?.dispose();
        chain.wavetableLfoLoop = null;
        return;
      }
      if (!chain.wavetableLfoLoop) {
        chain.wavetableLfoLoop = markRaw(new Tone.Loop((time) => {
          const currentTrack = chain.modulationTrack;
          if (currentTrack) {
            this.applyTonewheelModulation(
              currentTrack,
              chain,
              chain.sourceBus.context.transport.getSecondsAtTime(time),
            );
          }
        }, 1 / 30));
        chain.wavetableLfoLoop.start(0);
      }
    },
    /**
     * Recover the remaining free-running modulators on the track chain.
     * stop()+start() recreates each LFO's internal oscillator and re-binds frequency,
     * which recovers units that report "started" but are no longer producing motion.
     */
    ensureTrackModulationRunning(chain: TrackAudioChain) {
      if (chain.chorus) {
        chain.chorus.stop();
        chain.chorus.start();
      }
      if (chain.flangerLfo) {
        chain.flangerLfo.stop();
        chain.flangerLfo.start();
      }
      if (chain.phaser) {
        chain.phaser.lfo.stop();
        chain.phaser.lfo.start();
      }
    },
    updateSynths(trackId?: string, createMissingChains = true) {
      const activeTrackIds = new Set(this.tracks.map((track) => track.id));
      for (const [existingTrackId, chain] of Object.entries(this.trackSynths)) {
        if (!activeTrackIds.has(existingTrackId)) {
          this.disposeTrackChain(chain);
          delete this.trackSynths[existingTrackId];
        }
      }

      this.updateReverbChain();

      const tracksToUpdate = trackId
        ? this.tracks.filter((track) => track.id === trackId)
        : this.tracks;

      for (const track of tracksToUpdate) {
        const existing = this.trackSynths[track.id];
        if (!existing && !createMissingChains) {
          continue;
        }
        // Always go through getOrCreateTrackChain: an existing chain may no longer
        // fit the track (e.g. a lower bpm pushes the echo delay past its maxDelay).
        const chain = this.getOrCreateTrackChain(track);
        this.updateTrackChainSettings(track, chain);
      }
    },
    async getMidi(): Promise<Midi> {
      const midi = new Midi();
      
      midi.header.setTempo(this.bpm);
      const totalLoopDuration = this.getLoopDurationSecondsFromTrackLengths();

      for (const entry of this.allTrackActualNotes) {
        const events = this.buildTrackEvents(entry.track, entry.notes, totalLoopDuration, entry.trackIndex, entry.noteVelocities, entry.drumVoiceIds);
        if (events.length === 0) {
          continue;
        }

        const track = midi.addTrack();
        track.channel = entry.track.midiChannel - 1;

        for (const event of events) {
          for (let noteIndex = 0; noteIndex < event.notes.length; noteIndex += 1) {
            const note = event.notes[noteIndex];
            track.addNote({
              midi: note,
              time: event.time,
              duration: event.duration,
              velocity: event.noteVelocities?.[noteIndex] ?? event.velocity,
            });
          }
        }
      }
      
      return midi;
    },
    async toggleSequencer() {
      if (this.isRunning) {
        this.stopSequencer();
      } else {
        this.startSequencer();
      }
    },
    stopTrackLoops() {
      for (const loop of Object.values(this.trackLoops)) {
        loop.stop();
        loop.dispose();
      }
      this.trackLoops = markRaw({});
      for (const loop of Object.values(this.trackFadeLoops)) {
        loop.stop();
        loop.dispose();
      }
      this.trackFadeLoops = markRaw({});
      // A restart must not glide in from the pitch that was playing when the transport stopped.
      for (const chain of Object.values(this.trackSynths)) {
        chain.fadeGain.gain.cancelScheduledValues(Tone.now());
        chain.fadeGain.gain.value = 1;
        chain.drumReverbFadeGain.gain.cancelScheduledValues(Tone.now());
        chain.drumReverbFadeGain.gain.value = 1;
        chain.soundingNotes.length = 0;
        if (chain.synth instanceof MonoGlideSynth) {
          chain.synth.resetGlide();
        }
      }
    },
    scheduleTrackFadeEnvelope(
      track: PresetTrackData,
      trackNotes: number[][],
      gain: TrackAudioChain['fadeGain']['gain'],
      startTime: number,
      additionalGain?: TrackAudioChain['fadeGain']['gain'],
    ) {
      const activeDuration = track.repeats * this.getTrackRepeatDuration(track, trackNotes);
      const barSeconds = this.getTrackBarSeconds(track);
      const points = buildTrackFadeEnvelope(
        activeDuration,
        track.fadeIn * barSeconds,
        track.fadeOut * barSeconds,
      );
      for (const targetGain of additionalGain ? [gain, additionalGain] : [gain]) {
        if (points.length === 0) {
          targetGain.setValueAtTime(1, startTime);
          continue;
        }

        targetGain.setValueAtTime(points[0].gain, startTime + points[0].time);
        for (const point of points.slice(1)) {
          targetGain.linearRampToValueAtTime(point.gain, startTime + point.time);
        }
      }
    },
    scheduleTrackLoopRebuild() {
      if (!this.isRunning) {
        return;
      }

      if (this.rebuildTrackLoopsTimer !== null) {
        window.clearTimeout(this.rebuildTrackLoopsTimer);
      }

      this.rebuildTrackLoopsTimer = window.setTimeout(() => {
        this.rebuildTrackLoopsTimer = null;
        this.rebuildTrackLoops();
      }, 90);
    },
    rebuildTrackLoops() {
      if (!this.isRunning) {
        return;
      }

      if (this.rebuildTrackLoopsTimer !== null) {
        window.clearTimeout(this.rebuildTrackLoopsTimer);
        this.rebuildTrackLoopsTimer = null;
      }

      this.stopTrackLoops();

      const totalLoopDuration = this.getLoopDurationSecondsFromTrackLengths();

      for (const entry of this.allTrackActualNotes) {
        if (entry.notes.length === 0 || !this.isTrackAudible(entry.track.id)) {
          continue;
        }

        const events = this.buildTrackEvents(entry.track, entry.notes, totalLoopDuration, entry.trackIndex, entry.noteVelocities, entry.drumVoiceIds);
        if (events.length === 0) {
          continue;
        }

        const trackId = entry.track.id;
        const part = markRaw(new Tone.Part<TrackScheduledEvent>((when, event) => {
          this.playTrackStep(this.trackById.get(trackId) ?? entry.track, event, when);
        }, events));
        part.loop = true;
        part.loopStart = 0;
        part.loopEnd = totalLoopDuration;
        part.start(0);
        this.trackLoops[entry.track.id] = part;

        if (entry.track.fadeIn > 0 || entry.track.fadeOut > 0) {
          const fadePart = markRaw(new Tone.Part<{ time: number }>((when) => {
            const currentTrack = this.trackById.get(trackId) ?? entry.track;
            const currentNotes = this.computeActualNotes(currentTrack);
            const chain = this.getOrCreateTrackChain(currentTrack);
            this.scheduleTrackFadeEnvelope(
              currentTrack,
              currentNotes,
              chain.fadeGain.gain,
              when,
              chain.drumReverbFadeGain.gain,
            );
          }, [{ time: this.getTrackDelaySeconds(entry.track) }]));
          fadePart.loop = true;
          fadePart.loopStart = 0;
          fadePart.loopEnd = totalLoopDuration;
          fadePart.start(0);
          this.trackFadeLoops[entry.track.id] = fadePart;
        }
      }
    },
    showPlaybackErrorMessage(message: string) {
      this.playbackErrorMessage = message;
      this.showPlaybackError = true;
    },
    setupAudioContextResumeOnInteraction() {
      const handler = () => {
        if (Tone.getContext().state !== 'running') {
          Tone.start().catch((error) => {
            console.warn('Failed to resume audio context on interaction:', error);
          });
        }
      };
      this.audioContextResumeHandler = handler;
      document.addEventListener('click', handler, { once: true });
      document.addEventListener('touchstart', handler, { once: true });
      document.addEventListener('keydown', handler, { once: true });
    },
    async startSequencer() {
      if (this.isRunning || this.isStarting) {
        return;
      }

      this.isStarting = true;
      try {
        let lastError: unknown = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            await Tone.start();
            if (Tone.getContext().state === 'running') {
              break;
            }
            await new Promise((resolve) => window.setTimeout(resolve, 50));
          } catch (error) {
            lastError = error;
            await new Promise((resolve) => window.setTimeout(resolve, 100));
          }
        }

        if (Tone.getContext().state !== 'running') {
          throw lastError instanceof Error ? lastError : new Error('Audio context did not resume.');
        }

        this.applyRealtimeSettings();
        this.isRunning = true;
        this.rebuildTrackLoops();
        Tone.getTransport().seconds = 0;
        Tone.getTransport().start();
      } catch (error) {
        console.error('Unable to start audio playback:', error);
        this.isRunning = false;
        this.stopTrackLoops();
        Tone.getTransport().stop();
        const message = error instanceof Error ? error.message : String(error);
        this.showPlaybackErrorMessage(`Audio playback could not start: ${message}`);
      } finally {
        this.isStarting = false;
      }
    },
    stopSequencer() {
      this.isRunning = false;
      this.stopTrackLoops();
      Tone.getTransport().stop();
      Tone.getTransport().seconds = 0;
    },
    playTrackStep(track: PresetTrackData, event: TrackScheduledEvent, when: Tone.Unit.Seconds) {
      if (!this.audibleTrackIds.has(track.id)) {
        return;
      }

      const arr = event.notes;
      if (arr.length === 0) {
        return;
      }

      const vel = event.velocity;
      const noteDuration = event.duration;
      const noteVelocities = event.noteVelocities;
      const drumVoiceIds = event.drumVoiceIds;

      if (this.useMidiOutput) {
        for (let index = 0; index < arr.length; index += 1) {
          this.playNoteWithMidi(arr[index], noteVelocities?.[index] ?? vel, noteDuration, when, track.midiChannel);
        }
        return;
      }

      const chain = this.getOrCreateTrackChain(track);
      this.scheduleFilterEnvelope(track, arr, when, noteDuration, chain);
      if (track.trackKind === 'rhythmic') {
        for (let index = 0; index < arr.length; index += 1) {
          const voiceId = drumVoiceIds?.[index];
          const instrument = voiceId ? chain.drumInstruments[voiceId] : undefined;
          this.chokeDrumXorGroup(chain, voiceId, when);
          instrument?.trigger(when, noteVelocities?.[index] ?? vel, noteDuration);
        }
      } else {
        this.triggerTrackVoice(track, chain, arr, `${noteDuration}s`, when, vel);
      }
    },

    async downloadMIDI() {
      if (this.isExporting) {
        return;
      }

      this.transportMenuOpen = false;
      this.startExport('midi', 'Preparing MIDI export...');
      try {
        this.exportProgress = 30;
        this.exportStatus = 'Building MIDI data...';
        const midi = await this.getMidi();
        this.exportProgress = 70;
        this.exportStatus = 'Encoding MIDI...';
        const data = midi.toArray();
        const blob = new Blob([Uint8Array.from(data)], { type: 'audio/midi' });
        this.exportProgress = 90;
        this.exportStatus = 'Downloading MIDI...';
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `GateRunner-${this.currentPresetFilenamePart()}-${this.formattedDate().toString()}-${this.forte}-${this.bpm}bpm.mid`;
        a.click();

        URL.revokeObjectURL(url);
        this.exportProgress = 100;
        this.exportStatus = 'MIDI export complete.';
      } catch (error) {
        console.error('Failed to export MIDI:', error);
        this.showNotice('MIDI export failed. Please try again.', 'error');
      } finally {
        this.finishExport();
      }
    },
    async downloadWAV() {
      if (this.isExporting) {
        return;
      }

      this.transportMenuOpen = false;
      this.startExport('wav', 'Preparing WAV export...');

      try {
        const data = await this.renderMixWav();
        this.setWavExportProgress(98, 'Finalizing download...');
        const blob = new Blob([data.buffer as ArrayBuffer], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `GateRunner-${this.currentPresetFilenamePart()}-${this.formattedDate().toString()}-${this.forte}-${this.bpm}bpm-mix.wav`;
        a.click();

        URL.revokeObjectURL(url);
        this.setWavExportProgress(100, 'WAV export complete.');
      } catch (error) {
        console.error('Failed to export WAV:', error);
        this.showNotice('WAV export failed. Please try again.', 'error');
      } finally {
        this.finishExport();
      }
    }
  },
  async beforeMount() {
      await PCS12.init();
      const arr = Array.from(PCS12.getChords()).map(c => c.toString());
      arr.sort(PCS12.ReverseForteStringComparator);
      this.allChords=arr;
      this.applyRealtimeSettings();
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.updateControlDeckHeight);
    this.controlDeckResizeObserver?.disconnect();
    if (this.audioContextResumeHandler) {
      document.removeEventListener('click', this.audioContextResumeHandler);
      document.removeEventListener('touchstart', this.audioContextResumeHandler);
      document.removeEventListener('keydown', this.audioContextResumeHandler);
    }
    if (this.rebuildTrackLoopsTimer !== null) {
      window.clearTimeout(this.rebuildTrackLoopsTimer);
      this.rebuildTrackLoopsTimer = null;
    }
    this.stopSequencer();
    for (const chain of Object.values(this.trackSynths)) {
      this.disposeTrackChain(chain);
    }
    this.trackSynths = markRaw({});
    if (this.reverbChain) {
      disposeReverbAudioChain(this.reverbChain as ReverbAudioChain);
      this.reverbChain = null;
    }
  },
  async mounted() {
    this.applyRealtimeSettings();
    if (this.useMidiOutput) {
      await this.initializeMidi();
    }

    this.$nextTick(() => {
      this.updateControlDeckHeight();
      const deck = this.$refs.controlDeck as HTMLElement | undefined;
      if (deck) {
        this.controlDeckResizeObserver = new ResizeObserver(this.updateControlDeckHeight);
        this.controlDeckResizeObserver.observe(deck);
      }
    });
    window.addEventListener('resize', this.updateControlDeckHeight);
    this.setupAudioContextResumeOnInteraction();
  }
});
</script>

<style scoped>
.shader-bg {
  position: fixed;
  inset: 0;
  z-index: 0;
  width: 100vw;
  height: 100vh;
  display: none;
  pointer-events: none;
}

:deep(.v-application) {
  background: var(--panel-black) !important;
}

:deep(.v-main) {
  background: transparent !important;
}

.app-shell {
  color: var(--instrument-text);
  background:
    repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.012) 0 1px, transparent 1px 4px),
    var(--panel-black);
}

.workspace-main {
  position: relative;
  z-index: 1;
  padding: 0 12px 16px;
  background: transparent;
}

.donation-footer {
  min-height: 28px;
  padding: 4px 12px;
  justify-content: center;
  background: var(--panel-black);
}

.donation-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--instrument-muted);
  text-decoration: none;
  font-size: 0.72rem;
  letter-spacing: 0.02em;
}

.donation-link:hover,
.donation-link:focus-visible {
  color: var(--indicator-amber);
}

.control-deck {
  position: fixed;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  width: min(1120px, calc(100vw - 20px));
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.control-deck-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 0;
  border: 1px solid rgba(242, 184, 75, 0.48);
  background: linear-gradient(180deg, #2b2d24, var(--panel-deep));
  box-shadow: inset 0 1px rgba(255, 245, 205, 0.08), 0 0 18px rgba(242, 184, 75, 0.1), 0 14px 30px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(12px);
}

.control-deck-toggle {
  border: 1px solid var(--panel-border-soft);
  background: var(--panel-raised);
}

.toolbar-panel {
  padding: 8px 10px;
  border-radius: 0;
  border: 1px solid var(--panel-border-soft);
  background: var(--panel-deep);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(12px);
}

.track-rack {
  min-width: 0;
  border: 1px solid rgba(242, 184, 75, 0.5);
  background: #20221b;
  box-shadow: inset 0 1px rgba(255, 240, 190, 0.06), 0 8px 18px rgba(0, 0, 0, 0.36);
}

.track-rack-summary {
  min-height: 34px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 34px;
  align-items: stretch;
}

.track-rack-toggle {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 9px;
  border: 0;
  background: transparent;
  color: var(--instrument-text);
  font: inherit;
  cursor: pointer;
  text-align: left;
}

.track-rack-toggle:hover,
.track-rack-toggle:focus-visible {
  background: rgba(242, 184, 75, 0.08);
  outline: none;
}

.track-rack-icon,
.track-rack-label {
  color: var(--indicator-amber);
}

.track-rack-label {
  font-size: 0.78rem;
  font-weight: 800;
}

.track-rack-count {
  min-width: 20px;
  padding: 1px 5px;
  border: 1px solid rgba(217, 111, 50, 0.55);
  color: #ffc37d;
  font-size: 0.68rem;
  font-weight: 800;
  line-height: 1.35;
  text-align: center;
}

.track-rack-divider {
  width: 1px;
  height: 16px;
  background: var(--panel-border-soft);
}

.track-rack-current {
  min-width: 0;
  overflow: hidden;
  color: var(--instrument-muted);
  font-size: 0.76rem;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.track-rack-add {
  width: 34px;
  height: 34px;
  border-left: 1px solid var(--panel-border-soft);
}

.track-workspace {
  width: min(1120px, 100%);
  margin: 0 auto;
  padding: 8px 10px 10px;
  border: 1px solid rgba(242, 184, 75, 0.5);
  background: #23251d;
  box-shadow: inset 0 1px rgba(255, 240, 190, 0.06), 0 12px 24px rgba(0, 0, 0, 0.3);
}

.brand-group {
  flex: 1 1 auto;
  justify-content: center;
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.app-title {
  margin: 0;
  color: var(--indicator-amber);
  font-size: clamp(1.2rem, 2vw, 1.6rem);
  letter-spacing: 0;
  line-height: 1;
  text-shadow: 0 0 10px rgba(242, 184, 75, 0.28);
}

.version-pill {
  font-size: 0.76rem;
  letter-spacing: 0.05em;
  color: var(--instrument-muted);
  padding: 2px 8px;
  border-radius: 0;
  border: 1px solid var(--panel-border-soft);
  background: var(--panel-inset);
}

.toolbar-icon-btn {
  color: var(--instrument-text);
}

.header-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.header-icon-btn {
  width: 34px;
  height: 34px;
  border: 1px solid var(--panel-border-soft);
  box-shadow: inset 0 1px rgba(255, 245, 205, 0.05);
}

.play-toggle-btn {
  box-shadow: 0 0 14px rgba(158, 170, 105, 0.24);
}

.transport-actions {
  margin-top: 8px;
  display: grid;
  grid-template-columns: auto auto;
  justify-content: start;
  gap: 8px;
}

.transport-play-btn {
  min-width: 120px;
  font-weight: 700;
}

.transport-actions-menu-btn {
  min-width: 132px;
}

.transport-action-menu {
  min-width: 220px;
  border: 1px solid var(--panel-border-soft);
  background: rgba(28, 30, 25, 0.98);
}

.midi-menu-item {
  align-items: flex-start;
}

.midi-menu-switch {
  margin-top: 0;
}

.midi-menu-device-select {
  min-width: 220px;
}

.forte-control-top {
  min-width: 0;
}

.dependent-settings-row {
  margin-top: 8px;
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
  align-items: center;
}

.tempo-control,
.a4-control {
  min-width: 0;
}

.control-deck-spacer {
  width: 100%;
  pointer-events: none;
}

:deep(.v-btn),
:deep(.v-field),
:deep(.v-card),
:deep(.v-list),
:deep(.v-menu > .v-overlay__content),
:deep(.v-overlay__content),
:deep(.v-progress-linear),
:deep(.v-snackbar__wrapper) {
  border-radius: 0 !important;
}

:deep(.v-label),
:deep(.v-field__input),
:deep(.v-select__selection-text),
:deep(.v-autocomplete__selection-text),
:deep(.v-list-item-title),
:deep(.v-switch__label) {
  color: var(--instrument-text) !important;
}

:deep(.v-field) {
  border-radius: 0;
  background: var(--panel-inset);
}

:deep(.v-field--variant-outlined .v-field__outline) {
  color: rgba(180, 177, 133, 0.58) !important;
}

:deep(.v-btn__content) {
  text-transform: none;
  letter-spacing: 0.015em;
}

.rename-dialog-card {
  border: 1px solid var(--panel-border-soft);
  background: var(--panel-deep);
}

@media (max-width: 960px) {
  .control-deck {
    width: calc(100vw - 16px);
    top: 8px;
  }

  .dependent-settings-row {
    grid-template-columns: minmax(0, 1fr);
  }

}

@media (max-width: 680px) {
  .workspace-main {
    padding: 0 6px 10px;
  }

  .control-deck {
    width: calc(100vw - 10px);
    top: 6px;
    gap: 6px;
  }

  .toolbar-panel {
    padding: 8px 9px;
    border-radius: 0;
  }

  .track-workspace {
    padding: 6px;
  }

  .brand-group {
    gap: 8px;
  }

  .version-pill {
    font-size: 0.7rem;
  }

  .dependent-settings-row {
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }

}
</style>