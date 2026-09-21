# GateRunner performance review

## Realtime lifecycle follow-up — 2026.9.21

This change targets background control/DSP work, not synthesis resolution:

- Prewarmed `PitchEnvelopeSynth` voices no longer subscribe to the 200 Hz
  filter-LFO scheduler while unused. Attacks wake scheduling; future reservations,
  held notes, amplitude releases and a conservative resonance-settling allowance
  keep it active. Finished voices unsubscribe. Phase origins remain absolute and
  offline scheduling remains eager. Suspended contexts shed their tick listeners.
- Disabling vibrato, tremolo, chorus, flanger or phaser disposes its graph, including
  the flanger LFO and phaser input/output gains. Enabled effects are not restarted
  merely because routing changes. Chorus spread uses the same resting-DC correction
  as tremolo, avoiding a phase restart as a workaround.
- Stop retains outstanding notes and effect tails. A temporary stereo analyser
  waits until queued note durations/releases have elapsed and output stays below
  -120 dBFS for at least one second and longer than the configured echo/reverb gap.
  It then disposes itself and suspends the captured realtime AudioContext. Play
  cancels/awaits pending suspension before resuming; repeated Stop retains that
  promise. Ordinary stopped-state clicks do not wake the context. Offline export
  uses its own context and is not suspended by this controller.
- App/package version is `2026.9.21`; the committed `docs/` PWA build is refreshed.

Validation used the immutable Yarn lock (Tone 15.5.36), Node 24 and headless Chromium:

- All 268 Node tests pass, along with Vue and CLI TypeScript checks and the
  production Vite/PWA build.
- `runAudioLifecycleChecks`: 32 allocated voices have **zero idle filter-LFO
  listeners**; a future/sounding note wakes exactly one. Release completion removes
  it and reuse wakes it again. Three disable/re-enable cycles dispose/recreate all
  five modulation effects. Chorus spread, sleep cancellation and resume pass.
- `runTransportSleepChecks`: repeated Stop, immediate Stop/Play, waiting for tails,
  stopped UI clicks and playback after suspension pass.
- Existing filter-update PCM comparisons (all four slopes), idle wavetable checks,
  filter-LFO phase checks, native effects/synthesis, Unison sound and waveshaper
  comparisons pass. The new live fixtures save/restore Tone's global waveform cache
  so they do not contaminate later offline fixtures at another sample rate.

Reproduce focused native checks with an installed Chrome and `CHROME_PATH`:

```sh
node cli/profileBrowser.mjs runAudioLifecycleChecks runTransportSleepChecks
node cli/profileBrowser.mjs runFilterUpdateSoundChecks runIdleModulationChecks runFilterLfoChecks
node cli/profileBrowser.mjs runNativeEffectChecks runNativeSynthesisChecks runUnisonSoundChecks runWaveshaperChecks
```

These are lifecycle counts and regression checks, **not measured whole-app CPU
percentages or hardware underrun measurements**. No sample rate, harmonic count,
unison count, audible control cadence, polyphony ceiling or oversampling setting
was reduced. A resonant tail's settling allowance is an estimate; extreme settings
deliberately retain work longer. Context sleep is based on measured output silence,
not a fixed truncation timeout. Active wavetable pool-wide updates, dynamic pool
sizing and live standby-waveshaper disconnection remain separate follow-up work.

## Realtime follow-up: control edits and silent rests

Implemented three further changes without reducing synthesis quality:

- `resolveSynthMode` selects the engine without rebuilding the noise/choir control
  objects and formant arrays on every note and wavetable tick. It retains explicit
  mode precedence and legacy waveform migration. Full normalization still runs
  when the complete settings are needed. A local 20,000-call measurement using a
  Vue-reactive default track took 513.3 ms for full normalization versus 4.1 ms
  for mode resolution; this is an isolated control-path measurement.
- Filter updates omit an unchanged rolloff. Tone's rolloff setter otherwise
  reconstructs the entire native biquad bank, even for the same slope. This
  applies to per-voice filters, rhythmic track filters, drum edits and legacy
  formant banks. Per-voice routing also stays connected unless filter enablement
  changes. Actual slope/type/Q/gain changes still apply normally.
- Realtime polyphonic wavetable loops skip spectrum preparation while the voice
  pool is completely silent. Every attack still resolves the spectrum at its
  current transport/note time. Reserved future notes and release tails keep
  receiving updates. Offline rendering and mono/glide behavior remain eager.

