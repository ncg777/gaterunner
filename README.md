# GateRunner

A browser-based MIDI step sequencer with a lightweight tonewheel-based melodic engine that produces MIDI and WAV files from binary-encoded note sequences using Forte number pitch-class sets.

**Live app:** [https://ncg777.github.io/gaterunner/](https://ncg777.github.io/gaterunner/)

### Presets

GateRunner stores sequences as named presets in the browser.

- The selected preset loads into the working draft.
- Editing controls updates the working draft immediately for playback, MIDI export, and URL sharing.
- Use **Save** to update the selected preset.
- Use **Save As** to create a new preset from the current draft.
- Use **New** to create a fresh default preset.
- Existing single-preset local storage data is migrated automatically the first time the new preset system loads.

### Multidimensional Tonewheel Wavetables

Each melodic track can turn its drawbar registration into a sparse multidimensional
wavetable from the **Generator** tab.

- Enabling the wavetable creates a useful **Brightness** axis with the current sound
  at one end and a bright registration at the other.
- Add independent morph axes without having to fill every corner of a hypercube.
- Move the axis controls to crossfade smoothly between all nearby configurations.
- **Capture configuration here** snapshots the interpolated sound at the current
  position; configurations can then be renamed, moved, and edited.
- The current interpolated registration is also stored in the legacy drawbar field.
  Older presets therefore sound unchanged, and older GateRunner versions can still
  play a representative snapshot of newly saved presets.
- Add up to eight **Vector LFOs** and route each one independently and bipolarly to
  every morph axis, inspired by Prophet VS vector motion and Wavestation wave sequencing.
- LFOs support free rates or dotted/triplet tempo divisions, free/note/bar phase modes,
  bipolar or unipolar output, phase offset, smoothing, and smooth-random motion.
- Note retrigger restarts the track-wide vector trajectory for all sounding voices so
  the shared timbral space stays coherent during polyphonic passages.
- Later LFOs can take an earlier LFO as an FM source, creating acyclic cascades similar
  to modern wavetable modulation matrices while keeping playback deterministic.
- Browser playback updates the spectrum at control rate; browser and CLI WAV exports
  render the same modulation against absolute song time.

### Melodic Sound Palette

Each melodic track uses one bounded-cost tonewheel engine.

- Source shapes include sine, triangle, sawtooth, square, choir vowels, colored noise,
  resonant spectra, a compact flute spectrum, and fixed 25% and 12.5% pulse spectra.
- Nine Hammond-style drawbars and the multidimensional wavetable apply across pitched
  source shapes, with polyphony, unison, glide, envelopes, filters, and effects downstream.
- **Breath noise** adds one filtered pink-noise layer per track event. Its level and
  filter harmonic provide air without multiplying noise graphs by voice count.
- Browser playback and CLI WAV export share the flute and pulse harmonic definitions.
  CLI breath noise is seeded, so repeated exports of the same input are byte-identical.
- Imported presets that contain retired FM or virtual-analog fields remain loadable.
  Those fields are silently discarded and the track keeps its tonewheel-compatible settings.

### Import And Export

Preset files use JSON.

- **Export Preset** writes the current preset draft to a single-preset JSON file.
- **Export Library** writes the full preset library to a JSON file.
- **Import JSON** accepts either file type and adds imported presets without overwriting existing ones.
- If an imported preset name already exists, GateRunner keeps both presets by renaming the imported one.

### Track Timing

Each track can add silence around its sequence and fades across its full scheduled duration.

- **Delay** is applied once before the track begins.
- Every repeat schedules **Padding Before**, then the sequence, then **Padding After**.
- Padding and fade durations are measured in that track's bars, using its numerator and the shared BPM.
- A fade value of `0` disables that fade. Fade in starts after the one-time delay, and fade out ends after the final repeat's after-padding.
- Live playback and browser/CLI WAV export apply the fades. Browser and CLI MIDI export preserve the padded note timing.

### Track Activation (B)

GateRunner can optionally gate tracks across the full song loop with a song-level bitmask sequence `B`.

- Enter `B` in the collapsible **Track Activation (B)** section above the track strip.
- `B` is a whitespace-separated sequence of nonnegative decimal integer masks, for example `1 2 3 0`.
- Blank input disables the feature; every track stays active for the whole loop.
- When `B` has `N` values, the full longest-track loop duration is split into `N` equal wall-clock chunks.
- Bit 0 controls the first track, bit 1 the second, and so on. Deleting or reordering tracks shifts later bit assignments.
- A mask of `0` is valid and silences every track for that chunk.
- Activation is decided by each note's final post-time-warp onset:
  - Onsets in inactive chunks are omitted.
  - Active notes keep ringing only until the first later chunk where that track becomes inactive.
  - Adjacent active chunks stay continuous.
- Live playback, browser MIDI/WAV export, and CLI MIDI/WAV generation all use the same gating rules.
- The track strip darkens inactive chunks so the schedule stays visible.
- URL sharing accepts `?b=1+2+3+0` (or space-encoded values). The CLI accepts the same syntax via `--b "1 2 3 0"`.

### CLI WAV Export

Build or run the TypeScript CLI directly:

```sh
yarn cli --format wav --output output.wav --preset preset.json
```

Multi-track WAV rendering uses available CPU cores by default. Use `--threads 1` for
inline rendering or `--threads N` to set an explicit worker count. `--verbose` prints
separate render and WAV-encoding timings. Track results are mixed in source order, so
thread counts produce the same deterministic WAV bytes.

Workers are reused across tracks, including when running from TypeScript. Export mixes
results incrementally in track order with at most one outstanding result per worker,
instead of retaining every track's full-song buffers. Long pieces still require
full-length audio buffers; use a smaller `--threads` value to reduce concurrent memory
use. The render timing includes mixing and reverb, not just track synthesis.

The WAV benchmark can capture reference files and compare later renders by hash and
decoded 24-bit PCM error:

```sh
yarn bench:wav --write-reference .wav-reference
yarn bench:wav --reference .wav-reference
```

Add `--long --threads 2` to include long filtered and twelve-track fixtures. Capture
references with the same `--long` selection before comparing. No sample-rate, bit-depth,
envelope-resolution, or synthesis-quality settings are reduced for speed.

### Browser WAV Export

Offline rendering uses Tone's original audio graph and clock, without the per-second
timer waits in its default offline scheduler. Progress checkpoints resume rendering
without waiting for animation frames, so a hidden tab cannot stall export on a missing
frame callback. Scheduling runs synchronously and can briefly block the UI on dense
pieces; native audio rendering and chunked WAV encoding follow it.

Audio regressions can be checked with:

```sh
yarn node --import tsx --test cli/*.test.ts src/__tests__/*.test.ts
```

For the browser-specific clock equivalence and context-restoration checks, start
`yarn dev` and run this in the browser console on the local app:

```js
const checks = await import('/gaterunner/src/__tests__/offlineRender.browser.ts');
await checks.runOfflineRenderChecks();
await checks.runModulationChecks(document.querySelector('#app').__vue_app__._instance.proxy);
```

---

### How Notes Are Computed in the Encoding Scheme

This application uses a binary-based encoding system to determine which notes are played from numerical values. Here's how it works:

1. **Binary Representation of Numbers:**

   - Each number is converted into binary, with bit 0 at position 0, bit 1 at position 1, and so on. For example:
     - The number `5` becomes `1010`.
     - The number `10` becomes `0101`.

2. **Pitch Class Assignment:**

   - Each binary digit corresponds to a position in the selected pitch class set going up octavewise to the maximal midi pitch. For example, for 7-35.11:
     - Position 0 = C
     - Position 1 = D
     - Position 2 = E
     - Position 3 = F
     - Position 4 = G
     - Position 5 = A
     - Position 6 = B
     - Position 7 = C
     - ...

3. **Chords:**

   - If multiple `1`s are present, the corresponding notes form a chord.
     - Example: The number `7` (`111`) maps to C, D, and E.

### Summary

To compute notes:

- Convert the number to binary (bit 0 = position 0).
- Map `1`s to their pitch classes.
- Apply an octave offset for final pitches.
- Combine active notes into a chord.
