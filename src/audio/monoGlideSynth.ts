import * as Tone from 'tone';
import { PitchEnvelopeSynth } from './pitchEnvelopeSynth';
import {
  DEFAULT_GLIDE_SETTINGS,
  createMonoGlideState,
  planMonoGlide,
  resetMonoGlideState,
  type GlidePlan,
  type GlideSettings,
} from './glide';

/**
 * Single-voice engine used when a track is set to one voice. It adds the two things a
 * PolySynth cannot express: last-note pitch continuity (glide) and true legato, where an
 * overlapping note moves the pitch without restarting the amp and pitch envelopes.
 */
export class MonoGlideSynth extends PitchEnvelopeSynth {
  readonly name: string = 'MonoGlideSynth';

  private glideSettings: GlideSettings = { ...DEFAULT_GLIDE_SETTINGS };
  private readonly glideState = createMonoGlideState();
  private pendingGlide: GlidePlan | null = null;
  private oscillatorRunning = false;

  setGlide(settings: GlideSettings): void {
    this.glideSettings = { ...settings };
  }

  /** Forget the last pitch so playback restarts do not glide in from a stale note. */
  resetGlide(): void {
    resetMonoGlideState(this.glideState);
    this.pendingGlide = null;
    if (this.oscillatorRunning) {
      this.oscillatorRunning = false;
      this.oscillator.stop(this.now());
    }
  }

  /**
   * PolySynth-compatible entry point. Notes arrive as a chord, and classic mono
   * high-note priority picks the winner.
   */
  triggerNotes(
    frequencies: readonly number[],
    duration: Tone.Unit.Time,
    time: Tone.Unit.Time,
    velocity: number,
  ): void {
    if (frequencies.length === 0) {
      return;
    }

    const targetFrequency = Math.max(...frequencies);
    const startTime = this.toSeconds(time);
    const endTime = startTime + Math.max(this.sampleTime, this.toSeconds(duration));
    const plan = planMonoGlide(this.glideState, targetFrequency, startTime, endTime, this.glideSettings);

    this.pendingGlide = plan;
    if (plan.legato && this.glideSettings.legato) {
      // Drop the release the previous note had already queued past this point, then keep
      // its envelopes running and only move the pitch.
      this.envelope.cancel(startTime);
      this.pitchEnvelope.cancel(startTime);
      this.setNote(targetFrequency, startTime);
    } else {
      this.triggerAttack(targetFrequency, startTime, velocity);
    }
    this.triggerRelease(endTime);
  }

  setNote(note: Tone.Unit.Frequency | Tone.FrequencyClass, time?: Tone.Unit.Time): this {
    const plan = this.pendingGlide;
    this.pendingGlide = null;
    if (!plan || plan.seconds <= 0) {
      return super.setNote(note, time);
    }

    const startTime = this.toSeconds(time);
    this.frequency.cancelScheduledValues(startTime);
    this.frequency.setValueAtTime(plan.fromFrequency, startTime);
    if (plan.curve === 'linear') {
      this.frequency.linearRampToValueAtTime(plan.toFrequency, startTime + plan.seconds);
    } else {
      this.frequency.exponentialRampToValueAtTime(plan.toFrequency, startTime + plan.seconds);
    }
    this.scheduleFilterAttack(note, startTime);
    return this;
  }

  /**
   * The oscillator free-runs like an analog VCO. Tone's Synth starts it on every attack and
   * stops it on every release, which would silence each legato note because legato only
   * moves the pitch and never retriggers the envelopes.
   */
  protected _triggerEnvelopeAttack(time: number, velocity: number): void {
    this.envelope.triggerAttack(time, velocity);
    this.pitchEnvelope.triggerAttack(time);
    if (!this.oscillatorRunning) {
      this.oscillatorRunning = true;
      this.oscillator.start(time);
    }
  }

  protected _triggerEnvelopeRelease(time: number): void {
    this.envelope.triggerRelease(time);
    this.pitchEnvelope.triggerRelease(time);
  }
}
