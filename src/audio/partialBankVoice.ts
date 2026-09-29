import * as Tone from 'tone';
import { bankBandGain, compileBankPosition, normalizeBankAmplitudes, type PartialBankSettings } from './partialBank';
import { spectralSpectrumAtTime, type SpectralSourceSettings } from './spectralModulation';
import { emptyModulationValues, type ModulationTime, type ModulationValues } from './modulation';

interface Partial { ratio: GainNode; oscillators: Array<{ source: OscillatorNode; gain: GainNode; spread: number }> }
interface Bank { start: number; end: number; mono: boolean; partials: Map<number, Partial>; count: number }

/** Native sine bank. Ratios multiply the note signal, preserving phase through pitch and timbre motion. */
export class PartialBankVoice {
  readonly output: Tone.Gain;
  private banks = new Set<Bank>();
  private position: ReturnType<typeof compileBankPosition>;
  constructor(private context: Tone.BaseContext, private frequency: Tone.Signal<'frequency'>,
    private detune: Tone.Signal<'cents'>, private settings: SpectralSourceSettings, bank: PartialBankSettings) {
    this.output = new Tone.Gain({ context, gain: 1 });
    this.position = compileBankPosition(bank);
  }
  set(settings: SpectralSourceSettings, bank: PartialBankSettings) {
    this.settings = settings;
    this.position = compileBankPosition(bank);
    const now = this.context.now();
    for (const b of this.banks) for (const p of b.partials.values()) p.oscillators.forEach((o, i) => {
      o.spread = b.count === 1 ? 0 : (i / (b.count - 1) - 0.5) * settings.unisonDetune;
      o.source.detune.setTargetAtTime(o.spread, now, 0.005);
    });
    // Unison count is captured on attack; active partials retain their phase during edits.
  }
  attack(time: number, mono: boolean, stopTime = Infinity) {
    if (mono && [...this.banks].some(b => b.mono && b.end > time)) return;
    if (stopTime <= this.context.currentTime) return;
    const bank: Bank = { start: time, end: stopTime, mono, partials: new Map(),
      count: Math.max(1, Math.min(8, Math.round(this.settings.unisonVoices))) };
    this.banks.add(bank);
    this.write(emptyModulationValues(), { time, noteStart: time, bpm: this.context.transport.bpm.getValueAtTime(time) }, false);
  }
  private createPartial(bank: Bank, index: number, ratio: number, time: number): Partial {
    const multiplier = this.context.createGain();
    multiplier.gain.value = ratio * 2; // The synth's note bus is one octave below the musical note.
    Tone.connect(this.frequency, multiplier);
    const partial: Partial = { ratio: multiplier, oscillators: [] };
    bank.partials.set(index, partial);
    for (let i = 0; i < bank.count; i++) {
      const source = this.context.createOscillator(), gain = this.context.createGain();
      const spread = bank.count === 1 ? 0 : (i / (bank.count - 1) - 0.5) * this.settings.unisonDetune;
      source.type = 'sine'; source.frequency.value = 0; source.detune.value = spread; gain.gain.value = 0;
      multiplier.connect(source.frequency);
      Tone.connect(this.detune, source.detune);
      source.connect(gain); Tone.connect(gain, this.output);
      partial.oscillators.push({ source, gain, spread });
      source.onended = () => {
        Tone.disconnect(this.detune, source.detune);
        multiplier.disconnect(source.frequency); source.disconnect(); gain.disconnect();
        partial.oscillators = partial.oscillators.filter(o => o.source !== source);
        if (!partial.oscillators.length) {
          Tone.disconnect(this.frequency, multiplier); multiplier.disconnect(); bank.partials.delete(index);
          if (!bank.partials.size && bank.end <= this.context.currentTime) this.banks.delete(bank);
        }
      };
      source.start(Math.max(time, this.context.currentTime));
      if (Number.isFinite(bank.end)) source.stop(bank.end);
    }
    return partial;
  }
  release(time: number, seconds?: number) {
    if (seconds === undefined) return;
    for (const b of this.banks) if (b.start <= time && b.end > time + seconds) {
      b.end = time + seconds;
      for (const p of b.partials.values()) p.oscillators.forEach(o => o.source.stop(b.end));
    }
  }
  refresh(time: number) {
    for (const b of this.banks) if (b.end > time) for (const p of b.partials.values()) {
      p.ratio.gain.cancelAndHoldAtTime(time);
      p.oscillators.forEach(o => o.gain.gain.cancelAndHoldAtTime(time));
    }
  }
  write(values: ModulationValues, timing: ModulationTime, ramp: boolean) {
    // A fully silent source creates no nodes, so it has no onended callback to retire its bank.
    for (const bank of this.banks) if (!bank.partials.size && bank.end <= timing.time) this.banks.delete(bank);
    const banks = [...this.banks].filter(b => b.start <= timing.time + 1e-9 && b.end > timing.time);
    if (!banks.length) return;
    const spectrum = normalizeBankAmplitudes(spectralSpectrumAtTime(this.settings, values, timing));
    const fundamental = Number(this.frequency.getValueAtTime(timing.time)) * 2;
    const detune = Number(this.detune.getValueAtTime(timing.time));
    for (const b of banks) {
      const unisonGain = b.count === 1 ? 1 : 10 ** ((-6 - b.count * 1.1) / 20);
      const length = Math.max(spectrum.length, ...[...b.partials.keys()].map(i => i + 1), 0);
      for (let i = 0; i < length; i++) {
        const amplitude = spectrum[i] ?? 0, ratio = this.position((i + 1) / 2, values);
        let p = b.partials.get(i);
        const fresh = !p;
        if (!p && amplitude !== 0 && ratio > 0) p = this.createPartial(b, i, ratio, timing.time);
        if (!p) continue;
        const end = timing.time;
        if (ramp && !fresh) p.ratio.gain.linearRampToValueAtTime(ratio * 2, end);
        else p.ratio.gain.setValueAtTime(ratio * 2, end);
        for (const o of p.oscillators) {
          const gain = ratio > 0 ? amplitude * unisonGain * bankBandGain(fundamental * ratio * 2 ** ((detune + o.spread) / 1200), this.context.sampleRate) : 0;
          if (fresh && end > b.start + 1e-9) {
            o.gain.gain.setValueAtTime(0, end);
            o.gain.gain.linearRampToValueAtTime(gain, end + 0.005);
          } else if (ramp) o.gain.gain.linearRampToValueAtTime(gain, end);
          else o.gain.gain.setValueAtTime(gain, end);
        }
      }
    }
  }
  reset(time: number) {
    for (const b of this.banks) {
      b.end = Math.min(b.end, time);
      if (!b.partials.size) this.banks.delete(b);
      for (const p of b.partials.values()) p.oscillators.forEach(o => o.source.stop(Math.max(time, this.context.currentTime)));
    }
  }
  dispose() {
    for (const b of this.banks) for (const p of b.partials.values()) {
      Tone.disconnect(this.frequency, p.ratio); p.ratio.disconnect();
      for (const o of p.oscillators) {
        o.source.onended = null; o.source.stop(this.context.currentTime);
        Tone.disconnect(this.detune, o.source.detune); o.source.disconnect(); o.gain.disconnect();
      }
    }
    this.banks.clear(); this.output.dispose();
  }
}
