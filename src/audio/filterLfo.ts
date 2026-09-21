import type * as Tone from 'tone';
import { createSkewLfoState, sampleLfoAtTime, type LfoWaveform, type LfoPhaseMode } from './lfo.js';

export interface FilterLfoOptions {
  enabled: boolean;
  frequencyHz: number;
  amount: number;
  waveform: LfoWaveform;
  initPhase: number;
  retrigger?: LfoPhaseMode;
  a4?: number;
}

const CONTROL_INTERVAL = 1 / 200;

/** Continuous cutoff modulation with optional note or playback phase resets. */
export class FilterLfo {
  private readonly state = createSkewLfoState();
  private options: FilterLfoOptions | null = null;
  private nextTime = 0;
  private listening = false;
  private noteStarts: number[] = [0];
  private songStarts: number[];
  private readonly tick = () => this.schedule();
  private readonly songStart = (time: number) => {
    if (this.addStart(this.songStarts, time) && this.options?.retrigger === 'song') {
      this.refresh(Math.max(time, this.filter.context.now()));
    }
  };

  constructor(private readonly filter: Tone.Filter, private readonly isActive: () => boolean = () => true) {
    const time = filter.context.now();
    const transport = filter.context.transport;
    // Voices allocated during playback share the current song's phase origin.
    this.songStarts = [transport.state === 'started' ? time - transport.getSecondsAtTime(time) : 0];
    transport.on('start', this.songStart);
  }

  triggerNote(time: number): void {
    if (this.addStart(this.noteStarts, time) && this.options?.retrigger === 'note') {
      this.refresh(Math.max(time, this.filter.context.now()));
    }
  }

  private addStart(starts: number[], time: number): boolean {
    if (starts.includes(time)) return false;
    starts.push(time);
    starts.sort((a, b) => a - b);
    // Retain the current origin plus future events, including notes queued offline.
    const now = this.filter.context.currentTime;
    while (starts.length > 1 && starts[1]! <= now) starts.shift();
    return true;
  }

  private startAtTime(time: number): number {
    const starts = this.options?.retrigger === 'note' ? this.noteStarts
      : this.options?.retrigger === 'song' ? this.songStarts : [];
    for (let index = starts.length - 1; index >= 0; index -= 1) {
      if (starts[index]! <= time + 1e-9) return starts[index]!;
    }
    return 0;
  }

  private localTime(time: number): number {
    return Math.max(0, time - this.startAtTime(time));
  }

  set(options: FilterLfoOptions): void {
    options = { ...options, retrigger: options.retrigger ?? 'song' };
    if (JSON.stringify(options) === JSON.stringify(this.options)) {
      this.wake();
      return;
    }
    this.options = { ...options };
    const time = this.filter.context.now();
    if (!options.enabled || options.amount === 0) {
      this.filter.detune.cancelAndHoldAtTime(time);
      this.filter.context.off('tick', this.tick);
      this.listening = false;
      this.filter.detune.linearRampToValueAtTime(0, time + CONTROL_INTERVAL);
      return;
    }
    this.pause();
    this.wake(time);
  }

  /** Resume without resetting free/song/note phase. Future reserved notes count as active. */
  wake(time = this.filter.context.now()): void {
    if (this.listening || !this.options?.enabled || this.options.amount === 0) return;
    // Keep offline scheduling unchanged: native graphs are assembled before rendering.
    if (!this.filter.context.isOffline
      && (this.filter.context.state === 'suspended' || !this.isActive())) return;
    time = Math.max(this.filter.context.currentTime, Math.min(time, this.filter.context.now()));
    if (!this.listening) {
      this.filter.context.on('tick', this.tick);
      this.listening = true;
    }
    this.filter.detune.cancelAndHoldAtTime(time);
    this.filter.detune.setValueAtTime(this.detuneAtTime(time), time);
    this.nextTime = time + CONTROL_INTERVAL;
    this.schedule();
  }

  private pause(): void {
    this.filter.context.off('tick', this.tick);
    this.listening = false;
  }

  /** Recompute queued modulation where a new frequency envelope changes cutoff limits. */
  refresh(time: number): void {
    if (!this.listening || time >= this.nextTime) return;
    this.filter.detune.cancelScheduledValues(time);
    this.filter.detune.setValueAtTime(this.detuneAtTime(time), time);
    this.nextTime = time + CONTROL_INTERVAL;
    this.schedule();
  }

  private detuneAtTime(time: number): number {
    const options = this.options!;
    const offset = sampleLfoAtTime(this.state, this.localTime(time), options.frequencyHz,
      options.waveform, options.initPhase) * options.amount;
    const baseMidi = 69 + 12 * Math.log2(Number(this.filter.frequency.getValueAtTime(time)) / (options.a4 ?? 440));
    return (Math.max(0, Math.min(127, baseMidi + offset)) - baseMidi) * 100;
  }

  private schedule(): void {
    if (!this.listening) return;
    if (!this.filter.context.isOffline
      && (this.filter.context.state === 'suspended' || !this.isActive())) {
      this.pause();
      return;
    }
    // Fill the look-ahead window on the context clock, including offline rendering.
    const end = this.filter.context.now() + CONTROL_INTERVAL * 2;
    const options = this.options!;
    const stepped = options.waveform === 'square' || options.waveform === 'sample-hold';
    while (this.nextTime <= end) {
      const time = this.nextTime;
      const start = this.startAtTime(time);
      if (start > time - CONTROL_INTERVAL && start <= time) {
        this.filter.detune.setValueAtTime(this.detuneAtTime(start), start);
      }
      const value = this.detuneAtTime(time);
      const wraps = Math.floor(this.localTime(time) * options.frequencyHz + options.initPhase)
        !== Math.floor(this.localTime(time - CONTROL_INTERVAL) * options.frequencyHz + options.initPhase);
      if (stepped || (wraps && (options.waveform === 'saw-up' || options.waveform === 'saw-down'))) {
        this.filter.detune.setValueAtTime(value, time);
      } else {
        this.filter.detune.linearRampToValueAtTime(value, time);
      }
      this.nextTime += CONTROL_INTERVAL;
    }
  }

  dispose(): void {
    this.filter.context.off('tick', this.tick);
    this.filter.context.transport.off('start', this.songStart);
    this.listening = false;
  }
}
