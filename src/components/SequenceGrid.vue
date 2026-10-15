<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { PresetTrackData } from '../presets';
import { drumVoiceLabel } from '../domain/rhythmTrack';
import { editableSequence, toggleSequenceCell } from '../domain/sequenceEditor';

const props = defineProps<{ track: PresetTrackData; scale?: number[]; }>();
const emit = defineEmits<{ change: [sequence: string] }>();
const page = ref(0), rowPage = ref(0);
const rhythmic = computed(() => props.track.trackKind === 'rhythmic');
const values = computed(() => editableSequence(props.track.sequenceInput, rhythmic.value));
const bits = computed(() => rhythmic.value ? props.track.drumVelocityBits : 1);
const count = computed(() => values.value?.length ?? 0);
const pages = computed(() => Math.max(1, Math.ceil(count.value / 32)));
const rowCount = computed(() => rhythmic.value ? props.track.drumLanes.length : Math.min(53, props.scale?.length ?? 16));
const rows = computed(() => Array.from({ length: Math.min(8, Math.max(0, rowCount.value - rowPage.value * 8)) }, (_, i) => rowPage.value * 8 + i).reverse());
const steps = computed(() => Array.from({ length: Math.min(32, count.value - page.value * 32) }, (_, i) => page.value * 32 + i));
watch(() => props.track.id, () => { page.value = 0; rowPage.value = 0; });
watch(pages, total => { page.value = Math.min(page.value, total - 1); });
watch(rowCount, total => { rowPage.value = Math.min(rowPage.value, Math.max(0, Math.ceil(total / 8) - 1)); });
function label(row: number) {
  if (rhythmic.value) return drumVoiceLabel(props.track.drumLanes[row].voiceId);
  const midi = props.scale?.[row];
  return midi === undefined ? `Bit ${row}` : `${['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][midi % 12]}${Math.floor(midi / 12) - 1}`;
}
function active(step: number, row: number) {
  return !!(((values.value?.[step] ?? 0n) >> BigInt(row * bits.value)) & ((1n << BigInt(bits.value)) - 1n));
}
function toggle(step: number, row: number) {
  if (values.value) emit('change', toggleSequenceCell(values.value, step, row, bits.value));
}
function extend(duplicate: boolean) {
  if (!values.value) return;
  emit('change', duplicate ? [...values.value, ...values.value].join(' ') : [...values.value, ...Array<bigint>(16).fill(0n)].join(' '));
}
</script>

<template>
  <div class="sequence-grid">
    <div class="sequence-grid-toolbar">
      <span class="eyebrow">{{ rhythmic ? 'Drum sequencer' : 'Note sequencer' }}</span>
      <span class="grid-hint">Click a cell to toggle {{ rhythmic ? 'a hit' : 'a note' }}</span>
      <span class="grid-tools">
        <button title="Show lower rows" aria-label="Show lower notes or drum lanes" :disabled="rowPage === 0" @click="rowPage--">↓</button>
        <button title="Show higher rows" aria-label="Show higher notes or drum lanes" :disabled="(rowPage + 1) * 8 >= rowCount" @click="rowPage++">↑</button>
        <button :disabled="!values" @click="extend(false)">+ 16 steps</button>
        <button :disabled="!count || !values" @click="extend(true)">Double</button>
      </span>
    </div>
    <p v-if="!values" class="grid-message">This sequence uses values outside the visual editor. Edit the integer sequence field above.</p>
    <p v-else-if="!count" class="grid-message">An empty pattern. Add 16 steps, then draw your notes.</p>
    <div v-else class="sequence-grid-scroll">
      <div
        class="note-grid"
        :style="{ gridTemplateColumns: `96px repeat(${steps.length}, minmax(var(--step-min-width, 24px), 1fr))` }"
        role="group"
        :aria-label="rhythmic ? 'Drum step editor' : 'Note step editor'"
      >
        <span class="note-key grid-corner">STEP</span>
        <span
          v-for="step in steps"
          :key="`step-${step}`"
          class="step-number"
          :class="{ downbeat: step % track.denominator === 0 }"
        >{{ step + 1 }}</span>
        <template v-for="row in rows" :key="row">
          <span class="note-key" :title="label(row)">{{ label(row) }}</span>
          <button
            v-for="step in steps"
            :key="`${row}-${step}`"
            class="note-cell"
            :class="{ active: active(step, row), downbeat: step % track.denominator === 0, drum: rhythmic }"
            :aria-label="`${label(row)}, step ${step + 1}`"
            :aria-pressed="active(step, row)"
            @click="toggle(step, row)"
          >
            <span />
          </button>
        </template>
      </div>
    </div>
    <div v-if="pages > 1" class="grid-pagination">
      <button :disabled="page === 0" @click="page--">← Previous</button>
      <span>Steps {{ page * 32 + 1 }}–{{ Math.min(count, (page + 1) * 32) }} of {{ count }}</span>
      <button :disabled="page + 1 >= pages" @click="page++">Next →</button>
    </div>
  </div>
