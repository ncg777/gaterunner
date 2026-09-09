<template>
  <v-responsive class="editor-surface align-center mx-auto pa-2 pb-8">
    <div class="control-tabs-layout">
      <v-tabs v-model="activeControlTab" :direction="$vuetify.display.xs ? 'horizontal' : 'vertical'" class="control-tabs" color="primary">
        <v-tab value="sequence" prepend-icon="mdi-format-list-numbered">Sequence</v-tab>
        <v-tab v-if="draftTrack.trackKind === 'rhythmic'" value="drum-sounds" prepend-icon="mdi-album">Drum Sounds</v-tab>
        <v-tab value="playback" prepend-icon="mdi-play-circle-outline">Playback</v-tab>
        <v-tab value="time-warp" prepend-icon="mdi-chart-sankey">Time Warp</v-tab>
        <v-tab v-if="draftTrack.trackKind !== 'rhythmic'" value="generator" prepend-icon="mdi-sine-wave">Generator</v-tab>
        <v-tab v-if="draftTrack.trackKind !== 'rhythmic'" value="envelopes" prepend-icon="mdi-chart-bell-curve-cumulative">Envelopes</v-tab>
        <v-tab v-if="draftTrack.trackKind !== 'rhythmic'" value="unison" prepend-icon="mdi-account-voice">Voices &amp; Glide</v-tab>
        <v-tab value="modulation" prepend-icon="mdi-sine-wave">Tremolo/Vibrato</v-tab>
        <v-tab value="drive" prepend-icon="mdi-lightning-bolt-outline">Drive</v-tab>
        <v-tab value="chorus" prepend-icon="mdi-blur">Chorus</v-tab>
        <v-tab value="flanger" prepend-icon="mdi-waves">Flanger</v-tab>
        <v-tab value="phaser" prepend-icon="mdi-vector-curve">Phaser</v-tab>
        <v-tab value="filter" prepend-icon="mdi-filter-outline">Filter</v-tab>
        <v-tab value="effects" prepend-icon="mdi-waveform">Echo &amp; Sends</v-tab>
        <v-tab value="reverb" prepend-icon="mdi-weather-rainy">Global Reverb</v-tab>
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

        <v-window-item v-if="draftTrack.trackKind === 'rhythmic'" value="drum-sounds" class="control-tab-panel">
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

          <v-row class="compact-row">
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

          <v-row class="compact-row">
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

          <v-row class="compact-row">
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
              />
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

        <v-window-item v-if="draftTrack.trackKind !== 'rhythmic'" value="generator" class="control-tab-panel">
          <v-row>
            <v-col cols="12">
              <v-select
                v-model="draftTrack.waveform"
                label="Waveform"
                :items="waveformOptions"
                hide-details="auto"
                density="comfortable"
                variant="outlined"
                @update:modelValue="handleTrackDraftChange"
              />
            </v-col>
          </v-row>
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
          <v-row class="compact-row">
            <v-col cols="12">
              <v-switch
                :model-value="draftTrack.tonewheelWavetable.enabled"
                label="Multidimensional wavetable"
                hint="Morph between any number of tonewheel configurations across independent axes."
                persistent-hint
                density="compact"
                @update:modelValue="setTonewheelWavetableEnabled(Boolean($event))"
              />
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
              <v-col cols="12" md="8">
                <v-select
                  v-model="selectedTonewheelConfigurationIndex"
                  label="Configuration to edit"
                  :items="tonewheelConfigurationOptions"
                  density="comfortable"
                  variant="outlined"
                  hide-details
                />
              </v-col>
              <v-col cols="12" md="4">
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
              <v-col v-for="(label, index) in tonewheelDrawbarLabels" :key="label" cols="12" sm="6" md="4">
                <EditableSlider :label="`${label} Drawbar (${Number(selectedTonewheelConfiguration.drawbars[index]).toFixed(1)})`" :min="0" :max="8" :step="0.1" v-model="selectedTonewheelConfiguration.drawbars[index]" @update:modelValue="handleWavetableMorphChange" />
              </v-col>
            </v-row>
            <v-divider class="my-4" />
            <v-row align="center">
              <v-col>
                <div class="text-subtitle-1">Vector modulation</div>
                <div class="text-caption text-medium-emphasis">Route up to eight tempo-synced LFOs across every morph axis. Earlier LFOs can frequency-modulate later ones.</div>
              </v-col>
              <v-col cols="auto">
                <v-btn prepend-icon="mdi-sine-wave" variant="outlined" :disabled="draftTrack.tonewheelWavetable.lfos.length >= maxWavetableLfos" @click="addWavetableLfo">Add LFO</v-btn>
              </v-col>
            </v-row>
            <v-card v-for="(lfo, lfoIndex) in draftTrack.tonewheelWavetable.lfos" :key="`wavetable-lfo-${lfoIndex}`" variant="outlined" class="mb-3 pa-3">
              <v-row align="center" class="compact-row">
                <v-col cols="12" md="5">
                  <v-text-field v-model="lfo.name" :label="`LFO ${lfoIndex + 1} name`" density="compact" variant="outlined" hide-details @change="handleTrackDraftChange" />
                </v-col>
                <v-col cols="8" md="5">
                  <v-switch v-model="lfo.enabled" label="Enabled" density="compact" hide-details @update:modelValue="handleTrackDraftChange" />
                </v-col>
                <v-col cols="4" md="2" class="text-right">
                  <v-btn icon="mdi-delete-outline" size="small" variant="text" :aria-label="`Remove ${lfo.name}`" @click="removeWavetableLfo(lfoIndex)" />
                </v-col>
              </v-row>
              <v-row class="compact-row">
                <v-col cols="12" md="4">
                  <v-select v-model="lfo.waveform" label="Shape" :items="wavetableLfoWaveformOptions" density="compact" variant="outlined" hide-details @update:modelValue="handleTrackDraftChange" />
                </v-col>
                <v-col cols="12" md="4">
                  <v-select v-model="lfo.polarity" label="Polarity" :items="wavetableLfoPolarityOptions" density="compact" variant="outlined" hide-details @update:modelValue="handleTrackDraftChange" />
                </v-col>
                <v-col cols="12" md="4">
                  <v-select v-model="lfo.retrigger" label="Phase mode" :items="wavetableLfoRetriggerOptions" density="compact" variant="outlined" hide-details @update:modelValue="handleTrackDraftChange" />
                </v-col>
              </v-row>
              <v-row class="compact-row">
                <v-col cols="12" md="4">
                  <v-switch v-model="lfo.sync" label="Tempo sync" density="compact" hide-details @update:modelValue="handleTrackDraftChange" />
                </v-col>
                <v-col cols="12" md="8">
                  <v-select v-if="lfo.sync" v-model="lfo.syncRate" :label="`Rate ${formatModulationRate(lfo.syncRate)}`" :items="wavetableLfoSyncRateOptions" density="compact" variant="outlined" hide-details @update:modelValue="handleTrackDraftChange" />
                  <EditableSlider v-else v-model="lfo.rateHz" :label="`Rate (${Number(lfo.rateHz).toFixed(2)} Hz)`" :min="0.01" :max="20" :step="0.01" @update:modelValue="handleTrackDraftChange" />
                </v-col>
              </v-row>
              <v-row class="compact-row">
                <v-col cols="12" md="4">
                  <EditableSlider v-model="lfo.depth" :label="`Global depth (${Math.round(lfo.depth * 100)}%)`" :min="0" :max="1" :step="0.01" @update:modelValue="handleTrackDraftChange" />
                </v-col>
                <v-col cols="12" md="4">
                  <EditableSlider v-model="lfo.phase" :label="`Start phase (${Math.round(lfo.phase * 360)}°)`" :min="0" :max="0.99" :step="0.01" @update:modelValue="handleTrackDraftChange" />
                </v-col>
                <v-col cols="12" md="4">
                  <EditableSlider v-model="lfo.smoothing" :label="`Smoothing (${Math.round(lfo.smoothing * 100)}%)`" :min="0" :max="1" :step="0.01" @update:modelValue="handleTrackDraftChange" />
                </v-col>
              </v-row>
              <v-row class="compact-row">
                <v-col cols="12" md="6">
                  <v-select v-model="lfo.fmSource" label="Frequency modulation source" :items="wavetableLfoFmSourceOptions(lfoIndex)" density="compact" variant="outlined" hide-details @update:modelValue="handleTrackDraftChange" />
                </v-col>
                <v-col cols="12" md="6">
                  <EditableSlider v-model="lfo.fmAmount" :label="`FM index (${Number(lfo.fmAmount).toFixed(2)} cycles)`" :min="-4" :max="4" :step="0.01" :disabled="lfo.fmSource < 0" @update:modelValue="handleTrackDraftChange" />
                </v-col>
              </v-row>
              <v-row class="compact-row">
                <v-col v-for="(dimension, dimensionIndex) in draftTrack.tonewheelWavetable.dimensions" :key="`route-${lfoIndex}-${dimensionIndex}`" cols="12" md="6">
                  <EditableSlider v-model="lfo.routes[dimensionIndex]" :label="`${dimension.name} route (${Math.round(lfo.routes[dimensionIndex] * 100)}%)`" :min="-1" :max="1" :step="0.01" @update:modelValue="handleTrackDraftChange" />
                </v-col>
              </v-row>
            </v-card>
          </template>
          <v-row v-else class="compact-row">
            <v-col v-for="(label, index) in tonewheelDrawbarLabels" :key="label" cols="12" sm="6" md="4">
              <EditableSlider :label="label + ' Drawbar (' + draftTrack.tonewheelDrawbars[index] + ')'" :min="0" :max="8" :step="1" v-model="draftTrack.tonewheelDrawbars[index]" @update:modelValue="handleTrackDraftChange" />
            </v-col>
          </v-row>
        </v-window-item>

        <v-window-item v-if="draftTrack.trackKind !== 'rhythmic'" value="envelopes" class="control-tab-panel">
          <div class="envelope-section-label">Amp Envelope</div>
          <v-row class="compact-row">
            <v-col cols="12" md="6">
              <EditableSlider :label="'Amp Attack (' + Number(draftTrack.attack).toFixed(2) + 's)'" :min="0" :max="10" :step="0.01" v-model="draftTrack.attack" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="6">
              <EditableSlider :label="'Amp Decay (' + Number(draftTrack.decay).toFixed(2) + 's)'" :min="0" :max="10" :step="0.01" v-model="draftTrack.decay" @update:modelValue="handleTrackDraftChange" />
            </v-col>
          </v-row>
          <v-row class="compact-row">
            <v-col cols="12" md="6">
              <EditableSlider :label="'Amp Sustain (' + Number(draftTrack.sustain).toFixed(2) + ')'" :min="0" :max="1" :step="0.01" v-model="draftTrack.sustain" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="6">
              <EditableSlider :label="'Amp Release (' + Number(draftTrack.release).toFixed(2) + 's)'" :min="0" :max="20" :step="0.01" v-model="draftTrack.release" @update:modelValue="handleTrackDraftChange" />
            </v-col>
          </v-row>

          <div class="envelope-section-label envelope-section-label--spaced">Pitch Envelope</div>
          <v-row class="compact-row">
            <v-col cols="12" md="6">
              <EditableSlider :label="'Pitch Env Amount (' + Number(draftTrack.pitchEnvelopeAmount).toFixed(2) + ' MIDI)'" :min="-48" :max="48" :step="0.01" v-model="draftTrack.pitchEnvelopeAmount" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="6">
              <EditableSlider :label="'Pitch Env Shape (' + Number(draftTrack.pitchEnvelopeShape).toFixed(2) + ')'" :min="pitchEnvelopeShapeMin" :max="pitchEnvelopeShapeMax" :step="0.01" v-model="draftTrack.pitchEnvelopeShape" @update:modelValue="handleTrackDraftChange" />
            </v-col>
          </v-row>
          <v-row class="compact-row">
            <v-col cols="12" md="6">
              <EditableSlider :label="'Pitch Env Attack (' + Number(draftTrack.pitchEnvelopeAttack).toFixed(2) + 's)'" :min="0" :max="10" :step="0.01" v-model="draftTrack.pitchEnvelopeAttack" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="6">
              <EditableSlider :label="'Pitch Env Decay (' + Number(draftTrack.pitchEnvelopeDecay).toFixed(2) + 's)'" :min="0" :max="10" :step="0.01" v-model="draftTrack.pitchEnvelopeDecay" @update:modelValue="handleTrackDraftChange" />
            </v-col>
          </v-row>
          <v-row class="compact-row">
            <v-col cols="12" md="6">
              <EditableSlider :label="'Pitch Env Sustain (' + Number(draftTrack.pitchEnvelopeSustain).toFixed(2) + ')'" :min="0" :max="1" :step="0.01" v-model="draftTrack.pitchEnvelopeSustain" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="6">
              <EditableSlider :label="'Pitch Env Release (' + Number(draftTrack.pitchEnvelopeRelease).toFixed(2) + 's)'" :min="0" :max="20" :step="0.01" v-model="draftTrack.pitchEnvelopeRelease" @update:modelValue="handleTrackDraftChange" />
            </v-col>
          </v-row>
        </v-window-item>

        <v-window-item v-if="draftTrack.trackKind !== 'rhythmic'" value="unison" class="control-tab-panel">
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

          <div class="envelope-section-label envelope-section-label--spaced">Unison</div>
          <v-row class="compact-row">
            <v-col cols="12" md="6">
              <EditableSlider :label="'Unison Voices (' + draftTrack.unisonVoices + ')'" :min="1" :max="8" :step="1" v-model="draftTrack.unisonVoices" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="6">
              <EditableSlider :label="'Unison Detune (' + Number(draftTrack.unisonDetune).toFixed(0) + ' cents)'" :min="0" :max="100" :step="1" v-model="draftTrack.unisonDetune" @update:modelValue="handleTrackDraftChange" />
            </v-col>
          </v-row>
        </v-window-item>

        <v-window-item value="modulation" class="control-tab-panel">
          <v-row>
            <v-col cols="12" md="6">
              <v-switch v-model="draftTrack.tremoloEnabled" label="Tremolo" hide-details density="compact" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="6">
              <v-switch v-model="draftTrack.vibratoEnabled" label="Vibrato" hide-details density="compact" @update:modelValue="handleTrackDraftChange" />
            </v-col>
          </v-row>
          <v-row class="compact-row">
            <v-col cols="12" md="4">
              <EditableSlider :label="'Tremolo Rate (' + Number(draftTrack.tremoloFrequency).toFixed(2) + ' Hz)'" :min="0.01" :max="40" :step="0.01" v-model="draftTrack.tremoloFrequency" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="4">
              <EditableSlider :label="'Tremolo Depth (' + Number(draftTrack.tremoloDepth).toFixed(2) + ')'" :min="0" :max="1" :step="0.01" v-model="draftTrack.tremoloDepth" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="4">
              <EditableSlider :label="'Tremolo Spread (' + Number(draftTrack.tremoloSpread).toFixed(0) + '°)'" :min="0" :max="360" :step="1" v-model="draftTrack.tremoloSpread" @update:modelValue="handleTrackDraftChange" />
            </v-col>
          </v-row>
          <v-row class="compact-row">
            <v-col cols="12" md="6">
              <EditableSlider :label="'Vibrato Rate (' + Number(draftTrack.vibratoFrequency).toFixed(2) + ' Hz)'" :min="0.01" :max="40" :step="0.01" v-model="draftTrack.vibratoFrequency" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="6">
              <EditableSlider :label="'Vibrato Depth (' + Number(draftTrack.vibratoDepth).toFixed(2) + ')'" :min="0" :max="1" :step="0.01" v-model="draftTrack.vibratoDepth" @update:modelValue="handleTrackDraftChange" />
            </v-col>
          </v-row>
        </v-window-item>

        <v-window-item value="drive" class="control-tab-panel">
          <WaveshaperControls v-model="draftTrack.waveshaper" @update:modelValue="handleTrackDraftChange" />
          <v-divider class="my-4" />
          <EditableSlider :label="'Tanh Drive (' + Number(draftTrack.limiterGain).toFixed(1) + ' dB before tanh)'" :min="-48" :max="72" :step="0.1" v-model="draftTrack.limiterGain" @update:modelValue="handleTrackDraftChange" />
        </v-window-item>

        <v-window-item value="chorus" class="control-tab-panel">
          <v-row>
            <v-col cols="12" md="6">
              <v-switch v-model="draftTrack.chorusEnabled" label="Enable Chorus" hide-details density="compact" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="6">
              <v-select
                v-model="draftTrack.chorusRate"
                :label="'Chorus Rate ' + formatModulationRate(draftTrack.chorusRate)"
                :items="modulationRateOptions"
                hide-details
                density="comfortable"
                variant="outlined"
                @update:modelValue="handleTrackDraftChange"
              />
            </v-col>
          </v-row>
          <v-row class="compact-row">
            <v-col cols="12" md="4">
              <EditableSlider :label="'Chorus Delay (' + Number(draftTrack.chorusDelay).toFixed(2) + ' ms)'" :min="0.5" :max="20" :step="0.05" v-model="draftTrack.chorusDelay" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="4">
              <EditableSlider :label="'Chorus Depth (' + Number(draftTrack.chorusDepth).toFixed(2) + ')'" :min="0" :max="1" :step="0.01" v-model="draftTrack.chorusDepth" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="4">
              <EditableSlider :label="'Chorus Spread (' + Number(draftTrack.chorusSpread).toFixed(0) + '°)'" :min="0" :max="180" :step="1" v-model="draftTrack.chorusSpread" @update:modelValue="handleTrackDraftChange" />
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

        <v-window-item value="flanger" class="control-tab-panel">
          <v-row>
            <v-col cols="12" md="6">
              <v-switch v-model="draftTrack.flangerEnabled" label="Enable Flanger" hide-details density="compact" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="6">
              <v-select
                v-model="draftTrack.flangerRate"
                :label="'Flanger Rate ' + formatModulationRate(draftTrack.flangerRate)"
                :items="modulationRateOptions"
                hide-details
                density="comfortable"
                variant="outlined"
                @update:modelValue="handleTrackDraftChange"
              />
            </v-col>
          </v-row>
          <v-row class="compact-row">
            <v-col cols="12" md="4">
              <EditableSlider :label="'Flanger Delay (' + Number(draftTrack.flangerDelay).toFixed(2) + ' ms)'" :min="0.1" :max="20" :step="0.05" v-model="draftTrack.flangerDelay" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="4">
              <EditableSlider :label="'Flanger Depth (' + Number(draftTrack.flangerDepth).toFixed(2) + ')'" :min="0" :max="1" :step="0.01" v-model="draftTrack.flangerDepth" @update:modelValue="handleTrackDraftChange" />
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

        <v-window-item value="phaser" class="control-tab-panel">
          <v-row>
            <v-col cols="12" md="6">
              <v-switch v-model="draftTrack.phaserEnabled" label="Enable Phaser" hide-details density="compact" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="6">
              <v-select
                v-model="draftTrack.phaserRate"
                :label="'Phaser Rate ' + formatModulationRate(draftTrack.phaserRate)"
                :items="modulationRateOptions"
                hide-details
                density="comfortable"
                variant="outlined"
                @update:modelValue="handleTrackDraftChange"
              />
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
            <v-col cols="12" md="4">
              <EditableSlider :label="'Phaser Sweep (' + Number(draftTrack.phaserDepth).toFixed(0) + '%)'" :min="0" :max="100" :step="1" v-model="draftTrack.phaserDepth" @update:modelValue="handleTrackDraftChange" />
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

        <v-window-item value="filter" class="control-tab-panel">
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
          <v-row>
            <v-col cols="12" md="6">
              <v-switch v-model="draftTrack.filterLfoEnabled" label="Cutoff LFO" hide-details density="compact" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="6">
              <v-switch v-model="draftTrack.filterLfoSync" label="Tempo Sync" hide-details density="compact" :disabled="!draftTrack.filterLfoEnabled" @update:modelValue="handleTrackDraftChange" />
            </v-col>
          </v-row>
          <v-row class="compact-row">
            <v-col cols="12" md="6">
              <v-select
                v-if="draftTrack.filterLfoSync"
                v-model="draftTrack.filterLfoRate"
                :label="'LFO Rate ' + formatModulationRate(draftTrack.filterLfoRate)"
                :items="modulationRateOptions"
                hide-details
                density="comfortable"
                variant="outlined"
                :disabled="!draftTrack.filterLfoEnabled"
                @update:modelValue="handleTrackDraftChange"
              />
              <EditableSlider
                v-else
                :label="'LFO Rate (' + Number(draftTrack.filterLfoRateHz).toFixed(2) + ' Hz)'"
                :min="0.01"
                :max="20"
                :step="0.01"
                v-model="draftTrack.filterLfoRateHz"
                :disabled="!draftTrack.filterLfoEnabled"
                @update:modelValue="handleTrackDraftChange"
              />
            </v-col>
            <v-col cols="12" md="6">
              <EditableSlider
                :label="'LFO Depth (' + Number(draftTrack.filterLfoAmount).toFixed(1) + ' MIDI)'"
                :min="-48"
                :max="48"
                :step="0.1"
                v-model="draftTrack.filterLfoAmount"
                :disabled="!draftTrack.filterLfoEnabled"
                @update:modelValue="handleTrackDraftChange"
              />
            </v-col>
          </v-row>
          <v-row class="compact-row">
            <v-col cols="12" md="6">
              <v-select
                v-model="draftTrack.filterLfoWaveform"
                label="LFO Waveform"
                :items="skewLfoWaveformOptions"
                hide-details
                density="comfortable"
                variant="outlined"
                :disabled="!draftTrack.filterLfoEnabled"
                @update:modelValue="handleTrackDraftChange"
              />
            </v-col>
            <v-col cols="12" md="6">
              <EditableSlider
                :label="'LFO Init Phase (' + Number(draftTrack.filterLfoInitPhase).toFixed(2) + ')'"
                :min="0"
                :max="0.99"
                :step="0.01"
                v-model="draftTrack.filterLfoInitPhase"
                :disabled="!draftTrack.filterLfoEnabled"
                @update:modelValue="handleTrackDraftChange"
              />
            </v-col>
          </v-row>
          <v-row class="compact-row">
            <v-col cols="12" md="4">
              <EditableSlider :label="'Filter Env Amount (' + Number(draftTrack.filterEnvelopeAmount).toFixed(1) + ' MIDI)'" :min="-127" :max="127" :step="0.1" v-model="draftTrack.filterEnvelopeAmount" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="4">
              <EditableSlider :label="'Filter Env Attack (' + Number(draftTrack.filterEnvelopeAttack).toFixed(2) + 's)'" :min="0" :max="10" :step="0.01" v-model="draftTrack.filterEnvelopeAttack" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="4">
              <EditableSlider :label="'Filter Env Decay (' + Number(draftTrack.filterEnvelopeDecay).toFixed(2) + 's)'" :min="0" :max="10" :step="0.01" v-model="draftTrack.filterEnvelopeDecay" @update:modelValue="handleTrackDraftChange" />
            </v-col>
          </v-row>
          <v-row class="compact-row">
            <v-col cols="12" md="6">
              <EditableSlider :label="'Filter Env Sustain (' + Number(draftTrack.filterEnvelopeSustain).toFixed(2) + ')'" :min="0" :max="1" :step="0.01" v-model="draftTrack.filterEnvelopeSustain" @update:modelValue="handleTrackDraftChange" />
            </v-col>
            <v-col cols="12" md="6">
              <EditableSlider :label="'Filter Env Release (' + Number(draftTrack.filterEnvelopeRelease).toFixed(2) + 's)'" :min="0" :max="20" :step="0.01" v-model="draftTrack.filterEnvelopeRelease" @update:modelValue="handleTrackDraftChange" />
            </v-col>
          </v-row>
        </v-window-item>

        <v-window-item value="effects" class="control-tab-panel">
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

        <v-window-item value="reverb" class="control-tab-panel">
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
import ReverbControls from './ReverbControls.vue';
import RhythmTrackControls from './RhythmTrackControls.vue';
import RhythmSoundControls from './RhythmSoundControls.vue';
import TimeWarpPreview from './TimeWarpPreview.vue';
import WaveshaperControls from './WaveshaperControls.vue';
import {
  interpolateTonewheelDrawbars,
  MAX_WAVETABLE_CONFIGURATIONS,
  MAX_WAVETABLE_DIMENSIONS,
  MAX_WAVETABLE_LFOS,
  type TonewheelConfiguration,
  type TonewheelWavetableLfo,
} from '../audio/tonewheelWavetable';
import { LFO_SYNC_RATE_OPTIONS, LFO_WAVEFORM_OPTIONS } from '../audio/lfo';
import {
  CUSTOM_TIME_WARP_CURVE,
  TIME_WARP_CURVE_OPTIONS,
  TIME_WARP_QUANTIZE_OPTIONS,
  resolveTimeWarpFunction,
} from '../audio/timeWarp';
import {
  clonePresetTrackData,
  DEFAULT_PRESET_TRACK_DATA,
  ECHO_DELAY_OPTIONS,
  MAX_TRACK_POLYPHONY,
  MODULATION_RATE_OPTIONS,
  PHASER_STAGE_OPTIONS,
  PITCH_ENVELOPE_SHAPE_MAX,
  PITCH_ENVELOPE_SHAPE_MIN,
  SKEW_LFO_WAVEFORM_OPTIONS,
  TONEWHEEL_DRAWBAR_LABELS,
  WAVEFORM_OPTIONS,
  type PresetReverbData,
  type PresetTrackData,
} from '../presets';

