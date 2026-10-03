<template>
  <section class="routed-modulation" aria-label="Routed modulation">
    <div class="text-subtitle-2 mb-2">Routed sources · {{ settings.sources.length }} sources · {{ settings.routes.length }} routes</div>
    <p class="text-caption mb-3">Animate the partial spectrum with tilt, contrast, odd/even balance, or harmonic count. <template v-if="partialBank">Move frequencies with Position / Target a, b, c and Position morph. </template>Route any envelope or LFO to multiple parameters. Amounts offset the existing controls; each voice has its own envelopes.</p>
    <div class="d-flex ga-2 mb-3 flex-wrap">
      <v-btn size="small" prepend-icon="mdi-plus" @click="addSource('envelope')">Envelope</v-btn>
      <v-btn size="small" prepend-icon="mdi-plus" @click="addSource('lfo')">LFO</v-btn>
    </div>
    <p v-if="!settings.sources.length" class="text-caption text-medium-emphasis">No modulation sources. Add an envelope or LFO to begin.</p>
    <v-expansion-panels variant="accordion">
      <v-expansion-panel v-for="source in settings.sources" :key="source.id">
        <v-expansion-panel-title>{{ source.enabled ? '' : 'Bypassed · ' }}{{ source.name }} · {{ source.type === 'lfo' ? 'LFO' : 'Envelope' }}</v-expansion-panel-title>
        <v-expansion-panel-text>
          <div class="d-flex ga-2 align-center">
            <v-text-field :model-value="source.name" label="Name" density="compact" hide-details @update:modelValue="updateSource(source.id, { name: $event })" />
            <v-switch :model-value="source.enabled" label="On" density="compact" hide-details @update:modelValue="updateSource(source.id, { enabled: !!$event })" />
            <v-btn icon="mdi-delete-outline" size="small" variant="text" :aria-label="`Remove ${source.name} and its routes`" @click="removeSource(source.id)" />
          </div>
          <v-row v-if="source.type === 'envelope'" dense class="mt-3">
            <v-col v-for="field in envelopeFields" :key="field.key" cols="6" sm="4">
              <v-text-field :model-value="source[field.key]" :label="field.label" type="number" :min="field.min" :max="field.max" :step="field.step" density="compact" hide-details @update:modelValue="updateSource(source.id, { [field.key]: Number($event) })" />
            </v-col>
          </v-row>
          <v-row v-else dense class="mt-3">
            <v-col cols="12" sm="6"><v-select :model-value="source.waveform" label="Shape" :items="LFO_WAVEFORM_OPTIONS" density="compact" hide-details @update:modelValue="updateSource(source.id, { waveform: $event })" /></v-col>
            <v-col cols="12" sm="6"><v-select :model-value="source.retrigger" label="Phase timing" :items="phaseOptions" density="compact" hide-details @update:modelValue="updateSource(source.id, { retrigger: $event })" /></v-col>
            <v-col cols="6"><v-switch :model-value="source.sync" label="Tempo sync" density="compact" hide-details @update:modelValue="updateSource(source.id, { sync: !!$event })" /></v-col>
            <v-col cols="6"><v-switch :model-value="source.unipolar" label="Unipolar (0–1)" density="compact" hide-details @update:modelValue="updateSource(source.id, { unipolar: !!$event })" /></v-col>
            <v-col cols="6">
              <v-select v-if="source.sync" :model-value="source.syncRate" label="Cycle length" :items="LFO_SYNC_RATE_OPTIONS" density="compact" hide-details @update:modelValue="updateSource(source.id, { syncRate: $event })" />
              <v-text-field v-else :model-value="source.rateHz" label="Rate (Hz)" type="number" min="0.01" max="20" step="0.01" density="compact" hide-details @update:modelValue="updateSource(source.id, { rateHz: Number($event) })" />
            </v-col>
            <v-col cols="6"><v-text-field :model-value="source.phase" label="Initial phase (0–1)" type="number" min="0" max="1" step="0.01" density="compact" hide-details @update:modelValue="updateSource(source.id, { phase: Number($event) })" /></v-col>
          </v-row>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
    <div class="d-flex align-center justify-space-between mt-4 mb-2">
      <span class="text-subtitle-2">Routes</span>
      <v-btn size="small" prepend-icon="mdi-plus" :disabled="!settings.sources.length" @click="addRoute">Route</v-btn>
    </div>
    <v-row v-for="(route, i) in settings.routes" :key="route.id" dense class="route-row">
      <v-col cols="6" sm="4"><v-select :model-value="route.source" :label="`Source ${i + 1}`" :items="sourceOptions" density="compact" hide-details @update:modelValue="updateRoute(route.id, { source: $event })" /></v-col>
      <v-col cols="6" sm="3"><v-select :model-value="route.target" label="Destination" :items="targetOptions" density="compact" hide-details @update:modelValue="updateRoute(route.id, { target: $event, amount: 0 })" /></v-col>
      <v-col cols="8" sm="3"><v-text-field :model-value="route.amount" :label="MODULATION_TARGETS[route.target].unit" type="number" :min="MODULATION_TARGETS[route.target].min" :max="MODULATION_TARGETS[route.target].max" :step="MODULATION_TARGETS[route.target].step" density="compact" hide-details @update:modelValue="updateRoute(route.id, { amount: Number($event) })" /></v-col>
      <v-col cols="4" sm="2" class="d-flex align-center justify-end">
        <v-btn :icon="route.enabled ? 'mdi-check-circle' : 'mdi-circle-outline'" :aria-label="`${route.enabled ? 'Bypass' : 'Enable'} route ${i + 1}`" :aria-pressed="route.enabled" variant="text" size="small" @click="updateRoute(route.id, { enabled: !route.enabled })" />
        <v-btn icon="mdi-delete-outline" :aria-label="`Remove route ${i + 1}`" variant="text" size="small" @click="commit({ ...settings, routes: settings.routes.filter(r => r.id !== route.id) })" />
      </v-col>
    </v-row>
    <p v-if="settings.routes.some(r => ['cutoff', 'resonance', 'filterGain'].includes(r.target))" class="text-caption mt-2">Enable the voice filter in the Filter tab for filter routes. Filter gain affects shelf and peaking filters.</p>
    <p v-if="settings.routes.some(r => r.target === 'mappingExponent')" class="text-caption mt-2">Mapping exponent applies to sequence and binary sources with Power mapping.</p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { MODULATION_TARGETS, normalizeModulation, type ModulationSettings, type ModulationSource, type ModulationRoute } from '../audio/modulation';
