<template>
  <v-responsive class="editor-surface align-center mx-auto pa-2 pb-8">
    <div class="control-tabs-layout">
      <v-tabs v-model="activeControlTab" :direction="$vuetify.display.xs ? 'horizontal' : 'vertical'" class="control-tabs" color="primary">
        <v-tab value="sequence" prepend-icon="mdi-format-list-numbered">Sequence</v-tab>
        <v-tab v-if="!midiOutput && draftTrack.trackKind === 'rhythmic'" value="drum-sounds" prepend-icon="mdi-album">Drum Sounds</v-tab>
        <v-tab value="playback" prepend-icon="mdi-play-circle-outline">Playback</v-tab>
        <v-tab value="time-warp" prepend-icon="mdi-chart-sankey">Time Warp</v-tab>
        <v-tab v-if="!midiOutput && draftTrack.trackKind !== 'rhythmic'" value="generator" prepend-icon="mdi-sine-wave">Generator</v-tab>
        <v-tab v-if="!midiOutput" value="modulation" prepend-icon="mdi-chart-bell-curve-cumulative">Modulation</v-tab>
        <v-tab v-if="!midiOutput && draftTrack.trackKind !== 'rhythmic'" value="unison" prepend-icon="mdi-account-voice">Voices &amp; Glide</v-tab>
        <v-tab v-if="!midiOutput" value="drive" prepend-icon="mdi-lightning-bolt-outline">Drive</v-tab>
        <v-tab v-if="!midiOutput" value="chorus" prepend-icon="mdi-blur">Chorus</v-tab>
        <v-tab v-if="!midiOutput" value="flanger" prepend-icon="mdi-waves">Flanger</v-tab>
        <v-tab v-if="!midiOutput" value="phaser" prepend-icon="mdi-vector-curve">Phaser</v-tab>
        <v-tab v-if="!midiOutput" value="filter" prepend-icon="mdi-filter-outline">Filter</v-tab>
        <v-tab v-if="!midiOutput" value="effects" prepend-icon="mdi-waveform">Echo &amp; Sends</v-tab>
        <v-tab v-if="!midiOutput" value="reverb" prepend-icon="mdi-weather-rainy">Global Reverb</v-tab>
      </v-tabs>

      <v-window v-model="activeControlTab" :touch="false" class="control-tab-content">
        <v-window-item value="sequence" class="control-tab-panel">
          <RhythmTrackControls
            v-if="draftTrack.trackKind === 'rhythmic'"
            :track="draftTrack"
            @update:track="draftTrack = $event; handleTrackDraftChange()"
          />
          <v-row v-else>
            <v-col cols="12">
              <v-text-field
                :label="`Sequence (${selectedTrackSequenceLength})`"
                v-model="draftTrack.sequenceInput"
                placeholder="e.g. 0 1 2..."
                hide-details="auto"
                density="comfortable"
                variant="outlined"
                @update:modelValue="handleTrackDraftChange"
              />
            </v-col>
          </v-row>
        </v-window-item>

        <v-window-item v-if="!midiOutput && draftTrack.trackKind === 'rhythmic'" value="drum-sounds" class="control-tab-panel">
          <RhythmSoundControls
            :track="draftTrack"
            @update:track="draftTrack = $event; handleTrackDraftChange()"
          />
        </v-window-item>

        <v-window-item value="playback" class="control-tab-panel">
          <v-row class="compact-row">
            <v-col cols="12">
              <EditableSlider
                :label="'Track Numerator (' + draftTrack.numerator + ')'"
                :min="1"
                :step="1"
                :max="16"
                v-model="draftTrack.numerator"
                @update:modelValue="handleTrackDraftChange"
              />
            </v-col>
          </v-row>

          <v-row class="compact-row">
            <v-col cols="12">
              <EditableSlider
                :label="'Track Denominator (' + draftTrack.denominator + ')'"
                :min="1"
                :step="1"
                :max="16"
                v-model="draftTrack.denominator"
                @update:modelValue="handleTrackDraftChange"
              />
            </v-col>
          </v-row>

          <v-row class="compact-row">
            <v-col cols="12">
              <EditableSlider
                :label="'Track Phase (' + Number(draftTrack.phase).toFixed(2) + ')'"
                :min="0"
                :step="0.01"
                :max="1"
                v-model="draftTrack.phase"
                @update:modelValue="handleTrackDraftChange"
              />
            </v-col>
          </v-row>

          <v-row class="compact-row">
            <v-col cols="12">
              <EditableSlider
                :label="'Octave shift (' + draftTrack.octave + ')'"
                :min="0"
                :step="1"
                :max="10"
                v-model="draftTrack.octave"
                @update:modelValue="handleTrackDraftChange"
              />
            </v-col>
          </v-row>

          <v-row class="compact-row">
            <v-col cols="12">
              <EditableSlider
                :label="'Track Note Length (' + draftTrack.lengthFactor + '%)'"
                :min="0"
                :max="400"
                :step="1"
                v-model="draftTrack.lengthFactor"
                @update:modelValue="handleTrackDraftChange"
              />
            </v-col>
          </v-row>

          <v-row class="compact-row">
            <v-col cols="12">
              <EditableSlider
                :label="'Fixed Note Length (+' + Number(draftTrack.lengthOffset).toFixed(2) + ' steps)'"
                :min="0"
                :max="64"
                :step="0.01"
                v-model="draftTrack.lengthOffset"
                @update:modelValue="handleTrackDraftChange"
              />
            </v-col>
          </v-row>

          <v-row v-if="!midiOutput" class="compact-row">
            <v-col cols="12">
              <EditableSlider
                :label="'Track Gain (' + Number(draftTrack.gain).toFixed(1) + ' dB)'"
                :min="-96"
                :max="24"
                :step="0.1"
                v-model="draftTrack.gain"
                @update:modelValue="handleTrackDraftChange"
              />
            </v-col>
          </v-row>

          <v-row class="compact-row">
            <v-col cols="12">
              <EditableSlider
                :label="'Track Velocity Multiplier (' + Number(draftTrack.velocityMultiplier).toFixed(2) + 'x)'"
                :min="0"
                :max="4"
                :step="0.01"
                v-model="draftTrack.velocityMultiplier"
                @update:modelValue="handleTrackDraftChange"
              />
            </v-col>
          </v-row>

          <v-row class="compact-row">
            <v-col cols="12">
              <EditableSlider
                :label="'Track MIDI Channel (' + draftTrack.midiChannel + ')'"
                :min="1"
                :max="16"
                :step="1"
                v-model="draftTrack.midiChannel"
                @update:modelValue="handleTrackDraftChange"
              />
            </v-col>
          </v-row>

          <v-row class="compact-row">
            <v-col cols="12">
              <EditableSlider
                :label="'Track Delay (' + draftTrack.delay + ' bars)'"
                :min="0"
                :max="64"
                :step="1"
                v-model="draftTrack.delay"
                @update:modelValue="handleTrackDraftChange"
              />
            </v-col>
          </v-row>

          <v-row class="compact-row">
            <v-col cols="12">
              <EditableSlider
                :label="'Padding Before Sequence (' + Number(draftTrack.paddingBefore).toFixed(2) + ' bars)'"
                :min="0"
                :max="64"
                :step="0.01"
                v-model="draftTrack.paddingBefore"
                @update:modelValue="handleTrackDraftChange"
              />
            </v-col>
          </v-row>

          <v-row class="compact-row">
            <v-col cols="12">
              <EditableSlider
                :label="'Padding After Sequence (' + Number(draftTrack.paddingAfter).toFixed(2) + ' bars)'"
                :min="0"
                :max="64"
                :step="0.01"
                v-model="draftTrack.paddingAfter"
                @update:modelValue="handleTrackDraftChange"
              />
            </v-col>
          </v-row>

          <v-row v-if="!midiOutput" class="compact-row">
            <v-col cols="12">
              <EditableSlider
                :label="'Fade In (' + Number(draftTrack.fadeIn).toFixed(2) + ' bars)'"
                :min="0"
                :max="64"
                :step="0.01"
                v-model="draftTrack.fadeIn"
                @update:modelValue="handleTrackDraftChange"
              />
            </v-col>
          </v-row>

          <v-row v-if="!midiOutput" class="compact-row">
            <v-col cols="12">
              <EditableSlider
                :label="'Fade Out (' + Number(draftTrack.fadeOut).toFixed(2) + ' bars)'"
                :min="0"
                :max="64"
                :step="0.01"
                v-model="draftTrack.fadeOut"
                @update:modelValue="handleTrackDraftChange"
              />
            </v-col>
          </v-row>

          <v-row class="compact-row">
            <v-col cols="12">
              <EditableSlider
                :label="'Track Repeats (' + draftTrack.repeats + ')'"
                :min="1"
                :max="64"
                :step="1"
                v-model="draftTrack.repeats"
                @update:modelValue="handleTrackDraftChange"
              />
            </v-col>
          </v-row>
        </v-window-item>

        <v-window-item value="time-warp" class="control-tab-panel">
          <v-row>
            <v-col cols="12" md="6">
              <v-switch
                v-model="draftTrack.timeWarpEnabled"
                label="Enable Time Warp"
                hide-details
                density="compact"
                @update:modelValue="handleTrackDraftChange"
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-switch
                v-model="draftTrack.timeWarpNoteLengths"
                label="Warp note lengths"
                hide-details
                density="compact"
                :disabled="!draftTrack.timeWarpEnabled"
                @update:modelValue="handleTrackDraftChange"
              />
            </v-col>
          </v-row>

          <v-row>
            <v-col cols="12">
              <v-autocomplete
                v-model="draftTrack.timeWarpCurve"
                label="Warp curve"
                :items="timeWarpCurveOptions"
                hide-details="auto"
                density="comfortable"
                variant="outlined"
                :disabled="!draftTrack.timeWarpEnabled"
                @update:modelValue="handleTrackDraftChange"
              >
                <template #item="{ props, item }">
                  <v-list-item v-bind="props" class="time-warp-curve-option">
                    <template #title>
                      <span class="time-warp-curve-option-content">
                        <span>{{ item.title }}</span>
                        <svg viewBox="0 0 96 36" class="time-warp-curve-option-graph" aria-hidden="true">
                          <path d="M 0 36 L 96 0" class="time-warp-curve-option-identity" />
                          <path :d="timeWarpCurvePath(item.value)" class="time-warp-curve-option-line" />
                        </svg>
                      </span>
                    </template>
                  </v-list-item>
                </template>
              </v-autocomplete>
            </v-col>
          </v-row>

          <v-row v-if="draftTrack.timeWarpCurve === customTimeWarpCurve">
            <v-col cols="12">
              <v-text-field
                v-model="draftTrack.timeWarpExpression"
                label="Custom expression"
                placeholder="Y=T+sin(PI*T)*0.125"
                hide-details="auto"
                density="comfortable"
                variant="outlined"
                :error="timeWarpExpressionError.length > 0"
                :error-messages="timeWarpExpressionError"
                :disabled="!draftTrack.timeWarpEnabled"
                @update:modelValue="handleTrackDraftChange"
              />
            </v-col>
          </v-row>

          <v-row class="compact-row">
            <v-col cols="12">
              <EditableSlider
                :label="'Warp chunks (' + draftTrack.timeWarpRepeats + ')'"
                :min="1"
                :max="64"
                :step="1"
                v-model="draftTrack.timeWarpRepeats"
                :disabled="!draftTrack.timeWarpEnabled"
                @update:modelValue="handleTrackDraftChange"
              />
            </v-col>
          </v-row>

          <v-row class="compact-row">
            <v-col cols="12">
              <EditableSlider
                :label="'Warp amount (' + Number(draftTrack.timeWarpAmount).toFixed(0) + '%)'"
                :min="0"
                :max="100"
                :step="1"
                v-model="draftTrack.timeWarpAmount"
                :disabled="!draftTrack.timeWarpEnabled"
                @update:modelValue="handleTrackDraftChange"
              />
            </v-col>
          </v-row>

          <v-row>
            <v-col cols="12" md="6">
              <v-select
                v-model="draftTrack.timeWarpQuantize"
                label="Grid quantize"
                :items="timeWarpQuantizeOptions"
                hide-details="auto"
                density="comfortable"
                variant="outlined"
                :disabled="!draftTrack.timeWarpEnabled"
                @update:modelValue="handleTrackDraftChange"
              />
            </v-col>
          </v-row>

          <v-row>
            <v-col cols="12">
              <TimeWarpPreview
                :curve="draftTrack.timeWarpCurve"
                :expression="draftTrack.timeWarpExpression"
                :amount="draftTrack.timeWarpAmount"
                :steps="Math.max(1, selectedTrackSequenceLength)"
                :repeats="draftTrack.timeWarpRepeats"
              />
            </v-col>
          </v-row>
        </v-window-item>

        <v-window-item v-if="!midiOutput && draftTrack.trackKind !== 'rhythmic'" value="generator" class="control-tab-panel">
          <SynthEngineControls :track="draftTrack" @change="handleSynthEngineChange" />
          <template v-if="!draftTrack.synthMode || ['additive', 'partial-bank'].includes(draftTrack.synthMode)">
          <v-row class="compact-row">
            <v-col cols="12">
              <v-switch
                :model-value="draftTrack.tonewheelWavetable.enabled"
                label="Multidimensional wavetable"
                hint="Crossfade cached spectra from tonewheel, waveform, sequence, or binary configurations."
                persistent-hint
                density="compact"
                @update:modelValue="setTonewheelWavetableEnabled(Boolean($event))"
              />
            </v-col>
            <v-col v-if="draftTrack.tonewheelWavetable.enabled && selectedTonewheelConfiguration" cols="12">
              <v-select
                v-model="selectedTonewheelConfigurationIndex"
                label="Configuration to edit"
                :items="tonewheelConfigurationOptions"
                density="comfortable"
                variant="outlined"
                hide-details
              />
            </v-col>
          </v-row>
          <v-row>
            <v-col cols="12">
              <v-select
                :model-value="partialGenerator.type"
                label="Partial source"
                :items="partialSourceOptions"
                hide-details="auto"
                density="comfortable"
                variant="outlined"
                @update:modelValue="setPartialSource"
              />
            </v-col>
          </v-row>
          <template v-if="partialGenerator.type === 'sequence' || partialGenerator.type === 'binary'">
            <v-row>
              <v-col v-if="partialGenerator.type === 'sequence'" cols="12" md="6">
                <v-select :model-value="partialGenerator.sequence" label="Amplitude sequence" :items="partialSequenceOptions" density="comfortable" variant="outlined" hide-details @update:modelValue="updatePartialGenerator({ sequence: $event })" />
              </v-col>
              <v-col v-if="partialGenerator.type === 'binary'" cols="12" md="6">
                <v-select :model-value="partialGenerator.mode" label="Binary mode" :items="partialBinaryModeOptions" density="comfortable" variant="outlined" hide-details @update:modelValue="updatePartialGenerator({ mode: $event })" />
              </v-col>
              <v-col cols="12" md="6">
                <EditableSlider :model-value="partialGenerator.harmonicCount" :label="`Harmonic count (${partialGenerator.harmonicCount})`" :min="1" :max="64" :step="1" @update:modelValue="updatePartialGenerator({ harmonicCount: $event })" />
              </v-col>
              <v-col v-if="partialGenerator.type === 'binary' && partialGenerator.mode === 'bit'" cols="12">
                <EditableSlider :model-value="partialGenerator.bit" :label="`Bit index (${partialGenerator.bit}; 0 = least significant)`" :min="0" :max="5" :step="1" @update:modelValue="updatePartialGenerator({ bit: $event })" />
              </v-col>
              <v-col v-if="partialGenerator.type === 'binary' && partialGenerator.mode === 'bit-reversal'" cols="12">
                <EditableSlider :model-value="partialGenerator.bitWidth" :label="`Bit-reversal width (${partialGenerator.bitWidth})`" :min="1" :max="6" :step="1" @update:modelValue="updatePartialGenerator({ bitWidth: $event })" />
              </v-col>
            </v-row>
            <v-row>
              <v-col cols="12" md="6">
                <v-select :model-value="partialGenerator.mapping" label="Amplitude mapping" :items="partialMappingOptions" density="comfortable" variant="outlined" hide-details @update:modelValue="updatePartialGenerator({ mapping: $event })" />
              </v-col>
              <v-col cols="12" md="6">
                <v-select :model-value="partialGenerator.mask" label="Harmonic mask" :items="partialMaskOptions" density="comfortable" variant="outlined" hide-details @update:modelValue="updatePartialGenerator({ mask: $event })" />
              </v-col>
              <v-col v-if="partialGenerator.mapping === 'power'" cols="12">
                <EditableSlider :model-value="partialGenerator.exponent" :label="`Power exponent (${partialGenerator.exponent.toFixed(2)})`" :min="0.1" :max="4" :step="0.05" @update:modelValue="updatePartialGenerator({ exponent: $event })" />
              </v-col>
              <v-col v-if="partialGenerator.mapping === 'modulo'" cols="12">
                <EditableSlider :model-value="partialGenerator.mappingModulus" :label="`Mapping modulus (${partialGenerator.mappingModulus})`" :min="2" :max="64" :step="1" @update:modelValue="updatePartialGenerator({ mappingModulus: $event })" />
              </v-col>
              <v-col v-if="partialGenerator.mask === 'periodic'" cols="12" md="6">
                <EditableSlider :model-value="partialGenerator.maskPeriod" :label="`Mask period (${partialGenerator.maskPeriod})`" :min="2" :max="64" :step="1" @update:modelValue="updatePartialGenerator({ maskPeriod: $event })" />
              </v-col>
              <v-col v-if="partialGenerator.mask === 'periodic'" cols="12" md="6">
                <EditableSlider :model-value="partialGenerator.maskOffset" :label="`Mask offset (${partialGenerator.maskOffset}; 0 starts at harmonic 1)`" :min="0" :max="partialGenerator.maskPeriod - 1" :step="1" @update:modelValue="updatePartialGenerator({ maskOffset: $event })" />
              </v-col>
              <v-col v-if="partialGenerator.mask !== 'none'" cols="12">
                <v-switch :model-value="partialGenerator.invertMask" label="Invert harmonic mask" density="compact" hide-details @update:modelValue="updatePartialGenerator({ invertMask: Boolean($event) })" />
              </v-col>
              <v-col cols="12" md="8">
                <EditableSlider :model-value="partialGenerator.tilt" :label="`Spectral tilt (${partialGenerator.tilt.toFixed(1)} dB/oct)`" :min="-24" :max="24" :step="0.5" @update:modelValue="updatePartialGenerator({ tilt: $event })" />
              </v-col>
              <v-col cols="12" md="4">
                <v-switch :model-value="partialGenerator.normalize" label="Peak normalization" density="compact" hide-details @update:modelValue="updatePartialGenerator({ normalize: Boolean($event) })" />
              </v-col>
            </v-row>
            <p class="text-caption text-medium-emphasis mt-2">Mapping → harmonic mask → tilt → optional peak normalization. Inverse mappings keep zeros silent. Modulo uses the raw remainder. Binary, Thue–Morse, and Recamán start at n = 0.</p>
          </template>
          <v-row v-if="partialGenerator.type === 'waveform'">
            <v-col cols="12">
              <v-select
                :model-value="partialWaveform"
                label="Waveform"
                :items="availableWaveformOptions"
                hide-details="auto"
                density="comfortable"
                variant="outlined"
                @update:modelValue="updatePartialWaveform"
              />
            </v-col>
          </v-row>
          <template v-if="partialGenerator.type === 'waveform'">
            <v-row>
              <v-col cols="12" md="6">
                <EditableSlider :model-value="partialGenerator.harmonicCount" :label="`Harmonic count (${partialGenerator.harmonicCount})`" :min="1" :max="64" :step="1" @update:modelValue="updatePartialGenerator({ harmonicCount: $event })" />
              </v-col>
              <v-col cols="12" md="6">
                <v-select :model-value="partialGenerator.mask" label="Harmonic mask" :items="partialMaskOptions" density="comfortable" variant="outlined" hide-details @update:modelValue="updatePartialGenerator({ mask: $event })" />
              </v-col>
              <v-col v-if="partialGenerator.mask === 'periodic'" cols="12" md="6">
                <EditableSlider :model-value="partialGenerator.maskPeriod" :label="`Mask period (${partialGenerator.maskPeriod})`" :min="2" :max="64" :step="1" @update:modelValue="updatePartialGenerator({ maskPeriod: $event })" />
              </v-col>
              <v-col v-if="partialGenerator.mask === 'periodic'" cols="12" md="6">
                <EditableSlider :model-value="partialGenerator.maskOffset" :label="`Mask offset (${partialGenerator.maskOffset}; 0 starts at harmonic 1)`" :min="0" :max="partialGenerator.maskPeriod - 1" :step="1" @update:modelValue="updatePartialGenerator({ maskOffset: $event })" />
              </v-col>
              <v-col v-if="partialGenerator.mask !== 'none'" cols="12">
                <v-switch :model-value="partialGenerator.invertMask" label="Invert harmonic mask" density="compact" hide-details @update:modelValue="updatePartialGenerator({ invertMask: Boolean($event) })" />
              </v-col>
              <v-col cols="12" md="6">
                <EditableSlider :model-value="partialGenerator.tilt" :label="`Spectral tilt (${partialGenerator.tilt.toFixed(1)} dB/oct)`" :min="-24" :max="24" :step="0.5" @update:modelValue="updatePartialGenerator({ tilt: $event })" />
              </v-col>
              <v-col cols="12" md="6">
                <EditableSlider :model-value="partialGenerator.contrast" :label="`Spectral contrast (${partialGenerator.contrast.toFixed(2)})`" :min="0.25" :max="4" :step="0.05" @update:modelValue="updatePartialGenerator({ contrast: $event })" />
              </v-col>
              <v-col cols="12" md="8">
                <EditableSlider :model-value="partialGenerator.oddEvenBalance" :label="`Odd/even balance (${partialGenerator.oddEvenBalance.toFixed(1)} dB; + favors even)`" :min="-24" :max="24" :step="0.5" @update:modelValue="updatePartialGenerator({ oddEvenBalance: $event })" />
              </v-col>
              <v-col cols="12" md="4">
                <v-switch :model-value="partialGenerator.normalize" label="Peak normalization" density="compact" hide-details @update:modelValue="updatePartialGenerator({ normalize: Boolean($event) })" />
              </v-col>
            </v-row>
            <p class="text-caption text-medium-emphasis mt-2">Harmonic limit/mask → contrast → tilt and odd/even balance → optional peak normalization. Contrast below 1 flattens magnitudes; above 1 emphasizes strong partials. Signs and silent harmonics are preserved. Positive tilt brightens; negative tilt darkens. Strong boosts can increase level; normalization sets the largest partial magnitude to 1, not the output loudness.</p>
          </template>
          <v-row v-if="partialGenerator.type === 'tonewheel'" class="compact-row">
            <v-col v-for="(label, index) in tonewheelDrawbarLabels" :key="label" cols="12" sm="6" md="4">
              <EditableSlider :label="label + ' Drawbar (' + editableTonewheelDrawbars[index] + ')'" :min="0" :max="8" :step="1" v-model="editableTonewheelDrawbars[index]" @update:modelValue="handleWavetableMorphChange" />
            </v-col>
          </v-row>
          <figure class="partial-spectrum">
            <figcaption class="text-subtitle-2">{{ draftTrack.synthMode === 'partial-bank' ? 'Static partial positions' : 'Static harmonic spectrum preview' }}</figcaption>
            <svg viewBox="0 0 640 150" role="img" :aria-label="partialSpectrumDescription">
              <title>{{ partialSpectrumDescription }}</title>
              <desc>{{ partialSpectrumDescription }}</desc>
              <g v-for="tick in spectrumTicks" :key="tick.db">
                <line x1="48" :y1="tick.y" x2="624" :y2="tick.y" class="spectrum-grid" />
                <text x="42" :y="tick.y + 4" text-anchor="end">{{ tick.db }}</text>
              </g>
              <line x1="48" y1="120" x2="624" y2="120" class="spectrum-axis" />
              <line x1="48" y1="12" x2="48" y2="120" class="spectrum-axis" />
              <line v-for="(bar, index) in partialSpectrumBars" :key="index" :x1="bar.x" :x2="bar.x" :y1="bar.y" y2="120" class="spectrum-bar">
                <title>{{ bar.harmonic }}× fundamental: {{ bar.amplitude.toPrecision(3) }} ({{ bar.decibels.toFixed(1) }} dB relative to peak)</title>
              </line>
              <text x="48" y="140">0</text>
              <text x="328" y="140" text-anchor="middle">Frequency / musical fundamental</text>
              <text x="624" y="140" text-anchor="end">{{ partialSpectrumMaximum.toFixed(2) }}×</text>
            </svg>
            <p v-if="partialSpectrumPeak === 0" class="text-caption" role="status">Silent spectrum: all partial amplitudes are zero. Adjust the source settings to generate sound.</p>
            <p class="text-caption text-medium-emphasis">Magnitude in dB relative to peak ({{ partialSpectrumPeak.toPrecision(3) }}); partials below −60 dB are hidden. {{ draftTrack.tonewheelWavetable.enabled ? 'Selected configuration only, without morphing or LFO motion' : 'Static source only' }}, breath noise, envelopes, effects, and pitch-dependent band limiting are omitted.</p>
          </figure>
          <v-row class="compact-row">
            <v-col cols="12" md="4">
              <v-switch v-model="draftTrack.breathEnabled" label="Breath noise" hide-details density="compact" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="4">
              <EditableSlider v-model="draftTrack.breathLevel" :label="`Breath level (${Number(draftTrack.breathLevel).toFixed(1)} dB)`" :min="-60" :max="0" :step="0.5" :disabled="!draftTrack.breathEnabled" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="4">
              <EditableSlider v-model="draftTrack.breathHarmonic" :label="`Breath harmonic (${Number(draftTrack.breathHarmonic).toFixed(1)}x)`" :min="0.5" :max="8" :step="0.5" :disabled="!draftTrack.breathEnabled" @update:modelValue="handleTrackDraftChange" />
            </v-col>
          </v-row>
          <template v-if="draftTrack.tonewheelWavetable.enabled">
            <v-row v-for="(dimension, dimensionIndex) in draftTrack.tonewheelWavetable.dimensions" :key="dimensionIndex" class="compact-row">
              <v-col cols="12" md="4">
                <v-text-field v-model="dimension.name" :label="`Axis ${dimensionIndex + 1}`" density="compact" variant="outlined" hide-details @change="handleTrackDraftChange" />
              </v-col>
              <v-col cols="10" md="7">
                <EditableSlider :label="`${dimension.name} (${Math.round(dimension.value * 100)}%)`" :min="0" :max="1" :step="0.01" v-model="dimension.value" @update:modelValue="handleWavetableMorphChange" />
              </v-col>
              <v-col cols="2" md="1">
                <v-btn icon="mdi-delete-outline" size="small" variant="text" :aria-label="`Remove ${dimension.name}`" @click="removeWavetableDimension(dimensionIndex)" />
              </v-col>
            </v-row>
            <v-row>
              <v-col cols="12" md="6">
                <v-btn prepend-icon="mdi-axis-arrow" variant="outlined" block @click="addWavetableDimension">Add morph axis</v-btn>
              </v-col>
              <v-col cols="12" md="6">
                <v-btn prepend-icon="mdi-content-save-plus-outline" variant="outlined" block @click="addWavetableConfiguration">Capture configuration here</v-btn>
              </v-col>
            </v-row>
            <v-row v-if="selectedTonewheelConfiguration">
              <v-col cols="12">
                <v-btn prepend-icon="mdi-delete-outline" variant="outlined" block :disabled="draftTrack.tonewheelWavetable.configurations.length <= 1" @click="removeSelectedWavetableConfiguration">Remove</v-btn>
              </v-col>
              <v-col cols="12">
                <v-text-field v-model="selectedTonewheelConfiguration.name" label="Configuration name" density="compact" variant="outlined" hide-details @change="handleTrackDraftChange" />
              </v-col>
              <v-col v-for="(dimension, dimensionIndex) in draftTrack.tonewheelWavetable.dimensions" :key="`position-${dimensionIndex}`" cols="12" md="6">
                <EditableSlider
                  :label="`${dimension.name} position (${Math.round(selectedTonewheelConfiguration.position[dimensionIndex] * 100)}%)`"
                  :min="0"
                  :max="1"
                  :step="0.01"
                  v-model="selectedTonewheelConfiguration.position[dimensionIndex]"
                  @update:modelValue="handleWavetableMorphChange"
                />
              </v-col>
            </v-row>
          </template>
          </template>
        </v-window-item>

        <v-window-item v-if="!midiOutput && draftTrack.trackKind !== 'rhythmic'" value="unison" class="control-tab-panel">
          <div class="envelope-section-label">Polyphony</div>
          <v-row class="compact-row">
            <v-col cols="12" md="6">
              <EditableSlider :label="'Voices (' + (draftTrack.polyphony <= 1 ? 'mono' : draftTrack.polyphony) + ')'" :min="1" :max="maxTrackPolyphony" :step="1" v-model="draftTrack.polyphony" @update:modelValue="handleTrackDraftChange" />
            </v-col>
          </v-row>

          <div class="envelope-section-label envelope-section-label--spaced">Glide (monophonic only)</div>
          <v-row class="compact-row">
            <v-col cols="12" md="6">
              <EditableSlider
                :label="'Glide Time (' + Number(draftTrack.glideTime).toFixed(3) + (draftTrack.glideConstantRate ? 's / octave)' : 's)')"
                :min="0"
                :max="5"
                :step="0.001"
                v-model="draftTrack.glideTime"
                :disabled="draftTrack.polyphony > 1"
                @update:modelValue="handleTrackDraftChange"
              />
            </v-col>
            <v-col cols="12" md="3">
              <v-select
                v-model="draftTrack.glideMode"
                label="Glide Mode"
                :items="glideModeOptions"
                :disabled="draftTrack.polyphony > 1"
                hide-details="auto"
                density="comfortable"
                variant="outlined"
                @update:modelValue="handleTrackDraftChange"
              />
            </v-col>
            <v-col cols="12" md="3">
              <v-select
                v-model="draftTrack.glideCurve"
                label="Glide Curve"
                :items="glideCurveOptions"
                :disabled="draftTrack.polyphony > 1"
                hide-details="auto"
                density="comfortable"
                variant="outlined"
                @update:modelValue="handleTrackDraftChange"
              />
            </v-col>
          </v-row>
          <v-row class="compact-row">
            <v-col cols="12" md="6">
              <v-switch v-model="draftTrack.glideConstantRate" label="Constant Rate (time per octave)" :disabled="draftTrack.polyphony > 1" hide-details density="compact" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="6">
              <v-switch v-model="draftTrack.monoLegato" label="Legato (overlapping notes keep the envelopes)" :disabled="draftTrack.polyphony > 1" hide-details density="compact" @update:modelValue="handleTrackDraftChange" />
            </v-col>
          </v-row>

          <div v-if="!draftTrack.synthMode || ['additive', 'partial-bank'].includes(draftTrack.synthMode)" class="envelope-section-label envelope-section-label--spaced">Unison</div>
          <v-row v-if="!draftTrack.synthMode || ['additive', 'partial-bank'].includes(draftTrack.synthMode)" class="compact-row">
            <v-col cols="12" md="6">
              <EditableSlider :label="'Unison Voices (' + draftTrack.unisonVoices + ')'" :min="1" :max="8" :step="1" v-model="draftTrack.unisonVoices" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="6">
              <EditableSlider :label="'Unison Detune (' + Number(draftTrack.unisonDetune).toFixed(0) + ' cents)'" :min="0" :max="100" :step="1" v-model="draftTrack.unisonDetune" @update:modelValue="handleTrackDraftChange" />
            </v-col>
          </v-row>
        </v-window-item>

        <v-window-item v-if="!midiOutput" value="modulation" class="control-tab-panel">
          <TrackModulationControls :track="draftTrack" @update:track="draftTrack = $event; handleTrackDraftChange()" />
        </v-window-item>

        <v-window-item v-if="!midiOutput" value="drive" class="control-tab-panel">
          <WaveshaperControls v-model="draftTrack.waveshaper" @update:modelValue="handleTrackDraftChange" />
          <v-divider class="my-4" />
          <EditableSlider :label="'Tanh Drive (' + Number(draftTrack.limiterGain).toFixed(1) + ' dB before tanh)'" :min="-48" :max="72" :step="0.1" v-model="draftTrack.limiterGain" @update:modelValue="handleTrackDraftChange" />
        </v-window-item>

        <v-window-item v-if="!midiOutput" value="chorus" class="control-tab-panel">
          <p class="text-caption text-medium-emphasis mb-3">LFO controls are in Modulation.</p>
          <v-row>
            <v-col cols="12" md="6">
              <v-switch v-model="draftTrack.chorusEnabled" label="Enable Chorus" hide-details density="compact" @update:modelValue="handleTrackDraftChange" />
            </v-col>
          </v-row>
          <v-row class="compact-row">
            <v-col cols="12" md="4">
              <EditableSlider :label="'Chorus Delay (' + Number(draftTrack.chorusDelay).toFixed(2) + ' ms)'" :min="0.5" :max="20" :step="0.05" v-model="draftTrack.chorusDelay" @update:modelValue="handleTrackDraftChange" />
            </v-col>
          </v-row>
          <v-row class="compact-row">
            <v-col cols="12" md="6">
              <EditableSlider :label="'Chorus Feedback (' + Number(draftTrack.chorusFeedback).toFixed(2) + ')'" :min="0" :max="0.95" :step="0.01" v-model="draftTrack.chorusFeedback" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="6">
              <EditableSlider :label="'Chorus Wet (' + Number(draftTrack.chorusWet).toFixed(1) + ' dB)'" :min="-96" :max="0" :step="0.1" v-model="draftTrack.chorusWet" @update:modelValue="handleTrackDraftChange" />
            </v-col>
          </v-row>
        </v-window-item>

        <v-window-item v-if="!midiOutput" value="flanger" class="control-tab-panel">
          <p class="text-caption text-medium-emphasis mb-3">LFO controls are in Modulation.</p>
          <v-row>
            <v-col cols="12" md="6">
              <v-switch v-model="draftTrack.flangerEnabled" label="Enable Flanger" hide-details density="compact" @update:modelValue="handleTrackDraftChange" />
            </v-col>
          </v-row>
          <v-row class="compact-row">
            <v-col cols="12" md="4">
              <EditableSlider :label="'Flanger Delay (' + Number(draftTrack.flangerDelay).toFixed(2) + ' ms)'" :min="0.1" :max="20" :step="0.05" v-model="draftTrack.flangerDelay" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="4">
              <EditableSlider :label="'Flanger Feedback (' + Number(draftTrack.flangerFeedback).toFixed(2) + ')'" :min="0" :max="0.95" :step="0.01" v-model="draftTrack.flangerFeedback" @update:modelValue="handleTrackDraftChange" />
            </v-col>
          </v-row>
          <v-row class="compact-row">
            <v-col cols="12" md="6">
              <EditableSlider :label="'Flanger Wet (' + Number(draftTrack.flangerWet).toFixed(1) + ' dB)'" :min="-96" :max="0" :step="0.1" v-model="draftTrack.flangerWet" @update:modelValue="handleTrackDraftChange" />
            </v-col>
          </v-row>
        </v-window-item>

        <v-window-item v-if="!midiOutput" value="phaser" class="control-tab-panel">
          <p class="text-caption text-medium-emphasis mb-3">LFO controls are in Modulation.</p>
          <v-row>
            <v-col cols="12" md="6">
              <v-switch v-model="draftTrack.phaserEnabled" label="Enable Phaser" hide-details density="compact" @update:modelValue="handleTrackDraftChange" />
            </v-col>
          </v-row>
          <v-row class="compact-row">
            <v-col cols="12" md="4">
              <v-select
                v-model="draftTrack.phaserStages"
                label="Phaser Stages"
                :items="phaserStageOptions"
                hide-details
                density="comfortable"
                variant="outlined"
                @update:modelValue="handleTrackDraftChange"
              />
            </v-col>
            <v-col cols="12" md="4">
              <EditableSlider :label="'Phaser Center (' + Number(draftTrack.phaserCenter).toFixed(2) + ' MIDI)'" :min="0" :max="127" :step="0.01" v-model="draftTrack.phaserCenter" @update:modelValue="handleTrackDraftChange" />
            </v-col>
          </v-row>
          <v-row class="compact-row">
            <v-col cols="12" md="4">
              <EditableSlider :label="'Phaser Feedback (' + Number(draftTrack.phaserFeedback).toFixed(2) + ')'" :min="0" :max="0.95" :step="0.01" v-model="draftTrack.phaserFeedback" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="4">
              <EditableSlider :label="'Phaser Resonance (' + Number(draftTrack.phaserQ).toFixed(2) + ')'" :min="0.01" :max="30" :step="0.01" v-model="draftTrack.phaserQ" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="4">
              <EditableSlider :label="'Phaser Wet (' + Number(draftTrack.phaserWet).toFixed(1) + ' dB)'" :min="-96" :max="0" :step="0.1" v-model="draftTrack.phaserWet" @update:modelValue="handleTrackDraftChange" />
            </v-col>
          </v-row>
        </v-window-item>

        <v-window-item v-if="!midiOutput" value="filter" class="control-tab-panel">
          <p class="text-caption text-medium-emphasis mb-3">Cutoff envelopes and LFO controls are in Modulation.</p>
          <v-row>
            <v-col cols="12" md="6">
              <v-switch v-model="draftTrack.filterEnabled" label="Enable Filter" hide-details density="compact" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="6">
              <v-select v-model="draftTrack.filterType" label="Filter Mode" :items="['lowpass', 'highpass', 'bandpass', 'lowshelf', 'highshelf', 'notch', 'allpass', 'peaking']" hide-details density="comfortable" variant="outlined" @update:modelValue="handleTrackDraftChange" />
            </v-col>
          </v-row>
          <v-row class="compact-row">
            <v-col cols="12" md="4">
              <EditableSlider :label="'Cutoff/Base (' + Number(draftTrack.filterFrequency).toFixed(2) + ' MIDI)'" :min="0" :max="127" :step="0.01" v-model="draftTrack.filterFrequency" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="4">
              <EditableSlider :label="'Q (' + Number(draftTrack.filterQ).toFixed(2) + ')'" :min="0.01" :max="30" :step="0.01" v-model="draftTrack.filterQ" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="4">
              <EditableSlider :label="'Key Follow (' + Number(draftTrack.filterKeyFollow).toFixed(0) + '%)'" :min="-200" :max="200" :step="1" v-model="draftTrack.filterKeyFollow" @update:modelValue="handleTrackDraftChange" />
            </v-col>
          </v-row>
          <v-row class="compact-row">
            <v-col cols="12" md="6">
              <EditableSlider :label="'Filter Gain (' + Number(draftTrack.filterGain).toFixed(1) + ' dB)'" :min="-48" :max="48" :step="0.1" v-model="draftTrack.filterGain" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="6">
              <v-select v-model="draftTrack.filterRolloff" label="Rolloff" :items="[-12, -24, -48, -96]" hide-details density="comfortable" variant="outlined" @update:modelValue="handleTrackDraftChange" />
            </v-col>
          </v-row>
        </v-window-item>

        <v-window-item v-if="!midiOutput" value="effects" class="control-tab-panel">
          <v-row>
            <v-col cols="12" md="6">
              <v-switch v-model="draftTrack.echoEnabled" label="Feedback Stereo Echo" hide-details density="compact" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="6">
              <v-switch v-model="draftTrack.echoPingPong" label="Ping-pong echo" hide-details density="compact" @update:modelValue="handleTrackDraftChange" />
            </v-col>
          </v-row>
          <v-row class="compact-row">
            <v-col cols="12" md="4">
              <v-select v-model="draftTrack.echoDelay" label="Echo Delay" :items="echoDelayOptions" hide-details density="comfortable" variant="outlined" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="4">
              <EditableSlider :label="'Echo Feedback (' + Number(draftTrack.echoFeedback).toFixed(2) + ')'" :min="0" :max="0.95" :step="0.01" v-model="draftTrack.echoFeedback" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="4">
              <EditableSlider :label="'Echo Wet (' + Number(draftTrack.echoWet).toFixed(1) + ' dB)'" :min="-96" :max="0" :step="0.1" v-model="draftTrack.echoWet" @update:modelValue="handleTrackDraftChange" />
            </v-col>
          </v-row>
          <v-row class="compact-row">
            <v-col cols="12" md="6">
              <EditableSlider :label="'Track Reverb Send (' + Number(draftTrack.reverbWet).toFixed(1) + ' dB)'" :min="-96" :max="0" :step="0.1" v-model="draftTrack.reverbWet" @update:modelValue="handleTrackDraftChange" />
            </v-col>
          </v-row>
        </v-window-item>

        <v-window-item v-if="!midiOutput" value="reverb" class="control-tab-panel">
          <ReverbControls
            v-model:enabled="draftReverb.enabled"
            v-model:decay="draftReverb.decay"
            v-model:pre-delay="draftReverb.preDelay"
            v-model:dry="draftReverb.dry"
            v-model:wet="draftReverb.wet"
            v-model:low-cut="draftReverb.lowCut"
            v-model:high-cut="draftReverb.highCut"
            @change="handleReverbDraftChange"
          />
        </v-window-item>
      </v-window>
    </div>
  </v-responsive>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import EditableSlider from './EditableSlider.vue';
