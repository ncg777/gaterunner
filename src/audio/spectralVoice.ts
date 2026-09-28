import * as Tone from 'tone';
import { spectralSpectrumAtTime, type SpectralSourceSettings } from './spectralModulation';
import type { ModulationTime, ModulationValues } from './modulation';

interface Bank {
  start: number; end: number; mono: boolean;
  gains: Map<number, GainNode>; oscillators: OscillatorNode[];
}
const waves = new WeakMap<Tone.BaseContext, Map<number, PeriodicWave>>();
function harmonicWave(context: Tone.BaseContext, harmonic: number) {
  let cache = waves.get(context);
  if (!cache) { cache = new Map(); waves.set(context, cache); }
  let wave = cache.get(harmonic);
  if (!wave) {
    const real = new Float32Array(harmonic + 1), imag = new Float32Array(harmonic + 1);
    imag[harmonic] = 1;
    wave = context.createPeriodicWave(real, imag, { disableNormalization: true });
    cache.set(harmonic, wave);
  }
  return wave;
}

/** Audio-thread gain ramps move partials independently; offline renders retain every timbre change. */
export class SpectralVoice {
  readonly output: Tone.Gain;
  private banks = new Set<Bank>();
  constructor(private context: Tone.BaseContext, private frequency: Tone.Signal<'frequency'>,
    private detune: Tone.Signal<'cents'>, private settings: SpectralSourceSettings) {
    this.output = new Tone.Gain({ context, gain: 1 });
  }
  set(settings: SpectralSourceSettings) {
    const countChanged = settings.unisonVoices !== this.settings.unisonVoices;
    const spreadChanged = settings.unisonDetune !== this.settings.unisonDetune;
    this.settings = settings;
    if (countChanged) {
      const now = this.context.now();
      const windows = [...this.banks].filter(b => b.end > now).map(b => ({ ...b }));
      this.reset(now);
      for (const b of windows) this.attack(Math.max(now, b.start), b.mono, b.end);
    } else if (spreadChanged) {
      const count = Math.max(1, Math.min(8, Math.round(settings.unisonVoices)));
      for (const b of this.banks) b.oscillators.forEach((o, i) => {
        o.detune.setTargetAtTime(count === 1 ? 0 : ((i % count) / (count - 1) - 0.5) * settings.unisonDetune,
          this.context.now(), 0.005);
      });
    }
  }
  attack(time: number, mono: boolean, stopTime = Infinity) {
    if (mono && [...this.banks].some(b => b.mono && b.end > time)) return;
    if (stopTime <= this.context.currentTime) return;
    const bank: Bank = { start: time, end: stopTime, mono, gains: new Map(), oscillators: [] };
    this.banks.add(bank);
    // Include all supported bins so harmonic-count sweeps can reveal previously silent partials.
    const indices = [1, 3, ...Array.from({ length: 64 }, (_, i) => (i + 1) * 2)];
    const count = Math.max(1, Math.min(8, Math.round(this.settings.unisonVoices)));
    const gain = count > 1 ? 10 ** ((-6 - count * 1.1) / 20) : 1;
    for (const harmonic of indices) {
      const amplitude = this.context.createGain();
      amplitude.gain.value = 0;
      bank.gains.set(harmonic, amplitude);
      Tone.connect(amplitude, this.output);
      for (let i = 0; i < count; i++) {
        const oscillator = this.context.createOscillator();
        oscillator.frequency.value = 0;
        oscillator.detune.value = count === 1 ? 0 : (i / (count - 1) - 0.5) * this.settings.unisonDetune;
        oscillator.setPeriodicWave(harmonicWave(this.context, harmonic));
        Tone.connect(this.frequency, oscillator.frequency);
        Tone.connect(this.detune, oscillator.detune);
        oscillator.connect(amplitude);
        bank.oscillators.push(oscillator);
        oscillator.onended = () => {
          Tone.disconnect(this.frequency, oscillator.frequency);
          Tone.disconnect(this.detune, oscillator.detune);
          oscillator.disconnect();
          bank.oscillators.splice(bank.oscillators.indexOf(oscillator), 1);
          if (!bank.oscillators.length) { bank.gains.forEach(g => g.disconnect()); this.banks.delete(bank); }
        };
        oscillator.start(Math.max(time, this.context.currentTime));
        if (Number.isFinite(stopTime)) oscillator.stop(stopTime);
      }
    }
    this.bankGains.set(bank, gain);
  }
  private bankGains = new WeakMap<Bank, number>();
  release(time: number, seconds?: number) {
    if (seconds === undefined) return; // Mono phase continues through gaps, like the carrier.
    for (const b of this.banks) if (b.start <= time && b.end > time + seconds) {
      b.end = time + seconds;
      b.oscillators.forEach(o => o.stop(b.end));
    }
  }
  refresh(time: number) {
    for (const b of this.banks) for (const g of b.gains.values()) g.gain.cancelAndHoldAtTime(time);
  }
  write(values: ModulationValues, timing: ModulationTime, ramp: boolean) {
    const active = [...this.banks].filter(b => b.start <= timing.time + 1e-9 && b.end > timing.time);
    if (!active.length) return;
    const spectrum = spectralSpectrumAtTime(this.settings, values, timing);
    for (const b of active) for (const [harmonic, node] of b.gains) {
      const gain = (spectrum[harmonic - 1] ?? 0) * this.bankGains.get(b)!;
      if (ramp) node.gain.linearRampToValueAtTime(gain, timing.time);
      else node.gain.setValueAtTime(gain, timing.time);
    }
  }
  reset(time: number) {
    for (const b of this.banks) {
      b.end = Math.min(b.end, time);
      b.oscillators.forEach(o => o.stop(Math.max(time, this.context.currentTime)));
    }
  }
  dispose() {
    for (const b of this.banks) {
      for (const o of b.oscillators) {
        o.onended = null;
        o.stop(this.context.currentTime);
        Tone.disconnect(this.frequency, o.frequency);
        Tone.disconnect(this.detune, o.detune);
        o.disconnect();
      }
      b.gains.forEach(g => g.disconnect());
    }
    this.banks.clear();
    this.output.dispose();
  }
}
