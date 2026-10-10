<template>
  <v-select :model-value="engine.synthMode" label="Synth engine" :items="modes" variant="outlined" density="comfortable" @update:modelValue="emit('change', { ...engine, synthMode: $event })" />
  <PartialBankControls v-if="engine.synthMode === 'partial-bank'" :model-value="engine.partialBank" @update:modelValue="emit('change', { ...engine, partialBank: $event })" />
  <GeneratorControls v-if="isGeneratorMode(engine.synthMode)" :mode="engine.synthMode" :settings="engine.generatorEngines" :assets="assets ?? []" @update:settings="emit('change', { ...engine, generatorEngines: $event })" />
  <template v-if="engine.synthMode === 'resonant-noise'">
    <p class="text-body-2 mb-4">Real noise excites parallel resonators. Narrow resonance creates pitched whistles; wider bands create breath and turbulent textures. Base frequency is anchored at A4. Pitch tracking follows notes and glide.</p>
    <v-select :model-value="noiseStartingPoint" label="Noise starting point" :items="[...noisePresets, customPreset]" variant="outlined" @update:modelValue="applyPreset('noiseEngine', $event)" />
    <v-select :model-value="engine.noiseEngine.color" label="Noise color" :items="['white', 'pink', 'brown']" variant="outlined" @update:modelValue="update('noiseEngine', { color: $event })" />
    <v-row>
      <v-col cols="12" md="6"><EditableSlider :model-value="engine.noiseEngine.frequency" :label="'Resonator base (Hz; A4 reference): ' + Number(engine.noiseEngine.frequency).toFixed(0)" :min="30" :max="12000" :step="1" @update:modelValue="update('noiseEngine', { frequency: $event })" /></v-col>
      <v-col cols="12" md="6"><EditableSlider :model-value="engine.noiseEngine.keyTrack" :label="'Pitch tracking: ' + Number(engine.noiseEngine.keyTrack).toFixed(2)" :min="0" :max="1" :step="0.01" @update:modelValue="update('noiseEngine', { keyTrack: $event })" /></v-col>
      <v-col cols="12" md="6"><EditableSlider :model-value="engine.noiseEngine.resonance" :label="'Resonance (Q): ' + Number(engine.noiseEngine.resonance).toFixed(2)" :min="0.5" :max="80" :step="0.5" @update:modelValue="update('noiseEngine', { resonance: $event })" /></v-col>
      <v-col cols="12" md="6"><EditableSlider :model-value="engine.noiseEngine.bands" :label="'Resonator count: ' + Number(engine.noiseEngine.bands).toFixed(0)" :min="1" :max="8" :step="1" @update:modelValue="update('noiseEngine', { bands: $event })" /></v-col>
      <v-col cols="12" md="6"><EditableSlider :model-value="engine.noiseEngine.spacing" :label="'Harmonic spacing exponent: ' + Number(engine.noiseEngine.spacing).toFixed(2)" :min="0.25" :max="3" :step="0.01" @update:modelValue="update('noiseEngine', { spacing: $event })" /></v-col>
      <v-col cols="12" md="6"><EditableSlider :model-value="engine.noiseEngine.oddEven" :label="'Odd/even balance (dB; + favors even): ' + Number(engine.noiseEngine.oddEven).toFixed(2)" :min="-24" :max="24" :step="0.5" @update:modelValue="update('noiseEngine', { oddEven: $event })" /></v-col>
      <v-col cols="12" md="6"><EditableSlider :model-value="engine.noiseEngine.tilt" :label="'Resonator tilt (dB/oct): ' + Number(engine.noiseEngine.tilt).toFixed(2)" :min="-24" :max="6" :step="0.5" @update:modelValue="update('noiseEngine', { tilt: $event })" /></v-col>
      <v-col cols="12" md="6"><EditableSlider :model-value="engine.noiseEngine.dry" :label="'Unfiltered noise mix: ' + Number(engine.noiseEngine.dry).toFixed(2)" :min="0" :max="1" :step="0.01" @update:modelValue="update('noiseEngine', { dry: $event })" /></v-col>
    </v-row>
  </template>
  <template v-if="engine.synthMode === 'choir'">
    <p class="text-body-2 mb-4">A detuned vocal ensemble excites five independent formants. Each note moves from the starting vowel toward the target blend. Formant shift changes vocal size independently of pitch.</p>
    <v-select :model-value="choirStartingPoint" label="Choir starting point" :items="[...choirPresets, customPreset]" variant="outlined" @update:modelValue="applyPreset('choirEngine', $event)" />
    <v-row>
      <v-col cols="12" md="6"><v-select :model-value="engine.choirEngine.vowel" label="Starting vowel" :items="vowels" variant="outlined" @update:modelValue="update('choirEngine', { vowel: $event })" /></v-col>
      <v-col cols="12" md="6"><v-select :model-value="engine.choirEngine.targetVowel" label="Target vowel" :items="vowels" variant="outlined" @update:modelValue="update('choirEngine', { targetVowel: $event })" /></v-col>
      <v-col cols="12" md="6"><EditableSlider :model-value="engine.choirEngine.formantShift" :label="'Vocal tract shift (semitones): ' + Number(engine.choirEngine.formantShift).toFixed(2)" :min="-24" :max="24" :step="0.1" @update:modelValue="update('choirEngine', { formantShift: $event })" /></v-col>
      <v-col cols="12" md="6"><EditableSlider :model-value="engine.choirEngine.bandwidth" :label="'Formant bandwidth multiplier: ' + Number(engine.choirEngine.bandwidth).toFixed(2)" :min="0.3" :max="4" :step="0.05" @update:modelValue="update('choirEngine', { bandwidth: $event })" /></v-col>
      <v-col cols="12" md="6"><EditableSlider :model-value="engine.choirEngine.brightness" :label="'Glottal brightness (Hz): ' + Number(engine.choirEngine.brightness).toFixed(0)" :min="500" :max="16000" :step="10" @update:modelValue="update('choirEngine', { brightness: $event })" /></v-col>
      <v-col cols="12" md="6"><EditableSlider :model-value="engine.choirEngine.breath" :label="'Breathy / unvoiced blend: ' + Number(engine.choirEngine.breath).toFixed(2)" :min="0" :max="1" :step="0.01" @update:modelValue="update('choirEngine', { breath: $event })" /></v-col>
      <v-col cols="12" md="6"><EditableSlider :model-value="engine.choirEngine.voices" :label="'Ensemble singers per note: ' + Number(engine.choirEngine.voices).toFixed(0)" :min="1" :max="8" :step="1" @update:modelValue="update('choirEngine', { voices: $event })" /></v-col>
      <v-col cols="12" md="6"><EditableSlider :model-value="engine.choirEngine.detune" :label="'Ensemble spread (cents): ' + Number(engine.choirEngine.detune).toFixed(2)" :min="0" :max="60" :step="0.5" @update:modelValue="update('choirEngine', { detune: $event })" /></v-col>
    </v-row>
    <v-expansion-panels class="my-3"><v-expansion-panel title="Individual formants"><v-expansion-panel-text>
      <v-row v-for="i in 5" :key="i">
        <v-col cols="12" md="6"><EditableSlider :model-value="engine.choirEngine.formantOffsets[i - 1]" :label="'F' + i + ' shift (semitones): ' + engine.choirEngine.formantOffsets[i - 1].toFixed(1)" :min="-12" :max="12" :step="0.1" @update:modelValue="updateBand('formantOffsets', i - 1, $event)" /></v-col>
        <v-col cols="12" md="6"><EditableSlider :model-value="engine.choirEngine.formantGains[i - 1]" :label="'F' + i + ' gain (dB): ' + engine.choirEngine.formantGains[i - 1].toFixed(1)" :min="-24" :max="12" :step="0.5" @update:modelValue="updateBand('formantGains', i - 1, $event)" /></v-col>
      </v-row>
    </v-expansion-panel-text></v-expansion-panel></v-expansion-panels>
  </template>
  <figure v-if="engine.synthMode === 'choir' || engine.synthMode === 'resonant-noise'" class="engine-response my-4">
    <svg viewBox="0 0 600 130" role="img" :aria-label="engine.synthMode === 'choir' ? 'Target vowel formant response' : 'Resonator response at A4'">
      <path :d="responsePath" fill="none" stroke="currentColor" stroke-width="2" />
      <line x1="10" y1="110" x2="590" y2="110" stroke="currentColor" opacity="0.3" />
      <text x="10" y="126" fill="currentColor" font-size="11">30 Hz</text>
      <text x="590" y="126" text-anchor="end" fill="currentColor" font-size="11">20 kHz</text>
    </svg>
    <figcaption class="text-caption text-medium-emphasis">{{ engine.synthMode === 'choir' ? 'Target formant response' : 'Resonator response at A4' }} - relative magnitude - motion, source color and effects omitted.</figcaption>
  </figure>
  <p v-if="engine.synthMode === 'choir' || engine.synthMode === 'resonant-noise'" class="text-caption text-medium-emphasis mb-4">Envelopes, resonator motion, vowel transition, and vibrato are in Modulation. Each note has independent motion.</p>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import EditableSlider from './EditableSlider.vue';