import SynthEngineControls from './SynthEngineControls.vue';
import TrackModulationControls from './TrackModulationControls.vue';
import type { SynthEngineSettings } from '../audio/synthEngine';
import ReverbControls from './ReverbControls.vue';
import RhythmTrackControls from './RhythmTrackControls.vue';
import RhythmSoundControls from './RhythmSoundControls.vue';
import TimeWarpPreview from './TimeWarpPreview.vue';
import WaveshaperControls from './WaveshaperControls.vue';
import { compileBankPosition, normalizePartialBank, normalizeBankAmplitudes } from '../audio/partialBank';
import { emptyModulationValues } from '../audio/modulation';
import { generatePartialSpectrum, normalizePartialGenerator, type NormalizedPartialGenerator } from '../audio/partialGenerator';
import {
  interpolateTonewheelDrawbars,
  MAX_WAVETABLE_CONFIGURATIONS,
  MAX_WAVETABLE_DIMENSIONS,
  type TonewheelConfiguration,
} from '../audio/tonewheelWavetable';
import type { PartialSourceSnapshot } from '../audio/partialWavetable';
import { getSpectrumPreview } from '../audio/spectrumPreview';
import {
  CUSTOM_TIME_WARP_CURVE,
  TIME_WARP_CURVE_OPTIONS,
  TIME_WARP_QUANTIZE_OPTIONS,
  resolveTimeWarpFunction,
  sampleWarpCurve,
} from '../audio/timeWarp';
import {
  clonePresetTrackData,
  DEFAULT_PRESET_TRACK_DATA,
  ECHO_DELAY_OPTIONS,
  MAX_TRACK_POLYPHONY,
  PHASER_STAGE_OPTIONS,
  TONEWHEEL_DRAWBAR_LABELS,
  WAVEFORM_OPTIONS,
  type PresetReverbData,
  type PresetTrackData,
} from '../presets';

