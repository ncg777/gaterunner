<script setup lang="ts">
import type { PresetTrackData } from '../presets';
import type { TrackMixState } from './TrackStrip.vue';
defineProps<{ tracks: PresetTrackData[]; selectedTrackId: string | null; trackMixStates: Record<string, TrackMixState>; masterGain: number; midiOutput: boolean }>();
defineEmits<{ select: [id: string]; gain: [id: string, gain: number]; mute: [id: string]; solo: [id: string]; master: [gain: number]; edit: [id: string] }>();
const colors = ['#74bba9','#d6a269','#9e9bc9','#7ca8cc','#c68499','#aab87c'];
</script>

<template>
  <div class="mixer" aria-label="Track mixer">
    <div
      v-for="(track, index) in tracks"
      :key="track.id"
      class="mixer-channel"
      :class="{ selected: selectedTrackId === track.id }"
      :style="{ '--track-color': colors[index % colors.length] }"
    >
      <button class="channel-title" @click="$emit('select', track.id)">
        <span>{{ String(index + 1).padStart(2, '0') }}</span>
        {{ track.name }}
      </button>
      <button class="channel-device" title="Open instrument controls" @click="$emit('edit', track.id)">
        <v-icon size="14">{{ track.trackKind === 'rhythmic' ? 'mdi-album' : 'mdi-sine-wave' }}</v-icon>
        {{ track.trackKind === 'rhythmic' ? 'Drum kit' : track.synthMode ?? 'Additive' }}
      </button>
      <div class="channel-switches">
        <button
          :class="{ muted: trackMixStates[track.id]?.muted }"
          :aria-pressed="!!trackMixStates[track.id]?.muted"
          :aria-label="`Mute ${track.name}`"
          @click="$emit('mute', track.id)"
        >M</button>
        <button
          :class="{ soloed: trackMixStates[track.id]?.soloed }"
          :aria-pressed="!!trackMixStates[track.id]?.soloed"
          :aria-label="`Solo ${track.name}`"
          @click="$emit('solo', track.id)"
        >S</button>
      </div>
      <div class="channel-fader">
        <div class="fader-scale">
          <span v-for="db in [24, 0, -24, -48, -96]" :key="db" :style="{ top: `${(24 - db) / 120 * 100}%` }">{{ db > 0 ? '+' : '' }}{{ db }}</span>
        </div>
        <input
          type="range"
          min="-96"
          max="24"
          step="0.1"
          :value="track.gain"
          :disabled="midiOutput"
          :aria-label="`${track.name} gain in dB`"
          @input="$emit('gain', track.id, Number(($event.target as HTMLInputElement).value))"
        />
      </div>
      <output>
        {{ track.gain.toFixed(1) }}
        <small>dB</small>
      </output>
      <span class="channel-route">{{ midiOutput ? `MIDI · Ch ${track.midiChannel}` : '→ Master' }}</span>
    </div>
    <div class="mixer-channel master-channel">
      <div class="channel-title">MASTER</div>
      <span class="channel-device">Stereo output</span>
      <div class="master-caption">OUTPUT GAIN</div>
      <div class="channel-fader">
        <div class="fader-scale">
          <span v-for="db in [12, 0, -24, -48, -96]" :key="db" :style="{ top: `${(12 - db) / 108 * 100}%` }">{{ db > 0 ? '+' : '' }}{{ db }}</span>
        </div>
        <input
          type="range"
          min="-96"
          max="12"
          step="0.1"
          :value="masterGain"
          :disabled="midiOutput"
          aria-label="Master gain in dB"
          @input="$emit('master', Number(($event.target as HTMLInputElement).value))"
        />
      </div>
      <output>
        {{ masterGain.toFixed(1) }}
        <small>dB</small>
      </output>
      <span class="channel-route">{{ midiOutput ? 'External MIDI' : 'Main out · 1 / 2' }}</span>
    </div>
  </div>
</template>

<style scoped>
.mixer {
  display: flex;
  align-items: flex-start;
  overflow-x: auto;
  min-height: 340px;
  padding: 16px;
  gap: 6px;
  background: var(--panel-inset);
}

.mixer-channel {
  flex: 0 0 116px;
  min-height: 330px;
  border: 1px solid var(--panel-border-soft);
  border-top: 3px solid var(--track-color);
  border-radius: 4px;
  background: var(--panel-deep);
  display: flex;
  align-items: center;
  flex-direction: column;
  padding-bottom: 10px;
}

.mixer-channel > * {
  flex-shrink: 0;
}

.mixer-channel.selected {
  background: #2b3439;
  border-color: var(--track-color);
}

button {
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.channel-title {
  display: flex;
  gap: 7px;
  align-items: center;
  width: 100%;
  padding: 10px 8px;
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.channel-title span {
  color: var(--track-color);
  font: 10px var(--font-mono);
}

.channel-device {
  font-size: 10px;
  color: var(--instrument-muted);
  text-transform: capitalize;
  display: flex;
  gap: 4px;
  align-items: center;
  max-width: 110px;
}

.channel-switches {
  display: flex;
  gap: 5px;
  margin: 12px 0;
}

.channel-switches button {
  border: 1px solid #48505a;
  background: #20252b;
  border-radius: 3px;
  width: 31px;
  height: 24px;
  font: 11px var(--font-mono);
}

.channel-switches .muted {
  background: #b78d4c;
  color: #171b20;
}

.channel-switches .soloed {
  background: #74bba9;
  color: #171b20;
}

.channel-fader {
  display: flex;
  gap: 9px;
  height: 168px;
  justify-content: center;
}

.channel-fader input {
  writing-mode: vertical-lr;
  direction: rtl;
  width: 22px;
  height: 168px;
  accent-color: var(--track-color);
  cursor: ns-resize;
}

.fader-scale {
  position: relative;
  width: 24px;
  margin-block: 8px;
  font: 9px var(--font-mono);
  color: #808a95;
  text-align: right;
}

.fader-scale span {
  position: absolute;
  right: 0;
  transform: translateY(-50%);
}

output {
  margin: 11px 0 6px;
  font: 14px var(--font-mono);
}

output small {
  font-size: 10px;
  color: var(--instrument-muted);
}

.channel-route {
  font-size: 10px;
  color: var(--instrument-muted);
}

.master-channel {
  --track-color: #d6bd82;
  margin-left: auto;
  border-top-color: #d6bd82;
  background: #2b2d2c;
}

.master-caption {
  font-size: 8px;
  color: #a6a99e;
  letter-spacing: .08em;
  height: 48px;
  display: grid;
  place-content: center;
}

button:focus-visible, input:focus-visible {
  outline: 2px solid var(--indicator-amber);
  outline-offset: 2px;
}

@media (pointer: coarse), (max-width: 900px) {
  .channel-switches button {
    width: 44px;
    height: 44px;
  }

  .channel-title, .channel-device {
    min-height: 44px;
  }

  .channel-fader input {
    width: 44px;
  }
}
</style>
