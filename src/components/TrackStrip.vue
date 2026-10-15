<template>
  <div class="track-arranger">
    <div class="track-activation">
      <button
        type="button"
        class="track-activation-toggle"
        :aria-expanded="activationExpanded ? 'true' : 'false'"
        @click="activationExpanded = !activationExpanded"
      >
        <v-icon size="16">{{ activationExpanded ? 'mdi-chevron-down' : 'mdi-chevron-right' }}</v-icon>
        <span>Track Activation (B)</span>
        <span class="track-activation-status">{{ activationStatusLabel }}</span>
      </button>

      <div v-show="activationExpanded" class="track-activation-body">
        <v-text-field
          :model-value="bitmaskSequenceInput"
          label="Bitmask sequence B"
          placeholder="e.g. 1 2 3 0 (blank = off)"
          hide-details="auto"
          density="compact"
          variant="outlined"
          :error-messages="activationErrorMessages"
          @update:model-value="onBitmaskSequenceInput"
        />
        <p class="track-activation-help">
          Optional. Space-separated nonnegative decimal masks split the full song loop into equal chunks.
          Bit 0 = first track. Blank disables gating.
        </p>
      </div>
    </div>

    <div class="timeline-scroll">
    <div class="timeline-content" :style="{ width: `${zoom * 100}%` }">
    <div class="timeline-ruler"><span class="ruler-heading">TRACK / PATTERN</span><div class="ruler-beats"><span v-for="beat in rulerBeats" :key="beat" :style="{ left: `${beat / loopDurationBeats * 100}%` }">{{ formatBeats(beat) }}</span><span class="ruler-unit">BEATS</span></div><span class="ruler-heading ruler-tools">M / S</span></div>
    <div class="track-timeline" aria-label="Track lengths in beats">
      <div
        v-for="entry in trackTimingEntries"
        :key="entry.track.id"
        role="button"
        tabindex="0"
        class="track-timeline-row"
        :style="{ '--track-color': trackColors[entry.trackIndex % trackColors.length] }"
        :class="{
          selected: entry.track.id === selectedTrackId,
          dragging: entry.track.id === draggedTrackId,
          'drop-target': entry.track.id === dropTargetTrackId,
          'track-is-muted': !isTrackAudible(entry.track.id),
        }"
        draggable="true"
        @click="$emit('select-track', entry.track.id)"
        @dblclick="$emit('edit-track', entry.track.id)"
        @keydown.enter.self.prevent="$emit('select-track', entry.track.id)"
        @keydown.space.self.prevent="$emit('select-track', entry.track.id)"
        @dragstart="onDragStart(entry.track.id, $event)"
        @dragover.prevent="onDragOver(entry.track.id)"
        @dragleave="onDragLeave(entry.track.id)"
        @drop.prevent="onDrop(entry.track.id)"
        @dragend="onDragEnd"
      >
        <div class="track-timeline-meta">
          <span class="track-number">{{ String(entry.trackIndex + 1).padStart(2, '0') }}</span>
          <v-icon class="track-kind-icon" size="17">{{ entry.track.trackKind === 'rhythmic' ? 'mdi-album' : 'mdi-piano' }}</v-icon>
          <div class="track-meta-text">
          <input
            class="track-name-input"
            :value="entry.track.name"
            :aria-label="`Track name for ${entry.track.name || 'unnamed track'}`"
            @click.stop
            @dblclick.stop
            @focus="$emit('select-track', entry.track.id)"
            @input="$emit('track-name-input', entry.track.id, ($event.target as HTMLInputElement).value)"
            @blur="$emit('commit-track-name', entry.track.id)"
            @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
          />
          <span class="track-meta-description">{{ entry.track.trackKind === 'rhythmic' ? 'Drum kit' : entry.track.synthMode ?? 'Additive' }} · {{ formatBeats(entry.totalBeats) }} beats</span>
          </div>
        </div>
        <div class="track-timeline-bar" :style="{ backgroundSize: `${rulerInterval / loopDurationBeats * 100}% 100%` }">
          <div class="track-timeline-segments">
            <span
              v-if="entry.delayBeats > 0"
              class="track-timeline-segment delay"
              :style="segmentStyle(entry.delayBeats)"
              :title="`${formatBeats(entry.delayBeats)} beat delay`"
            ></span>
            <template v-for="section in entry.sections" :key="section.id">
              <span class="track-timeline-segment repeat" :style="segmentStyle(section.beats)" :title="`${section.name}: ${formatBeats(section.beats)} beats · double-click to edit phrase`" @dblclick.stop="$emit('edit-pattern', entry.track.id, section.pattern)"><span class="clip-label">{{ section.name }}</span></span>
            </template>
            <template v-for="repeat in entry.repeatBlocks" :key="repeat">
              <span
                v-if="entry.paddingBeforeBeats > 0"
                class="track-timeline-segment sequence-padding"
                :style="segmentStyle(entry.paddingBeforeBeats)"
                :title="`Repeat ${repeat}: ${formatBeats(entry.paddingBeforeBeats)} beats before padding`"
              ></span>
              <span
                class="track-timeline-segment repeat"
                :style="segmentStyle(entry.patternBeats)"
                :title="`Repeat ${repeat}: ${formatBeats(entry.patternBeats)} sequence beats`"
              ><span class="clip-label">{{ entry.track.name }} <small>· {{ repeat }}</small></span></span>
              <span
                v-if="entry.paddingAfterBeats > 0"
                class="track-timeline-segment sequence-padding"
                :style="segmentStyle(entry.paddingAfterBeats)"
                :title="`Repeat ${repeat}: ${formatBeats(entry.paddingAfterBeats)} beats after padding`"
              ></span>
            </template>
            <span
              v-if="entry.padBeats > 0"
              class="track-timeline-segment pad"
              :style="segmentStyle(entry.padBeats)"
              aria-hidden="true"
            ></span>
          </div>
          <svg class="track-note-preview" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true"><path :d="entry.preview" /></svg>
          <div
            v-if="entry.chunkStates.length > 0"
            class="track-activation-overlay"
            aria-hidden="true"
          >
            <span
              v-for="(active, chunkIndex) in entry.chunkStates"
              :key="`chunk-${entry.track.id}-${chunkIndex}`"
              class="track-activation-chunk"
              :class="{ inactive: !active }"
              :title="chunkTooltip(entry, chunkIndex, active)"
            ></span>
          </div>
          <div class="timeline-playhead" :style="{ left: `${playhead * 100}%` }" aria-hidden="true" />
        </div>
        <div class="track-timeline-controls" @dblclick.stop>
          <v-btn
            class="track-mix-btn"
            icon
            size="x-small"
            :variant="isTrackMuted(entry.track.id) ? 'tonal' : 'text'"
            :color="isTrackMuted(entry.track.id) ? 'warning' : undefined"
            :aria-label="`Mute ${entry.track.name}`"
            :aria-pressed="isTrackMuted(entry.track.id)"
            :title="isTrackMuted(entry.track.id) ? `Unmute ${entry.track.name}` : `Mute ${entry.track.name}`"
            @click.stop="$emit('toggle-muted', entry.track.id)"
          >
            <span class="mix-letter">M</span>
          </v-btn>
          <v-btn
            class="track-mix-btn"
            icon
            size="x-small"
            :variant="isTrackSoloed(entry.track.id) ? 'tonal' : 'text'"
            :color="isTrackSoloed(entry.track.id) ? 'primary' : undefined"
            :aria-label="`Solo ${entry.track.name}`"
            :aria-pressed="isTrackSoloed(entry.track.id)"
            :title="isTrackSoloed(entry.track.id) ? `Unsolo ${entry.track.name}` : `Solo ${entry.track.name}`"
            @click.stop="$emit('toggle-soloed', entry.track.id)"
          >
            <span class="mix-letter">S</span>
          </v-btn>
          <v-menu location="bottom end">
            <template #activator="{ props }">
              <v-btn v-bind="props" icon="mdi-dots-vertical" size="x-small" variant="text"
                :aria-label="`Actions for ${entry.track.name}`" :title="`Actions for ${entry.track.name}`" @click.stop />
            </template>
            <v-list density="compact">
              <v-list-item title="Duplicate track" prepend-icon="mdi-content-copy" @click="$emit('duplicate-track', entry.track.id)" />
              <v-list-item title="Move track up" prepend-icon="mdi-arrow-up" :disabled="entry.trackIndex === 0"
                @click="$emit('reorder-tracks', entry.track.id, tracks[entry.trackIndex - 1].id)" />
              <v-list-item title="Move track down" prepend-icon="mdi-arrow-down" :disabled="entry.trackIndex === tracks.length - 1"
                @click="$emit('reorder-tracks', entry.track.id, tracks[entry.trackIndex + 1].id)" />
              <v-list-item title="Delete track" prepend-icon="mdi-trash-can-outline" :disabled="tracks.length <= 1"
                @click="$emit('remove-track', entry.track.id)" />
            </v-list>
          </v-menu>
        </div>
      </div>
    </div>
    <div class="timeline-empty-space"><div class="empty-track-heading">{{ tracks.length }} {{ tracks.length === 1 ? 'track' : 'tracks' }} in this project</div><span>Select a pattern to shape its sequence and sound</span></div>
    </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import type { PresetTrackData } from '../presets';
