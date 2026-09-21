import { markRaw } from 'vue';
import * as Tone from 'tone';

export interface PhaserOptions extends Tone.ToneAudioNodeOptions {
  /** Number of first-order allpass poles; each pole pair creates one sweeping notch. */
  stages: number;
  /** Sweep center in Hz; poles are spaced one octave apart around it. */
  centerFrequency: number;
}

export interface PhaserSettings {
  /** LFO rate in Hz (one sweep cycle per selected note division). */
  frequency: number;
  /** Sweep around the center frequency, in ±octaves. */
  sweepOctaves: number;
  /** Notch sharpness of the allpass poles. */
  Q: number;
  /** Feedback around the cascade (0-0.95); resonates the notches. */
  feedback: number;
  /** Dry/wet mix; 0.5 gives the deepest phase cancellation. */
  wet: number;
}

/** The phaser mix is always at least half wet so the sweeping notches stay audible. */
const PHASER_MIN_WET_MIX = 0.5;

/** Widest sweep the octaves-to-Hz waveshaper can represent. */
const MAX_SWEEP_OCTAVES = 12;

/** Highest allpass resonance accepted by the Web Audio biquad filters. */
const MAX_STAGE_Q = 1000;

/**
 * Tone params reject out-of-range values by throwing, which would abort playback,
 * so every incoming setting is clamped (and non-finite values fall back to a safe
 * default) before it reaches an audio param.
 */
function clampSetting(value: number, min: number, max: number, fallback: number = min): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

/**
 * First-order allpasses phase-shift frequencies near their corner by up to 90°,
 * so one pole pair sums to full cancellation against the dry signal. The poles of
 * a classic phaser are spaced one octave apart around the sweep center so the
 * notches march together instead of bunching up at one frequency.
 */
function getStageOffsetOctaves(index: number, stagesCount: number): number {
  return (index * 2) - (stagesCount - 1);
}

/**
 * Driving the frequency params directly with a bipolar LFO would waste the lower
 * half of the sweep (negative Hz clamps to 0), so stages are driven in octaves
 * around the center frequency and converted to Hz with a 2^x waveshaper.
 */
function createOctavesToFrequencyConverter(centerFrequency: number): Tone.WaveShaper {
  return markRaw(new Tone.WaveShaper(
    (value) => centerFrequency * Math.pow(2, Math.max(-12, Math.min(12, value))),
    1024,
  ));
}

/**
 * A classic phaser pedal: a cascade of LFO-swept first-order allpass filters
 * mixed against the dry signal, with optional feedback resonance around the
 * cascade. Behaves as a single ToneAudioNode so it drops into the track chain
 * like any other Tone effect.
 */
export class Phaser extends Tone.ToneAudioNode<PhaserOptions> {
  readonly name = 'Phaser';

  readonly input: Tone.Gain;
  readonly output: Tone.Gain;

  /** Cascade of first-order allpass filters; each pair creates one sweeping notch. */
  readonly stages: Tone.Filter[] = [];
  /** Tempo-synced bipolar LFO driving the stage corner frequencies. */
  readonly lfo: Tone.LFO;
  /** Adds the stage's octave offset from the sweep center, one per stage. */
  readonly centerOffsets: Tone.Add[] = [];
  /** One octave-domain to Hz converter (x ↦ center · 2^x) per stage. */
  readonly frequencyConverters: Tone.WaveShaper[] = [];
  /** Scales feedback amount into negative feedback around the cascade. */
  readonly feedbackGain: Tone.Gain;
  /** Makes the feedback cycle valid in Web Audio with an inaudible one-sample delay. */
  readonly feedbackDelay: Tone.Delay;
  /** Mixes the dry signal against the cascade output to create the notches. */
  readonly mix: Tone.CrossFade;
  readonly stagesCount: number;
  readonly centerFrequency: number;
  private feedbackConnected = true;

