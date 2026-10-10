<template>
  <section class="generator-controls" :aria-label="`${mode} generator controls`">
    <p class="text-body-2 mb-4">{{ descriptions[mode] }}</p>
    <v-select v-if="mode === 'modal'" :model-value="settings.modal.material" label="Resonant material"
      :items="['bell', 'bar', 'glass', 'harmonic']" variant="outlined" @update:modelValue="update('material', $event)" />
    <template v-if="mode === 'granular'">
      <v-select :model-value="settings.granular.asset" label="Grain sample" :items="assets.map(a => ({ title: a.name, value: a.hash }))"
        variant="outlined" @update:modelValue="update('asset', $event)" />
      <p v-if="!assets.length" class="text-body-2 mb-3">Import a WAV in Phrases, motion &amp; studio → Samples, then choose it here.</p>
      <p v-else-if="!assets.some(a => a.hash === settings.granular.asset)" class="text-body-2 mb-3">Choose an available sample to play this generator.</p>
    </template>
    <v-row>
      <v-col v-for="field in GENERATOR_FIELDS[mode]" :key="field.key" cols="12" md="6">
        <EditableSlider :model-value="value(field.key)" :label="`${field.label}: ${format(field.key, field.step)}`"
          :min="field.min" :max="field.max" :step="field.step" @update:modelValue="update(field.key, $event)" />
      </v-col>
    </v-row>
    <p class="text-caption text-medium-emphasis mt-3">{{ modulationHints[mode] }} Amp/pitch envelopes and filter motion remain in Modulation.</p>
  </section>
</template>
<script setup lang="ts">
import EditableSlider from './EditableSlider.vue';
import { GENERATOR_FIELDS, normalizeGeneratorEngines, type GeneratorMode, type GeneratorEngines } from '../audio/generatorSettings';
import type { SampleAsset } from '../domain/development';
const props = defineProps<{ mode: GeneratorMode; settings: GeneratorEngines; assets: readonly SampleAsset[] }>();
const emit = defineEmits<{ 'update:settings': [settings: GeneratorEngines] }>();
const descriptions: Record<GeneratorMode, string> = {
  modal: 'Strike a bank of independently decaying resonances. Choose bells, bars, glass or a harmonic body; damping makes the higher modes fade faster.',
  pulse: 'A continuously variable pulse spectrum. Move width by hand or with modulation to animate hollow leads, basses and pads.',
  fm: 'A sine modulator changes a sine carrier’s frequency. Ratio sets the spacing of the added tones; index and its envelope shape their strength.',
  pluck: 'Seeded excitation rings through a tuned string. Brightness controls high-frequency loss; position changes the initial pluck color. The tuning range is 20–8,000 Hz.',
  granular: 'Play overlapping, windowed grains from an imported sample. Position and scatter explore the recording; root note sets its tuning. Stereo samples are mixed to mono before track pan and effects.',
};
const modulationHints: Record<GeneratorMode, string> = {
  modal: 'Route an envelope or LFO to Modal damping.', pulse: 'Route an envelope or LFO to Pulse width.',
  fm: 'Route an envelope or LFO to FM index.', pluck: 'Route an envelope or LFO to Pluck brightness.',
  granular: 'Route envelopes or LFOs to Grain position and Grain size. Up to 32 grains can overlap per voice.',
};
function value(key: string): number { return (props.settings[props.mode] as unknown as Record<string, number>)[key]; }
function format(key: string, step: number) { return value(key).toFixed(step === 1 ? 0 : step < 0.01 ? 3 : 2); }
function update(key: string, value: unknown) {
  emit('update:settings', normalizeGeneratorEngines({ ...props.settings, [props.mode]: { ...props.settings[props.mode], [key]: value } }));
}
</script>
