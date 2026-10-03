<template>
  <v-row dense class="modulation-fields">
    <v-col v-for="field in fields" :key="field.key" cols="6" sm="4">
      <v-switch v-if="field.kind === 'switch'" :model-value="Boolean(value(field.key))" :label="field.label" density="compact" hide-details :disabled="field.disabled" @update:modelValue="emit('change', field.key, !!$event)" />
      <v-select v-else-if="field.items" :model-value="value(field.key)" :label="field.label" :items="field.items" density="compact" hide-details :disabled="field.disabled" @update:modelValue="emit('change', field.key, $event)" />
      <v-text-field v-else :model-value="value(field.key)" :label="field.label" type="number" :min="field.min" :max="field.max" :step="field.step" density="compact" hide-details :disabled="field.disabled" @update:modelValue="updateNumber(field, $event)" />
    </v-col>
  </v-row>
</template>

<script setup lang="ts">
import type { ModulationField } from './modulationFields';
const props = defineProps<{ modelValue: object; fields: readonly ModulationField[] }>();
const emit = defineEmits<{ change: [key: string, value: unknown] }>();
function value(key: string) { return (props.modelValue as Record<string, unknown>)[key]; }
function updateNumber(field: ModulationField, input: unknown) {
  if (input === '' || input === null) return;
  const number = Number(input);
  if (!Number.isFinite(number)) return;
  emit('change', field.key, Math.max(field.min ?? -Infinity, Math.min(field.max ?? Infinity, number)));
}
</script>

<style scoped>
.modulation-fields { margin-top: 8px; }
</style>
