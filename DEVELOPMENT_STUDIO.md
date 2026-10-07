# Development studio — 2026.10.7

The optional **Phrases, motion & studio** panel develops a recognizable groove by
changing phrases, articulation, space and sound. Integer-mask sequences remain the
primary authoring format. Adding variation does not require adding attacks: ties,
sparse phrases, darker hats and echo throws are independent choices.

## Open the demonstration

Run `yarn dev`, open **Preset Actions → Import JSON**, and select
`cli/fixtures/development-demo.json`. Select the bass, drums or chords and expand
**Phrases, motion & studio**. Press Play to prepare and play the developed project.
The Render tab can preview/download a range, export stems, or bounce a source into
the Samples pool. The fixture is an application test project, not an album release.
Its two metallic samples are generated locally by `cli/createDevelopmentDemo.ts`.

The 16-bar arrangement has a main groove, a related bass/beat phrase, two sparse
bars, a two-bar fill and a return. Hat decay and brightness develop over the piece;
two sample alternatives alternate on the existing hat lane. The chord send rises
at beat 28, then closes, while the shared delay darkens. A snapshot settles the
chord sound at beat 48. These are computed demonstrations; no listening score is
claimed.

```sh
yarn cli validate --project cli/fixtures/development-demo.json
yarn cli resolve --project cli/fixtures/development-demo.json --output events.json
yarn cli render --project cli/fixtures/development-demo.json --output demo.wav --cache-dir .render-cache --report render.json
yarn cli render --project cli/fixtures/development-demo.json --output throw.wav --start 6 --end 8 --unit bars --cache-dir .render-cache
yarn cli stems --project cli/fixtures/development-demo.json --output stems --start 6 --end 8 --unit bars --cache-dir .render-cache
yarn cli bounce --project cli/fixtures/development-demo.json --source dub --name "Echo texture" --output texture.grproject.json --start 6 --end 8 --unit bars --cache-dir .render-cache
```

Range positions start at zero and the end is exclusive. Bars use the first track's
numerator; API callers can supply `beatsPerBar`. The example includes the echo
throw at musical bars 7–8. Run `yarn cli features` for current parameter definitions.
`--verbose` reports stages; Ctrl+C cancels a rendering command.

## Compatibility

`PresetData.studio` and `PresetTrackData.development` are optional. Normalization
does not add them to old projects. A development object activates only with
`enabled: true`; imported samples alone do not activate a track. Creating a shared
return explicitly selects the new rendering path. Missing fields continue to use
the established defaults, integer interpretation, drum lane/MIDI mapping, routing,
voice stealing, note releases and timing. Legacy CLI flags and their defaults are
preserved. No schema migration is required for this additive format.

Legacy browser playback/export retains its Tone graph, including browser-specific
phase and noise behavior. Legacy native rendering retains its DSP, summation order
and deterministic dither. New developed projects use the same native DSP in a
browser worker and Node. This intentionally gives the new paths matching audio
and control semantics without replacing legacy browser oscillators.

Projects, presets, libraries, track copies, merges and the full-project URL retain
development data and embedded assets. Merge deduplicates asset hashes and remaps
colliding return IDs and all their references. Copying an entire project preserves
random choices. Duplicating a track gives it a new ID and thus a distinct random
identity. Source tracks merged into a different project use that project's seed.

The app reads older projects faithfully. Export **for an older application** is
not offered: older versions cannot represent banks, conditions, locks, samples,
snapshots, automation or returns in their project schema. MIDI flattens resolved
notes, velocity, gates and timing, with portamento CC5/65; it cannot encode these
sound controls faithfully. WAV or bounced samples flatten audible results, at the
cost of editable synthesis and arrangement. Do not remove new fields and call the
remaining JSON a faithful old-version export.

## Phrase scheduling

Each enabled track can have `patterns` with stable IDs, names, integer `sequence`
strings, step controls and voice overrides. Settings inherit from the track.
Programmatic developed tracks must supply a stable track ID; save normalized IDs
with the project instead of generating them again for each render.
Overrides use the same voice parameter registry as locks; bus changes use motion
curves. Without `sections`, the existing sequence, delay, padding and repeats still
determine the track length. A bank does not replace the single-sequence workflow.