`runFilterUpdatePerformanceChecks` measured **192.9 ms -> 4.4 ms** for 60 control
updates across eight native filters, eliminating **960 redundant biquad
allocations**. This measures control-edit work, not whole-song speed or audio
thread utilization. `runFilterUpdateSoundChecks` compares repeated settings
updates against uninterrupted native filtering during held notes, release tails
and reuse: all four slopes (-12/-24/-48/-96 dB/octave) have exactly equal PCM.
Retaining filter history also avoids resetting it during unrelated voice edits.

`runIdleModulationChecks` confirms 90 silent callbacks perform zero spectrum
preparations, while attacks, scheduled future notes, release tails and reused
voices still update. All 261 Node tests pass, along with native browser checks
for partial generators, Unison sound, voice filters/lifecycle, modulation phase,
all filter-LFO waveform/retrigger combinations, percussion, live engine controls,
scheduled engine switches and offline context restoration. Six oversampled
waveshaper comparisons remain sample-identical. Vue/CLI TypeScript checks and
the Vite/PWA build in `dist/realtime-followup-build` pass.

The browser profiler now excludes the three-second warmup from CPU sampling as
well as timing in `PROFILE_MODES=steady`. Earlier steady CPU profiles included
startup even though their task/timer measurements did not. Optional Google Fonts
are blocked before navigation so proxy/network delays cannot stall startup.
The final six-track steady run recorded zero tasks over 50 ms during eight
seconds, with a 45.1 ms maximum timer gap. The preceding steady run also had zero
long tasks (34.2 ms maximum gap), so these runs do **not** demonstrate a general
dense-playback latency improvement. The proven savings are redundant control
updates and preparation during silence; hardware audio underruns were not measured.

Reproduce the focused browser checks with:

```sh
node cli/profileBrowser.mjs runFilterUpdatePerformanceChecks runFilterUpdateSoundChecks runIdleModulationChecks
```

Sample rate, partial counts, Unison oscillators, oversampling, audible modulation
cadence and effect tails are unchanged. Native periodic-wave construction remains
a sustained-playback cost. These results do not justify a quality reduction or
a browser DSP rewrite; warm standby shapers remain unchanged because transition
state would need separate validation.

## Implementation results

Implemented the primary optimizations from this review:

- Animated CLI tonewheel sampling reuses harmonic tables and shares per-event
  modulation across notes/unison. It sums the two table endpoints before
  interpolation, preserving the original floating-point operations exactly.
- Both peak-estimation grids reuse bounded Float64 sine bases and scratch storage.
  Static peak reuse handles changed realtime input arrays correctly.
- Browser wavetable sources are prepared when voice settings change. Modulation
  skips equal coefficients and updates only partials/gain; animated callbacks no
  longer serialize the entire wavetable for an unused cache key.
- Browser export uses Tone's exact clock ticks with elapsed-time yields, preserving event order/context
  restoration. Fixed offline graphs do not feed their standby 4x waveshaper.
- CLI workers reuse prepared projects, refill a bounded queue on completion, and
  respect estimated memory limits. Tracks without notes omit empty reverb buffers.
  The original tiny -96 dB contribution remains when another track enables reverb.
- Stereo filters share coefficient calculations while keeping independent state;
  glide frequency is evaluated once per sample.
- Browser WAV encoding runs in a worker with one bounded PCM transfer in flight
  (2 MiB for stereo), preserving source buffers and deterministic dither state.
  Worker failures fall back to the existing yielding encoder. This moves encoding
  off the UI thread; it does not eliminate the full rendered audio/output buffers.
- Voice-pool retention updates reuse their collector and timer during control
  edits. CLI worker and serial rendering now share the same project snapshot.

The captured `vector-wavetable` reference took **44,701.9 ms**; the first optimized
comparison took **550.2 ms (81x faster)**. All five standard benchmark WAVs were
byte-identical. The final comparison after all changes took **559.1 ms (80x faster)**,
with all five WAVs still byte-identical. Additional original-versus-optimized comparisons covered changing
tonewheel spectra with three unison voices, vibrato, pitch/filter envelopes and
free/note/song retrigger; these took 9.9-10.1 seconds originally and 82-138 ms after
optimization, again with byte-identical WAVs. Explicit waveform/procedural and
generic mixed-source cases also matched. These measurements are fixture-specific,
not a claim of an 81x improvement for every project.