import { LFO_WAVEFORM_OPTIONS, LFO_SYNC_RATE_OPTIONS } from '../audio/lfo';
const props = defineProps<{ modelValue: ModulationSettings; partialBank?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: ModulationSettings] }>();
const settings = computed(() => props.modelValue);
const sourceOptions = computed(() => settings.value.sources.map(s => ({ title: s.name, value: s.id })));
const targetOptions = computed(() => Object.entries(MODULATION_TARGETS)
  .filter(([value]) => props.partialBank || !/^(position|target)/.test(value))
  .map(([value, d]) => ({ title: d.title, value })));
const phaseOptions = [{ title: 'Each voice attack', value: 'note' }, { title: 'Song start', value: 'song' }, { title: 'Free running', value: 'free' }];
const envelopeFields = [
  { key: 'attack', label: 'Attack (s)', min: 0, max: 60, step: 0.01 },
  { key: 'decay', label: 'Decay (s)', min: 0, max: 60, step: 0.01 },
  { key: 'sustain', label: 'Sustain (0–1)', min: 0, max: 1, step: 0.01 },
  { key: 'release', label: 'Release (s)', min: 0, max: 60, step: 0.01 },
  { key: 'curve', label: 'Curve (0 = linear)', min: -10, max: 10, step: 0.1 },
] as const;
function commit(value: unknown) { emit('update:modelValue', normalizeModulation(value)); }
function addSource(type: ModulationSource['type']) {
  commit({ ...settings.value, sources: [...settings.value.sources, { id: crypto.randomUUID(), type,
    name: `${type === 'lfo' ? 'LFO' : 'Envelope'} ${settings.value.sources.length + 1}` }] });
}
function updateSource(id: string, change: Record<string, unknown>) {
  commit({ ...settings.value, sources: settings.value.sources.map(s => s.id === id ? { ...s, ...change } : s) });
}
function removeSource(id: string) {
  commit({ sources: settings.value.sources.filter(s => s.id !== id), routes: settings.value.routes.filter(r => r.source !== id) });
}
function addRoute() {
  commit({ ...settings.value, routes: [...settings.value.routes, { id: crypto.randomUUID(), source: settings.value.sources[0].id, target: 'spectralTilt', amount: 0 }] });
}
function updateRoute(id: string, change: Partial<ModulationRoute>) {
  commit({ ...settings.value, routes: settings.value.routes.map(r => r.id === id ? { ...r, ...change } : r) });
}
</script>
<style scoped>
.route-row { margin-bottom: 8px; }
</style>