import PartialBankControls from './PartialBankControls.vue';
import GeneratorControls from './GeneratorControls.vue';
import { isGeneratorMode } from '../audio/generatorSettings';
import type { SampleAsset } from '../domain/development';
import { choirBands, noiseBands, normalizeSynthEngine, type SynthEngineSettings, type NoiseEngineSettings, type ChoirEngineSettings } from '../audio/synthEngine';
const props = defineProps<{ track: unknown; assets?: readonly SampleAsset[] }>();
const emit = defineEmits<{ change: [settings: SynthEngineSettings] }>();
const engine = computed(() => normalizeSynthEngine(props.track));
const modes = [{ title: 'Additive', value: 'additive' }, { title: 'Partial Bank', value: 'partial-bank' }, { title: 'Resonant noise', value: 'resonant-noise' }, { title: 'Vocal choir', value: 'choir' },
  { title: 'Modal percussion', value: 'modal' }, { title: 'Variable pulse', value: 'pulse' }, { title: 'Two-operator FM', value: 'fm' }, { title: 'Plucked string', value: 'pluck' }, { title: 'Granular sampler', value: 'granular' }];
const vowels = [{ title: 'Ah / a', value: 'a' }, { title: 'Eh / e', value: 'e' }, { title: 'Ee / i', value: 'i' }, { title: 'Oh / o', value: 'o' }, { title: 'Oo / u', value: 'u' }];
const noisePresets = [
  { title: 'Balanced resonators', value: {} },
  { title: 'Air column', value: { bands: 2, resonance: 35, tilt: -12 } },
  { title: 'Reed buzz', value: { color: 'white', bands: 6, resonance: 28, tilt: -3 } },
  { title: 'Hollow pipe', value: { bands: 6, oddEven: -24, resonance: 30 } },
  { title: 'Wind wash', value: { color: 'brown', bands: 3, resonance: 2, keyTrack: 0, frequency: 900, dry: 0.3, lfoDepth: 5, lfoRate: 0.2 } },
];
const choirPresets = [
  { title: 'Open choir', value: {} },
  { title: 'Breathy vowels', value: { breath: 0.35, bandwidth: 2, vowel: 'u', targetVowel: 'a', morph: 0.6, morphTime: 1.5 } },
  { title: 'Small ensemble', value: { voices: 2, detune: 9, vibratoDepth: 5, vowel: 'o' } },
  { title: 'Vowel sweep', value: { vowel: 'a', targetVowel: 'i', morph: 1, morphTime: 0.8, formantShift: 3 } },
];
const customPreset = { title: 'Custom', value: 'custom', props: { disabled: true } };
function matchingPreset(field: 'noiseEngine' | 'choirEngine', presets: Array<{ value: unknown }>) {
  const current = JSON.stringify(engine.value[field]);
  return presets.find(preset => JSON.stringify(normalizeSynthEngine({ [field]: preset.value })[field]) === current)?.value ?? 'custom';
}
const noiseStartingPoint = computed(() => matchingPreset('noiseEngine', noisePresets));
const choirStartingPoint = computed(() => matchingPreset('choirEngine', choirPresets));
function applyPreset(field: 'noiseEngine' | 'choirEngine', value: unknown) {
  if (value === 'custom') return;
  emit('change', normalizeSynthEngine({ ...engine.value, [field]: value }));
}
const responsePath = computed(() => {
  const s = engine.value;
  const bands = s.synthMode === 'choir' ? choirBands(s.choirEngine)
    : noiseBands(s.noiseEngine).map(b => ({ frequency: s.noiseEngine.frequency * b.ratio, Q: s.noiseEngine.resonance, gain: b.gain }));
  const magnitudes = Array.from({ length: 300 }, (_, i) => {
    const hz = 30 * (20000 / 30) ** (i / 299);
    let real = s.synthMode === 'resonant-noise' ? s.noiseEngine.dry : 0, imag = 0;
    for (const b of bands) {
      const ratio = hz / b.frequency, x = 1 - ratio * ratio, y = ratio / b.Q;
      const denominator = x * x + y * y;
      real += b.gain * y * y / denominator;
      imag += b.gain * x * y / denominator;
    }
    return Math.hypot(real, imag);
  });
  const peak = Math.max(...magnitudes, 1e-9);
  return magnitudes.map((v, i) => (i ? 'L' : 'M') + (10 + i * 580 / 299).toFixed(2) + ','
    + (10 + Math.min(60, -20 * Math.log10(Math.max(1e-9, v / peak))) * 100 / 60).toFixed(2)).join(' ');
});
function update(field: 'noiseEngine' | 'choirEngine', change: Partial<NoiseEngineSettings> | Partial<ChoirEngineSettings>) {
  emit('change', normalizeSynthEngine({ ...engine.value, [field]: { ...engine.value[field], ...change } }));
}
function updateBand(field: 'formantOffsets' | 'formantGains', index: number, value: number) {
  const bands = [...engine.value.choirEngine[field]];
  bands[index] = value;
  update('choirEngine', { [field]: bands });
}
</script>

<style scoped>
.engine-response { margin-inline: 0; color: rgb(var(--v-theme-primary)); }
.engine-response svg { display: block; width: 100%; max-height: 150px; }
</style>