`node cli/benchHotspots.mjs` now measures production implementations against the
original direct peak sum and full oscillator tables. One run measured peak recovery
at 739.5 -> 24.7 ms and changing oscillator blocks at 796.4 -> 14.3 ms (including
cold harmonic-table setup); both comparisons were exactly equal.

Browser checks passed for voice lifecycle, per-voice filters, partial generators,
modulation phase, offline clock equivalence and context restoration. The new
`runPerformanceOptimizationChecks` confirms exact PCM equality for six native 4x
waveshaper cases and verifies modulation update deduplication. The pre-existing
`runWaveshaperChecks` originally failed on both versions because it compared native
4x oversampling with a non-oversampled scalar reference. Its reference now uses an
independent native 4x graph, with unchanged tolerances: all eight adapter and 16
application graph cases pass (maximum application difference 2.384e-7).
`runWavWorkerChecks` confirms byte-identical WAVs with and without dithering,
retained source AudioBuffer data, progress reporting, and a responsive browser
event loop while the worker encodes. The worker is included in the PWA precache.

The earlier CLI follow-up passed all **210 Node tests** with native module mocks
enabled, Vue/CLI TypeScript checks, and a production Vite/PWA build into
`dist/performance-build`.
After the encoding changes, all five benchmark WAVs still match the original
references exactly; the animated vector fixture took 551.1 ms in that run.

Live standby-branch disconnection, broader voice-pool lifecycle changes, worker-based
browser DSP and full streaming renders remain
future architectural work. Live shapers remain warm to preserve transition state;
sample rate, harmonics, unison, oversampling, modulation cadence and tails are unchanged.

## Browser profiling and implementation

### Unison sound and active waveform processing

Unison voices now start at a common phase and diverge at their separately detuned
frequencies. Tone's evenly spaced starting phases canceled harmonics at low/zero
detune, particularly with sparse tonewheel spectra. This is an intentional sound
correction in live playback, browser export and CLI rendering. New tracks default
to 12 cents of detune; explicitly saved values, including zero, remain intact.

`src/audio/unisonPartials.ts` shares one prepared wave per context, spectrum and
common phase across all Unison members and pooled notes. Previously each unison
phase needed its own native wave. Idle voices still defer preparation until attack;
raw audio time keeps release tails and future-scheduled notes included. Coefficient
buffers contain only the actual spectrum. Structural settings are applied before
the final shared wave, avoiding redundant partial updates. Unexpected Tone private
internals fall back to the public setter.

`node cli/profileBrowser.mjs runUnisonSoundChecks runActiveUnisonPerformanceChecks
runUnisonOptimizationChecks runNativeSynthesisChecks` verifies independent detuned
single-synth references, actual two-voice beating, zero-detune reinforcement, live
count/phase/spread edits, signed/zero spectra, rests and voice reuse. The independent
2/3/8-voice references differ by at most **4.47e-8** PCM. Ninety waveform updates
of sounding eight-voice Unison require **90 native waves instead of 720**, shared
across eight sounding notes. This measures active waveform preparation, not just
idle work. Unison retains its full set of detuned oscillators.

The six-track `PROFILE_MODES=steady,export` fixture in `dist/unison-coherent`
spent approximately **285 ms** of sampled native waveform CPU time versus
**870 ms** in `dist/unison-before`, about **67% less**. Export took **12,621 ms**
versus **16,242 ms**, about **22% less**. Steady playback had no tasks over 50 ms;
the largest timer gap was 45.1 ms. These are synthetic fixture measurements,
not hardware audio-thread CPU percentages. Export hashes change with the corrected
starting phases; the acceptance reference is the independent detuned voice bank.
The equal-size eight-note bank benchmark measured 90 active updates at
**604.1 ms -> 66.9 ms** with eight Unison oscillators per note. The full Node
suite passed (255 tests), as did the subsequently expanded zero-detune/default
regressions, native browser sound/lifecycle/modulation checks, Vue and CLI
TypeScript checks, and the production Vite/PWA build in `dist/unison-build`.

### Realtime polling correction

The next investigation isolated sustained playback from startup with
`PROFILE_MODES=steady` (three seconds of warmup, then eight measured seconds).
GateRunner set `context.lookAhead = 0.4`, but Tone's setter also sets
`updateInterval = lookAhead / 2`. The resulting 200 ms polling interval batched
approximately six 30 Hz wavetable updates per track into a single scheduler tick.
Native waveform construction was expensive partly because it arrived in bursts.