Sections reference a pattern ID, a positive length and `unit: 'bars' | 'beats'`.
One bar is the track's numerator in quarter-note beats. The existing sequence
denominator retains its established meaning: one step occupies `1 / denominator`
beats. Track delay occurs once before the arrangement. Track repeats no longer
multiply an explicit section arrangement. Each section repeats its phrase until
the specified end; its last repetition may be partial.

Phrase phase, repeated padding and time warp restart in each phrase repetition.
Each section's default pattern determines its repetition slot length, including
padding. Conditional alternatives fit that slot: longer alternatives lose attacks
beyond its end; shorter alternatives leave space. Alternative changes never move
later sections. `cut` (the default) clips note gates at the section boundary and
prevents a tie from crossing it. `carry` permits gates, releases and valid ties to
continue. Release envelopes and effect tails remain audible after a cut gate.
Timing offsets are applied after phase/time warp. Attacks shifted outside their
section are discarded; cut durations are clipped again.

Legacy `B` is separate: its masks still divide the complete song into equal
duration sections, using original track order. Inactive sections drop new attacks
and truncate sounding gates. Activation is applied before tying and again after
ties, so a tie cannot bridge an inactive section. `B` boundaries are not replaced
by phrase sections. Effect tails retain the established release behavior.

Conditions combine `every` (repetitions N, 2N, …), `first`, `fill` and
`probability` in [0,1]. Repetition counting restarts within a section. Section
choices are evaluated in array order at each phrase repetition; the last matching
choice wins. Event conditions determine whether that attack plays, rather than
merely whether its accent applies. Track controls precede pattern controls.
For all-zero probabilities the event never occurs; probability one always passes.

Project and track seeds are saved unsigned 32-bit values, combined by XOR. Random
values are hashes of the seed and stable track/section/event identity, never a
mutable random stream. Worker count, track rendering order and excerpt selection
cannot consume or reset the random sequence. Round robin counts resolved attacks
per lane (or melodic track), across the full song, after conditions and ties.

## Articulation and sound precedence

Step indices and drum lane indices begin at 0. A control with no `note` or `lane`
applies to the entire chord/hit event. `note` selects a MIDI pitch in a polyphonic
chord; `lane` selects a drum lane. Note-specific controls split chords consistently
so velocities, gates and ties remain independent. Slides/legato require a
monophonic melodic track. A tie joins touching/overlapping gates of identical
pitches and lane, removes the following attack and retains the first voice's
settings. Drum hits use choke/retrigger behavior and cannot tie.

`velocity` is normalized 0–1 and reuses existing per-lane integer velocity decoding.
`gate` multiplies the scheduled duration; `durationBeats` replaces it. `slide` is
seconds and selects the existing always-glide mode for that attack. `legato`
selects the existing overlapping-note envelope rule. `offsetBeats`, bounded
`timingVariation` and `velocityVariation` are deterministic. Velocity variation is
clamped to [0,1]. Sound-only values remain saved even when MIDI cannot represent
them. Slide CCs reset to the next event's effective value.

Sound precedence is:

1. Track/lane base settings and the selected pattern's voice overrides.
2. Selected snapshot values, including numeric morphs from the prior sound.
3. Timeline curves, in array order (last connected curve wins).
4. That event's locks, held for its voice/hit.
5. Existing LFO/envelope modulation offsets and destination limits.

Every voice/hit gets fresh controls. A later event without a lock does not inherit
one, and overlapping voices do not share mutable lock state. Bus locks are rejected
because an event cannot privately change a shared mixer/effect bus. Use track
`gain`, `reverbWet`, `echoWet`, `echoFeedback` motion curves for those controls.
Shared sends support voice/lane scope (`send.RETURN_ID`); a per-hit send lock cannot
alter the dry level. The Dub returns tab provides individual lane sends as constant
song curves, which can be developed further in Motion.