export default defineComponent({
  name: 'EditorSurface',
  components: {
    EditableSlider,
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
  },
  emits: ['track-change', 'reverb-change'],
  data() {
    return {
      draftTrack: clonePresetTrackData(this.track ?? DEFAULT_PRESET_TRACK_DATA),
      draftReverb: { ...this.reverb },
      tonewheelDrawbarLabels: TONEWHEEL_DRAWBAR_LABELS,
      echoDelayOptions: ECHO_DELAY_OPTIONS,
      modulationRateOptions: MODULATION_RATE_OPTIONS,
      phaserStageOptions: [...PHASER_STAGE_OPTIONS] as number[],
      waveformOptions: WAVEFORM_OPTIONS,
      skewLfoWaveformOptions: SKEW_LFO_WAVEFORM_OPTIONS,
      wavetableLfoWaveformOptions: LFO_WAVEFORM_OPTIONS,
      wavetableLfoSyncRateOptions: LFO_SYNC_RATE_OPTIONS,
      wavetableLfoPolarityOptions: [
        { title: 'Bipolar (±)', value: 'bipolar' },
        { title: 'Unipolar (+)', value: 'unipolar' },
      ],
      wavetableLfoRetriggerOptions: [
        { title: 'Free running', value: 'free' },
        { title: 'Retrigger on note event (track-wide)', value: 'note' },
        { title: 'Retrigger when song is played', value: 'song' },
      ],
      maxWavetableLfos: MAX_WAVETABLE_LFOS,
      pitchEnvelopeShapeMin: PITCH_ENVELOPE_SHAPE_MIN,
      pitchEnvelopeShapeMax: PITCH_ENVELOPE_SHAPE_MAX,
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
    /** Shows the tempo-synced LFO cycle length translated into Hz at the current tempo. */
    formatModulationRate(rate: string): string {
      const match = rate.match(/^(\d+)\/(\d+)([DT])?$/);
      if (!match) {
        return '';
      }

      const modifierRatio = match[3] === 'D' ? 1.5 : match[3] === 'T' ? 2 / 3 : 1;
      const cycleSeconds = (240 / this.bpm) * (Number(match[1]) / Number(match[2])) * modifierRatio;
      return `(${(1 / cycleSeconds).toFixed(3)} Hz)`;
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
        wavetable.dimensions = [{ name: 'Brightness', value: 0 }];
        wavetable.configurations = [
          { name: 'Original', position: [0], drawbars: this.draftTrack.tonewheelDrawbars.slice() },
          { name: 'Bright', position: [1], drawbars: [0, 0, 8, 8, 6, 5, 3, 2, 1] },
        ];
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
      const drawbars = interpolateTonewheelDrawbars(wavetable, this.draftTrack.tonewheelDrawbars);
      wavetable.configurations.push({
        name: `Configuration ${wavetable.configurations.length + 1}`,
        position: wavetable.dimensions.map((dimension) => dimension.value),
        drawbars,
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
    addWavetableLfo() {
      const wavetable = this.draftTrack.tonewheelWavetable;
      if (wavetable.lfos.length >= MAX_WAVETABLE_LFOS) {
        return;
      }
      const index = wavetable.lfos.length;
      const lfo: TonewheelWavetableLfo = {
        name: `Vector LFO ${index + 1}`,
        enabled: true,
        waveform: index === 0 ? 'sine' : 'smooth-random',
        sync: true,
        rateHz: 0.5,
        syncRate: index === 0 ? '1/1' : '4/1',
        phase: index * 0.25 % 1,
        depth: 0.25,
        polarity: 'bipolar',
        retrigger: 'free',
        smoothing: 0.1,
        fmSource: index > 0 ? index - 1 : -1,
        fmAmount: 0,
        routes: wavetable.dimensions.map((_, dimensionIndex) => dimensionIndex === index % wavetable.dimensions.length ? 1 : 0),
      };
      wavetable.lfos.push(lfo);
      this.handleTrackDraftChange();
    },
    removeWavetableLfo(index: number) {
      const lfos = this.draftTrack.tonewheelWavetable.lfos;
      lfos.splice(index, 1);
      lfos.forEach((lfo) => {
        if (lfo.fmSource === index) {
          lfo.fmSource = -1;
        } else if (lfo.fmSource > index) {
          lfo.fmSource -= 1;
        }
      });
      this.handleTrackDraftChange();
    },
    wavetableLfoFmSourceOptions(index: number): Array<{ title: string; value: number }> {
      return [
        { title: 'None', value: -1 },
        ...this.draftTrack.tonewheelWavetable.lfos.slice(0, index).map((lfo, sourceIndex) => ({
          title: `${sourceIndex + 1}: ${lfo.name}`,
          value: sourceIndex,
        })),
      ];
    },
    handleWavetableMorphChange() {
      this.draftTrack.tonewheelDrawbars = interpolateTonewheelDrawbars(
        this.draftTrack.tonewheelWavetable,
        this.draftTrack.tonewheelDrawbars,
      );
      this.handleTrackDraftChange();
    },
    handleReverbDraftChange() {
      this.$emit('reverb-change', { ...this.draftReverb });
    },
  },
});
</script>

<style scoped>
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