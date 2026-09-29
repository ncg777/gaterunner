<template>
  <p class="text-body-2 mb-3">Each partial has its own frequency. Choose two position functions, then move between them with Morph. The partial source below supplies amplitudes. Envelopes and LFOs can move the function parameters while notes play.</p>
  <v-row>
    <v-col v-for="side in sides" :key="side.key" cols="12" md="6">
      <v-card variant="outlined" class="pa-3 h-100">
        <v-select :model-value="modelValue[side.key].type" :label="side.title" :items="functionOptions" variant="outlined" density="comfortable" @update:modelValue="changeType(side.key, $event)" />
        <p class="text-caption mb-2">{{ definition(side.key).description }}</p>
        <code class="bank-formula">{{ modelValue[side.key].type === 'custom' ? modelValue[side.key].expression : definition(side.key).formula }}</code>
        <v-text-field v-if="modelValue[side.key].type === 'custom'" :model-value="modelValue[side.key].expression" label="Position expression" hint="n = original ratio; a, b, c = parameters; sin, sqrt, log, pow…" persistent-hint :error-messages="bankExpressionError(modelValue[side.key].expression) ?? []" class="mt-3" @update:modelValue="updatePosition(side.key, { expression: $event })" />
        <EditableSlider v-for="(p, i) in definition(side.key).parameters" :key="i" :model-value="modelValue[side.key][parameterKeys[i]]" :label="`${parameterKeys[i]} · ${p.title}: ${modelValue[side.key][parameterKeys[i]].toFixed(3)}`" :min="p.min" :max="p.max" :step="p.step" class="mt-4" @update:modelValue="updatePosition(side.key, { [parameterKeys[i]]: $event })" />
        <v-text-field v-if="modelValue[side.key].type === 'jitter'" :model-value="modelValue[side.key].seed" label="Pattern seed" type="number" min="0" max="2147483647" step="1" @update:modelValue="updatePosition(side.key, { seed: Number($event) })" />
      </v-card>
    </v-col>
    <v-col cols="12" md="8"><EditableSlider :model-value="modelValue.morph" :label="`Position morph: ${Math.round(modelValue.morph * 100)}%`" :min="0" :max="1" :step="0.01" @update:modelValue="update({ morph: $event })" /></v-col>
    <v-col cols="12" md="4"><v-switch :model-value="modelValue.anchor" label="Anchor 1× to played note" density="compact" hide-details @update:modelValue="update({ anchor: !!$event })" /></v-col>
  </v-row>
  <p class="text-caption text-medium-emphasis mb-4">Functions map the original ratios shown by the amplitude source. Ratios stay between 1/64× and 256×; invalid or nonpositive results silence that partial. Output energy is normalized, and very high partials fade out before Nyquist. Unison count edits apply to new notes; other controls affect sounding notes.</p>
</template>
<script setup lang="ts">
import EditableSlider from './EditableSlider.vue';
import { POSITION_FUNCTIONS, normalizeBankPosition, normalizePartialBank, bankExpressionError, type BankPosition, type PartialBankSettings, type PositionFunctionType } from '../audio/partialBank';
const props = defineProps<{ modelValue: PartialBankSettings }>();
const emit = defineEmits<{ 'update:modelValue': [value: PartialBankSettings] }>();
const sides = [{ key: 'position', title: 'Position function' }, { key: 'target', title: 'Target position function' }] as const;
type Side = (typeof sides)[number]['key'];
const parameterKeys = ['a', 'b', 'c'] as const;
const functionOptions = Object.entries(POSITION_FUNCTIONS).map(([value, item]) => ({ value, title: item.title }));
const definition = (side: Side) => POSITION_FUNCTIONS[props.modelValue[side].type];
function update(change: Partial<PartialBankSettings>) { emit('update:modelValue', normalizePartialBank({ ...props.modelValue, ...change })); }
function changeType(side: Side, type: PositionFunctionType) { update({ [side]: normalizeBankPosition({ type }) }); }
function updatePosition(side: Side, change: Partial<BankPosition>) { update({ [side]: { ...props.modelValue[side], ...change } }); }
</script>
<style scoped>
.bank-formula { display: block; overflow-wrap: anywhere; font-size: 0.8rem; }
</style>