</template>

<style scoped>
.sequence-grid {
  margin-bottom: 18px;
  border: 1px solid var(--panel-border-soft);
  border-radius: 5px;
  overflow: hidden;
}

.sequence-grid-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 12px;
  background: var(--panel-raised);
  flex-wrap: wrap;
}

.eyebrow {
  color: var(--instrument-text);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.grid-hint {
  font-size: 11px;
  color: var(--instrument-muted);
}

.grid-tools {
  margin-left: auto;
  display: flex;
  gap: 5px;
}

button {
  font: inherit;
  font-size: 11px;
  color: var(--instrument-text);
  cursor: pointer;
}

.grid-tools button, .grid-pagination button {
  padding: 3px 7px;
  background: var(--panel-deep);
  border: 1px solid var(--panel-border-soft);
  border-radius: 3px;
}

button:disabled {
  opacity: .35;
  cursor: default;
}

button:focus-visible {
  outline: 2px solid var(--indicator-amber);
  outline-offset: -2px;
}

.sequence-grid-scroll {
  overflow-x: auto;
}

.note-grid {
  display: grid;
  background: #15181c;
}

.note-key {
  position: sticky;
  left: 0;
  z-index: 1;
  padding: 4px 10px;
  font-size: 10px;
  font-family: var(--font-mono);
  background: #252a30;
  color: #c0c7cf;
  border-right: 1px solid #424950;
  border-bottom: 1px solid #33383e;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.step-number {
  padding: 4px 2px;
  text-align: center;
  color: #7c8591;
  font: 10px var(--font-mono);
  border-right: 1px solid #30353b;
}

.step-number.downbeat {
  color: #d6dbe1;
}

.note-cell {
  min-height: 19px;
  border-right: 1px solid #2c3138;
  border-bottom: 1px solid #2c3138;
  padding: 3px 2px;
}

.note-cell.downbeat {
  border-left: 1px solid #424952;
  background: #1d2229;
}

.note-cell:hover {
  background: #303b40;
}

.note-cell span {
  display: block;
  min-height: 11px;
  border-radius: 2px;
}

.note-cell.active span {
  background: var(--indicator-teal);
  box-shadow: inset 0 1px #ffffff35;
}

.note-cell.drum.active span {
  background: var(--indicator-orange);
}

.grid-message {
  margin: 16px;
  color: var(--instrument-muted);
  font-size: 12px;
}

.grid-pagination {
  padding: 6px 10px;
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 11px;
  color: var(--instrument-muted);
}

@media (pointer: coarse), (max-width: 900px) {
  .note-grid {
    --step-min-width: 36px;
  }

  .note-cell {
    min-height: 36px;
  }

  .note-key {
    display: flex;
    align-items: center;
  }

  .grid-tools {
    flex-wrap: wrap;
  }

  .grid-tools button, .grid-pagination button {
    min-height: 44px;
    min-width: 44px;
  }
}
</style>
