import { getLfoSyncRateHz, LFO_SYNC_RATE_OPTIONS, type LfoSyncRateValue } from './lfo.js';

export interface MasterPulseSettings {
  enabled: boolean;
  rateMode: 'hz' | 'sync';
  frequency: number;
  division: LfoSyncRateValue;
  depth: number;
  shape: 'sine' | 'triangle' | 'pulse';
  width: number;
  edgeMs: number;
}

export const DEFAULT_MASTER_PULSE: Readonly<MasterPulseSettings> = Object.freeze({
  enabled: false, rateMode: 'hz', frequency: 10, division: '1/16',
  depth: 0.5, shape: 'sine', width: 0.5, edgeMs: 5,
});

export function normalizeMasterPulse(value: unknown): MasterPulseSettings {
  const raw = value && typeof value === 'object' ? value as Partial<MasterPulseSettings> : {};
  const number = (value: unknown, fallback: number, min: number, max: number) => {
    const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
  };
  return {
    enabled: raw.enabled === true,
    rateMode: raw.rateMode === 'sync' ? 'sync' : 'hz',
    frequency: number(raw.frequency, DEFAULT_MASTER_PULSE.frequency, 0.1, 80),
    division: LFO_SYNC_RATE_OPTIONS.includes(raw.division as LfoSyncRateValue) ? raw.division! : DEFAULT_MASTER_PULSE.division,
    depth: number(raw.depth, DEFAULT_MASTER_PULSE.depth, 0, 1),
    shape: raw.shape === 'pulse' || raw.shape === 'triangle' ? raw.shape : 'sine',
    width: number(raw.width, DEFAULT_MASTER_PULSE.width, 0.05, 0.95),
    edgeMs: number(raw.edgeMs, DEFAULT_MASTER_PULSE.edgeMs, 0.1, 50),
  };
}

export function masterPulseFrequency(settings: MasterPulseSettings, bpm: number): number {
  return settings.rateMode === 'sync' ? getLfoSyncRateHz(settings.division, bpm) : settings.frequency;
}

/** A bounded unipolar envelope. Pulse edges fit inside the audible part of each cycle. */
export function masterPulseEnvelope(phase: number, shape: MasterPulseSettings['shape'], width: number, edge: number): number {
  const p = phase - Math.floor(phase);
  if (shape === 'sine') return 0.5 + 0.5 * Math.cos(2 * Math.PI * p);
  if (shape === 'triangle') return Math.abs(2 * p - 1);
  if (p >= width) return 0;
  const ramp = Math.min(width / 2, edge);
  if (ramp <= 0) return 1;
  const progress = Math.min(1, p / ramp, (width - p) / ramp);
  return 0.5 - 0.5 * Math.cos(Math.PI * progress);
}

/** Shared audio-rate DSP for the browser worklet and native/export rendering. */
export class MasterPulseDSP {
  private settings: MasterPulseSettings;
  private bpm: number;
  private phase = 0;
  private values: number[] = [];
  private targets: number[] = [];
  private increments: number[] = [];
  private remaining = 0;

  constructor(readonly sampleRate: number, settings: MasterPulseSettings, bpm: number) {
    this.settings = settings;
    this.bpm = bpm;
    this.set(settings, bpm, false);
  }

  set(settings: MasterPulseSettings, bpm: number, smooth = true): void {
    this.settings = settings;
    this.bpm = bpm;
    this.targets = [masterPulseFrequency(settings, bpm), settings.enabled ? settings.depth : 0,
      settings.width, settings.edgeMs / 1000,
      settings.shape === 'sine' ? 1 : 0, settings.shape === 'triangle' ? 1 : 0, settings.shape === 'pulse' ? 1 : 0];
    this.remaining = smooth ? Math.max(1, Math.round(this.sampleRate * 0.01)) : 0;
    if (!smooth) this.values = [...this.targets];
    this.increments = this.targets.map((value, i) => (value - this.values[i]!) / Math.max(1, this.remaining));
  }

  /** Starts and excerpt offsets refer to absolute song time, never loop-local time. */
  reset(frame = 0): void {
    this.set(this.settings, this.bpm, false);
    const cycles = frame * this.values[0]! / this.sampleRate;
    this.phase = cycles - Math.floor(cycles);
  }

  nextGain(): number {
    if (this.remaining > 0) {
      for (let i = 0; i < this.values.length; i++) this.values[i]! += this.increments[i]!;
      if (--this.remaining === 0) this.values = [...this.targets];
    }
    const [frequency, depth, width, edge, sine, triangle, pulse] = this.values as [number, number, number, number, number, number, number];
    let gain = 1;
    if (depth > 0) {
      const envelope = sine * masterPulseEnvelope(this.phase, 'sine', width, edge * frequency)
        + triangle * masterPulseEnvelope(this.phase, 'triangle', width, edge * frequency)
        + pulse * masterPulseEnvelope(this.phase, 'pulse', width, edge * frequency);
      gain = Math.max(0, Math.min(1, 1 - depth * (1 - envelope)));
    }
    this.phase += frequency / this.sampleRate;
    this.phase -= Math.floor(this.phase);
    return gain;
  }
}

/** Apply once after master clipping, leaving pre-master stems available for recombination. */
export function applyMasterPulse(channels: readonly Float32Array[], settings: MasterPulseSettings | undefined,
  bpm: number, sampleRate: number, startFrame = 0): void {
  if (!settings?.enabled || settings.depth === 0) return;
  const dsp = new MasterPulseDSP(sampleRate, settings, bpm);
  dsp.reset(startFrame);
  for (let frame = 0; frame < (channels[0]?.length ?? 0); frame++) {
    const gain = dsp.nextGain();
    for (const channel of channels) channel[frame]! *= gain;
  }
}