`configureRealtimeScheduling` retains the 400 ms scheduling cushion and sets
polling independently to 10 ms. It does not change event timestamps, harmonics,
unison, or modulation sample cadence, and leaves offline contexts untouched.
Realtime waveform changes are delivered more regularly instead of being bunched
into five main-thread callbacks per second. Repeated control edits do not restart
the ticker when its settings already match.

In the same six-track sustained-playback fixture, long tasks (>50 ms) fell from
**32 to 0** over eight seconds. The largest observed task was 105 ms before the
fix; the maximum timer gap fell from 111.2 to 65.2 ms. Total waveform computation
remains similar: this corrects its scheduling, not its harmonic resolution.
These are main-thread measurements, not a measurement of hardware audio underruns.

Use `PROFILE_POLL_BASELINE=1` with `PROFILE_MODES=steady` to reproduce the old
200 ms polling while retaining the other optimizations. Unit and native Tone
checks cover the setter interaction and offline isolation; all 223 Node tests
pass, along with browser audio/phase/lifecycle checks and TypeScript checks.

`node cli/profileBrowser.mjs` profiles a disposable Chrome instance running six
animated tonewheel tracks, three unison oscillators per voice, and filter
envelopes. Playback and export have separate CPU profiles. `PROFILE_BASELINE=1`
restores the old padded wave preparation and Tone clock in the benchmark only;
`PROFILE_OUTPUT` selects a separate results directory. This is a synthetic stress
project, not a captured user session. Development-mode instrumentation and system
load affect these timings; they are not universal performance guarantees.

The main playback hotspot was native periodic-wave construction. Tone supplies
2048 coefficients even for short custom spectra. The new context adapter omits
only trailing coefficients whose real and imaginary parts are both zero. It
preserves normalization, phases, all nonzero harmonics and the modulation rate.

Offline scheduling now yields after approximately 8 ms of work, retaining the
same 128-frame ticks, addition order and event times. It uses ordinary posted
tasks: prioritized `scheduler.yield()` continuations improved task lengths but
starved timers in this workload. Individual callbacks and initial graph setup
can still exceed the budget. The adapter checks Tone 15's private clock fields
and falls back to Tone's scheduler if they are absent; dependency upgrades should
rerun the clock equivalence tests.

| Browser stress measurement | Baseline | Final |
| --- | ---: | ---: |
| Export elapsed | 22,253.9 ms | 15,856.0 ms |
| Longest export task | 2,340 ms | 133 ms |
| Maximum export timer gap | 3,462.6 ms | 762.7 ms |
| Longest playback task | 1,336 ms | 645 ms |

The final export took about **29% less time**. Sampled native periodic-wave CPU
time during eight seconds of playback fell from roughly 3.3 seconds to 1.3 seconds.
Heavy playback still produces substantial stalls; this does not claim glitch-free
realtime audio or measure hardware audio underruns.

Audio validation:

- 36 native wave comparisons (six spectrum sizes, three sample rates, normalized
  and unnormalized) produced exactly equal PCM. The 60-second clock equivalence
  fixture also remains sample-exact; cancellation restores the live context.
- Full baseline-versus-final stress WAVs differed by at most 4.768e-7, RMS 2.473e-8.
  Two unchanged exports differed by the same peak and RMS 2.518e-8. Therefore this
  browser fixture is not bit-repeatable; no byte-identical full-export claim is made.
- All **221 Node tests**, native-browser lifecycle/filter/partial/modulation/
  waveshaper/WAV checks, and Vue/CLI TypeScript checks passed. The production build
  was verified separately under `dist/performance-build`.

## Follow-up CLI profiling

No saved user project was available in the repository. The existing `--long`
fixtures were used as reproducible stress workloads, not as a substitute for
measuring a user's actual realtime session.

Profile command (create the output directory first):

```sh
node --cpu-prof --cpu-prof-dir=dist/performance-review --cpu-prof-name=remaining.cpuprofile --import tsx cli/bench.ts --threads 1 --long
```

The combined profile attributed about 8.18 seconds of self time to the track
render callback and 5.58 seconds to a static spectrum oscillator callback, versus
0.75 seconds to WAV encoding and 0.46 seconds to reverb processing. These sampled
figures include all seven fixtures; timings below were measured without profiling.

Implemented two further optimizations:

