<template>
  <div>
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

    <div class="track-timeline" aria-label="Track lengths in beats">
      <div
        v-for="entry in trackTimingEntries"
        :key="entry.track.id"
        role="button"
        tabindex="0"
        class="track-timeline-row"
        :class="{
          selected: entry.track.id === selectedTrackId,
          dragging: entry.track.id === draggedTrackId,
          'drop-target': entry.track.id === dropTargetTrackId,
        }"
        draggable="true"
        @click="$emit('select-track', entry.track.id)"
        @keydown.enter.prevent="$emit('select-track', entry.track.id)"
        @keydown.space.prevent="$emit('select-track', entry.track.id)"
        @dragstart="onDragStart(entry.track.id, $event)"
        @dragover.prevent="onDragOver(entry.track.id)"
        @dragleave="onDragLeave(entry.track.id)"
        @drop.prevent="onDrop(entry.track.id)"
        @dragend="onDragEnd"
      >
        <div class="track-timeline-meta">
          <input
            class="track-name-input"
            :value="entry.track.name"
            :aria-label="`Track name for ${entry.track.name || 'unnamed track'}`"
            @click.stop
            @focus="$emit('select-track', entry.track.id)"
            @input="$emit('track-name-input', entry.track.id, ($event.target as HTMLInputElement).value)"
            @blur="$emit('commit-track-name', entry.track.id)"
            @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
          />
          <span>{{ formatBeats(entry.totalBeats) }} beats · {{ formatBars(entry.totalBars) }} bars</span>
        </div>
        <div class="track-timeline-bar">
          <div class="track-timeline-segments">
            <span
              v-if="entry.delayBeats > 0"
              class="track-timeline-segment delay"
              :style="{ flexGrow: entry.delayBeats }"
              :title="`${formatBeats(entry.delayBeats)} beat delay`"
            ></span>
            <template v-for="repeat in entry.repeatBlocks" :key="repeat">
              <span
                v-if="entry.paddingBeforeBeats > 0"
                class="track-timeline-segment sequence-padding"
                :style="{ flexGrow: entry.paddingBeforeBeats }"
                :title="`Repeat ${repeat}: ${formatBeats(entry.paddingBeforeBeats)} beats before padding`"
              ></span>
              <span
                class="track-timeline-segment repeat"
                :style="{ flexGrow: entry.patternBeats }"
                :title="`Repeat ${repeat}: ${formatBeats(entry.patternBeats)} sequence beats`"
              ></span>
              <span
                v-if="entry.paddingAfterBeats > 0"
                class="track-timeline-segment sequence-padding"
                :style="{ flexGrow: entry.paddingAfterBeats }"
                :title="`Repeat ${repeat}: ${formatBeats(entry.paddingAfterBeats)} beats after padding`"
              ></span>
            </template>
            <span
              v-if="entry.padBeats > 0"
              class="track-timeline-segment pad"
              :style="{ flexGrow: entry.padBeats }"
              aria-hidden="true"
            ></span>
          </div>
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
        </div>
        <div class="track-timeline-controls">
          <v-btn
            class="track-mix-btn"
            icon
            size="x-small"
            :variant="isTrackMuted(entry.track.id) ? 'tonal' : 'text'"
            :color="isTrackMuted(entry.track.id) ? 'warning' : undefined"
            :title="isTrackMuted(entry.track.id) ? `Unmute ${entry.track.name}` : `Mute ${entry.track.name}`"
            @click.stop="$emit('toggle-muted', entry.track.id)"
          >
            <v-icon size="18">mdi-volume-off</v-icon>
          </v-btn>
          <v-btn
            class="track-mix-btn"
            icon
            size="x-small"
            :variant="isTrackSoloed(entry.track.id) ? 'tonal' : 'text'"
            :color="isTrackSoloed(entry.track.id) ? 'primary' : undefined"
            :title="isTrackSoloed(entry.track.id) ? `Unsolo ${entry.track.name}` : `Solo ${entry.track.name}`"
            @click.stop="$emit('toggle-soloed', entry.track.id)"
          >
            <v-icon size="18">mdi-headphones</v-icon>
          </v-btn>
          <v-btn
            class="track-duplicate-btn"
            icon
            size="x-small"
            variant="text"
            :title="`Duplicate ${entry.track.name}`"
            @click.stop="$emit('duplicate-track', entry.track.id)"
          >
            <v-icon size="18">mdi-content-copy</v-icon>
          </v-btn>
          <v-btn
            class="track-delete-btn"
            icon
            size="x-small"
            variant="text"
            color="error"
            :disabled="tracks.length <= 1"
            :title="tracks.length <= 1 ? 'Cannot delete the only track' : `Delete ${entry.track.name}`"
            @click.stop="$emit('remove-track', entry.track.id)"
          >
            <v-icon size="18">mdi-trash-can-outline</v-icon>
          </v-btn>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import type { PresetTrackData } from '../presets';