import { trackDurationBeats } from '../domain/developmentSchedule';
import type { ScheduledEvent } from '../domain/scheduling';
import { trackNotePreview } from '../domain/trackPreview';
import { parseRhythmSequenceInput } from '../domain/rhythmTrack';
import {
  buildTrackChunkActivationStates,
  parseBitmaskSequenceInput,
} from '../trackActivation';

export interface TrackMixState {
  muted: boolean;
  soloed: boolean;
}

export interface TrackTimingEntry {
  preview: string;
  track: PresetTrackData;
  trackIndex: number;
  sequenceLength: number;
  numerator: number;
  denominator: number;
  repeats: number;
  delayBeats: number;
  patternBeats: number;
  paddingBeforeBeats: number;
  paddingAfterBeats: number;
  activeBeats: number;
  totalBeats: number;
  totalBars: number;
  padBeats: number;
  repeatBlocks: number[];
  chunkStates: boolean[];
  sections: { id: string; pattern: string; name: string; beats: number }[];
}

export default defineComponent({
  name: 'TrackStrip',
  props: {
    zoom: { type: Number, default: 1 },
    playhead: { type: Number, default: 0 },
    scheduledEvents: { type: Object as PropType<Record<string, ScheduledEvent[]>>, required: true },
    tracks: {
      type: Array as PropType<PresetTrackData[]>,
      required: true,
    },
    selectedTrackId: {
      type: String as PropType<string | null>,
      default: null,
    },
    trackMixStates: {
      type: Object as PropType<Record<string, TrackMixState>>,
      required: true,
    },
    bitmaskSequenceInput: {
      type: String,
      default: '',
    },
    /** Full song loop duration in seconds (matches App scheduling). */
    loopDurationSeconds: {
      type: Number,
      default: 1,
    },
    bpm: {
      type: Number,
      default: 90,
    },
  },
  emits: [
    'edit-pattern',
    'edit-track',
    'select-track',
    'track-name-input',
    'commit-track-name',
    'toggle-muted',
    'toggle-soloed',
    'duplicate-track',
    'remove-track',
    'reorder-tracks',
    'bitmask-sequence-input',
  ],
  data() {
    return {
      trackColors: ['#74bba9', '#d6a269', '#9e9bc9', '#7ca8cc', '#c68499', '#aab87c'],
      activationExpanded: false,
      draggedTrackId: null as string | null,
      dropTargetTrackId: null as string | null,
    };
  },
  computed: {
    rulerInterval(): number {
      return Math.max(0.25, Math.pow(2, Math.ceil(Math.log2(this.loopDurationBeats / (8 * this.zoom)))));
    },
    rulerBeats(): number[] {
      const interval = this.rulerInterval;
      return Array.from({ length: Math.ceil(this.loopDurationBeats / interval) }, (_, i) => i * interval);
    },
    activationParse() {
      return parseBitmaskSequenceInput(this.bitmaskSequenceInput);
    },
    activationMasks(): bigint[] {
      return this.activationParse.masks;
    },
    activationErrorMessages(): string[] {
      if (this.activationParse.valid) {
        return [];
      }
      return [`Invalid tokens: ${this.activationParse.invalidTokens.join(', ')}`];
    },
    activationStatusLabel(): string {
      const masks = this.activationMasks;
      if (masks.length === 0) {
        return 'off';
      }
      return `${masks.length} chunk${masks.length === 1 ? '' : 's'}`;
    },
    /** Loop duration expressed in beats at the shared BPM (for padding alignment). */
    loopDurationBeats(): number {
      const bpm = Math.max(1, this.bpm);
      const seconds = Math.max(0, this.loopDurationSeconds);
      return Math.max(seconds * bpm / 60, 0.0001);
    },
    trackTimingEntries(): TrackTimingEntry[] {
      const masks = this.activationMasks;
      const loopBeats = this.loopDurationBeats;

      return this.tracks.map((track, trackIndex) => {
        const sequenceLength = track.trackKind === 'rhythmic'
          ? parseRhythmSequenceInput(track.sequenceInput).masks.length : this.parseSequence(track.sequenceInput).length;
        const patternBeats = sequenceLength / Math.max(1, track.denominator);
        const delayBeats = track.delay * track.numerator;
        const paddingBeforeBeats = track.paddingBefore * track.numerator;
        const paddingAfterBeats = track.paddingAfter * track.numerator;
        const sections = track.development?.enabled ? track.development.sections.map(section => ({
          id: section.id,
          pattern: section.pattern,
          name: section.name,
          beats: section.length * (section.unit === 'bars' ? track.numerator : 1),
        })) : [];
        const activeBeats = sections.length ? trackDurationBeats(track) - delayBeats : (paddingBeforeBeats + patternBeats + paddingAfterBeats) * track.repeats;
        const totalBeats = delayBeats + activeBeats;
        const totalBars = track.numerator > 0 ? totalBeats / track.numerator : 0;
        return {
          preview: trackNotePreview(track, this.scheduledEvents[track.id] ?? [], this.loopDurationSeconds),
          track,
          sections,
          trackIndex,
          sequenceLength,
          numerator: track.numerator,
          denominator: track.denominator,
          repeats: track.repeats,
          delayBeats,
          patternBeats,
          paddingBeforeBeats,
          paddingAfterBeats,
          activeBeats,
          totalBeats,
          totalBars,
          padBeats: Math.max(0, loopBeats - totalBeats),
          repeatBlocks: sections.length ? [] : Array.from({ length: track.repeats }, (_, index) => index + 1),
          chunkStates: buildTrackChunkActivationStates(masks, trackIndex),
        };
      });
    },
  },
  methods: {
    segmentStyle(beats: number): { width: string } {
      return { width: `${beats / this.loopDurationBeats * 100}%` };
    },
    parseSequence(sequenceInput: string): number[] {
      return sequenceInput
        .trim()
        .split(/\s+/)
        .map((value: string) => Number.parseInt(value.trim(), 10))
        .filter((value: number) => !Number.isNaN(value));
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
      return !this.isTrackMuted(trackId) && (!this.tracks.some(track => this.isTrackSoloed(track.id)) || this.isTrackSoloed(trackId));
    },
    formatBeats(value: number): string {
      return Number.isInteger(value) ? value.toString() : value.toFixed(2).replace(/\.?0+$/, '');
    },
    formatBars(value: number): string {
      return Number.isInteger(value) ? value.toString() : value.toFixed(2).replace(/\.?0+$/, '');
    },
    onBitmaskSequenceInput(value: string | number | null) {
      this.$emit('bitmask-sequence-input', value == null ? '' : String(value));
    },
    onDragStart(trackId: string, event: DragEvent) {
      this.draggedTrackId = trackId;
      this.dropTargetTrackId = null;
      event.dataTransfer?.setData('text/plain', trackId);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
      }
    },
    onDragOver(trackId: string) {
      if (trackId !== this.draggedTrackId) {
        this.dropTargetTrackId = trackId;
      }
    },
    onDragLeave(trackId: string) {
      if (this.dropTargetTrackId === trackId) {
        this.dropTargetTrackId = null;
      }
    },
    onDrop(trackId: string) {
      if (this.draggedTrackId && this.draggedTrackId !== trackId) {
        this.$emit('reorder-tracks', this.draggedTrackId, trackId);
      }
      this.onDragEnd();
    },
    onDragEnd() {
      this.draggedTrackId = null;
      this.dropTargetTrackId = null;
    },
    chunkTooltip(entry: TrackTimingEntry, chunkIndex: number, active: boolean): string {
      const mask = this.activationMasks[chunkIndex];
      const maskText = mask === undefined ? '?' : mask.toString(10);
      const state = active ? 'active' : 'inactive';
      return `Chunk ${chunkIndex + 1}/${entry.chunkStates.length}: B=${maskText} · track bit ${entry.trackIndex} ${state}`;
    },
  },
});
</script>

<style scoped src="./TrackStrip.css"></style>
