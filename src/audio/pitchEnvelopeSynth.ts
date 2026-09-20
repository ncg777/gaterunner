import * as Tone from 'tone';
import { EngineSource } from './engineSource';
import { normalizeSynthEngine, type SynthEngineSettings } from './synthEngine';
import { buildPitchEnvelopeCurve } from './pitchEnvelope';
import type { LfoWaveform, LfoPhaseMode } from './lfo';
import { FilterLfo } from './filterLfo';
import { setSharedUnisonPartials } from './unisonPartials';
import { setFilterSettings } from './filterSettings';

type SynthOptions = Tone.SynthOptions;
type EngineEvent =
  | { type: 'attack'; time: number; mono: boolean; stopTime?: number }
  | { type: 'release'; time: number; ampRelease?: number };

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
  lfoRetrigger: LfoPhaseMode;
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
  engine: SynthEngineSettings;
  /** Track-wide note origin broadcast to all voices, including future allocations. */
  filterLfoNoteStartSeconds: number;
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
  private filterLfo: FilterLfo | null = null;
  private filterLfoNoteStartSeconds = -1;
  private _pitchEnvelopeAmount = 0;
  private _pitchEnvelopeShape = 0;
  private voiceFilterOptions: VoiceFilterOptions;
  private filterBaseFrequency = 20000;
  protected engineSource: EngineSource | null = null;
  private engineSignature = "";
  private engineMode: SynthEngineSettings['synthMode'] = 'additive';
  private engineEvents: EngineEvent[] = [];
  private retiring = false;

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

    const initialOscillator = options?.oscillator;
    if (initialOscillator && 'partials' in initialOscillator && initialOscillator.partials) {
      setSharedUnisonPartials(this.oscillator, initialOscillator.partials);
    }

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
    this.filterLfoNoteStartSeconds = options?.filterLfoNoteStartSeconds ?? -1;
    this.filter = new Tone.Filter({
      context: this.context,
      type: this.voiceFilterOptions.type,
      frequency: this.midiToFrequency(this.voiceFilterOptions.frequencyMidi),
      rolloff: this.voiceFilterOptions.rolloff,
      Q: this.voiceFilterOptions.Q,
      gain: this.voiceFilterOptions.gain,
    });
    this.setEngine(options?.engine ?? normalizeSynthEngine({}));
    this.routeFilter();
    this.syncFilterLfo();
    this.pitchEnvelopeAmount = options?.pitchEnvelopeAmount ?? defaults.pitchEnvelopeAmount;
    this.pitchEnvelopeShape = options?.pitchEnvelopeShape ?? defaults.pitchEnvelopeShape;
  }

  static getDefaults(): PitchEnvelopeSynthOptions {
    return Object.assign(Tone.Synth.getDefaults(), {
      engine: normalizeSynthEngine({}),
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
        lfoRetrigger: 'song' as LfoPhaseMode,
      },
      filterLfoNoteStartSeconds: -1,
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
    const { engine, pitchEnvelope, pitchEnvelopeAmount, pitchEnvelopeShape, voiceFilter, oscillator,
      filterLfoNoteStartSeconds, ...rest } = props;
    if (filterLfoNoteStartSeconds !== undefined) {
      this.filterLfoNoteStartSeconds = filterLfoNoteStartSeconds;
      if (filterLfoNoteStartSeconds >= 0) this.filterLfo?.triggerNote(filterLfoNoteStartSeconds);
    }
    if (engine) this.setEngine(engine);
    if (oscillator) {
      if ('partials' in oscillator && oscillator.partials) {
        const { partials, ...settings } = oscillator;
        // Apply topology/detune first, then prepare the final spectrum once.
        // Sending partials through Tone first builds all the phase-offset waves
        // that the shared Unison wave replaces immediately afterwards.
        if (Object.keys(settings).length) this.oscillator.set(settings);
        if (!setSharedUnisonPartials(this.oscillator, partials)) this.oscillator.partials = partials;
      } else {
        this.oscillator.set(oscillator);
        // Count and phase edits create/rephase Tone children; restore the shared
        // starting phase before their next note or waveform update.
        if (this.oscillator.type === 'fatcustom') {
          setSharedUnisonPartials(this.oscillator, this.oscillator.partials);
        }
      }
    }
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
      const wasEnabled = this.voiceFilterOptions.enabled;
      this.voiceFilterOptions = { ...this.voiceFilterOptions, ...voiceFilter };
      setFilterSettings(this.filter, {
        type: this.voiceFilterOptions.type,
        rolloff: this.voiceFilterOptions.rolloff,
        Q: this.voiceFilterOptions.Q,
        gain: this.voiceFilterOptions.gain,
      });
      if (wasEnabled !== this.voiceFilterOptions.enabled) this.routeFilter();
      this.syncFilterLfo();
    }
    return this;
  }

  setNote(note: Tone.Unit.Frequency | Tone.FrequencyClass, time?: Tone.Unit.Time): this {
    super.setNote(note, time);
    this.engineSource?.note(Tone.Frequency(note).toFrequency(), this.toSeconds(time));
    if (this.voiceFilterOptions.enabled) {
      this.scheduleFilterAttack(note, this.toSeconds(time));
    }
    return this;
  }

  private setEngine(engine: SynthEngineSettings): void {
    const signature = JSON.stringify(engine);
    if (signature === this.engineSignature) return;
    if (this.engineSource && engine.synthMode === this.engineMode) {
      this.engineSource.set(engine);
      this.engineSignature = signature;
      return;
    }
    this.engineSignature = signature;
    this.engineMode = engine.synthMode;
    this.engineSource?.dispose();
    this.engineSource = null;
    this.oscillator.disconnect();
    if (engine.synthMode === 'additive') this.oscillator.connect(this.envelope);
    else {
      this.engineSource = new EngineSource(this.context, this.frequency, this.detune, engine);
      this.engineSource.output.connect(this.envelope);
      this.restoreEngineEvents();
    }
  }

  /** Source graphs change independently of the amp envelope's queued notes. */
  private rememberEngineEvent(event: EngineEvent): void {
    this.engineEvents.push(event);
    this.engineEvents.sort((a, b) => a.time - b.time);
    const now = this.context.currentTime;
    let lastAttack = -1;
    this.engineEvents.forEach((entry, i) => {
      if (entry.type === 'attack' && entry.time <= now) lastAttack = i;
    });
    if (lastAttack > 0) this.engineEvents.splice(0, lastAttack);
  }

  private restoreEngineEvents(): void {
    const source = this.engineSource!;
    const now = this.context.currentTime;
    let active: Extract<EngineEvent, { type: 'attack' }> | undefined;
    for (const event of this.engineEvents) {
      if (event.time > now) break;
      if (event.type === 'attack') active = event;
    }
    if (active) {
      const release = this.engineEvents.find(event => event.type === 'release' && event.time >= active!.time);
      const stop = Math.min(active.stopTime ?? Infinity,
        release?.type === 'release' && release.ampRelease !== undefined ? release.time + release.ampRelease : Infinity);
      if (stop > now) {
        source.attack(now, active.mono, active.stopTime);
        if (release && release.time <= now && release.type === 'release') {
          source.release(now, release.ampRelease === undefined ? undefined : Math.max(0, stop - now));
        }
      }
    }
    for (const event of this.engineEvents) {
      if (event.time <= now) continue;
      if (event.type === 'attack') {
        source.note(Tone.Frequency(this.frequency.getValueAtTime(event.time)).toFrequency(), event.time);
        source.attack(event.time, event.mono, event.stopTime);
      } else source.release(event.time, event.ampRelease);
    }
  }

  protected attackEngine(time: number, mono = false, stopTime?: number): void {
    this.rememberEngineEvent({ type: 'attack', time, mono, stopTime });
    this.engineSource?.attack(time, mono, stopTime);
  }

  protected releaseEngine(time: number, ampRelease?: number): void {
    this.rememberEngineEvent({ type: 'release', time, ampRelease });
    this.engineSource?.release(time, ampRelease);
  }

  protected cancelEngine(time: number): void {
    this.engineEvents = this.engineEvents.filter(event => event.time < time);
    this.engineSource?.cancel(time);
  }

  protected resetEngine(time: number): void {
    this.engineEvents = [];
    this.engineSource?.reset(time);
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

  private syncFilterLfo(): void {
    const options = this.voiceFilterOptions;
    if (options.enabled && options.lfoEnabled && options.lfoAmount !== 0) {
      this.filterLfo ??= new FilterLfo(this.filter);
    }
    this.filterLfo?.set({
      enabled: options.enabled && options.lfoEnabled,
      frequencyHz: options.lfoFrequencyHz,
      amount: options.lfoAmount,
      waveform: options.lfoWaveform,
      initPhase: options.lfoInitPhase,
      retrigger: options.lfoRetrigger,
    });
    if (this.filterLfoNoteStartSeconds >= 0) this.filterLfo?.triggerNote(this.filterLfoNoteStartSeconds);
  }

  protected scheduleFilterAttack(note: Tone.Unit.Frequency | Tone.FrequencyClass, startTime: number): void {
    if (this.filterLfoNoteStartSeconds < 0) this.filterLfo?.triggerNote(startTime);
    const options = this.voiceFilterOptions;
    const noteMidi = Tone.Frequency(note).toMidi() + 12;
    const keyFollowMidi = (noteMidi - 69) * options.keyFollow / 100;
    const baseMidi = this.clampMidi(options.frequencyMidi + keyFollowMidi);
    this.filterBaseFrequency = this.midiToFrequency(baseMidi);
    this.filter.frequency.cancelAndHoldAtTime(startTime);

    if (options.amount === 0) {
      this.filter.frequency.linearRampToValueAtTime(this.filterBaseFrequency, startTime + this.sampleTime);
      this.filterLfo?.refresh(startTime);
      return;
    }

    const attackEnd = startTime + Math.max(options.attack, this.sampleTime);
    const decayEnd = attackEnd + Math.max(options.decay, this.sampleTime);
    const frequencyForLevel = (level: number): number => this.midiToFrequency(
      this.clampMidi(baseMidi + options.amount * level),
    );
    this.filter.frequency.linearRampToValueAtTime(frequencyForLevel(1), attackEnd);
    this.filter.frequency.linearRampToValueAtTime(frequencyForLevel(options.sustain), decayEnd);
    this.filterLfo?.refresh(startTime);
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
    this.attackEngine(time, false, this.envelope.sustain === 0
      ? time + this.toSeconds(this.envelope.attack) + this.toSeconds(this.envelope.decay) : undefined);
  }

  protected _triggerEnvelopeRelease(time: number): void {
    super._triggerEnvelopeRelease(time);
    this.pitchEnvelope.triggerRelease(time);
    this.releaseEngine(time, this.toSeconds(this.envelope.release));
    if (this.voiceFilterOptions.enabled) {
      this.filter.frequency.cancelAndHoldAtTime(time);
      this.filter.frequency.linearRampToValueAtTime(
        this.filterBaseFrequency,
        time + Math.max(this.voiceFilterOptions.release, this.sampleTime),
      );
      this.filterLfo?.refresh(time);
    }
  }

  dispose(): this {
    if (this.retiring) return this;
    this.retiring = true;
    this.engineSource?.dispose();
    const cleanup = () => {
      this.filterLfo?.dispose();
      this.pitchEnvelope.dispose();
      this.pitchCents.dispose();
      this.filter.dispose();
      super.dispose();
    };
    if (this.context.isOffline) cleanup();
    else {
      this.disconnect();
      const now = this.context.currentTime;
      this.oscillator.stop(now);
      // Tone's carrier also retains callbacks from previously scheduled notes.
      const end = Math.max(now, ...this.engineEvents.map(event => event.type === 'attack'
        ? event.stopTime ?? event.time : event.time + (event.ampRelease ?? 0)));
      this.context.setTimeout(cleanup, Math.max(this.context.now() - now, end - now) + 0.1);
    }
    return this;
  }
}
