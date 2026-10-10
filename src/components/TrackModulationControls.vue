<template>
  <div class="track-modulation">
    <p class="text-caption text-medium-emphasis">Track envelopes and LFOs. Expand a source to edit it; its destination stays visible when collapsed.</p>

    <ModulationControls v-if="additive || isGeneratorMode(engine.synthMode)" :model-value="engine.modulation" :partial-bank="engine.synthMode === 'partial-bank'" :generator-mode="isGeneratorMode(engine.synthMode) ? engine.synthMode : undefined" @update:modelValue="updateMatrix" />

    <template v-for="section in ['Envelope', 'LFO'] as const" :key="section">
      <h3 class="text-subtitle-2">{{ section === 'Envelope' ? 'Envelopes' : 'LFOs' }} · fixed destinations</h3>
      <v-expansion-panels variant="accordion" multiple>
        <v-expansion-panel v-for="panel in panels.filter(p => p.type === section)" :key="panel.id" :value="panel.id">
          <v-expansion-panel-title>
            <span class="source-summary"><span>{{ panel.name }} · {{ panel.target }}</span><span class="source-status">{{ panelStatus(panel) }}</span></span>
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <div v-if="panel.enabledKey" class="d-flex align-center ga-2">
              <v-switch :model-value="Boolean(panelModel(panel)[panel.enabledKey])" :label="panel.enabledLabel ?? 'On'" density="compact" hide-details @update:modelValue="updatePanel(panel, panel.enabledKey!, !!$event)" />
            </div>
            <p v-if="panel.help" class="text-caption text-medium-emphasis">{{ panel.help }}</p>
            <CompactModulationFields :model-value="panelModel(panel)" :fields="panel.fields" @change="(key, value) => updatePanel(panel, key, value)" />
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </template>

    <section v-if="additive" aria-label="Vector modulation">
      <div class="d-flex align-center justify-space-between ga-2 mb-2">
        <h3 class="text-subtitle-2">Vector LFOs · {{ track.tonewheelWavetable.lfos.length }} sources</h3>
        <v-btn size="small" prepend-icon="mdi-plus" :disabled="!track.tonewheelWavetable.enabled || !track.tonewheelWavetable.dimensions.length || track.tonewheelWavetable.lfos.length >= MAX_WAVETABLE_LFOS" @click="addVectorLfo">Vector LFO</v-btn>
      </div>
      <p class="text-caption text-medium-emphasis mb-2">Route up to eight LFOs to morph axes. Earlier LFOs can frequency-modulate later ones. <template v-if="!track.tonewheelWavetable.enabled">Enable Multidimensional wavetable in Generator to use these sources.</template></p>
      <p v-if="!track.tonewheelWavetable.lfos.length" class="text-caption text-medium-emphasis">No vector LFOs.</p>
      <v-expansion-panels v-model="openVectorPanels" variant="accordion" multiple>
        <v-expansion-panel v-for="(lfo, index) in track.tonewheelWavetable.lfos" :key="index" :value="index">
          <v-expansion-panel-title>
            <span class="source-summary"><span>{{ lfo.name }} · Morph axes</span><span class="source-status">{{ !track.tonewheelWavetable.enabled ? 'Wavetable off' : !lfo.enabled ? 'Bypassed' : lfo.sync ? lfo.syncRate : `${lfo.rateHz} Hz` }}</span></span>
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <div class="d-flex ga-2 align-center">
              <v-text-field :model-value="lfo.name" label="Name" density="compact" hide-details @update:modelValue="updateVectorLfo(index, { name: $event })" />
              <v-switch :model-value="lfo.enabled" label="On" density="compact" hide-details @update:modelValue="updateVectorLfo(index, { enabled: !!$event })" />
              <v-btn icon="mdi-delete-outline" size="small" variant="text" :aria-label="`Remove ${lfo.name}`" @click="removeVectorLfo(index)" />
            </div>
            <CompactModulationFields :model-value="lfo" :fields="vectorFields(lfo, index)" @change="(key, value) => updateVectorLfo(index, { [key]: value })" />
            <CompactModulationFields :model-value="lfo.routes" :fields="track.tonewheelWavetable.dimensions.map((dimension, i) => number(String(i), `${dimension.name} route`, -1, 1, 0.01))" @change="(key, value) => updateVectorRoute(index, Number(key), Number(value))" />
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ModulationControls from './ModulationControls.vue';
import CompactModulationFields from './CompactModulationFields.vue';
import type { ModulationField } from './modulationFields';
import { clonePresetTrackData, MODULATION_RATE_OPTIONS, SKEW_LFO_WAVEFORM_OPTIONS, PITCH_ENVELOPE_SHAPE_MIN, PITCH_ENVELOPE_SHAPE_MAX, type PresetTrackData } from '../presets';
import { normalizeSynthEngine } from '../audio/synthEngine';
import { isGeneratorMode } from '../audio/generatorSettings';
import { LFO_WAVEFORM_OPTIONS, LFO_SYNC_RATE_OPTIONS, LFO_PHASE_MODE_OPTIONS } from '../audio/lfo';
import { MAX_WAVETABLE_LFOS, type TonewheelWavetableLfo } from '../audio/tonewheelWavetable';
import type { ModulationSettings } from '../audio/modulation';

