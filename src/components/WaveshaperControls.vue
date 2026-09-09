<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import EditableSlider from './EditableSlider.vue';
import WaveshaperPreview from './WaveshaperPreview.vue';
import {
  WAVESHAPER_BUILTINS,
  cloneWaveshaperSettings,
  resolveWaveshaperCurve,
  reconcileWaveshaperParameters,
  type WaveshaperSettings,
  type WaveshaperParameter,
} from '../audio/waveshaper';

type RangeField = 'min' | 'max' | 'step';
type RangeDraft = Record<RangeField, string>;

export default defineComponent({
  name: 'WaveshaperControls',
  components: { EditableSlider, WaveshaperPreview },
  props: {
    modelValue: { type: Object as PropType<WaveshaperSettings>, required: true },
  },
  emits: {
    'update:modelValue': (_settings: WaveshaperSettings) => true,
  },
  data() {
    return {
      settings: cloneWaveshaperSettings(this.modelValue),
      rangeDrafts: {} as Record<string, RangeDraft>,
      expandedRanges: [] as string[],
      pickerSearch: '',
    };
  },
  computed: {
    selectedBuiltin() {
      return WAVESHAPER_BUILTINS.find((builtin) => builtin.id === this.settings.curve);
    },
    pickerItems(): Array<{ title: string; value: string; group: string; heading: string }> {
      const builtins = [...WAVESHAPER_BUILTINS];
      const groups = [...new Set(builtins.map((builtin) => builtin.group))];
      const sineGroup = builtins.find((builtin) => builtin.id === 'sine-fold')?.group;
      if (sineGroup) groups.sort((left, right) => Number(right === sineGroup) - Number(left === sineGroup));
      const items = groups.flatMap((group) => builtins
        .filter((builtin) => builtin.group === group)
        .sort((left, right) => Number(right.id === 'sine-fold') - Number(left.id === 'sine-fold'))
        .map((builtin) => ({ title: builtin.title, value: builtin.id, group, heading: '' })));
      items.push({ title: 'Custom', value: 'custom', group: 'Custom', heading: '' });
      return items.map((item, index) => ({
        ...item,
        heading: items[index - 1]?.group !== item.group ? item.group : '',
      }));
    },
    parameters(): WaveshaperParameter[] {
      if (this.settings.curve === 'custom') return this.settings.customParameters;
      return (this.selectedBuiltin?.parameters ?? []).map((parameter) => ({
        ...parameter,
        value: this.settings.builtinParameters[this.settings.curve]?.[parameter.name] ?? parameter.value,
      }));
    },
    formulaError(): string | null {
      if (this.settings.curve !== 'custom') return null;
      if (this.settings.expression.length > 512) return 'Formula exceeds 512 characters.';
      return reconcileWaveshaperParameters(this.settings.expression, this.settings.customParameters).error;
    },
    resolution(): { curve: Float32Array | null; error: string | null } {
      if (this.formulaError) return { curve: null, error: this.formulaError };
      const result = resolveWaveshaperCurve(this.settings);
      return { curve: result.error ? null : result.curve, error: result.error };
    },
  },
  watch: {
    modelValue: {
      deep: true,
      handler(next: WaveshaperSettings) {
        if (JSON.stringify(next) === JSON.stringify(this.settings)) return;
        this.settings = cloneWaveshaperSettings(next);
        this.rangeDrafts = {};
        this.expandedRanges = [];
      },
    },
  },
  methods: {
    matchesCurve(value: string, query: string, item?: { raw: { group: string } }): boolean {
      return `${value} ${item?.raw.group ?? ''}`.toLowerCase().includes(query.toLowerCase().trim());
    },
    publish(settings: WaveshaperSettings): void {
      this.settings = settings;
      this.$emit('update:modelValue', cloneWaveshaperSettings(settings));
    },
    updateSetting<Key extends keyof WaveshaperSettings>(key: Key, value: WaveshaperSettings[Key]): void {
      const next = cloneWaveshaperSettings(this.settings);
      next[key] = value;
      this.publish(next);
    },
    selectCurve(value: string | null): void {
      if (!value) return;
      this.pickerSearch = '';
      this.updateSetting('curve', value);
    },
    updateExpression(value: string | null): void {
      const next = cloneWaveshaperSettings(this.settings);
      next.expression = value ?? '';
      if (next.expression.length <= 512) {
        next.customParameters = reconcileWaveshaperParameters(next.expression, next.customParameters).parameters;
      }
      const names = new Set(next.customParameters.map((parameter) => parameter.name));
      this.expandedRanges = this.expandedRanges.filter((name) => names.has(name));
      this.rangeDrafts = Object.fromEntries(Object.entries(this.rangeDrafts).filter(([name]) => names.has(name)));
      this.publish(next);
    },
    updateParameter(parameter: WaveshaperParameter, value: number): void {
      if (!Number.isFinite(value)) return;
      const next = cloneWaveshaperSettings(this.settings);
      const bounded = Math.max(parameter.min, Math.min(parameter.max, value));
      if (next.curve === 'custom') {
        next.customParameters = next.customParameters.map((row) => row.name === parameter.name ? { ...row, value: bounded } : row);
      } else {
        next.builtinParameters[next.curve] = { ...next.builtinParameters[next.curve], [parameter.name]: bounded };
      }
      this.publish(next);
    },
    rangeValue(parameter: WaveshaperParameter, field: RangeField): string {
      return this.rangeDrafts[parameter.name]?.[field] ?? String(parameter[field]);
    },
    rangeError(parameter: WaveshaperParameter): string {
      const draft = this.rangeDrafts[parameter.name];
      if (!draft) return '';
      if (Object.values(draft).some((value) => !value.trim() || !Number.isFinite(Number(value)))) {
        return 'Min, max and step must be finite numbers.';
      }
      if (Number(draft.min) >= Number(draft.max)) return 'Min must be less than max.';
      if (Math.abs(Number(draft.min)) > 1e6 || Math.abs(Number(draft.max)) > 1e6) return 'Range must stay between -1000000 and 1000000.';
      if (Number(draft.step) <= 0) return 'Step must be greater than zero.';
      if (Number(draft.step) > Number(draft.max) - Number(draft.min)) return 'Step must not exceed the range.';
      return '';
    },
    updateRange(parameter: WaveshaperParameter, field: RangeField, value: string | null): void {
      this.rangeDrafts[parameter.name] = {
        min: this.rangeValue(parameter, 'min'),
        max: this.rangeValue(parameter, 'max'),
        step: this.rangeValue(parameter, 'step'),
        [field]: value ?? '',
      };
      if (this.rangeError(parameter)) return;
      const draft = this.rangeDrafts[parameter.name]!;
      const min = Number(draft.min);
      const max = Number(draft.max);
      const step = Number(draft.step);
      const next = cloneWaveshaperSettings(this.settings);
      next.customParameters = next.customParameters.map((row) => row.name === parameter.name
        ? { ...row, min, max, step, value: Math.max(min, Math.min(max, row.value)) }
        : row);
      this.publish(next);
    },
    toggleRange(name: string): void {
      this.expandedRanges = this.expandedRanges.includes(name)
        ? this.expandedRanges.filter((entry) => entry !== name)
        : [...this.expandedRanges, name];
    },
    resetSelected(): void {
      const next = cloneWaveshaperSettings(this.settings);
      if (next.curve === 'custom') {
        const defaults = reconcileWaveshaperParameters(next.expression, []);
        if (defaults.error || next.expression.length > 512) return;
        next.customParameters = defaults.parameters.map((parameter) => {
          const value = next.customParameters.find((row) => row.name === parameter.name)?.value ?? parameter.value;
          return { ...parameter, value: Math.max(parameter.min, Math.min(parameter.max, value)) };
        });
        this.rangeDrafts = {};
      } else if (this.selectedBuiltin) {
        next.builtinParameters[next.curve] = Object.fromEntries(this.selectedBuiltin.parameters.map((parameter) => [parameter.name, parameter.value]));
      }
      this.publish(next);
    },
  },
});
</script>