- Reuse oscillator band selection when frequency and sample rate are unchanged.
  Changing either still recomputes the exact original Nyquist limit. Tests cover
  repeated frequencies, sample-rate changes, silent bands, and return from silence.
- Mix tracks directly when filtering and fades are disabled, avoiding per-sample
  filter event scheduling, cutoff evaluation, and identity filter calls. Float32
  accumulation, channel order, drum sends, and effect processing remain unchanged.

| Stress fixture | Before these changes | After (two runs) |
| --- | ---: | ---: |
| Long static filter | 1,909.9 ms | 1,797.1 / 1,833.7 ms |
| Long 12-track mix with reverb | 13,474.3 ms | 11,597.7 / 11,684.8 ms |

The repeat run reduced 12-track render time by about **13%**. All seven WAV hashes
match the captured pre-change references, with zero PCM differences. The full
210-test suite and CLI TypeScript checks pass. These CLI measurements do not
establish realtime browser speedups or justify a browser DSP rewrite; streaming
remains a separate opportunity for reducing large-project memory usage.

## Original review

Reviewed 2026-09-17 at commit `c4e5d07`, before modifying production audio code.
The review covers browser playback, browser WAV export, and the separate CLI WAV
renderer. The largest opportunities remove repeated waveform preparation while
preserving sample rate, harmonic content, interpolation, modulation cadence,
unison, envelopes, effects, and export precision.

Measurements below report the initial local runs on Windows with Node 24.13.0
and an AMD Ryzen 5 5560U. A subsequent hotspot verification run also passed its
numerical assertions; timings vary with JIT warmup and system load. Browser
findings are source-level findings, including inspection of the installed Tone
15.5.36 implementation; browser CPU and dropout improvements are not measured.

## Measured evidence

`node --import tsx cli/bench.ts --threads 1` completed successfully:

| Existing fixture | Elapsed | WAV hash |
| --- | ---: | --- |
| sine-polyphonic | 330.6 ms | bba1a89ee842a89f |
| pulse-unison | 183.7 ms | 39127e2b31238388 |
| flute-breath-filter | 149.3 ms | d583a1c387c9efbd |
| vector-wavetable | **42,765.0 ms** | 8745c7b434f72a48 |
| rhythmic-kit | 1,004.7 ms | 4e6fde6926b81cda |

These fixtures have different durations and workloads; the table is not a
controlled comparison of individual features. The animated case nevertheless
reproduces a severe slowdown. No reference WAV comparison was requested in this run.

The review-only experiment `node cli/benchHotspots.mjs` loads the current production
functions and compares them with small alternative implementations:

| Experiment | Current | Prototype | Output comparison |
| --- | ---: | ---: | --- |
| Peak recovery: 90 distinct 128-partial spectra | 732.8 ms | 79.9 ms | Exactly equal |
| Sparse tonewheel: 128 distinct 64-frame blocks | 801.6 ms | 10.6 ms | Maximum absolute difference 1.11e-16 |

These are approximately **9.2x** and **75.5x** improvements to the isolated work,
not whole-render speedups. Prototype setup costs were respectively 40.8 ms and
41.3 ms; retained basis data requires approximately 4.0 MiB and 4.5 MiB. The
oscillator experiment includes multiple Nyquist cutoffs. It is a focused numerical
check, not a substitute for complete audio regression testing.

## Prioritized findings and optimizations

1. **Critical: CLI animated tonewheel rebuilds full oscillator tables every 64 frames.**

   In [cli/generate.ts](cli/generate.ts), the inner loop at line 1463 calls
   `prepareTonewheelSpectrumOscillator` for every modulation block, inside both the
   note and unison loops. At 48 kHz this is 750 preparations per second of each
   sounding voice. The first oscillator sample then builds a 65,537-element
   Float64 table using sine evaluation for every nonzero partial
   ([cli/partialOscillator.ts](cli/partialOscillator.ts), lines 25-32).
   Changing drawbars also invokes an 8,192-point peak scan through
   `resolvePartialSourceSpectrum`. Continuously varying drawbars defeat the
   spectrum and oscillator caches; the 32-table cache cannot recover repeated
   long trajectories across sequentially rendered notes or unison voices.

   **Optimize:** retain immutable harmonic basis tables and combine their
   interpolated samples using the current normalized amplitudes. Tonewheel needs
   at most nine active harmonic positions. Preserve the existing table grid,
   phase, strict Nyquist cutoff, and 64-frame modulation boundaries. Prepare the
   modulation and normalization trajectory once per event and reuse it across
   its notes and unison voices; keep frequency-dependent band limits per voice.
   Preserve note/free/song retrigger semantics when sharing trajectories.

   The prototype demonstrates this oscillator transformation with error at
   floating-point roundoff scale. Normalization must also be optimized; otherwise
   its repeated peak scan becomes the next bottleneck. Preserve static table
   lookup for long unchanging spectra, where it is already inexpensive.

