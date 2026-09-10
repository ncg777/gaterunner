import * as Tone from 'tone';
import { buildPitchEnvelopeCurve } from './pitchEnvelope';
import { createSkewLfoState, sampleLfoAtTime, type LfoWaveform } from './lfo';

type SynthOptions = Tone.SynthOptions;

export interface VoiceFilterOptions {
  enabled: boolean;
  type: BiquadFilterType;
  frequencyMidi: number;
  rolloff: -12 | -24 | -48 | -96;
  Q: number;
  gain: number;
  keyFollow: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  amount: number;
  lfoEnabled: boolean;
  lfoFrequencyHz: number;
  lfoAmount: number;
  lfoWaveform: LfoWaveform;
  lfoInitPhase: number;
}

export interface PitchEnvelopeSynthOptions extends SynthOptions {
  pitchEnvelope: {
    attack: Tone.Unit.Time;
    decay: Tone.Unit.Time;
    sustain: Tone.Unit.NormalRange;
    release: Tone.Unit.Time;
  };
  /** Pitch modulation depth in MIDI pitches (converted to cents on the detune bus). */
  pitchEnvelopeAmount: number;
  /** Exponential steepness for pitch envelope segments (0 = linear). */
  pitchEnvelopeShape: number;
  voiceFilter: VoiceFilterOptions;
}

/**
 * Tone.Synth voice with a per-note ADSR pitch envelope summed into detune (cents).
 * Used by PolySynth so each voice gets independent pitch-envelope state.
 */
export class PitchEnvelopeSynth extends Tone.Synth {
  readonly name: string = 'PitchEnvelopeSynth';

  readonly pitchEnvelope: Tone.Envelope;
  readonly filter: Tone.Filter;
  private readonly pitchCents: Tone.Multiply;
  private readonly filterLfoState = createSkewLfoState();
  private _pitchEnvelopeAmount = 0;
  private _pitchEnvelopeShape = 0;
  private voiceFilterOptions: VoiceFilterOptions;
  private filterBaseFrequency = 20000;

  constructor(options?: Partial<PitchEnvelopeSynthOptions>) {
    const defaults = PitchEnvelopeSynth.getDefaults();
    const mergedPitchEnvelope = {
      ...defaults.pitchEnvelope,
      ...(options?.pitchEnvelope ?? {}),
    };
    super({
      ...defaults,
      ...options,
      envelope: {
        ...defaults.envelope,
        ...(options?.envelope ?? {}),
      },
      oscillator: {
        ...defaults.oscillator,
        ...(options?.oscillator ?? {}),
      },
    });

    this.pitchEnvelope = new Tone.Envelope({
      context: this.context,
      attack: mergedPitchEnvelope.attack,
      decay: mergedPitchEnvelope.decay,
      sustain: mergedPitchEnvelope.sustain,
      release: mergedPitchEnvelope.release,
      attackCurve: 'linear',
      decayCurve: 'linear',
      releaseCurve: 'linear',
    });
    this.pitchCents = new Tone.Multiply({
      context: this.context,
      value: 0,
    });
    this.pitchEnvelope.connect(this.pitchCents);
    this.pitchCents.connect(this.detune);
    this.voiceFilterOptions = {
      ...defaults.voiceFilter,
      ...(options?.voiceFilter ?? {}),
    };
    this.filter = new Tone.Filter({
      context: this.context,
      type: this.voiceFilterOptions.type,
      frequency: this.midiToFrequency(this.voiceFilterOptions.frequencyMidi),
      rolloff: this.voiceFilterOptions.rolloff,
      Q: this.voiceFilterOptions.Q,
      gain: this.voiceFilterOptions.gain,
    });
    this.routeFilter();
    this.pitchEnvelopeAmount = options?.pitchEnvelopeAmount ?? defaults.pitchEnvelopeAmount;
    this.pitchEnvelopeShape = options?.pitchEnvelopeShape ?? defaults.pitchEnvelopeShape;
  }

  static getDefaults(): PitchEnvelopeSynthOptions {
    return Object.assign(Tone.Synth.getDefaults(), {
      pitchEnvelope: {
        attack: 0.01,
        decay: 0.1,
        sustain: 0,
        release: 0.2,
      },
      pitchEnvelopeAmount: 0,
      pitchEnvelopeShape: 0,
      voiceFilter: {
        enabled: false,
        type: 'lowpass' as BiquadFilterType,
        frequencyMidi: 119,
        rolloff: -24 as const,
        Q: 1,
        gain: 0,
        keyFollow: 0,
        attack: 0.01,
        decay: 0.1,
        sustain: 1,
        release: 0.1,
        amount: 0,
        lfoEnabled: false,
        lfoFrequencyHz: 1,
        lfoAmount: 0,
        lfoWaveform: 'sine' as LfoWaveform,
        lfoInitPhase: 0,
      },
    });
  }

  get pitchEnvelopeAmount(): number {
    return this._pitchEnvelopeAmount;
  }

  set pitchEnvelopeAmount(amount: number) {
    this._pitchEnvelopeAmount = amount;
    // Envelope is 0-1; scale to cents so 1 MIDI pitch = 100 cents.
    this.pitchCents.value = amount * 100;
  }

  get pitchEnvelopeShape(): number {
    return this._pitchEnvelopeShape;
  }

