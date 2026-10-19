<script setup lang="ts">
import EditableSlider from './EditableSlider.vue';
import { REVERB_DECAY_CURVE_MIN, REVERB_DECAY_CURVE_MAX } from '../audio/reverbImpulse';

const enabled = defineModel<boolean>('enabled', { required: true });
const decay = defineModel<number>('decay', { required: true });
const decayCurve = defineModel<number>('decayCurve', { required: true });
const preDelay = defineModel<number>('preDelay', { required: true });
const dry = defineModel<number>('dry', { required: true });
const wet = defineModel<number>('wet', { required: true });
const lowCut = defineModel<number>('lowCut', { required: true });
const highCut = defineModel<number>('highCut', { required: true });

const emit = defineEmits<{
  (event: 'change'): void;
}>();
</script>

<template>
  <v-row>
    <v-col cols="12">
      <v-switch
        v-model="enabled"
        label="Enable Pink Noise Convolution Reverb"
        hide-details
        density="compact"
        @update:model-value="emit('change')"
      />
    </v-col>
  </v-row>
  <v-row class="compact-row">
    <v-col cols="12" md="4">
      <EditableSlider
        v-model="decay"
        :label="`Reverb Decay (${Number(decay).toFixed(2)}s)`"
        :min="0.1"
        :max="30"
        :step="0.1"
        @update:model-value="emit('change')"
      />
    </v-col>
    <v-col cols="12" md="4">
      <EditableSlider
        v-model="decayCurve"
        :label="`Decay Curvature (${Number(decayCurve).toFixed(2)})`"
        :min="REVERB_DECAY_CURVE_MIN"
        :max="REVERB_DECAY_CURVE_MAX"
        :step="0.01"
        @update:model-value="emit('change')"
      />
      <div class="text-caption text-medium-emphasis">1 = exponential; lower fades earlier, higher holds longer.</div>
    </v-col>
    <v-col cols="12" md="4">
      <EditableSlider
        v-model="preDelay"
        :label="`Pre-delay (${Number(preDelay).toFixed(2)}s)`"
        :min="0"
        :max="1"
        :step="0.01"
        @update:model-value="emit('change')"
      />
    </v-col>
  </v-row>
  <v-row class="compact-row">
    <v-col cols="12" md="6">
      <EditableSlider
        v-model="dry"
        :label="`Dry Level (${Number(dry).toFixed(1)} dB)`"
        :min="-96"
        :max="12"
        :step="0.1"
        @update:model-value="emit('change')"
      />
    </v-col>
    <v-col cols="12" md="6">
      <EditableSlider
        v-model="wet"
        :label="`Reverb Wet Return (${Number(wet).toFixed(1)} dB)`"
        :min="-96"
        :max="12"
        :step="0.1"
        @update:model-value="emit('change')"
      />
    </v-col>
  </v-row>
  <v-row class="compact-row">
    <v-col cols="12" md="6">
      <EditableSlider
        v-model="lowCut"
        :label="`Reverb Low Cut (${Number(lowCut).toFixed(2)} MIDI)`"
        :min="0"
        :max="127"
        :step="0.01"
        @update:model-value="emit('change')"
      />
    </v-col>
    <v-col cols="12" md="6">
      <EditableSlider
        v-model="highCut"
        :label="`Reverb High Cut (${Number(highCut).toFixed(2)} MIDI)`"
        :min="0"
        :max="127"
        :step="0.01"
        @update:model-value="emit('change')"
      />
    </v-col>
  </v-row>
</template>
