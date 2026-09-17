import type * as Tone from 'tone';
import { createSkewLfoState, sampleLfoAtTime, type LfoWaveform } from './lfo.js';

export interface FilterLfoOptions {
  enabled: boolean;
  frequencyHz: number;
  amount: number;
  waveform: LfoWaveform;
  initPhase: number;
  a4?: number;
}

const CONTROL_INTERVAL = 1 / 200;

/** Free-running cutoff modulation, independent of the frequency ADSR and note gates. */
export class FilterLfo {
  private readonly state = createSkewLfoState();
  private options: FilterLfoOptions | null = null;
  private nextTime = 0;
  private listening = false;
  private readonly tick = () => this.schedule();

  constructor(private readonly filter: Tone.Filter) {}

  set(options: FilterLfoOptions): void {
    if (JSON.stringify(options) === JSON.stringify(this.options)) return;
    this.options = { ...options };
    const time = this.filter.context.now();
    this.filter.detune.cancelAndHoldAtTime(time);
    if (!options.enabled || options.amount === 0) {
      this.filter.context.off('tick', this.tick);
      this.listening = false;
      this.filter.detune.linearRampToValueAtTime(0, time + CONTROL_INTERVAL);
      return;
    }
    if (!this.listening) {
      this.filter.context.on('tick', this.tick);
      this.listening = true;
    }
    this.filter.detune.setValueAtTime(this.detuneAtTime(time), time);
    this.nextTime = time + CONTROL_INTERVAL;
    this.schedule();
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
    const offset = sampleLfoAtTime(this.state, time, options.frequencyHz,
      options.waveform, options.initPhase) * options.amount;
    const baseMidi = 69 + 12 * Math.log2(Number(this.filter.frequency.getValueAtTime(time)) / (options.a4 ?? 440));
    return (Math.max(0, Math.min(127, baseMidi + offset)) - baseMidi) * 100;
  }

  private schedule(): void {
    if (!this.listening) return;
    // Fill the look-ahead window on the context clock, including offline rendering.
    const end = this.filter.context.now() + CONTROL_INTERVAL * 2;
    const options = this.options!;
    const stepped = options.waveform === 'square' || options.waveform === 'sample-hold';
    while (this.nextTime <= end) {
      const time = this.nextTime;
      const value = this.detuneAtTime(time);
      const wraps = Math.floor(time * options.frequencyHz + options.initPhase)
        !== Math.floor((time - CONTROL_INTERVAL) * options.frequencyHz + options.initPhase);
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
    this.listening = false;
  }
}