  constructor(options?: Partial<PhaserOptions>) {
    super(options as PhaserOptions);
    this.stagesCount = Math.max(2, Math.round(options?.stages ?? 4));
    this.centerFrequency = Math.max(1, options?.centerFrequency ?? 660);

    this.input = markRaw(new Tone.Gain(1));
    this.output = markRaw(new Tone.Gain(1));
    this.mix = markRaw(new Tone.CrossFade(0.5));
    this.feedbackGain = markRaw(new Tone.Gain(0));
    const feedbackDelaySeconds = 1 / this.context.sampleRate;
    this.feedbackDelay = markRaw(new Tone.Delay(feedbackDelaySeconds, feedbackDelaySeconds));
    this.lfo = markRaw(new Tone.LFO({
      type: 'sine',
      min: -1,
      max: 1,
      phase: 270,
    }));

    let cascadeTail: Tone.ToneAudioNode = this.input;
    for (let index = 0; index < this.stagesCount; index += 1) {
      const stage = markRaw(new Tone.Filter({ type: 'allpass', Q: 1, frequency: this.centerFrequency }));
      const centerOffset = markRaw(new Tone.Add(getStageOffsetOctaves(index, this.stagesCount)));
      const converter = createOctavesToFrequencyConverter(this.centerFrequency);
      this.lfo.connect(centerOffset);
      centerOffset.connect(converter);
      converter.connect(stage.frequency);
      cascadeTail.connect(stage);
      cascadeTail = stage;
      this.stages.push(stage);
      this.centerOffsets.push(centerOffset);
      this.frequencyConverters.push(converter);
    }

    // Dry vs cascade: frequencies rotated 180° by a pole pair cancel out into notches.
    this.input.connect(this.mix.a);
    cascadeTail.connect(this.mix.b);
    this.mix.output.connect(this.output);
    // Negative feedback stays stable for any stage count while sharpening the notches.
    cascadeTail.connect(this.feedbackGain);
    this.feedbackGain.connect(this.feedbackDelay);
    this.feedbackDelay.connect(this.input);

    this.lfo.start();
  }

  apply(settings: PhaserSettings) {
    // Sweep depth is applied to the LFO's output range, not its amplitude: amplitude
    // is a normalRange [0, 1] param and would throw on any sweep wider than an octave.
    const sweepOctaves = clampSetting(settings.sweepOctaves, 0, MAX_SWEEP_OCTAVES, 0);
    this.lfo.set({
      frequency: clampSetting(settings.frequency, 0, 1000, 1),
      amplitude: 1,
    });
    this.lfo.min = -sweepOctaves;
    this.lfo.max = sweepOctaves;
    this.feedbackGain.gain.value = -clampSetting(settings.feedback, 0, 0.95, 0);
    // A zero-gain cycle can still make Web Audio insert a render quantum of latency.
    const feedbackEnabled = this.feedbackGain.gain.value !== 0;
    if (feedbackEnabled !== this.feedbackConnected) {
      if (feedbackEnabled) this.feedbackDelay.connect(this.input);
      else this.feedbackDelay.disconnect(this.input);
      this.feedbackConnected = feedbackEnabled;
    }
    const stageQ = clampSetting(settings.Q, 0.0001, MAX_STAGE_Q, 0.0001);
    this.stages.forEach((stage) => {
      stage.Q.value = stageQ;
    });
    this.mix.fade.value = PHASER_MIN_WET_MIX
      + (1 - PHASER_MIN_WET_MIX) * clampSetting(settings.wet, 0, 1, 0);
  }

  dispose(): this {
    this.lfo.stop();
    this.lfo.dispose();
    this.stages.forEach((stage) => stage.dispose());
    this.centerOffsets.forEach((offset) => offset.dispose());
    this.frequencyConverters.forEach((converter) => converter.dispose());
    this.feedbackGain.dispose();
    this.feedbackDelay.dispose();
    this.mix.dispose();
    this.input.dispose();
    this.output.dispose();
    super.dispose();
    return this;
  }
}