Targets and ranges come from `parameterDefinitions()` and the existing drum
definitions (`lane.INDEX.PARAMETER`). Instrument modulation destinations are
`modulation.TARGET`, such as `modulation.pitch`, `modulation.level` and spectral
controls. Pass the track kind to `parameterDefinitions(lanes, returns, trackKind)`:
drum track filtering is a bus control, while individual lane filters are voice
controls. Synth envelope/glide targets are omitted for drum tracks. Unsupported
target/voice combinations produce validation errors.
Lane-scoped curves and snapshot cues require drum voice controls; a shared bus
always applies to the whole track. Melodic controls cannot select drum lanes.

Curves have beat-positioned points and `linear`, cubic smoothstep `smooth`, or
`step` interpolation. Discrete choices require `step`; numeric envelope/source
settings are evaluated at attacks, while continuous filter, level and send controls
continue during sounding voices. `clock: 'song'` uses absolute song beats;
`'note'` uses beats since that voice's attack. Buses/returns use song time. Snapshot
cues are ordered song beats; compatible numeric values morph linearly, discrete
values change at the morph end. A new overlapping morph starts at the actual value
of the previous morph at that cue. Common continuous controls and return controls
use short 5 ms smoothing. Explicit per-hit voice changes retain intentional attacks.

## Routing and samples

Legacy inserts keep their original order. Melodic voices apply their envelopes,
modulation and voice filters, then track waveshaping/tanh/limiter gain, track level,
vibrato/tremolo/chorus/flanger/phaser, track echo and fades. Drum voices apply lane
filters and choke/retrigger behavior; drum echo sends return before the track
waveshaper, with drum track filtering/fades after inserts. Global reverb receives
the existing sends, filters them, then convolves its deterministic impulse. Global
dry trim precedes the wet addition. Master gain and shared soft clipping run last.

New auxiliary sends tap individual voices/lane output before track inserts, with
track level and fade applied to the send. Sources feed named returns; returns feed
the pre-master mix. Return-to-return edges are not accepted. Each return processes
its serialized chain in order, then its own level. Delay output contains repeats
only; its feedback loop applies low-pass filtering and normalized tanh saturation
before reinjection. Modes are independent stereo, mono and ping-pong. Chain
filters, saturation and gain provide further shaping. Return automation targets
`level` or `PROCESSOR_ID.PARAMETER`. Feedback is bounded to 0–0.95; invalid graphs,
invalid dimensions and non-finite audio fail explicitly. Automation of delay time
changes pitch, as a continuously moving delay tap does. Finite tails decay to the
estimated -100 dB threshold; full physical infinity is not rendered.

Sample import supports RIFF WAV, mono/stereo, 8–192 kHz: PCM 8/16/24/32-bit or
IEEE float 32/64-bit. Compressed WAV, MP3 and other containers are unsupported.
Samples have a region in seconds, gain in dB, MIDI root note, semitone tuning,
attack/release and one-shot/loop mode. Playback uses linear resampling at the normal
48 kHz render rate. A one-shot ends at its region end, or releases when its gate
ends sooner. Loops wrap the region until gate release. Monophonic legato retains
sample position/envelope when the selected asset and region remain the same;
changing the alternative starts its source anew. Existing glide, pitch envelope,
filter and pitch/level/pan modulation work with tuned samples. Sample-source
attack/release define the sampler envelope, followed by the melodic track's ADSR
envelope. Both constrain the audible sample release.

One sample source replaces a selected drum lane, preserving its index and MIDI
mapping, or replaces a melodic source. Sampled drum decay, brightness, tuning,
filters and sends reuse applicable lane definitions; synthesized transient/noise
controls cannot reconstruct an imported waveform and are rejected for that lane.
Velocity-layer bounds are inclusive. Round robin cycles eligible alternatives;
seeded random chooses among them. A velocity with no eligible layer is an error.
Sample drum hits retain existing choke groups and same-voice replacement.