import {
  buildTrackChunkActivationStates,
  parseBitmaskSequenceInput,
} from '../trackActivation';

export interface TrackMixState {
  muted: boolean;
  soloed: boolean;
}

export interface TrackTimingEntry {
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
}

export default defineComponent({
  name: 'TrackStrip',
  props: {
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
      activationExpanded: false,
      draggedTrackId: null as string | null,
      dropTargetTrackId: null as string | null,
    };
  },
  computed: {
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
        const sequenceLength = this.parseSequence(track.sequenceInput).length;
        const patternBeats = sequenceLength / Math.max(1, track.denominator);
        // Include phase so the strip lines up with App scheduling (delay bars + phase steps).
        const delayBeats = track.delay * track.numerator + track.phase / Math.max(1, track.denominator);
        const paddingBeforeBeats = track.paddingBefore * track.numerator;
        const paddingAfterBeats = track.paddingAfter * track.numerator;
        const activeBeats = (paddingBeforeBeats + patternBeats + paddingAfterBeats) * track.repeats;
        const totalBeats = delayBeats + activeBeats;
        const totalBars = track.numerator > 0 ? totalBeats / track.numerator : 0;
        return {
          track,
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
          repeatBlocks: Array.from({ length: track.repeats }, (_, index) => index + 1),
          chunkStates: buildTrackChunkActivationStates(masks, trackIndex),
        };
      });
    },
  },
  methods: {
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

<style scoped>
.track-activation {
  border: 1px solid var(--panel-border-soft);
  background: #1a1c16;
}

.track-activation-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: 0;
  background: transparent;
  color: var(--instrument-text);
  font: inherit;
  font-size: 0.76rem;
  font-weight: 700;
  cursor: pointer;
  text-align: left;
}

.track-activation-toggle:hover,
.track-activation-toggle:focus-visible {
  background: rgba(242, 184, 75, 0.08);
  outline: none;
}

.track-activation-status {
  margin-left: auto;
  color: var(--instrument-muted);
  font-weight: 600;
  font-size: 0.72rem;
  letter-spacing: 0.02em;
  text-transform: lowercase;
}

.track-activation-body {
  padding: 0 8px 8px;
}

.track-activation-help {
  margin: 6px 0 0;
  color: var(--instrument-muted);
  font-size: 0.72rem;
  line-height: 1.35;
}

.track-timeline {
  margin-top: 6px;
  display: grid;
  gap: 3px;
}

