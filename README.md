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
  resonant spectra, flute, oboe, clarinet, saxophone, and fixed 25% and 12.5% pulse spectra.
  The reed-inspired shapes offer a bright, nasal oboe, an odd-harmonic-led clarinet,
  and a full, buzzy saxophone.
- Nine Hammond-style drawbars and the multidimensional wavetable apply across pitched
  source shapes, with polyphony, unison, glide, envelopes, filters, and effects downstream.
- **Breath noise** adds one filtered pink-noise layer per track event. Its level and
  filter harmonic provide air without multiplying noise graphs by voice count.
- Browser playback and CLI WAV export share the woodwind and pulse harmonic definitions.
  CLI breath noise is seeded, so repeated exports of the same input are byte-identical.
- Imported presets that contain retired FM or virtual-analog fields remain loadable.
  Those fields are silently discarded and the track keeps its tonewheel-compatible settings.

### Waveform Spectral Transforms

Select **Waveform** as the **Partial source** in a melodic track's **Generator** tab.
Its harmonic spectrum can be reshaped before envelopes, filters, and effects:

- **Harmonic count** (1–64) limits the highest musical harmonic.
- **Harmonic mask** keeps all, odd, even, prime, Fibonacci, or power-of-two harmonics.
- **Spectral tilt** (−24 to +24 dB/octave) darkens or brightens the spectrum relative
  to the fundamental.
- **Spectral contrast** (0.25–4) raises each partial's magnitude to that power.
  Below 1 flattens magnitude differences; above 1 emphasizes stronger partials.
  Coefficient signs and zero amplitudes are preserved.
- **Odd/even balance** (−24 to +24 dB) favors odd harmonics at negative values
  and even harmonics at positive values by attenuating the opposite group.
- **Peak normalization** optionally scales the largest absolute partial to 1
  after all transforms. This is spectral normalization, not a loudness limiter;
  strong positive tilt without normalization can substantially increase level.

The order is harmonic limit/mask → contrast → tilt and balance → normalization.
The live spectrum preview, browser playback/WAV export, and CLI WAV generation
use the same transformed coefficients. MIDI is unchanged. Pink and brown spectrum
waveforms use deterministic signed coefficients with $1/\sqrt{h}$ and $1/h$
amplitude envelopes. They are periodic, follow note pitch, and support the same
transforms, unison, preview, and multidimensional wavetable crossfades.

Defaults (64 harmonics, no mask, 0 dB tilt/balance, contrast 1, normalization off)
preserve existing waveform sounds. Settings persist with presets, copies, JSON
export/import, and shared URLs inside `partialGenerator` using `harmonicCount`,
`mask`, `tilt`, `contrast`, `oddEvenBalance`, and `normalize`.

### Waveshaper And Tanh Drive

The **Drive** tab has an optional waveshaper for each melodic or rhythmic track,
independent of the existing **Tanh Drive** control. The signal order is:

```text
track source sum -> optional waveshaper -> limiterGain (Tanh Drive) -> tanh lookup -> track gain -> downstream effects
```

- Choose from **33 built-in curves**, or select **Custom**. The sine family includes
  Sine Fold (`sin(k*x)`), Sine Phase (`sin(k*x+p)`), Cosine Bend, Nested Sine
  (`sin(a*sin(b*x))`), Sine Phase Modulation, Dual Sine, Odd/Even Harmonic Sine,
  Power Sine, and Damped Sine. Other groups cover saturation, folding/rectification,
  polynomials, bells, and identity.
- In a custom formula, `x` is the signed input sample, not time. `PI` and `E` are
  constants. Valid free variables, such as `k` and `p` in `sin(k*x+p)`, become
  parameter controls automatically. For example, `sin(PI*x/2)` needs no parameters,
  while `tanh(amount*x)` creates an `amount` control.
- Each custom parameter stores its value and editable **Min**, **Max**, and **Step**.
  Min must be less than Max; Step must be positive and no larger than the range.
  These are numeric controls, not automation lanes. The transfer graph is read-only;
  drawing curves and parameter automation are not supported.
