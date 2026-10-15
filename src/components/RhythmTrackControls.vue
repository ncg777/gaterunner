<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  DRUM_VOICE_OPTIONS,
  DRUM_XOR_GROUP_OPTIONS,
  cloneDrumLanes,
  createDefaultDrumLane,
  drumVoiceIcon,
  normalizeDrumLanes,
  normalizeDrumVelocityBits,
  normalizeDrumXorGroup,
  parseRhythmSequenceInput,
  type DrumVoiceId,
  type DrumXorGroupId,
} from '../domain/rhythmTrack';
import { clonePresetTrackData, type PresetTrackData } from '../presets';

const props = withDefaults(defineProps<{
  track: PresetTrackData;
  showSequenceInput?: boolean;
}>(), { showSequenceInput: true });

const emit = defineEmits<{
  'update:track': [track: PresetTrackData];
}>();

const selectedLaneIndex = ref(0);
const addVoice = ref<DrumVoiceId | null>(null);
const sequenceLength = computed(() => parseRhythmSequenceInput(props.track.sequenceInput).masks.length);

const availableVoices = computed(() => {
  const used = new Set(props.track.drumLanes.map((lane) => lane.voiceId));
  return DRUM_VOICE_OPTIONS.filter((option) => !used.has(option.value));
});
watch(() => props.track.drumLanes.length, (length) => {
  if (length === 0) {
    selectedLaneIndex.value = 0;
  } else if (selectedLaneIndex.value >= length) {
    selectedLaneIndex.value = length - 1;
  }
});

function emitTrack(nextTrack: PresetTrackData): void {
  emit('update:track', nextTrack);
}

function updateLanes(nextLanes: PresetTrackData['drumLanes']): void {
  const nextTrack = clonePresetTrackData(props.track);
  nextTrack.drumLanes = normalizeDrumLanes(nextLanes);
  emitTrack(nextTrack);
}

function addLane(): void {
  if (!addVoice.value) {
    return;
  }
  const nextLanes = cloneDrumLanes(props.track.drumLanes);
  nextLanes.push(createDefaultDrumLane(addVoice.value));
  selectedLaneIndex.value = nextLanes.length - 1;
  updateLanes(nextLanes);
  addVoice.value = null;
}

function removeLane(index: number): void {
  if (props.track.drumLanes.length <= 1) {
    return;
  }
  const nextLanes = props.track.drumLanes.filter((_, laneIndex) => laneIndex !== index);
  selectedLaneIndex.value = Math.min(selectedLaneIndex.value, nextLanes.length - 1);
  updateLanes(nextLanes);
}

function moveLane(index: number, direction: -1 | 1): void {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= props.track.drumLanes.length) {
    return;
  }
  const nextLanes = cloneDrumLanes(props.track.drumLanes);
  [nextLanes[index], nextLanes[targetIndex]] = [nextLanes[targetIndex], nextLanes[index]];
  selectedLaneIndex.value = targetIndex;
  updateLanes(nextLanes);
}

function updateVelocityBits(value: number | null): void {
  const nextTrack = clonePresetTrackData(props.track);
  nextTrack.drumVelocityBits = normalizeDrumVelocityBits(value);
  emitTrack(nextTrack);
}

function updateLaneXorGroup(index: number, value: DrumXorGroupId | null): void {
  const nextLanes = cloneDrumLanes(props.track.drumLanes);
  if (!nextLanes[index]) {
    return;
  }
  nextLanes[index] = {
    ...nextLanes[index],
    xorGroup: normalizeDrumXorGroup(value),
  };
  updateLanes(nextLanes);
}

</script>

