<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  visible: boolean;
  format: 'midi' | 'wav' | null;
  progress: number;
  status: string;
}>();

defineEmits<{ cancel: [] }>();

const formatLabel = computed(() => {
  if (props.format === 'wav') {
    return 'WAV mix';
  }
  if (props.format === 'midi') {
    return 'MIDI file';
  }
  return '';
});
</script>

<template>
  <v-dialog :model-value="visible" persistent max-width="420">
    <v-card class="export-dialog-card">
      <v-card-text class="text-center py-6 px-4">
        <v-icon size="48" color="primary" class="mb-4">
          {{ format === 'wav' ? 'mdi-waveform' : 'mdi-music-note' }}
        </v-icon>
        <div class="text-h6 mb-2">Exporting {{ formatLabel }}</div>
        <div class="text-body-2 text-medium-emphasis mb-5">{{ status }}</div>
        <v-progress-linear
          v-if="progress >= 0"
          :model-value="progress"
          color="primary"
          height="12"
          rounded
          striped
        />
        <v-progress-linear
          v-else
          indeterminate
          color="primary"
          height="12"
          rounded
        />
      </v-card-text>
      <v-card-actions v-if="format === 'wav'">
        <v-spacer />
        <v-btn variant="text" @click="$emit('cancel')">Cancel</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.export-dialog-card {
  border: 1px solid var(--panel-border-soft);
  border-radius: 0;
  background: var(--panel-deep);
}

:deep(.v-progress-linear) {
  border-radius: 0 !important;
}
</style>