.track-timeline-row {
  width: 100%;
  min-height: 30px;
  display: grid;
  grid-template-columns: minmax(132px, 0.34fr) minmax(160px, 1fr) auto;
  gap: 6px;
  align-items: center;
  padding: 1px 6px;
  border: 1px solid var(--panel-border-soft);
  border-radius: 0;
  color: var(--instrument-text);
  background: linear-gradient(90deg, #25271f, #2c2e24);
  cursor: pointer;
  text-align: left;
}

.track-timeline-row.selected {
  border-color: rgba(242, 184, 75, 0.82);
  background:
    linear-gradient(90deg, rgba(242, 184, 75, 0.24), rgba(93, 166, 154, 0.14)),
    #292b21;
  box-shadow: inset 4px 0 var(--indicator-amber), 0 0 14px rgba(242, 184, 75, 0.16);
}

.track-timeline-row.dragging {
  opacity: 0.45;
}

.track-timeline-row.drop-target {
  border-color: var(--indicator-amber);
  box-shadow: inset 4px 0 var(--indicator-amber), 0 0 12px rgba(242, 184, 75, 0.2);
}

.track-timeline-row.selected .track-name-input {
  color: #ffe0a0;
}

.track-timeline-controls {
  display: flex;
  align-items: center;
  gap: 2px;
}

.track-timeline-meta {
  min-width: 0;
  display: grid;
  gap: 1px;
}

.track-timeline-meta span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--instrument-muted);
  font-size: 0.76rem;
}

.track-name-input {
  width: 100%;
  min-width: 0;
  color: var(--instrument-text);
  font: inherit;
  font-weight: 800;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 0;
  padding: 1px 5px;
  outline: none;
}

.track-name-input:hover,
.track-name-input:focus {
  border-color: rgba(242, 184, 75, 0.52);
  background: rgba(242, 184, 75, 0.08);
  box-shadow: 0 0 10px rgba(242, 184, 75, 0.1);
}

.track-timeline-bar {
  position: relative;
  min-width: 0;
  height: 18px;
  border: 1px solid rgba(180, 177, 133, 0.34);
  border-radius: 0;
  background: #0d0f0c;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.72);
  overflow: hidden;
}

.track-timeline-segments {
  position: absolute;
  inset: 2px;
  display: flex;
  gap: 3px;
  min-width: 0;
}

.track-timeline-segment {
  min-width: 5px;
  border-radius: 0;
}

.track-timeline-segment.delay {
  background: repeating-linear-gradient(
    135deg,
    rgba(170, 167, 141, 0.58),
    rgba(170, 167, 141, 0.58) 4px,
    rgba(96, 96, 75, 0.42) 4px,
    rgba(96, 96, 75, 0.42) 8px
  );
}

.track-timeline-segment.repeat {
  background: linear-gradient(90deg, #5da69a, #c2b760 54%, #e58b43);
  box-shadow: 0 0 8px rgba(242, 184, 75, 0.28);
}

.track-timeline-segment.sequence-padding {
  min-width: 2px;
  border: 1px dashed rgba(180, 177, 133, 0.48);
  background: rgba(180, 177, 133, 0.12);
}

.track-delete-btn {
  opacity: 0.76;
}

.track-delete-btn:hover,
.track-delete-btn:focus-visible {
  opacity: 1;
}

.track-timeline-segment.pad {
  min-width: 0;
  background: rgba(180, 177, 133, 0.1);
}

.track-activation-overlay {
  position: absolute;
  inset: 0;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  pointer-events: none;
  z-index: 1;
}

.track-activation-chunk {
  min-width: 0;
  border-right: 1px solid rgba(8, 14, 20, 0.55);
  background: transparent;
}

.track-activation-chunk:last-child {
  border-right: 0;
}

.track-activation-chunk.inactive {
  background: rgba(0, 0, 0, 0.58);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.25);
}

@media (max-width: 680px) {
  .track-timeline-row {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      "meta controls"
      "bar bar";
    gap: 2px;
    min-height: 40px;
    padding: 1px 6px;
  }

  .track-timeline-meta {
    grid-area: meta;
    gap: 2px;
  }

  .track-timeline-bar {
    grid-area: bar;
    height: 10px;
  }

  .track-timeline-segments {
    inset: 1px;
  }

  .track-delete-btn {
    grid-area: delete;
  }

  .track-timeline-controls {
    grid-area: controls;
  }
}
</style>