<template>
  <section class="waveshaper-controls" aria-label="Waveshaper">
    <div class="waveshaper-controls__header">
      <v-switch :model-value="settings.enabled" label="Waveshaper" density="compact" hide-details
        @update:model-value="updateSetting('enabled', Boolean($event))" />
      <v-tooltip :text="settings.curve === 'custom' ? 'Reset parameter ranges' : 'Reset selected curve parameters'">
        <template #activator="{ props }">
          <v-btn v-bind="props" icon="mdi-restore" variant="text" size="small"
            :aria-label="settings.curve === 'custom' ? 'Reset parameter ranges' : 'Reset selected curve parameters'"
            :disabled="!parameters.length || Boolean(formulaError)" @click="resetSelected" />
        </template>
      </v-tooltip>
    </div>
    <v-autocomplete :model-value="settings.curve" v-model:search="pickerSearch" :items="pickerItems"
      label="Curve" density="compact" variant="outlined" hide-details :custom-filter="matchesCurve"
      @update:model-value="selectCurve">
      <template #item="{ props, item }">
        <v-list-subheader v-if="item.raw.heading">{{ item.raw.heading }}</v-list-subheader>
        <v-list-item v-bind="props" />
      </template>
    </v-autocomplete>
    <v-textarea v-if="settings.curve === 'custom'" :model-value="settings.expression" label="Formula"
      class="waveshaper-controls__expression" rows="2" auto-grow density="compact" variant="outlined"
      :counter="512" :error-messages="formulaError ? [formulaError] : []" spellcheck="false"
      autocapitalize="off" autocomplete="off" @update:model-value="updateExpression" />
    <output v-else class="waveshaper-controls__formula">{{ selectedBuiltin?.formula ?? settings.curve }}</output>
    <WaveshaperPreview :curve="resolution.curve" :error="resolution.error" />
    <div v-for="parameter in parameters" :key="`${settings.curve}:${parameter.name}`" class="waveshaper-controls__parameter">
      <div class="waveshaper-controls__parameter-row">
        <EditableSlider :model-value="parameter.value" :label="`${parameter.name} (${parameter.value})`"
          :min="parameter.min" :max="parameter.max" :step="parameter.step"
          @update:model-value="updateParameter(parameter, $event)" />
        <v-tooltip v-if="settings.curve === 'custom'" :text="`Edit ${parameter.name} range`">
          <template #activator="{ props }">
            <v-btn v-bind="props" icon="mdi-cog-outline" variant="text" size="x-small"
              :aria-label="`Edit ${parameter.name} range`" :aria-expanded="expandedRanges.includes(parameter.name)"
              @click="toggleRange(parameter.name)" />
          </template>
        </v-tooltip>
      </div>
      <div v-if="settings.curve === 'custom' && expandedRanges.includes(parameter.name)" class="waveshaper-controls__range">
        <v-text-field v-for="field in (['min', 'max', 'step'] as const)" :key="field"
          :model-value="rangeValue(parameter, field)" :label="`${parameter.name} ${field}`"
          inputmode="decimal" density="compact" variant="underlined"
          hide-details :error="Boolean(rangeError(parameter))" @update:model-value="updateRange(parameter, field, $event)" />
        <p v-if="rangeError(parameter)" class="waveshaper-controls__range-error" role="status">{{ rangeError(parameter) }}</p>
      </div>
    </div>
    <div class="waveshaper-controls__levels">
      <EditableSlider :model-value="settings.inputDriveDb" :label="`Input Drive (${settings.inputDriveDb} dB)`"
        :min="-24" :max="36" :step="0.1" @update:model-value="updateSetting('inputDriveDb', $event)" />
      <EditableSlider :model-value="settings.mix" :label="`Mix (${settings.mix}%)`"
        :min="0" :max="100" :step="1" @update:model-value="updateSetting('mix', $event)" />
    </div>
    <v-switch :model-value="settings.dcBlock" label="DC block" density="compact" hide-details
      @update:model-value="updateSetting('dcBlock', Boolean($event))" />
  </section>
</template>

<style scoped>
.waveshaper-controls {
  display: grid;
  gap: 12px;
  min-width: 0;
  color: var(--instrument-text);
}
.waveshaper-controls__header,
.waveshaper-controls__parameter-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.waveshaper-controls__header :deep(.v-input),
.waveshaper-controls__parameter-row > .editable-slider {
  flex: 1;
  min-width: 0;
}
.waveshaper-controls__formula {
  font-family: monospace;
  font-size: 0.82rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.waveshaper-controls__expression :deep(textarea) {
  font-family: monospace;
  overflow-wrap: anywhere;
}
.waveshaper-controls__range {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding-top: 8px;
}
.waveshaper-controls__range-error {
  grid-column: 1 / -1;
  margin: 0;
  color: #e9836f;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.waveshaper-controls__levels {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
  gap: 12px;
}
.waveshaper-controls :deep(.editable-slider__label) {
  overflow-wrap: anywhere;
}
</style>