- Curves are sampled over the signed domain `[-1, 1]`. Native Web Audio lookup
  clamps driven inputs outside that domain to the nearest endpoint; the CLI matches
  that lookup behavior. Finite formula outputs are clipped to `[-1, 1]`, not rescaled.
  Invalid syntax or non-finite math detected during curve validation bypasses the
  **whole new effect**, including its drive, wet path, and DC filter. For example,
  `sqrt(x)` fails on negative inputs and `1/x` fails at zero. The legacy tanh stage
  still runs; invalid math does not mute the track or disable Tanh Drive.
- **Input Drive** (-24 to +36 dB) drives only the new effect's wet path. **Mix**
  (0%-100%) blends the untouched dry signal with the shaped wet signal. **DC block**
  optionally applies a 10 Hz high-pass filter to the wet signal after shaping;
  browser and CLI use shared filter coefficients. Neither transfer stage uses
  oversampling, so strong nonlinear shaping can alias.
- **Tanh Drive** (`limiterGain`, -48 to +72 dB) is a separate gain before the legacy
  tanh lookup. Its native transfer table also covers `[-1, 1]` and clamps at the
  endpoints: the output of this stage is bounded near `+/-0.7616` (`tanh(1)`), not
  unrestricted `tanh(drivenInput)` approaching `+/-1`. Track gain and downstream
  processing follow it, so this is not a bound on the final mix.
- New and older presets without waveshaper settings default to **off**, Sine Fold,
  0 dB Input Drive, 100% Mix, and DC block on. Switching curves or disabling the
  effect retains the custom formula, parameter metadata, and per-built-in values.
  Save/Save As, track copying/merging, and preset/library JSON export-import retain
  these nested settings independently. Editing them marks the draft as changed,
  including when the effect is off. Waveshaping does not change MIDI output.

Browser playback and browser WAV export use the same audio graph. Native CLI WAV
rendering implements the same nonlinear stages and DC-filter coefficients, but it
is not the full browser synth/effects graph and is not promised to sound identical.
**CLI WAV compatibility:** previous CLI rendering omitted the legacy tanh stage.
It now always runs, even at 0 dB Tanh Drive with the new waveshaper disabled. Old
CLI WAV renders therefore change; refresh audio/hash references deliberately.
This does not change MIDI generation.

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

`--preset` accepts a single-preset export or a library export (using the selected
preset, or the first if that selection is unavailable). It replaces individual
generation parameters and forwards each track's `limiterGain` and nested
`waveshaper` settings; separate drive flags do not override the loaded preset.

For legacy single-track input, use `--limiter-gain <dB>` and `--waveshaper <json>`.
The latter must be a JSON object; unspecified fields use waveshaper defaults.
For example, in a shell that preserves single-quoted JSON arguments:

```sh
yarn cli --format wav --output shaped.wav --sequence "1 2 4 8" --limiter-gain 6 --waveshaper '{"enabled":true,"curve":"sine-fold","builtinParameters":{"sine-fold":{"k":3}},"inputDriveDb":6,"mix":75,"dcBlock":true}'
```

With `--tracks`, put `limiterGain` and `waveshaper` on each track object. The
generator field is `sequence`, mapped from a preset's `sequenceInput`:

```sh
yarn cli --format wav --output tracks.wav --tracks '[{"sequence":"1 2 4","limiterGain":3,"waveshaper":{"enabled":true,"curve":"custom","expression":"sin(k*x)","customParameters":[{"name":"k","value":3,"min":0.1,"max":12,"step":0.1}],"mix":50}}]'
```

An omitted per-track `limiterGain` or `waveshaper` inherits the top-level fallback.
A supplied waveshaper object is normalized with defaults, not deep-merged with
the top-level object. Omit both flags to leave the new effect off; the legacy tanh
stage still runs. These settings affect WAV audio only, not MIDI notes or timing.

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
await checks.runVoiceFilterChecks();
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