Assets contain canonical Float32 PCM arrays, sample rate, a name and a SHA-256 hash
covering audio/rate/channel layout. Rendering verifies hashes and reports missing
assets; it never depends on browser object URLs. **Portable project** and CLI
`pack` export `{type:'gaterunner-asset-package',version:1,project:...}` with all
assets embedded. Preset/library exports also preserve embedded assets. Large audio
can make JSON/URLs large; use the asset package for sharing substantial samples.
Bounces record the normalized source project, selected original-song range, source
ID, renderer version and rate. CLI `sample` imports a WAV into the pool; assign it
to a source in the UI or API.

## Rendering, stems and caching

Excerpts resolve the complete schedule first, then process audio from song origin
through the requested end and crop the result. They retain preceding envelopes,
oscillator/noise/filter state, mono glide, choke decisions, LFO clocks, snapshots,
seeds, delay and reverb state. There is no unvalidated jump into a song. Early
excerpts allocate buffers only through their end. Returns process contiguous
blocks with persistent ring, filter and smoothing state. Existing voices/inserts
keep their full causal buffers to preserve numerical behavior. Quality remains
48 kHz/24-bit WAV for mix exports, with original synthesis, polyphony and modulation
resolution. Stem exports use 48 kHz/32-bit float WAV to preserve unmastered samples
above full scale without clipping.

Track post-insert stems include their track effects and global dry trim. Global
reverb and each auxiliary return are separate wet stems. Sum only files marked
`recombine: true` in `stems.json`, then apply master gain and GateRunner master
soft clipping once. This reproduces the appropriate pre-master mix within Float32
summation rounding. Independently clipped/mastered stems cannot
recombine through nonlinear processing. Optional track/lane pre-insert sources
are marked `recombine: false`: they omit shared track inserts and cannot reproduce
a nonlinear drum bus by processing every lane independently. Excerpts crop all
stems at identical original-song positions.

CLI `stems --stem-stage post` exports recombining track/wet-return files;
`--stem-stage pre` exports dry editing sources. `--no-lane-stems` and
`--no-pre-insert-stems` omit those optional files. The API accepts `stemStage`,
`laneStems` and `preInsertStems`; the Render tab offers source inclusion controls.
Dry sources retain voice/lane filtering, track level and fades, while bypassing
track distortion, time effects and the shared drum track filter.

In-browser caching uses a bounded 256 MiB LRU. Native disk entries have canonical
SHA-256 keys and atomic completion writes; metadata, renderer version, dimensions,
payload checksum and finite values are checked before reuse. Keys cover track and
resolved events, timing, automation, snapshots, seeds, assets, routing, gain/effects,
rate and renderer version. Return keys include all input track keys. Completed
warm-up prefixes have separate end-frame keys; full entries can serve shorter
excerpts. Incomplete writes/checkpoints are never resumed. No intermediate-state
checkpoint format is offered. Conservative keys may invalidate more work than
strictly necessary. Disk caches are user-managed; delete a cache directory to clear
it. Renderer changes must bump `RENDERER_VERSION`.

Browser exports run in a worker; cancellation terminates it. CLI/API AbortSignal
rendering runs in a cancellable worker, preserving completed disk entries.
Custom in-process caches yield between tracks and return blocks. Developed browser
Play prepares audio before starting playback; editing/mute/solo stops prepared
playback (including preparation) and the next Play prepares the current project.
Muting preserves phrase lengths, song activation boundaries and random identities;
API callers can use `mutedTrackIds` for the same behavior. This is suitable for
composition previews, with a preparation delay for long projects. Legacy live
editing keeps its existing behavior.

## Importable API

Build with `yarn build:cli`, then import `dist-cli/cli/projectApi.js` in Node. Or use
`cli/projectApi.ts` with `tsx`. These operations accept normalized `PresetData`;
`loadProject` accepts raw project, preset, library or portable package files.
Libraries use the selected preset, falling back to their first preset.