2. **High: generic wavetable peak recovery consumes substantial main-thread time.**

   [src/audio/partialSpectrumGain.ts](src/audio/partialSpectrumGain.ts), line 25,
   evaluates `4099 * spectrum.length` sine terms on every call, including zero
   coefficients. [src/App.vue](src/App.vue), lines 2044 and 2659, calls it when
   applying generic wavetable modulation, from a 30 Hz loop (line 2704) and note
   triggers (line 2121). With 128 partials that is 15.7 million sine evaluations
   per second per track from the modulation loop alone. Browser export executes
   the same callbacks during offline scheduling. Static generic wavetables also
   use this uncached peak routine when oscillator settings are reapplied.

   **Optimize:** precompute Float64 sine bases for the existing 4,099- and
   8,192-point grids and reuse scratch buffers. Retain the existing summation
   order for exact equivalence. Cache peaks for immutable static spectra and
   prepare bases outside scheduling callbacks, with a bounded memory budget.
   The measured 4,099-point prototype returned exactly equal peaks. Skipping
   zero coefficients is another straightforward reduction. Do not replace peak
   normalization with RMS, a smaller sample grid, or removal of normalization:
   these change levels and therefore downstream distortion.

3. **High: every modulation tick applies a full oscillator configuration to the entire voice pool.**

   [src/App.vue](src/App.vue), line 2667, supplies `type`, `count`, `spread`,
   `partials`, and `volume` on each change. Animated spectra are new arrays, so
   the identity check at line 2664 does not suppress numerically unchanged
   results, including positions clamped to a boundary. Installed Tone
   `PolySynth.set` updates every pooled voice plus its dummy voice. Its oscillator
   `type` setter performs periodic-wave lookup, and setting `partials` invokes
   that work again. Custom-wave cache lookup linearly scans up to 100 entries
   using partial-array equality. Unison multiplies this work by oscillator count.
   Tone guards unchanged `count`; this is not a claim that count rebuilds the
   oscillator graph on every tick.

   **Optimize first:** send only `partials` and changed gain during modulation;
   update structural settings only when the user edits them. Compare coefficient
   values or prepared state versions before submitting updates. Compile immutable
   source spectra/configuration data when settings change: currently
   `getTonewheelPartials` serializes the entire generic wavetable even when its
   animated cache lookup is disabled, and `blendPartialWavetableSpectra`
   renormalizes and serializes each configuration on every blend.

   **Further option:** prepare waves once per context, spectrum, and unison phase,
   then distribute them through an explicit oscillator adapter. Updating only
   sounding voices requires applying the latest state before reuse and including
   release tails. Treat this as a lifecycle change needing browser tests; merely
   shrinking the voice pool or skipping tails changes the sound.

4. **Medium: browser export runs all scheduling callbacks synchronously before native rendering.**

   [src/audio/offlineRender.ts](src/audio/offlineRender.ts), line 16, calls
   `context.render(false)`. Installed Tone `OfflineContext._renderClock` advances
   through every 128-sample quantum without yielding in this mode, invoking the
   expensive modulation callbacks above before `startRendering`. The 39 native
   suspend/resume progress checkpoints in [src/App.vue](src/App.vue), line 1270,
   occur after this phase and cannot make scheduling responsive.

   **Optimize:** fix waveform preparation first, then budget main-thread
   scheduling work and yield between chunks while retaining Tone clock/event
   ordering. Tone's asynchronous render mode is an available responsiveness
   tradeoff, not a throughput optimization: it inserts timer waits. Offload pure
   spectral preparation and WAV encoding to a worker where useful. Measure
   scheduling, native rendering, and encoding separately. Preserve context
   restoration and complete graph preparation before native rendering. Reducing
   progress checkpoints is a lower-priority overhead experiment, not the main fix.

