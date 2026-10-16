<script setup lang="ts">
import { computed } from 'vue';
import EditableSlider from './EditableSlider.vue';
import { LFO_SYNC_RATE_OPTIONS } from '../audio/lfo';
import { masterPulseEnvelope, masterPulseFrequency, normalizeMasterPulse, type MasterPulseSettings } from '../audio/masterPulse';

const props = defineProps<{ modelValue: MasterPulseSettings; bpm: number }>();
const emit = defineEmits<{ (event: 'update:modelValue', value: MasterPulseSettings): void }>();
function update(patch: Partial<MasterPulseSettings>) {
  emit('update:modelValue', normalizeMasterPulse({ ...props.modelValue, ...patch }));
}
const rate = computed(() => masterPulseFrequency(props.modelValue, props.bpm));
const preview = computed(() => Array.from({ length: 241 }, (_, i) => {
  const settings = props.modelValue;
  const envelope = masterPulseEnvelope(i / 120, settings.shape, settings.width, settings.edgeMs / 1000 * rate.value);
  const gain = 1 - settings.depth * (1 - envelope);
  return `${i === 0 ? 'M' : 'L'}${i},${36 - gain * 30}`;
}).join(' '));
const shortcuts = [
  { name: 'Delta', hz: 2 }, { name: 'Theta', hz: 6 }, { name: 'Alpha', hz: 10 },
  { name: 'Beta', hz: 20 }, { name: 'Gamma', hz: 40 },
];
</script>

<template>
  <details class="master-pulse-controls">
    <summary>Master Pulse <span>{{ modelValue.enabled ? `${rate.toFixed(2)} Hz` : 'Off' }}</span></summary>
    <v-switch label="Enabled" :model-value="modelValue.enabled" color="primary" density="compact" hide-details
      @update:model-value="update({ enabled: !!$event })" />
    <p class="pulse-description">Pulse the whole mix, including reverb. Both stereo channels move together.</p>
    <svg class="pulse-preview" viewBox="0 0 240 40" role="img" aria-label="Master Pulse envelope preview">
      <path :d="preview" fill="none" stroke="currentColor" stroke-width="1.5" />
    </svg>
    <v-select label="Shape" :model-value="modelValue.shape" :items="[
      { title: 'Sine · smooth tremolo', value: 'sine' },
      { title: 'Triangle', value: 'triangle' },
      { title: 'Pulse · isochronic style', value: 'pulse' },
    ]" density="compact" variant="outlined" hide-details @update:model-value="update({ shape: $event })" />
    <v-select label="Rate mode" :model-value="modelValue.rateMode" :items="[
      { title: 'Frequency (Hz)', value: 'hz' }, { title: 'Tempo sync', value: 'sync' },
    ]" density="compact" variant="outlined" hide-details @update:model-value="update({ rateMode: $event })" />
    <EditableSlider v-if="modelValue.rateMode === 'hz'" :label="`Rate · ${modelValue.frequency.toFixed(2)} Hz`"
      :model-value="modelValue.frequency" :min="0.1" :max="80" :step="0.01" @update:model-value="update({ frequency: $event })" />
    <v-select v-else label="Tempo division" :model-value="modelValue.division" :items="[...LFO_SYNC_RATE_OPTIONS]"
      density="compact" variant="outlined" hide-details @update:model-value="update({ division: $event })" />
    <EditableSlider :label="`Depth · ${Math.round(modelValue.depth * 100)}%`" :model-value="modelValue.depth"
      :min="0" :max="1" :step="0.01" @update:model-value="update({ depth: $event })" />
    <template v-if="modelValue.shape === 'pulse'">
      <EditableSlider :label="`Pulse width · ${Math.round(modelValue.width * 100)}%`" :model-value="modelValue.width"
        :min="0.05" :max="0.95" :step="0.01" @update:model-value="update({ width: $event })" />
      <EditableSlider :label="`Edge softness · ${modelValue.edgeMs.toFixed(1)} ms`" :model-value="modelValue.edgeMs"
        :min="0.1" :max="50" :step="0.1" @update:model-value="update({ edgeMs: $event })" />
    </template>
    <span class="pulse-caption">Frequency shortcuts</span>
    <div class="pulse-shortcuts">
      <button v-for="shortcut in shortcuts" :key="shortcut.name" type="button"
        :aria-label="`${shortcut.name} ${shortcut.hz} Hz`"
        @click="update({ rateMode: 'hz', frequency: shortcut.hz })">{{ shortcut.name }} · {{ shortcut.hz }} Hz</button>
    </div>
  </details>
</template>

<style scoped>
.master-pulse-controls { margin-top: 14px; font-size: 0.8rem; }
summary { cursor: pointer; font-weight: 600; }
summary span { float: right; font-weight: 400; opacity: 0.7; }
.master-pulse-controls :deep(.v-select) { margin: 12px 0; }
.master-pulse-controls :deep(.editable-slider) { margin: 14px 0; }
.pulse-description { font-size: 0.73rem; line-height: 1.5; opacity: 0.7; margin: 6px 0; }
.pulse-preview { display: block; width: 100%; color: var(--instrument-accent, #78c9bd); }
.pulse-caption { display: block; font-size: 0.73rem; margin: 12px 0 6px; }
.pulse-shortcuts { display: flex; flex-wrap: wrap; gap: 5px; }
.pulse-shortcuts button { border: 1px solid currentColor; border-radius: 4px; padding: 4px 6px; font-size: 0.7rem; }
.pulse-shortcuts button:hover { background: rgba(128, 128, 128, 0.15); }
</style>