const props = defineProps<{ track: PresetTrackData }>();
const emit = defineEmits<{ 'update:track': [track: PresetTrackData] }>();
const engine = computed(() => normalizeSynthEngine(props.track));
const additive = computed(() => props.track.trackKind !== 'rhythmic' && ['additive', 'partial-bank'].includes(engine.value.synthMode));
const openVectorPanels = ref<number[]>([]);
watch(() => props.track.id, () => { openVectorPanels.value = []; });
type EngineGroup = 'noiseEngine' | 'choirEngine';
interface Panel {
  id: string; name: string; type: 'Envelope' | 'LFO'; target: string;
  group?: EngineGroup; enabledKey?: string; enabledLabel?: string; amountKey?: string; help?: string;
  fields: ModulationField[];
}
function number(key: string, label: string, min: number, max: number, step = 0.01): ModulationField { return { key, label, min, max, step }; }
function select(key: string, label: string, items: ModulationField['items']): ModulationField { return { key, label, items }; }
function adsr(prefix = ''): ModulationField[] {
  const key = (name: string) => prefix ? prefix + name[0].toUpperCase() + name.slice(1) : name;
  return [number(key('attack'), 'Attack (s)', 0, 10), number(key('decay'), 'Decay (s)', 0, 10), number(key('sustain'), 'Sustain (0–1)', 0, 1), number(key('release'), 'Release (s)', 0, 20)];
}
const panels = computed<Panel[]>(() => {
  const track = props.track;
  const result: Panel[] = [];
  if (track.trackKind !== 'rhythmic') {
    result.push(
      { id: 'amp', name: 'Amp envelope', type: 'Envelope', target: 'Voice level', help: 'Determines how long each voice sounds, including its release tail.', fields: adsr() },
      { id: 'pitch', name: 'Pitch envelope', type: 'Envelope', target: 'Voice pitch', amountKey: 'pitchEnvelopeAmount', fields: [...adsr('pitchEnvelope'), number('pitchEnvelopeAmount', 'Amount (semitones)', -48, 48), number('pitchEnvelopeShape', 'Curve (0 = linear)', PITCH_ENVELOPE_SHAPE_MIN, PITCH_ENVELOPE_SHAPE_MAX)] },
    );
    if (engine.value.synthMode === 'resonant-noise') result.push(
      { id: 'resonator-env', name: 'Resonator envelope', type: 'Envelope', target: 'Resonator frequency', group: 'noiseEngine', amountKey: 'envelopeAmount', fields: [...adsr(), number('envelopeAmount', 'Amount (semitones)', -48, 48, 0.5)] },
      { id: 'resonator-lfo', name: 'Resonator LFO', type: 'LFO', target: 'Resonator frequency', group: 'noiseEngine', amountKey: 'lfoDepth', fields: [number('lfoRate', 'Rate (Hz)', 0.01, 20), number('lfoDepth', 'Depth (semitones)', 0, 24, 0.1)] },
    );
    if (engine.value.synthMode === 'choir') result.push(
      { id: 'vowel', name: 'Vowel transition', type: 'Envelope', target: 'Target vowel blend', group: 'choirEngine', amountKey: 'morph', help: 'Moves each note from the starting vowel to the target blend. A transition time of 0 uses a fixed blend.', fields: [number('morph', 'Target blend (0–1)', 0, 1), number('morphTime', 'Transition (s)', 0, 10)] },
      { id: 'choir-vibrato', name: 'Choir vibrato', type: 'LFO', target: 'Singer pitch', group: 'choirEngine', amountKey: 'vibratoDepth', fields: [number('vibratoRate', 'Rate (Hz)', 0.1, 12, 0.1), number('vibratoDepth', 'Depth (cents)', 0, 100, 0.5)] },
    );
  }
  result.push(
    { id: 'filter-env', name: 'Filter envelope', type: 'Envelope', target: 'Filter cutoff', amountKey: 'filterEnvelopeAmount', help: 'Enable the filter in Filter to hear cutoff motion.', fields: [...adsr('filterEnvelope'), number('filterEnvelopeAmount', 'Amount (semitones)', -127, 127, 0.1)] },
    { id: 'filter-lfo', name: 'Filter LFO', type: 'LFO', target: 'Filter cutoff', enabledKey: 'filterLfoEnabled', help: 'Enable the filter in Filter to hear cutoff motion.', fields: [
      select('filterLfoWaveform', 'Shape', SKEW_LFO_WAVEFORM_OPTIONS), select('filterLfoRetrigger', 'Phase mode', LFO_PHASE_MODE_OPTIONS),
      { key: 'filterLfoSync', label: 'Tempo sync', kind: 'switch' },
      track.filterLfoSync ? select('filterLfoRate', 'Cycle length', MODULATION_RATE_OPTIONS) : number('filterLfoRateHz', 'Rate (Hz)', 0.01, 20),
      number('filterLfoAmount', 'Depth (semitones)', -48, 48, 0.1), number('filterLfoInitPhase', 'Initial phase (0–1)', 0, 0.99),
    ] },
    { id: 'tremolo', name: 'Tremolo', type: 'LFO', target: 'Track level', enabledKey: 'tremoloEnabled', fields: [number('tremoloFrequency', 'Rate (Hz)', 0.01, 40), number('tremoloDepth', 'Depth (0–1)', 0, 1), number('tremoloSpread', 'Stereo spread (°)', 0, 360, 1)] },
    { id: 'vibrato', name: 'Vibrato', type: 'LFO', target: 'Track pitch', enabledKey: 'vibratoEnabled', fields: [number('vibratoFrequency', 'Rate (Hz)', 0.01, 40), number('vibratoDepth', 'Depth (0–1)', 0, 1)] },
    { id: 'chorus', name: 'Chorus LFO', type: 'LFO', target: 'Chorus delay', enabledKey: 'chorusEnabled', enabledLabel: 'Chorus on', help: 'Delay, feedback, and wet mix are in Chorus.', fields: [select('chorusRate', 'Cycle length', MODULATION_RATE_OPTIONS), number('chorusDepth', 'Depth (0–1)', 0, 1), number('chorusSpread', 'Stereo spread (°)', 0, 180, 1)] },
    { id: 'flanger', name: 'Flanger LFO', type: 'LFO', target: 'Flanger delay', enabledKey: 'flangerEnabled', enabledLabel: 'Flanger on', help: 'Delay, feedback, and wet mix are in Flanger.', fields: [select('flangerRate', 'Cycle length', MODULATION_RATE_OPTIONS), number('flangerDepth', 'Depth (0–1)', 0, 1)] },
    { id: 'phaser', name: 'Phaser LFO', type: 'LFO', target: 'Phaser frequency', enabledKey: 'phaserEnabled', enabledLabel: 'Phaser on', help: 'Center, stages, feedback, resonance, and wet mix are in Phaser.', fields: [select('phaserRate', 'Cycle length', MODULATION_RATE_OPTIONS), number('phaserDepth', 'Sweep (%)', 0, 100, 1)] },
  );
  return result;
});
function panelModel(panel: Panel): Record<string, unknown> {
  return (panel.group ? engine.value[panel.group] : props.track) as unknown as Record<string, unknown>;
}
function panelStatus(panel: Panel): string {
  const model = panelModel(panel);
  if (panel.enabledKey && !model[panel.enabledKey]) return 'Bypassed';
  if (panel.id.startsWith('filter') && !props.track.filterEnabled) return 'Filter off';
  if (panel.amountKey && model[panel.amountKey] === 0) return 'Zero amount';
  return panel.id === 'amp' ? 'Always active' : 'On';
}
function updatePanel(panel: Panel, key: string, value: unknown) {
  const next = clonePresetTrackData(props.track);
  const model = (panel.group ? next[panel.group] : next) as unknown as Record<string, unknown>;
  model[key] = value;
  emit('update:track', clonePresetTrackData(next));
}
function updateMatrix(modulation: ModulationSettings) { emit('update:track', { ...clonePresetTrackData(props.track), modulation }); }
function vectorFields(lfo: TonewheelWavetableLfo, index: number): ModulationField[] {
  return [select('waveform', 'Shape', LFO_WAVEFORM_OPTIONS), select('polarity', 'Polarity', [{ title: 'Bipolar (±)', value: 'bipolar' }, { title: 'Unipolar (+)', value: 'unipolar' }]), select('retrigger', 'Phase mode', LFO_PHASE_MODE_OPTIONS),
    { key: 'sync', label: 'Tempo sync', kind: 'switch' }, lfo.sync ? select('syncRate', 'Cycle length', LFO_SYNC_RATE_OPTIONS) : number('rateHz', 'Rate (Hz)', 0.01, 20),
    number('depth', 'Global depth (0–1)', 0, 1), number('phase', 'Initial phase (0–1)', 0, 0.99), number('smoothing', 'Smoothing (0–1)', 0, 1),
    select('fmSource', 'FM source', [{ title: 'None', value: -1 }, ...props.track.tonewheelWavetable.lfos.slice(0, index).map((source, value) => ({ title: `${value + 1}: ${source.name}`, value }))]),
    { ...number('fmAmount', 'FM index (cycles)', -4, 4), disabled: lfo.fmSource < 0 }];
}
function addVectorLfo() {
  const next = clonePresetTrackData(props.track), wavetable = next.tonewheelWavetable, index = wavetable.lfos.length;
  if (!wavetable.enabled || !wavetable.dimensions.length || index >= MAX_WAVETABLE_LFOS) return;
  wavetable.lfos.push({ name: `Vector LFO ${index + 1}`, enabled: true, waveform: index === 0 ? 'sine' : 'smooth-random', sync: true, rateHz: 0.5,
    syncRate: index === 0 ? '1/1' : '4/1', phase: index * 0.25 % 1, depth: 0.25, polarity: 'bipolar', retrigger: 'free', smoothing: 0.1,
    fmSource: index > 0 ? index - 1 : -1, fmAmount: 0, routes: wavetable.dimensions.map((_, i) => i === index % wavetable.dimensions.length ? 1 : 0) });
  emit('update:track', next);
}
function updateVectorLfo(index: number, change: Partial<TonewheelWavetableLfo>) {
  const next = clonePresetTrackData(props.track);
  Object.assign(next.tonewheelWavetable.lfos[index], change);
  emit('update:track', clonePresetTrackData(next));
}
function updateVectorRoute(index: number, axis: number, value: number) {
  const next = clonePresetTrackData(props.track);
  next.tonewheelWavetable.lfos[index].routes[axis] = value;
  emit('update:track', next);
}
function removeVectorLfo(index: number) {
  const next = clonePresetTrackData(props.track);
  next.tonewheelWavetable.lfos.splice(index, 1);
  next.tonewheelWavetable.lfos.forEach(lfo => {
    if (lfo.fmSource === index) lfo.fmSource = -1;
    else if (lfo.fmSource > index) lfo.fmSource--;
  });
  openVectorPanels.value = openVectorPanels.value.filter(i => i !== index).map(i => i > index ? i - 1 : i);
  emit('update:track', next);
}
</script>

<style scoped>
.track-modulation { display: grid; gap: 16px; }
.source-summary { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; width: 100%; padding-right: 8px; flex-wrap: wrap; }
.source-status { color: var(--instrument-muted); font-size: 0.75rem; white-space: nowrap; }
</style>
