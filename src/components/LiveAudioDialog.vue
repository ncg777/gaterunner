<template>
  <v-dialog :model-value="modelValue" max-width="460" scrollable @update:model-value="$emit('update:modelValue', $event)">
    <v-card title="Live audio buffering">
      <v-card-text>
        <p class="mb-4">Stop playback before changing buffering. Applying clears remaining audio tails; your preset and unsaved edits stay intact.</p>
        <v-select v-model="selected" :items="modes" label="Buffering" :disabled="busy || running" />
        <p>Playback requests more output buffering. Controls may respond more slowly. The browser decides the actual latency.</p>
        <p class="my-3">Sound quality and WAV export are unchanged. This setting is saved on this device, not in presets.</p>
        <dl class="live-audio-stats my-4">
          <dt>Active request</dt><dd>{{ mode }}</dd>
          <dt>Sample rate</dt><dd>{{ sampleRate }} Hz</dd>
          <dt>Base latency</dt><dd>{{ baseLatency }}</dd>
          <dt>Output latency</dt><dd>{{ outputLatency }}</dd>
          <dt>Lookahead</dt><dd>{{ lookAhead }} ms</dd>
          <dt>Late note callbacks</dt><dd>{{ stats.late }} / {{ stats.callbacks }}</dd>
          <dt>Worst lateness</dt><dd>{{ stats.worstLateMs.toFixed(1) }} ms</dd>
        </dl>
        <p class="text-caption">Counters reset on Play. These measure note scheduling, not audio-output glitches or CPU usage. Zero late callbacks does not rule out crackling.</p>
      </v-card-text>
      <v-card-actions>
        <v-btn @click="$emit('update:modelValue', false)">Close</v-btn>
        <v-spacer />
        <v-btn color="primary" :disabled="busy || running || selected === mode" @click="$emit('apply', selected)">Apply buffering</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue';
import * as Tone from 'tone';
import { readLiveScheduling, type LiveBuffering } from '../audio/liveAudio';
const props = defineProps<{ modelValue: boolean; mode: LiveBuffering; busy: boolean; running: boolean }>();
defineEmits<{ 'update:modelValue': [boolean]; apply: [LiveBuffering] }>();
const modes = [{ title: 'Interactive (current default)', value: 'interactive' }, { title: 'Playback (more buffering)', value: 'playback' }];
const selected = ref<LiveBuffering>(props.mode);
const sampleRate = ref(0), lookAhead = ref(0);
const baseLatency = ref('Unavailable'), outputLatency = ref('Unavailable');
const stats = ref({ callbacks: 0, late: 0, worstLateMs: 0 });
const milliseconds = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? `${(value * 1000).toFixed(1)} ms` : 'Unavailable';
function update() {
  const context = Tone.getContext();
  if (context.isOffline) return;
  const raw = context.rawContext as unknown as { baseLatency?: number; outputLatency?: number };
  sampleRate.value = context.sampleRate; lookAhead.value = context.lookAhead * 1000;
  baseLatency.value = milliseconds(raw.baseLatency); outputLatency.value = milliseconds(raw.outputLatency);
  stats.value = readLiveScheduling(context);
}
let timer: ReturnType<typeof setInterval> | undefined;
watch(() => [props.modelValue, props.mode], () => {
  clearInterval(timer); timer = undefined;
  selected.value = props.mode;
  if (props.modelValue) { update(); timer = setInterval(update, 1000); }
}, { immediate: true });
onUnmounted(() => clearInterval(timer));
</script>
<style scoped>
.live-audio-stats { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
</style>
