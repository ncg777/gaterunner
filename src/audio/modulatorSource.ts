import * as Tone from 'tone';
import { EngineSource } from './engineSource';
import { GeneratorSource } from './generatorSource';
import { isGeneratorMode } from './generatorSettings';
import { SpectralVoice } from './spectralVoice';
import { PartialBankVoice } from './partialBankVoice';
import { VoiceModulation } from './voiceModulation';
import { hasVoiceActivity, type VoiceEvent } from './voiceActivity';
import type { EngineLayerSettings } from './synthEngine';

/** A raw second engine: its source motion runs per note, before the track's shared amp/effects. */
export class ModulatorSource {
  readonly output: Tone.WaveShaper;
  private frequency: Tone.Signal<'frequency'>;
  private detune: Tone.Signal<'cents'>;
  private ratio: Tone.Multiply;
  private filter: Tone.Filter;
  private motion: VoiceModulation;
  private source: EngineSource | GeneratorSource | SpectralVoice | PartialBankVoice;
  private events: VoiceEvent[] = [];
  private mode: EngineLayerSettings['synthMode'];
  constructor(private context: Tone.BaseContext, private parentFrequency: Tone.Signal<'frequency'>,
    private parentDetune: Tone.Signal<'cents'>, settings: EngineLayerSettings, frequencyRatio: number,
    private releaseSeconds: () => number = () => 0) {
    this.mode = settings.synthMode;
    this.frequency = new Tone.Signal({ context, value: 0, units: 'frequency' });
    this.detune = new Tone.Signal({ context, value: 0, units: 'cents' });
    this.ratio = new Tone.Multiply({ context, value: frequencyRatio });
    parentFrequency.connect(this.ratio);
    this.ratio.connect(this.frequency);
    Tone.connect(parentDetune, this.detune);
    this.source = settings.synthMode === 'partial-bank'
      // An audio-driven Signal reports only its intrinsic zero to getValueAtTime.
      // Read the upstream note/ratio automation so the bank can taper high partials.
      ? new PartialBankVoice(context, this.frequency, this.detune, settings, settings.partialBank,
        (time, values) => Number(parentFrequency.getValueAtTime(time)) * Number(this.ratio.factor.getValueAtTime(time))
          * 2 ** (Number(parentDetune.getValueAtTime(time)) / 1200 + values.pitch / 12))
      : settings.synthMode === 'additive' ? new SpectralVoice(context, this.frequency, this.detune, settings)
      : isGeneratorMode(settings.synthMode) ? new GeneratorSource(context, this.frequency, this.detune, settings)
      : new EngineSource(context, this.frequency, this.detune, settings);
    this.filter = new Tone.Filter({ context });
    this.motion = new VoiceModulation(context, this.detune, this.filter,
      () => hasVoiceActivity(this.events, context.currentTime, this.releaseSeconds()), {
        write: (values, timing, ramp) => {
          if (!(this.source instanceof EngineSource)) this.source.write(values, timing, ramp);
        },
        refresh: time => { if (!(this.source instanceof EngineSource)) this.source.refresh(time); },
        needsClock: () => this.mode === 'additive' || this.mode === 'partial-bank',
      });
    this.motion.set(settings.modulation, 1, 0);
    // Keep the multiplier bounded even for resonant, noisy or unusually hot source settings.
    this.output = new Tone.WaveShaper({ context, mapping: x => Math.max(-1, Math.min(1, x)), length: 2049 });
    this.source.output.connect(this.motion.gain);
    this.motion.pan.connect(this.output);
  }
  set(settings: EngineLayerSettings, frequencyRatio: number): void {
    this.ratio.factor.value = frequencyRatio;
    if (this.source instanceof PartialBankVoice) this.source.set(settings, settings.partialBank);
    else this.source.set(settings);
    this.motion.set(settings.modulation, 1, 0);
    this.note(Tone.Frequency(this.parentFrequency.getValueAtTime(this.context.now())).toFrequency(), this.context.now());
  }
  note(frequency: number, time: number, from?: number, glide = 0): void {
    if (this.source instanceof EngineSource || this.source instanceof GeneratorSource) {
      const ratio = this.ratio.factor.value;
      this.source.note(frequency * ratio, time, from === undefined ? undefined : from * ratio, glide);
    }
  }
  attack(time: number, mono = false, stopTime?: number): void {
    this.events.push({ type: 'attack', time, mono, stopTime });
    this.events.sort((a, b) => a.time - b.time);
    let last = -1;
    this.events.forEach((e, i) => { if (e.type === 'attack' && e.time <= this.context.currentTime) last = i; });
    if (last > 0) this.events.splice(0, last);
    this.source.attack(time, mono, stopTime);
    this.motion.attack(time);
  }
  release(time: number, ampRelease?: number): void {
    this.events.push({ type: 'release', time, ampRelease });
    this.source.release(time, ampRelease);
    this.motion.release(time);
  }
  cancel(time: number): void {
    this.events = this.events.filter(e => e.time < time);
    this.motion.cancel(time);
    if (this.source instanceof EngineSource || this.source instanceof GeneratorSource) this.source.cancel(time);
  }
  reset(time: number): void { this.events = []; this.motion.reset(time); this.source.reset(time); }
  dispose(): void {
    this.source.dispose(); this.motion.dispose(); this.output.dispose(); this.filter.dispose();
    this.parentFrequency.disconnect(this.ratio);
    Tone.disconnect(this.parentDetune, this.detune);
    const cleanup = () => { this.ratio.dispose(); this.frequency.dispose(); this.detune.dispose(); };
    if (this.context.isOffline) cleanup();
    else this.context.setTimeout(cleanup, Math.max(0, ...this.events.map(e => e.type === 'attack'
      ? (e.stopTime ?? e.time) - this.context.currentTime : e.time + (e.ampRelease ?? 0) - this.context.currentTime)) + 0.1);
  }
}