5. **Medium: CLI parallel rendering uses full-song buffers and can leave workers idle.**

   [cli/generate.ts](cli/generate.ts), lines 1277-1305, allocates full-duration
   Float64 result channels plus Float32 track channels for each selected track.
   Reverb-send arrays are allocated based on whether *any* track sends reverb,
   including workers rendering a track with no send. Four Float64 and two
   Float32 channels at 48 kHz consume about **576 MB per worker for five minutes**,
   before extra drum buffers, the master mix, and encoded WAV.

   [cli/renderPool.ts](cli/renderPool.ts), line 90, waits for results in track
   order and dispatches the next job only after yielding that worker's result.
   A slow early track can keep already-finished workers idle. Thread count is
   limited by CPU count and track count, not duration or memory. Each worker task
   also calls `prepareRenderData(options)` again for all tracks (generate.ts:1259).

   **Optimize:** prepare immutable project data once per worker/session, allocate
   sends only for the selected track when needed, and use a bounded completion
   queue to dispatch work independently of ordered mixing. Add a memory-based
   concurrency cap. A later streaming renderer can carry oscillator, filter,
   delay, reverb, and dither state across blocks; preserve source-order mixing and
   Float32 rounding boundaries to retain deterministic output. More workers alone
   will not fix the table-building algorithm and can increase memory pressure.

6. **Medium: inactive waveshaper branches remain fed with audio.**

   [src/audio/waveshaperEffect.ts](src/audio/waveshaperEffect.ts), lines 166-170,
   permanently connects both native shapers at 4x oversampling. A settled
   transition only sets the inactive branch's downstream gain to zero. This
   leaves a redundant processing branch in the graph, including offline graphs
   that never need a live crossfade. Actual native CPU savings need browser
   measurement because graph pruning is browser-dependent.

   **Optimize:** use one active shaper for a fixed offline render. For live
   editing, feed the standby shaper only around transitions, allowing its
   oversampling filters to settle before the existing crossfade and disconnecting
   it afterwards. Preserve 4x oversampling and crossfade timing; a cold branch
   switched on abruptly could change transients. Stateful DC filtering also needs
   care before treating a bypass as permission to stop its processing.

7. **Lower priority: CLI repeats identical per-sample control calculations.**

   [cli/generate.ts](cli/generate.ts), lines 1516 and 1530, evaluates the same glide
   frequency twice per sample. Both stereo filters (lines 1571-1572) independently
   calculate identical coefficients when the cutoff changes. Envelope and
   modulation trajectories are also repeated across notes/unison voices of the
   same event where their inputs match.

   **Optimize:** calculate the glide ratio once, share a stereo coefficient
   generator while retaining independent filter histories, and reuse bounded
   control blocks for matching event timing. Keep cutoff/envelope evaluation at
   the existing sample cadence. Static filter coefficient caching and disabled
   filter fast paths already exist; adding another static cache is not the main
   opportunity.

## Implementation order and sound-quality checks

Implement findings 1-3 first, followed by scheduling responsiveness and worker
memory/scheduling. Browser native-DSP changes should follow profiling rather than
an assumption that every connected silent branch is processed.

- Capture reference WAVs with `cli/bench.ts --write-reference` before changing DSP;
  compare hashes where exact equivalence is intended, and decoded PCM peak/RMS
  errors where floating-point operation order changes. Preserve deterministic dither.
- Add fixtures explicitly selecting `partialGenerator: { type: 'waveform' }`,
  64-harmonic procedural sources, generic mixed-source wavetables, and animated
  tonewheel with dense chords/unison. Existing fixtures named `pulse-unison` and
  `flute-breath-filter` omit `partialGenerator`; normalization defaults them to
  tonewheel, so those names do not currently prove waveform-source coverage.
- Exercise Nyquist crossings under glide/pitch envelopes/vibrato, zero spectra,
  signed partials, all retrigger modes, long release tails, voice reuse, and
  waveshaper transitions. Keep the original grid sizes and interpolation quality.
- Run existing Node audio tests and browser offline lifecycle/modulation/context
  checks. Compare browser output against the same browser's baseline: browser
  and CLI use different implementations, so cross-engine bit equality is not a
  valid acceptance criterion.
- Measure cold/warm renders separately; record browser main-thread long tasks,
  scheduler deadline misses, stage timings, and peak memory. Microbenchmark
  speedups should not be reported as end-to-end improvements.

Avoid reducing sample rate, harmonic count, unison, oversampling, modulation rate,
or effect tails to obtain speed. The opportunities above target redundant work.