```js
import { loadProject, supportedFeatures, validateProject, normalizeProject,
  resolveProjectEvents, renderProject, exportStems, bounceSample,
  exportProjectPackage } from './dist-cli/cli/projectApi.js';

const project = await loadProject('cli/fixtures/development-demo.json');
console.log(supportedFeatures());
console.log(validateProject(project).diagnostics);
const events = await resolveProjectEvents(project);
const controller = new AbortController();
const rendered = await renderProject(project, {
  output: 'range.wav', range: {start: 6, end: 8, unit: 'bars'},
  cacheDirectory: '.render-cache', signal: controller.signal,
  onProgress: ({completed,total,stage}) => console.log(completed,total,stage)
});
console.log(rendered.file, rendered.measurements, rendered.performance);
await exportStems(project, 'stems', {range: {start: 6,end: 8,unit: 'bars'}});
const sample = await bounceSample(project, 'Echo texture', 'dub', {
  range: {start: 6,end: 8,unit: 'bars'}
});
project.studio.assets.push(sample);
await exportProjectPackage(project, 'texture.grproject.json');
```

Measurements are duration in seconds, rate in Hz, absolute sample peak, RMS across
all channel samples, and count of channel samples with absolute value ≥1.
They are computed audio measurements, not listener assessments, LUFS or true peak.
No unsupported loudness accuracy claim is made. Progress covers rendering stages;
performance includes render elapsed time and process peak RSS (a lifetime high-water
mark). Encoding/file I/O is outside the reported renderer elapsed time.

## Verification and performance

`yarn test` runs the repository tests, including frozen pre-change WAV/MIDI/raw
channel hashes, worker-count equality, serialization/merging/sharing, conditions,
ties/activation, locks, automation precedence, samples, routing, block continuity,
excerpts, stem recombination, cache corruption/invalidation and cancellation.
`node cli/verifyDevelopmentBrowser.mjs` uses a disposable Chrome profile and local
Vite server to verify editor/playback and browser/native event, MIDI and waveform
agreement. Set `CHROME_PATH` if Chrome is installed elsewhere.

The original five compatibility fixtures were captured before DSP edits. Additional
engine coverage is generated from the immutable original Git archive, whose commit
is recorded in `cli/fixtures/legacy-2026.10.3.json`. The capture command requires
that archive explicitly; do not regenerate golden fixtures against modified DSP.

Measured on Windows, Node 24.13, the 16-bar demonstration at 48 kHz:

| Render | Elapsed | Reused work | Process peak RSS |
| --- | ---: | --- | ---: |
| Full, uncached | 21.41 s | none | 718.2 MiB |
| Full, cached | 3.76 s | 3 tracks + 1 return | 804.0 MiB cumulative |
| Bars 6–8, cached | 1.09 s | 3 tracks + 1 return | 819.4 MiB cumulative |
| Bars 6–8, uncached | 8.48 s | none | 850.4 MiB cumulative |

The repeated full render was 5.70× faster; the cached excerpt was 7.78× faster
than the same uncached excerpt, and 19.63× faster than the uncached full render.
These are measured workloads, not claims of DSP speedup on every project.
Process RSS rows are successive high-water marks from
one benchmark process retaining prior results/cache; they are not independent
per-render allocations. Estimated working buffers fell from 205,296,000 bytes
for a full render to 79,872,000 bytes for an uncached excerpt. Results vary with
hardware and project. The recorded results are in
`cli/fixtures/development-performance.json`.
`yarn bench:development` reproduces the full/cache/excerpt comparison and writes
`dist/development-benchmark/report.json`.

The implementation phases are compatibility fixtures and shared scheduling;
optional model/persistence and controls; shared DSP/samples/returns;
rendering/API/cache; then editor/demo and end-to-end verification. Current limits:
full-length voice/instrument buffers up to the excerpt end, finite effect-tail
estimates, linear sample resampling, pre-rendered developed playback, and pre-insert
lane stems where nonlinear shared processing prevents faithful independent wet
lane recombination. Existing chorus/flanger/phaser settings remain available as
track settings; new timeline targets are explicitly listed by `features`.
