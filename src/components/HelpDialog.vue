<script setup lang="ts">
defineProps<{
  appVersion: string;
}>();

const visible = defineModel<boolean>({ required: true });
</script>

<template>
  <v-dialog v-model="visible" max-width="800px">
    <v-card class="pa-4 bg-black">
      <v-card-title class="pa-4">
        <span class="text-h5 font-weight-bold">
          GateRunner <small class="version">v{{ appVersion }}</small>
        </span>
        <v-spacer />
        <v-btn icon class="close-btn" title="Close help" @click="visible = false">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>
      <v-divider />
      <v-card-text class="pa-4">
        <h4 class="mb-2">How the Sequencer Works</h4>
        <p>The sequencer allows you to customize the following parameters:</p>
        <p>GateRunner stores your work as named presets. Changes affect the current draft immediately for playback and URL sharing, but the preset itself is only updated when you use <strong>Save</strong> or <strong>Save As</strong>. You can also export a single preset or the full preset library to JSON and import them back later.</p>
        <ul>
          <li><strong>Preset</strong>: Pick a named preset, create a new one, save your current draft, or delete presets you no longer need.</li>
          <li><strong>Preset Browser</strong>: Open the preset browser to organize presets into nested folders, search by name/path, and move or delete folders and presets.</li>
          <li><strong>Forte number</strong>: The pitch-class set to use as Forte number with transposition (see <a target="_blank" href="https://en.wikipedia.org/wiki/List_of_set_classes">Forte numbers</a>).</li>
          <li><strong>BPM</strong>: Controls the tempo of the sequence.</li>
          <li><strong>A4</strong>: Master concert pitch in Hz for all tracks (default 440; some prefer 432).</li>
          <li><strong>Track Activation (B)</strong>: Optional collapsible song-level sequence of nonnegative decimal bitmasks. Blank disables gating. When set, its <code>N</code> values split the full longest-track loop into <code>N</code> equal wall-clock chunks. Bit 0 controls the first track, bit 1 the second, and so on (deleting a track shifts later bits). A mask of <code>0</code> silences every track for that chunk. Activation uses each note's final post-time-warp onset; inactive onsets are omitted, and active notes are clipped at the first later inactive chunk boundary. Example: <code>1 2 3 0</code>. The track strip darkens inactive chunks.</li>
          <li><strong>Rhythmic tracks</strong>: Add a rhythmic track to use a synthesized GM-oriented drum kit instead of the melodic pitch-class encoder. Its ordered lanes map to GM percussion notes, with lane 1 using the least-significant velocity bits. Each sequence value is a decimal BigInt mask; the selected 1-7 velocity bits per lane allow simultaneous hits and velocity variation. Assign an XOR group (1-8) to choke other members of that group so only one can be active; the default is no group. When two grouped voices fire on the same step, the later/higher lane wins. Rhythmic tracks default to MIDI channel 10, but the channel remains editable for hardware routing.</li>
          <li><strong>Numerator/Denominator</strong>: Set per-track rhythmic grid while all tracks share one tempo.</li>
          <li><strong>Tracks</strong>: Each preset can contain multiple tracks with their own MIDI channel, waveform, gain, sequence, octave shift, note length, amp/pitch envelopes, polyphony, modulation, tanh drive, chorus, flanger, phaser, filter, echo, and reverb send.</li>
          <li><strong>Generator</strong>: Shape the tonewheel engine with classic oscillator waves, choir vowels, colored noise, resonant spectra, flute, oboe, clarinet, saxophone, fixed pulse spectra, drawbars, and optional breath noise.</li>
          <li><strong>Sequence</strong>: Input a sequence of numbers per track to generate notes based on their binary representation.</li>
          <li><strong>Octave Shift</strong>: Adjusts the octave of the notes played for the selected track.</li>
          <li><strong>Track Gain</strong>: Sets each track's audio level in dB. Use the velocity multiplier to control MIDI note velocity independently.</li>
          <li><strong>Note length</strong>: Multiplies the durations of the selected track's notes, then adds the optional fixed length measured in that track's steps (for example, a denominator of 4 makes one step a sixteenth note).</li>
          <li><strong>Track Delay</strong>: Number of bars to wait before the track starts playing.</li>
          <li><strong>Track Repeats</strong>: Number of times the track's pattern is repeated. After its repeats, the track stays silent until the longest track finishes, then everything loops.</li>
          <li><strong>Track Length View</strong>: The track strip shows each track's delay, repeats, and total duration in beats/bars with compact selectable blocks.</li>
          <li><strong>Tanh Drive</strong>: Applies the selected dB gain before a tanh waveshaper, so high values amplify and distort while the final track signal remains softly bounded.</li>
          <li><strong>Envelopes</strong>: Each track has a separate amp ADSR and pitch ADSR. Pitch Env Amount is in MIDI pitches (can be negative). Pitch Env Shape is a numeric exponential steepness (0 = linear; higher values make the curve steeper).</li>
          <li><strong>Instrument/Modulation/Filter</strong>: Shape each track with amp/pitch envelopes, unison voices, tremolo, vibrato, and a key-following multimode filter.</li>
          <li><strong>Effects</strong>: Add optional per-track feedback echo and send each track into the global pink-noise convolution reverb.</li>
          <li><strong>Chorus/Flanger/Phaser</strong>: Tempo-synced modulation effects whose LFO completes one cycle per selected note division (e.g. 4/1 sweeps over four whole notes, 1/8T warbles per eighth triplet), so they follow the BPM automatically.</li>
          <li><strong>Phaser</strong>: A classic phaser pedal: a cascade of first-order allpass stages (each stage pair creates one notch) whose poles are spaced one octave apart around the Center frequency and swept by the LFO over ±(Sweep % of 5 octaves). Stages picks the pole count (classic pedals use 4), Feedback resonates the notches, Resonance sharpens each pole, and Wet sets the dry/phase-shifted mix (always at least 50% wet so the notches stay audible).</li>
          <li><strong>Multidimensional Tonewheel</strong>: For melodic, non-noise tracks, build a morphable tonewheel spectrum from sparse drawbar configurations and animate its position with routed vector LFOs.</li>
          <li><strong>Breath noise</strong>: Add one filtered pink-noise layer to each melodic event. Level controls the blend, while Harmonic tracks the event's mean pitch to set the filter center.</li>
          <li><strong>Import/Export</strong>: Export one preset or the full library as JSON for backup and sharing, then import those files later without overwriting your existing presets.</li>
          <li><strong>WAV Export</strong>: Render and download an offline WAV mix of all tracks in the current draft, including an automatic rest trail for releases and effects.</li>
        </ul>

        <h3 class="mt-4 mb-2">Melodic Sound Palette</h3>
        <p>The <strong>Generator</strong> tab uses one tonewheel-based melodic engine. Choose a source shape, mix its nine drawbars, and optionally add breath noise before the track's shared envelope, filter, drive, modulation, and effects.</p>
        <ul>
          <li><strong>Flute</strong>: Uses a compact, fundamental-led harmonic spectrum for a soft acoustic starting point.</li>
          <li><strong>Oboe, Clarinet, and Saxophone</strong>: Use distinct reed-inspired harmonic spectra: bright and nasal for oboe, hollow and odd-harmonic-led for clarinet, and full and buzzy for saxophone.</li>
          <li><strong>Pulse 25% and 12.5%</strong>: Use fixed narrow-duty spectra for brighter, leaner tones without a per-voice PWM graph.</li>
          <li><strong>Breath noise</strong>: Adds one pink-noise source per track event. Level sets its gain and Harmonic sets the pitch-relative center of its band-pass filter.</li>
          <li><strong>Legacy presets</strong>: Retired FM and virtual-analog fields are ignored during import, while compatible waveform, envelope, sequence, and effect settings are retained.</li>
        </ul>

        <h3 class="mt-4 mb-2">Multidimensional Tonewheel Wavetable</h3>
        <p>Open the <strong>Generator</strong> tab to turn a melodic track's nine drawbars into a morphable spectrum. Instead of keeping one fixed drawbar registration, you place named registrations at points in a space with up to 16 independent morph axes. GateRunner continuously interpolates the drawbars at the current position, so one axis could represent brightness, another body, and another harmonic complexity.</p>
        <p>This feature affects the additive tonewheel spectrum used by melodic waveforms. Rhythmic tracks do not use it, and noise waveforms bypass the tonewheel drawbar spectrum.</p>

        <h4 class="mt-3 mb-2">Axes and Configurations</h4>
        <ul>
          <li><strong>Enable Multidimensional wavetable</strong>: Enabling it for the first time creates a <em>Brightness</em> axis plus <em>Original</em> and <em>Bright</em> starting configurations. Disabling it returns the track to its single fixed set of drawbars without deleting the stored wavetable.</li>
          <li><strong>Morph axes</strong>: Each axis has a name and a current value from 0% to 100%. The current values form the base position used for playback. Use <strong>Add morph axis</strong> to add another independent direction; existing configurations receive a centered 50% coordinate on the new axis.</li>
          <li><strong>Configurations</strong>: A configuration stores a name, one position per axis, and all nine drawbar levels. Select <strong>Configuration to edit</strong> to rename it, move it in the morph space, or change its registration.</li>
          <li><strong>Capture configuration here</strong>: Adds a point at the current axis position and initializes its drawbars from the sound currently interpolated there. You can then edit that point into a new registration.</li>
          <li><strong>Sparse interpolation</strong>: You do not need to define every corner of a multidimensional grid. GateRunner weights nearby configurations by inverse squared distance. Landing exactly on a configuration uses its drawbars exactly; elsewhere, closer configurations contribute more strongly.</li>
          <li><strong>Limits and removal</strong>: A wavetable supports up to 16 axes and 64 configurations. Removing an axis also removes its coordinate and LFO route from every stored item. Removing the final axis disables the wavetable, and at least one configuration must remain while it is enabled.</li>
        </ul>

        <h4 class="mt-3 mb-2">Vector Modulation</h4>
        <p>Up to eight vector LFOs can animate the morph position. For each axis, the movement is its base value plus the LFO output multiplied by <strong>Global depth</strong> and that axis's <strong>Route</strong>. The final position is constrained to the 0%-100% range. Multiple enabled LFOs are applied in list order.</p>
        <ul>
          <li><strong>Shape</strong>: Choose sine, triangle, rising or falling saw, square, sample-and-hold, or smooth random motion.</li>
          <li><strong>Polarity</strong>: Bipolar motion ranges from -1 to +1 around the base position. Unipolar motion ranges from 0 to +1; a negative route can make that motion travel downward instead.</li>
          <li><strong>Rate</strong>: With <strong>Tempo sync</strong> enabled, the selected note division is the duration of one complete LFO cycle; dotted and triplet divisions are available. With sync disabled, set a free rate from 0.01 Hz to 20 Hz.</li>
          <li><strong>Phase mode</strong>: <em>Free running</em> follows transport time continuously. <em>Retrigger on note event</em> restarts the phase for each track-wide note event. <em>Retrigger when song is played</em> restarts it at playback start.</li>
          <li><strong>Start phase and smoothing</strong>: Start phase offsets the cycle from 0° to almost 360°. Smoothing softens abrupt or random changes, which is especially useful with square and sample-and-hold shapes.</li>
          <li><strong>Axis routes</strong>: Each route ranges from -100% to +100%. A value of 0% disconnects that LFO from the axis, positive values follow the LFO, and negative values reverse it. One LFO can move several axes at different strengths and directions.</li>
          <li><strong>Frequency modulation</strong>: An LFO may use an earlier LFO in the list as its frequency-modulation source. The <strong>FM index</strong> sets the phase deviation in cycles; positive and negative values bend the destination motion in opposite directions. Only earlier LFOs are offered as sources, preventing circular modulation.</li>
          <li><strong>Global depth</strong>: Scales all routes from that LFO at once. Setting depth to 0%, disabling the LFO, or setting every route to 0% leaves the base morph position unchanged.</li>
        </ul>

        <h3 class="mt-4 mb-2">How Notes Are Computed in the Encoding Scheme</h3>
        <p>This application uses a binary-based encoding system to determine which notes are played from numerical values. Here's how it works:</p>

        <ol>
          <li><strong>Binary Representation of Numbers:</strong>
            <ul>
              <li>Each number's absolute value is converted into binary, with bit 0 at position 0, bit 1 at position 1, and so on. For example:</li>
              <ul>
                <li>The number <code>5</code> becomes <code>101</code>.</li>
                <li>The number <code>10</code> becomes <code>0101</code>.</li>
              </ul>
              <li>Negative numbers are supported and in this case the note indices are computed as you would expect.</li>
            </ul>
          </li>
          <li><strong>Pitch Class Assignment:</strong>
            <ul>
              <li>Each binary digit corresponds to a position in the selected pitch class set, with the octave shift, going up and down octavewise to the minimal and maximal MIDI pitch. For example, to give a general idea without considering the octave, for 3-11B.00 you would get:
                <ul>
                  <li>Position 0 = C</li>
                  <li>Position 1 = E</li>
                  <li>Position 2 = G</li>
                  <li>Position 3 = C</li>
                  <li>...</li>
                </ul>
              </li>
            </ul>
          </li>
          <li><strong>Chords:</strong>
            <ul>
              <li>If multiple <code>1</code>s are present, the corresponding notes form a chord.</li>
              <li>Example: The number <code>7</code> (<code>111</code>) maps to C, E, and G.</li>
            </ul>
          </li>
        </ol>
      </v-card-text>
      <v-divider />
      <v-card-actions class="pa-4">
        <v-spacer />
        <v-btn color="primary" @click="visible = false">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.version {
  margin-left: 1em;
  color: var(--instrument-muted);
  font-size: 0.6em;
}

.close-btn {
  position: absolute;
  top: 16px;
  right: 16px;
}
</style>