<template>
  <div class="rhythm-controls">
    <v-alert type="info" variant="tonal" density="compact" class="rhythm-note">
      Decimal sequence values are split across the lanes from least-significant lane first. Each lane uses the selected number of velocity bits; zero means rest.
    </v-alert>

    <v-row class="compact-row">
      <v-col cols="12" :md="showSequenceInput ? 6 : 12">
        <v-slider
          :model-value="track.drumVelocityBits"
          label="Velocity bits per lane"
          :min="1"
          :max="7"
          :step="1"
          thumb-label
          hide-details="auto"
          @update:model-value="updateVelocityBits"
        />
      </v-col>
      <v-col v-if="showSequenceInput" cols="12" md="6">
        <v-text-field
          :model-value="track.sequenceInput"
          :label="`Rhythm mask sequence (${sequenceLength})`"
          placeholder="e.g. 1 4 16 5"
          hint="Lane 1 uses the lowest bits of each decimal value."
          persistent-hint
          hide-details="auto"
          variant="outlined"
          density="comfortable"
          @update:model-value="(value) => { const next = clonePresetTrackData(track); next.sequenceInput = String(value ?? ''); emitTrack(next); }"
        />
      </v-col>
    </v-row>

    <div class="lane-toolbar">
      <span class="section-label">
        <v-icon size="16" class="section-icon">mdi-album</v-icon>
        GM drum lanes
      </span>
      <v-select
        v-model="addVoice"
        :items="availableVoices"
        item-title="title"
        item-value="value"
        label="Add voice"
        density="compact"
        variant="outlined"
        hide-details
        :disabled="availableVoices.length === 0"
        class="add-voice-select"
      >
        <template #item="{ props: itemProps, item }">
          <v-list-item v-bind="itemProps" :prepend-icon="item.raw.icon" />
        </template>
      </v-select>
      <v-btn icon size="small" variant="tonal" color="secondary" title="Add drum lane" :disabled="!addVoice" @click="addLane">
        <v-icon>mdi-plus-circle-outline</v-icon>
      </v-btn>
    </div>

    <div class="lane-list">
      <div
        v-for="(lane, laneIndex) in track.drumLanes"
        :key="lane.voiceId"
        role="button"
        tabindex="0"
        class="lane-row"
        :class="{ selected: laneIndex === selectedLaneIndex }"
        @click="selectedLaneIndex = laneIndex"
        @keydown.enter.prevent="selectedLaneIndex = laneIndex"
        @keydown.space.prevent="selectedLaneIndex = laneIndex"
      >
        <span class="lane-order">{{ laneIndex + 1 }}</span>
        <v-icon size="18" class="lane-icon">{{ drumVoiceIcon(lane.voiceId) }}</v-icon>
        <span class="lane-name">{{ DRUM_VOICE_OPTIONS.find((option) => option.value === lane.voiceId)?.title }}</span>
        <span class="lane-midi">GM {{ DRUM_VOICE_OPTIONS.find((option) => option.value === lane.voiceId)?.midi }}</span>
        <v-select
          :model-value="lane.xorGroup"
          :items="DRUM_XOR_GROUP_OPTIONS"
          item-title="title"
          item-value="value"
          density="compact"
          variant="outlined"
          hide-details
          class="lane-xor-select"
          title="XOR exclusion group"
          menu-icon=""
          @click.stop
          @update:model-value="(value) => updateLaneXorGroup(laneIndex, value)"
        />
        <v-btn icon size="x-small" variant="text" title="Move lane up" :disabled="laneIndex === 0" @click.stop="moveLane(laneIndex, -1)">
          <v-icon size="16">mdi-arrow-up-circle-outline</v-icon>
        </v-btn>
        <v-btn icon size="x-small" variant="text" title="Move lane down" :disabled="laneIndex === track.drumLanes.length - 1" @click.stop="moveLane(laneIndex, 1)">
          <v-icon size="16">mdi-arrow-down-circle-outline</v-icon>
        </v-btn>
        <v-btn icon size="x-small" variant="text" color="error" title="Remove drum lane" :disabled="track.drumLanes.length <= 1" @click.stop="removeLane(laneIndex)">
          <v-icon size="16">mdi-trash-can-outline</v-icon>
        </v-btn>
      </div>
    </div>

  </div>
</template>

<style scoped>
.rhythm-controls {
  display: grid;
  gap: 10px;
}

.rhythm-note {
  font-size: 0.78rem;
}

.lane-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-label {
  color: var(--indicator-amber);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.section-icon {
  margin-right: 4px;
  vertical-align: -3px;
}

.lane-icon {
  color: var(--instrument-muted);
}

.add-voice-select {
  min-width: 190px;
  margin-left: auto;
}

.lane-list {
  display: grid;
  gap: 4px;
}

.lane-row {
  display: grid;
  grid-template-columns: 24px 20px minmax(0, 1fr) auto 52px repeat(3, 28px);
  align-items: center;
  gap: 5px;
  min-height: 34px;
  padding: 2px 5px;
  border: 1px solid var(--panel-border-soft);
  color: var(--instrument-text);
  background: var(--panel-raised);
  text-align: left;
}

.lane-row.selected {
  border-color: rgba(242, 184, 75, 0.72);
  background: rgba(242, 184, 75, 0.12);
}

.lane-order,
.lane-midi {
  color: var(--instrument-muted);
  font-size: 0.75rem;
}

.lane-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 700;
}

.lane-xor-select {
  min-width: 0;
  width: 52px;
}

.lane-xor-select :deep(.v-input__control),
.lane-xor-select :deep(.v-field) {
  min-width: 0;
  padding-inline: 4px;
}

.lane-xor-select :deep(.v-field__append-inner) {
  display: none;
}

.lane-xor-select :deep(.v-field__input) {
  min-height: 28px;
  padding-top: 0;
  padding-bottom: 0;
  padding-inline: 4px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

.lane-xor-select :deep(.v-select__selection-text) {
  overflow: visible;
}

@media (max-width: 680px) {
  .lane-toolbar {
    flex-wrap: wrap;
  }

  .add-voice-select {
    flex: 1 1 180px;
    margin-left: 0;
  }

  .lane-row {
    grid-template-columns: 22px 20px minmax(0, 1fr) auto 52px 28px 28px 28px;
  }
}
</style>