  set pitchEnvelopeShape(shape: number) {
    this._pitchEnvelopeShape = shape;
    this.applyPitchEnvelopeShape(shape);
  }

  /** Apply numeric exponential steepness as custom Tone envelope curves. */
  applyPitchEnvelopeShape(shape: number) {
    if (shape < 1e-6) {
      this.pitchEnvelope.attackCurve = 'linear';
      this.pitchEnvelope.decayCurve = 'linear';
      this.pitchEnvelope.releaseCurve = 'linear';
      return;
    }

    const curve = buildPitchEnvelopeCurve(shape);
    // Attack rises with the curve; release falls with the reversed curve.
    // Tone decayCurve only supports linear/exponential, so use exponential for non-zero shape.
    this.pitchEnvelope.attackCurve = curve;
    this.pitchEnvelope.decayCurve = 'exponential';
    this.pitchEnvelope.releaseCurve = curve.slice().reverse();
  }

  set(props: Partial<PitchEnvelopeSynthOptions>): this {
    const { pitchEnvelope, pitchEnvelopeAmount, pitchEnvelopeShape, voiceFilter, ...rest } = props;
    if (Object.keys(rest).length > 0) {
      super.set(rest);
    }
    if (pitchEnvelope) {
      this.pitchEnvelope.set(pitchEnvelope);
    }
    if (typeof pitchEnvelopeAmount === 'number') {
      this.pitchEnvelopeAmount = pitchEnvelopeAmount;
    }
    if (typeof pitchEnvelopeShape === 'number') {
      this.pitchEnvelopeShape = pitchEnvelopeShape;
    }
    if (voiceFilter) {
      this.voiceFilterOptions = { ...this.voiceFilterOptions, ...voiceFilter };
      this.filter.set({
        type: this.voiceFilterOptions.type,
        rolloff: this.voiceFilterOptions.rolloff,
        Q: this.voiceFilterOptions.Q,
        gain: this.voiceFilterOptions.gain,
      });
      this.routeFilter();
    }
    return this;
  }

  setNote(note: Tone.Unit.Frequency | Tone.FrequencyClass, time?: Tone.Unit.Time): this {
    super.setNote(note, time);
    if (this.voiceFilterOptions.enabled) {
      this.scheduleFilterAttack(note, this.toSeconds(time));
    }
    return this;
  }

  private routeFilter(): void {
    this.envelope.disconnect();
    this.filter.disconnect();
    if (this.voiceFilterOptions.enabled) {
      this.envelope.connect(this.filter);
      this.filter.connect(this.output);
    } else {
      this.envelope.connect(this.output);
    }
  }

  protected scheduleFilterAttack(note: Tone.Unit.Frequency | Tone.FrequencyClass, startTime: number): void {
    const options = this.voiceFilterOptions;
    const noteMidi = Tone.Frequency(note).toMidi() + 12;
    const keyFollowMidi = (noteMidi - 69) * options.keyFollow / 100;
    const lfoOffsetMidi = options.lfoEnabled && options.lfoAmount !== 0
      ? sampleLfoAtTime(
        this.filterLfoState,
        startTime,
        options.lfoFrequencyHz,
        options.lfoWaveform,
        options.lfoInitPhase,
      ) * options.lfoAmount
      : 0;
    const baseMidi = this.clampMidi(options.frequencyMidi + keyFollowMidi + lfoOffsetMidi);
    this.filterBaseFrequency = this.midiToFrequency(baseMidi);
    this.filter.frequency.cancelAndHoldAtTime(startTime);

    if (options.amount === 0) {
      this.filter.frequency.linearRampToValueAtTime(this.filterBaseFrequency, startTime + this.sampleTime);
      return;
    }

    const attackEnd = startTime + Math.max(options.attack, this.sampleTime);
    const decayEnd = attackEnd + Math.max(options.decay, this.sampleTime);
    const frequencyForLevel = (level: number): number => this.midiToFrequency(
      this.clampMidi(baseMidi + options.amount * level),
    );
    this.filter.frequency.linearRampToValueAtTime(frequencyForLevel(1), attackEnd);
    this.filter.frequency.linearRampToValueAtTime(frequencyForLevel(options.sustain), decayEnd);
  }

  private clampMidi(midi: number): number {
    return Math.max(0, Math.min(127, midi));
  }

  private midiToFrequency(midi: number): number {
    return 440 * 2 ** ((midi - 69) / 12);
  }

  protected _triggerEnvelopeAttack(time: number, velocity: number): void {
    super._triggerEnvelopeAttack(time, velocity);
    this.pitchEnvelope.triggerAttack(time);
  }

  protected _triggerEnvelopeRelease(time: number): void {
    super._triggerEnvelopeRelease(time);
    this.pitchEnvelope.triggerRelease(time);
    if (this.voiceFilterOptions.enabled) {
      this.filter.frequency.cancelAndHoldAtTime(time);
      this.filter.frequency.linearRampToValueAtTime(
        this.filterBaseFrequency,
        time + Math.max(this.voiceFilterOptions.release, this.sampleTime),
      );
    }
  }

  dispose(): this {
    this.pitchEnvelope.dispose();
    this.pitchCents.dispose();
    this.filter.dispose();
    return super.dispose();
  }
}