function makeTimeWarpCurvePath(curve: string, expression = ''): string {
  const samples = sampleWarpCurve(resolveTimeWarpFunction(curve, expression).fn, 1, 49);
  return samples.map((value, index) => {
    const x = (index / (samples.length - 1)) * 96;
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${(36 - value * 36).toFixed(1)}`;
  }).join(' ');
}

const builtinTimeWarpCurvePaths = new Map(
  TIME_WARP_CURVE_OPTIONS.map(({ value }) => [value, makeTimeWarpCurvePath(value)]),
);

export default defineComponent({
  name: 'EditorSurface',
  components: {
    EditableSlider,
    SynthEngineControls,
    TrackModulationControls,
    ReverbControls,
    RhythmTrackControls,
    RhythmSoundControls,
    TimeWarpPreview,
    WaveshaperControls,
  },
  props: {
    track: {
      type: Object as PropType<PresetTrackData | null>,
      default: null,
    },
    reverb: {
      type: Object as PropType<PresetReverbData>,
      required: true,
    },
    bpm: {
      type: Number,
      required: true,
    },
    midiOutput: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['track-change', 'reverb-change'],
  data() {
    return {
      draftTrack: clonePresetTrackData(this.track ?? DEFAULT_PRESET_TRACK_DATA),
      draftReverb: { ...this.reverb },
      tonewheelDrawbarLabels: TONEWHEEL_DRAWBAR_LABELS,
      echoDelayOptions: ECHO_DELAY_OPTIONS,
      phaserStageOptions: [...PHASER_STAGE_OPTIONS] as number[],
      waveformOptions: WAVEFORM_OPTIONS,
      partialSourceOptions: [
        { title: 'Tonewheel (drawbars)', value: 'tonewheel' },
        { title: 'Waveform (Fourier / frozen spectrum)', value: 'waveform' },
        { title: 'Sequence', value: 'sequence' },
        { title: 'Binary', value: 'binary' },
      ],
      spectrumTicks: [0, -20, -40, -60].map((db) => ({ db, y: 16 - db / 60 * 104 })),
      partialSequenceOptions: [
        { title: 'Natural (1, 2, 3, …)', value: 'natural' },
        { title: 'Fibonacci (1, 1, 2, …)', value: 'fibonacci' },
        { title: 'Primes (2, 3, 5, …)', value: 'primes' },
        { title: 'Powers of two (1, 2, 4, …)', value: 'powers-of-two' },
        { title: 'Thue–Morse (0, 1, 1, 0, …)', value: 'thue-morse' },
        { title: 'Triangular (1, 3, 6, 10, …)', value: 'triangular' },
        { title: 'Lucas (2, 1, 3, 4, …)', value: 'lucas' },
        { title: 'Divisor count (1, 2, 2, 3, …)', value: 'divisor-count' },
        { title: 'Stern diatomic (1, 1, 2, 1, …)', value: 'stern-diatomic' },
        { title: 'Euler totient (1, 1, 2, 2, …)', value: 'euler-totient' },
        { title: 'Recamán (0, 1, 3, 6, …)', value: 'recaman' },
      ],
      partialBinaryModeOptions: [
        { title: 'Popcount (number of set bits)', value: 'popcount' },
        { title: 'Parity (popcount modulo 2)', value: 'parity' },
        { title: 'Selected bit', value: 'bit' },
        { title: 'Gray code (0, 1, 3, 2, …)', value: 'gray-code' },
        { title: 'Gray popcount (0, 1, 2, 1, …)', value: 'gray-popcount' },
        { title: 'Bit length (0, 1, 2, 2, …)', value: 'bit-length' },
        { title: 'Ruler (0, 1, 0, 2, …)', value: 'ruler' },
        { title: 'Longest one-run (0, 1, 1, 2, …)', value: 'longest-one-run' },
        { title: 'One-run count (0, 1, 1, 1, …)', value: 'one-run-count' },
        { title: 'Rudin–Shapiro (0, 0, 0, 1, …)', value: 'rudin-shapiro' },
        { title: 'Bit reversal', value: 'bit-reversal' },
      ],
      partialMappingOptions: [
        { title: 'Linear', value: 'linear' },
        { title: 'Power', value: 'power' },
        { title: 'Square root', value: 'sqrt' },
        { title: 'Inverse (zeros stay zero)', value: 'inverse' },
        { title: 'Logarithmic (log₂(1 + value))', value: 'logarithmic' },
        { title: 'Inverse square root (zeros stay zero)', value: 'inverse-sqrt' },
        { title: 'Saturating (value / (1 + value))', value: 'saturating' },
        { title: 'Modulo (raw remainder)', value: 'modulo' },
      ],
      partialMaskOptions: [
        { title: 'None', value: 'none' },
        { title: 'Odd harmonics', value: 'odd' },
        { title: 'Even harmonics', value: 'even' },
        { title: 'Prime harmonics', value: 'prime' },
        { title: 'Fibonacci harmonics', value: 'fibonacci' },
        { title: 'Power-of-two harmonics', value: 'power-of-two' },
        { title: 'Square harmonics', value: 'square' },
        { title: 'Triangular harmonics', value: 'triangular' },
        { title: 'Thue–Morse harmonics', value: 'thue-morse' },
        { title: 'Periodic comb', value: 'periodic' },
      ],
      maxTrackPolyphony: MAX_TRACK_POLYPHONY,
      glideModeOptions: [
        { title: 'Legato (overlapping notes)', value: 'legato' },
        { title: 'Always', value: 'always' },
      ],
      glideCurveOptions: [
        { title: 'Exponential (constant cents/s)', value: 'exponential' },
        { title: 'Linear (constant Hz/s)', value: 'linear' },
      ],
      customTimeWarpCurve: CUSTOM_TIME_WARP_CURVE,
      timeWarpCurveOptions: [
        { title: 'Custom expression', value: CUSTOM_TIME_WARP_CURVE },
        ...TIME_WARP_CURVE_OPTIONS.map((option) => ({
          title: `${option.group} - ${option.title}`,
          value: option.value,
        })).sort((left, right) => left.title.localeCompare(right.title, undefined, { numeric: true })),
      ],
      timeWarpQuantizeOptions: TIME_WARP_QUANTIZE_OPTIONS.map((value) => ({
        title: value === 0 ? 'Off' : `${value} subdivisions per step`,
        value,
      })),
      activeControlTab: 'sequence' as string,
      selectedTonewheelConfigurationIndex: 0,
    };
  },
  computed: {
    partialGenerator(): NormalizedPartialGenerator {
      const selectedSource = this.draftTrack.tonewheelWavetable.enabled
        ? this.draftTrack.tonewheelWavetable.configurations[this.selectedTonewheelConfigurationIndex]?.source
        : undefined;
      return normalizePartialGenerator(selectedSource?.partialGenerator ?? this.draftTrack.partialGenerator);
    },
    partialWaveform(): string {
      const selectedSource = this.draftTrack.tonewheelWavetable.enabled
        ? this.draftTrack.tonewheelWavetable.configurations[this.selectedTonewheelConfigurationIndex]?.source
        : undefined;
      return selectedSource?.waveform ?? this.draftTrack.waveform;
    },
    editableTonewheelDrawbars(): number[] {
      if (!this.draftTrack.tonewheelWavetable.enabled) return this.draftTrack.tonewheelDrawbars;
      const configuration = this.draftTrack.tonewheelWavetable.configurations[this.selectedTonewheelConfigurationIndex];
      return configuration?.source?.tonewheelDrawbars ?? configuration?.drawbars ?? this.draftTrack.tonewheelDrawbars;
    },
    availableWaveformOptions(): ReadonlyArray<(typeof WAVEFORM_OPTIONS)[number]> {
      return WAVEFORM_OPTIONS;
    },
    partialSpectrum(): number[] {
      return generatePartialSpectrum(this.partialGenerator, this.partialWaveform, this.editableTonewheelDrawbars);
    },
    partialSpectrumPreview() {
      if (this.draftTrack.synthMode !== 'partial-bank') return getSpectrumPreview(this.partialSpectrum);
      const position = compileBankPosition(normalizePartialBank(this.draftTrack.partialBank));
      const modulation = emptyModulationValues();
      const amplitudes = normalizeBankAmplitudes(this.partialSpectrum)
        .map((amplitude, i) => position((i + 1) / 2, modulation) > 0 ? amplitude : 0);
      const preview = getSpectrumPreview(amplitudes);
      const bars = preview.bars.map(bar => ({ ...bar, harmonic: position(bar.harmonic, modulation) })).filter(bar => bar.harmonic > 0);
      const maximum = Math.max(1, ...bars.map(bar => bar.harmonic));
      return { ...preview, bars: bars.map(bar => ({ ...bar, x: 48 + bar.harmonic / maximum * 576 })) };
    },
    partialSpectrumMaximum(): number {
      return this.draftTrack.synthMode === 'partial-bank'
        ? Math.max(1, ...this.partialSpectrumPreview.bars.map(bar => bar.harmonic)) : this.partialSpectrum.length / 2;
    },
    partialSpectrumPeak(): number {
      return this.partialSpectrumPreview.peak;
    },
    partialSpectrumBars() {
      return this.partialSpectrumPreview.bars;
    },
    partialSpectrumDescription(): string {
      const source = this.partialGenerator.type === 'waveform' ? this.partialWaveform : this.partialGenerator.type;
      return `Static ${source} spectrum. ${this.partialSpectrumBars.length} visible partials; peak amplitude ${this.partialSpectrumPeak.toPrecision(3)}. Magnitude from 0 to -60 dB relative to peak. Frequencies are multiples of the musical fundamental.`;
    },
    selectedTrackSequenceLength(): number {
      return this.parseSequence(this.draftTrack.sequenceInput).length;
    },
    timeWarpExpressionError(): string {
      if (!this.draftTrack.timeWarpEnabled || this.draftTrack.timeWarpCurve !== CUSTOM_TIME_WARP_CURVE) {
        return '';
      }

      const resolution = resolveTimeWarpFunction(this.draftTrack.timeWarpCurve, this.draftTrack.timeWarpExpression);
      return resolution.error ?? '';
    },
    selectedTonewheelConfiguration(): TonewheelConfiguration | null {
      return this.draftTrack.tonewheelWavetable.configurations[this.selectedTonewheelConfigurationIndex] ?? null;
    },
    tonewheelConfigurationOptions(): Array<{ title: string; value: number }> {
      return this.draftTrack.tonewheelWavetable.configurations.map((configuration, index) => ({
        title: `${configuration.name} · ${configuration.position.map((value) => Math.round(value * 100)).join(' / ')}%`,
        value: index,
      }));
    },
  },
  watch: {
    midiOutput(enabled: boolean) {
      if (enabled && !['sequence', 'playback', 'time-warp'].includes(this.activeControlTab)) {
        this.activeControlTab = 'sequence';
      }
    },
    track: {
      deep: true,
      immediate: true,
      handler(nextTrack: PresetTrackData | null) {
        if (nextTrack) {
          const trackKindChanged = nextTrack.trackKind !== this.draftTrack.trackKind;
          this.draftTrack = clonePresetTrackData(nextTrack);
          this.selectedTonewheelConfigurationIndex = Math.min(
            this.selectedTonewheelConfigurationIndex,
            Math.max(0, this.draftTrack.tonewheelWavetable.configurations.length - 1),
          );
          if (trackKindChanged) {
            this.activeControlTab = 'sequence';
          }
        }
      },
    },
    reverb: {
      deep: true,
      immediate: true,
      handler(nextReverb: PresetReverbData) {
        this.draftReverb = { ...nextReverb };
      },
    },
  },
  methods: {
    timeWarpCurvePath(curve: string): string {
      return curve === CUSTOM_TIME_WARP_CURVE
        ? makeTimeWarpCurvePath(curve, this.draftTrack.timeWarpExpression)
        : (builtinTimeWarpCurvePaths.get(curve) ?? '');
    },
    handleSynthEngineChange(settings: SynthEngineSettings) {
      Object.assign(this.draftTrack, settings);
      if (['additive', 'partial-bank'].includes(settings.synthMode) && !WAVEFORM_OPTIONS.some(option => option.value === this.draftTrack.waveform)) {
        this.draftTrack.waveform = 'sine';
      }
      this.handleTrackDraftChange();
    },
    setPartialSource(type: NormalizedPartialGenerator['type']) {
      this.updatePartialGenerator({ type });
    },
    updatePartialGenerator(change: Record<string, unknown>) {
      const partialGenerator = normalizePartialGenerator({ ...this.partialGenerator, ...change });
      const configuration = this.draftTrack.tonewheelWavetable.enabled
        ? this.draftTrack.tonewheelWavetable.configurations[this.selectedTonewheelConfigurationIndex]
        : undefined;
      if (configuration) {
        configuration.source = {
          partialGenerator,
          waveform: configuration.source?.waveform ?? this.draftTrack.waveform,
          tonewheelDrawbars: (configuration.source?.tonewheelDrawbars ?? configuration.drawbars).slice(),
        };
      } else {
        this.draftTrack.partialGenerator = partialGenerator;
      }
      this.handleTrackDraftChange();
    },
    updatePartialWaveform(waveform: string) {
      const configuration = this.draftTrack.tonewheelWavetable.enabled
        ? this.draftTrack.tonewheelWavetable.configurations[this.selectedTonewheelConfigurationIndex]
        : undefined;
      if (configuration?.source) configuration.source.waveform = waveform;
      else this.draftTrack.waveform = waveform;
      this.handleTrackDraftChange();
    },
    parseSequence(sequenceInput: string): number[] {
      return sequenceInput
        .trim()
        .split(/\s+/)
        .map((value: string) => Number.parseInt(value.trim(), 10))
        .filter((value: number) => !Number.isNaN(value));
    },
    handleTrackDraftChange() {
      this.$emit('track-change', clonePresetTrackData(this.draftTrack));
    },
    setTonewheelWavetableEnabled(enabled: boolean) {
      const wavetable = this.draftTrack.tonewheelWavetable;
      if (enabled && wavetable.dimensions.length === 0) {
        const source: PartialSourceSnapshot = {
          partialGenerator: this.partialGenerator,
          waveform: this.partialWaveform,
          tonewheelDrawbars: this.draftTrack.tonewheelDrawbars.slice(),
        };
        wavetable.dimensions = [{ name: 'Brightness', value: 0 }];
        wavetable.configurations = [
          { name: 'Configuration 1', position: [0], drawbars: source.tonewheelDrawbars.slice(), source },
          { name: 'Configuration 2', position: [1], drawbars: source.tonewheelDrawbars.slice(), source: {
            ...source,
            partialGenerator: { ...source.partialGenerator },
            tonewheelDrawbars: source.tonewheelDrawbars.slice(),
          } },
        ];
      } else if (enabled && this.partialGenerator.type !== 'tonewheel'
        && !wavetable.configurations.some((configuration) => configuration.source)) {
        const source: PartialSourceSnapshot = {
          partialGenerator: { ...this.partialGenerator },
          waveform: this.partialWaveform,
          tonewheelDrawbars: this.draftTrack.tonewheelDrawbars.slice(),
        };
        wavetable.configurations.forEach((configuration) => {
          configuration.source = {
            ...source,
            partialGenerator: { ...source.partialGenerator },
            tonewheelDrawbars: source.tonewheelDrawbars.slice(),
          };
        });
      }
      wavetable.enabled = enabled;
      this.selectedTonewheelConfigurationIndex = 0;
      this.handleWavetableMorphChange();
    },
    addWavetableDimension() {
      const wavetable = this.draftTrack.tonewheelWavetable;
      if (wavetable.dimensions.length >= MAX_WAVETABLE_DIMENSIONS) {
        return;
      }
      wavetable.dimensions.push({ name: `Morph ${wavetable.dimensions.length + 1}`, value: 0.5 });
      wavetable.configurations.forEach((configuration) => configuration.position.push(0.5));
      wavetable.lfos.forEach((lfo) => lfo.routes.push(0));
      this.handleTrackDraftChange();
    },
    removeWavetableDimension(index: number) {
      const wavetable = this.draftTrack.tonewheelWavetable;
      if (wavetable.dimensions.length <= 1) {
        this.setTonewheelWavetableEnabled(false);
        return;
      }
      wavetable.dimensions.splice(index, 1);
      wavetable.configurations.forEach((configuration) => configuration.position.splice(index, 1));
      wavetable.lfos.forEach((lfo) => lfo.routes.splice(index, 1));
      this.handleWavetableMorphChange();
    },
    addWavetableConfiguration() {
      const wavetable = this.draftTrack.tonewheelWavetable;
      if (wavetable.configurations.length >= MAX_WAVETABLE_CONFIGURATIONS) {
        return;
      }
      const selected = wavetable.configurations[this.selectedTonewheelConfigurationIndex];
      const source: PartialSourceSnapshot = selected?.source ? {
        partialGenerator: { ...selected.source.partialGenerator },
        waveform: selected.source.waveform,
        tonewheelDrawbars: selected.source.tonewheelDrawbars.slice(),
      } : {
        partialGenerator: { type: 'tonewheel' },
        waveform: 'sine',
        tonewheelDrawbars: (selected?.drawbars ?? this.draftTrack.tonewheelDrawbars).slice(),
      };
      wavetable.configurations.push({
        name: `Configuration ${wavetable.configurations.length + 1}`,
        position: wavetable.dimensions.map((dimension) => dimension.value),
        drawbars: source.tonewheelDrawbars.slice(),
        source,
      });
      this.selectedTonewheelConfigurationIndex = wavetable.configurations.length - 1;
      this.handleTrackDraftChange();
    },
    removeSelectedWavetableConfiguration() {
      const configurations = this.draftTrack.tonewheelWavetable.configurations;
      if (configurations.length <= 1) {
        return;
      }
      configurations.splice(this.selectedTonewheelConfigurationIndex, 1);
      this.selectedTonewheelConfigurationIndex = Math.min(this.selectedTonewheelConfigurationIndex, configurations.length - 1);
      this.handleWavetableMorphChange();
    },
    handleWavetableMorphChange() {
      if (!this.draftTrack.tonewheelWavetable.configurations.some((configuration) => configuration.source)) {
        this.draftTrack.tonewheelDrawbars = interpolateTonewheelDrawbars(
          this.draftTrack.tonewheelWavetable,
          this.draftTrack.tonewheelDrawbars,
        );
      }
      this.handleTrackDraftChange();
    },
    handleReverbDraftChange() {
      this.$emit('reverb-change', { ...this.draftReverb });
    },
  },
});
</script>

<style scoped>
.time-warp-curve-option-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.time-warp-curve-option-content > span {
  overflow: hidden;
  text-overflow: ellipsis;
}

.time-warp-curve-option-graph {
  width: 96px;
  height: 36px;
  flex: none;
  background: var(--panel-inset);
}

.time-warp-curve-option-identity {
  fill: none;
  stroke: rgba(170, 167, 141, 0.45);
  stroke-dasharray: 3 3;
  stroke-width: 1;
}

.time-warp-curve-option-line {
  fill: none;
  stroke: #f2b84b;
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}

.partial-spectrum {
  margin: 16px 0;
}

.partial-spectrum svg {
  display: block;
  width: 100%;
  max-height: 190px;
  margin-block: 8px;
  color: var(--instrument-muted);
  background: var(--panel-deep);
}

.partial-spectrum text {
  fill: currentColor;
  font-size: 11px;
}

.spectrum-axis {
  stroke: currentColor;
  stroke-opacity: 0.5;
}

.spectrum-bar {
  stroke: var(--indicator-amber, #f2b84b);
  stroke-width: 2;
}

.spectrum-grid {
  stroke: currentColor;
  stroke-opacity: 0.15;
}

.editor-surface {
  width: min(1120px, calc(100vw - 20px));
  background: var(--panel-deep);
  border: 1px solid var(--panel-border-soft);
  border-radius: 0;
  box-shadow: inset 0 1px rgba(255, 245, 205, 0.05), 0 24px 40px rgba(0, 0, 0, 0.38);
}

.control-tabs-layout {
  display: grid;
  grid-template-columns: 188px minmax(0, 1fr);
  min-height: 470px;
  border: 1px solid var(--panel-border-soft);
  background: var(--panel-inset);
}

.control-tabs {
  border-right: 1px solid var(--panel-border-soft);
  background: var(--panel-raised);
}

.control-tabs :deep(.v-tab) {
  justify-content: flex-start;
  min-height: 44px;
  padding-inline: 14px;
  color: var(--instrument-muted);
}

.control-tabs :deep(.v-tab--selected) {
  color: #fff0c7;
  background: rgba(242, 184, 75, 0.15);
  box-shadow: inset 3px 0 var(--indicator-amber);
}

.control-tab-content {
  min-width: 0;
}

.control-tab-panel {
  padding: 12px 14px 6px;
}

.envelope-section-label {
  margin: 2px 0 8px;
  color: var(--indicator-amber);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.envelope-section-label--spaced {
  margin-top: 14px;
}

:deep(.v-btn),
:deep(.v-field),
:deep(.v-card),
:deep(.v-list),
:deep(.v-menu > .v-overlay__content),
:deep(.v-overlay__content),
:deep(.v-progress-linear),
:deep(.v-snackbar__wrapper) {
  border-radius: 0 !important;
}

.control-tab-panel :deep(.v-row) {
  margin-top: 0;
  margin-bottom: 7px;
}

.control-tab-panel :deep(.v-col) {
  padding-top: 2px;
  padding-bottom: 2px;
}

:deep(.v-label),
:deep(.v-field__input),
:deep(.v-select__selection-text),
:deep(.v-autocomplete__selection-text),
:deep(.v-list-item-title),
:deep(.v-switch__label) {
  color: var(--instrument-text) !important;
}

:deep(.v-field) {
  border-radius: 0;
  background: var(--panel-inset);
}

:deep(.v-field--variant-outlined .v-field__outline) {
  color: rgba(180, 177, 133, 0.58) !important;
}

:deep(.v-btn__content) {
  text-transform: none;
  letter-spacing: 0.015em;
}

.compact-row {
  margin-top: -4px;
}

@media (max-width: 960px) {
  .editor-surface {
    width: calc(100vw - 16px);
  }
}

@media (max-width: 680px) {
  .control-tabs-layout {
    grid-template-columns: minmax(0, 1fr);
    min-height: 0;
  }

  .control-tabs {
    border-right: none;
    border-bottom: 1px solid var(--panel-border-soft);
  }

  .control-tabs :deep(.v-slide-group__container) {
    overflow-x: auto;
  }

  .control-tabs :deep(.v-slide-group__content) {
    flex-wrap: nowrap;
  }

  .control-tabs :deep(.v-tab) {
    flex: 0 0 auto;
    min-height: 40px;
    padding-inline: 10px;
  }

  .control-tab-panel {
    padding: 10px 12px 5px;
  }

  .compact-row {
    margin-left: -12px;
    margin-right: -12px;
    padding-left: 12px;
    padding-right: 12px;
    touch-action: pan-y;
  }

  .compact-row :deep(.v-col) {
    padding-left: 0;
    padding-right: 0;
  }

  .compact-row :deep(.v-slider) {
    margin-left: 8px;
    margin-right: 8px;
  }

  .editor-surface {
    width: calc(100vw - 10px);
    border-radius: 0;
    padding: 12px !important;
  }

}
</style>
