# Partial Bank

Select **Generator → Synth engine → Partial Bank** on a melodic track.
Each partial is an independent sine oscillator, so its frequency can be any
positive ratio of the played note: 1×, 2.37×, √3×, and so on.

## Playing it

1. Choose an amplitude source below the engine controls. A sawtooth with 16
   harmonics is a useful starting point because every harmonic has an amplitude.
2. Choose a position function and adjust its parameters.
3. Choose a target function and use **Position morph** to move between them.
4. Open the **Modulation** tab, add an envelope or LFO, and route it to **Position
   function · a/b/c**, **Target position · a/b/c**, or **Position morph**.
   Route amounts are offsets, in the units shown by the corresponding function.

Both function controls and modulation change sounding notes while preserving
oscillator phase. Amp/pitch envelopes, filters, effects, breath, unison, polyphony,
and mono glide remain available. Unison count changes take effect on new notes;
unison spread changes affect sounding notes.

### Built-in position functions

Here `n` is the original frequency ratio from the amplitude source. Normal
waveforms and procedural sources use 1, 2, 3, …; tonewheels can also supply 0.5
and 1.5. The half-frequency internal carrier does not change these musical ratios.

| Function | Position before optional anchoring | Controls |
| --- | --- | --- |
| Harmonic | `n` | — |
| Linear spacing | `1 + a*(n-1)` | Spacing |
| Power stretch | `n^a` | Exponent |
| Stiff string | `n*sqrt((1+a*n*n)/(1+a))` | Stiffness |
| Logarithmic | `1 + a*log(n)` | Spread |
| Pitch grid | `2^(a*(n-1)/12)` | Semitones per partial |
| Odd series | `2*n-1` | — |
| Subharmonic | `n^-a` | Exponent |
| Prime series | `prime(round(n))/2` | — |
| Fibonacci series | `1, 2, 3, 5, 8, …` | — |
| Triangular series | `n*(n+1)/2` | — |
| Square series | `n*n` | — |
| Square root | `sqrt(n)` | — |
| Root lattice | `sqrt((n*n+a)/(1+a))` | Compression |
| Golden ratio | `phi^(a*(n-1))` | Spacing exponent |
| Bounded cluster | `1+a*tanh((n-1)/b)` | Width, convergence |
| Alternating detune | `n*2^(±a/1200)` | Opposite odd/even detune |
| Spectral ripple | `n*2^(a*sin(b*(n-1)+c)/1200)` | Depth, rate, phase |
| Seeded irregularity | `n*2^(a*noise(n,seed)/1200)` | Depth, seed |
| Custom expression | For example `n^a + b*sin(c*(n-1))` | a, b, c |

Prime and Fibonacci functions use a rounded ordinal. Custom expressions use
the existing bounded math parser, with `n`, `a`, `b`, `c`, `PI`, `E`, and supported
math functions; they do not execute JavaScript. Invalid expressions show an error.

**Anchor** divides each function by its value at `n=1`, keeping that partial at
the played note. Turning it off permits shifts of the entire bank. Morphing uses
geometric interpolation of ratios, so equal morph steps follow equal pitch
distances. The two endpoints are anchored before interpolation.

Positive ratios are clamped to 1/64–256; invalid or nonpositive results mute the
affected partial. An invalid anchor mutes that function. When morphing between
two functions, a slot with an invalid endpoint is muted between the endpoints.
Large series can reach the ratio ceiling and coincide there.

### Starting recipes

- **Struck string:** Stiff string, stiffness 0.003; a short amp attack and long decay.
- **Metallic bloom:** Harmonic → Square root; send a slow envelope to Position morph.
- **Moving shimmer:** Spectral ripple, depth 30–100 cents; send a slow LFO to its
  phase parameter, Position function · c.
- **Descending organ:** Subharmonic, exponent 1, with a low partial count.
- **Stable disorder:** Seeded irregularity; modulate depth to expand and contract
  the same detuning pattern. Change seed to choose a different pattern.

Amplitude masks, tilt, odd/even controls, and the existing multidimensional
wavetable operate on the original source positions before frequency remapping.
The position functions apply to the whole blended amplitude spectrum. The static
preview shows remapped ratios and excludes modulation and pitch-dependent fading.

## Reviewed implementation

- **Browser:** native Web Audio sine oscillators, integrated with Tone's existing
  voice pool, envelopes, note scheduling, and modulation matrix. Each slot retains
  its own phase while its ratio changes. Only audible slots are initially allocated;
  slots that later become silent stay alive until release to preserve phase.
- **Control rate:** existing 200 Hz scheduling with AudioParam ramps between
  points. LFOs and envelopes animate function parameters; this is control-rate
  motion, not audio-rate FM or arbitrary formula evaluation on every audio sample.
- **CLI:** independent phase accumulators and an interpolated sine lookup table;
  the same position functions, amplitude sources, and modulation definitions.
  A fractional partial never derives phase from the wrapped fundamental phase.
- **Level and bandwidth:** amplitude vectors whose energy exceeds one are scaled
  by their Euclidean norm. Coincident frequencies can still sum coherently; this
  is not a peak limiter. The existing output protection remains in place. The bank
  fades partials over the top 10% of the Nyquist band. Browser frequency/detune
  signals still run at audio rate; connected pitch-envelope signals are not included
  in the control-rate fade estimate. Native sine oscillators supply the final
  browser bandwidth limit, while the CLI fades using the final playback frequency.
- **Persistence:** `synthMode: "partial-bank"` plus `partialBank` and `modulation`
  survive preset cloning, JSON, shared URLs, and CLI `--tracks` input. Existing
  presets keep their previous engine selection.

The native bank fits the current engine architecture and permits browser offline
export without a separate worklet lifecycle. A worklet remains a possible later
optimization for very large banks or audio-rate formula modulation. CPU usage
scales with sounding notes × active partials × unison voices. There is no claim
that maximum settings will run in real time on every device.

Browser and CLI share musical parameters and spectral behavior. They do not
promise sample-identical initial phases: native oscillator starts and control
clock alignment can differ. Mono CLI phase advancement across silent gaps uses
the last frequency and position snapshot, as the existing renderer does for its
carrier; continuously moving positions during a gap may resume at a different
phase from the browser.

## Verification

`src/__tests__/partialBank.test.ts` covers all functions and parameter extremes,
fractional placement, independent phase, expression rejection, seeded patterns,
modulation, persistence, high-frequency fading, and full CLI rendering.

Browser checks are exported from `src/__tests__/offlineRender.browser.ts`:

- `runPartialBankChecks()`: actual fractional spectral peaks, browser/CLI phase
  and level at aligned onset, envelopes, held edits, release, mono glide, and a
  512-oscillator offline stress case.
- `runPartialBankRealtimeChecks()`: oscillator identities remain stable during
  held edits; switching engines restores sound; release returns to zero running
  oscillators.
- Existing engine UI and app-chain checks include Partial Bank in mono and poly
  modes and verify voice-pool reuse when switching engines.
