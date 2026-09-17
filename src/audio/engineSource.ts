import * as Tone from 'tone';
import { ChoirEnsemble } from './choirEnsemble';
import { choirBands, noiseBands, type SynthEngineSettings } from './synthEngine';

/** A per-note source/filter instrument feeding the existing amp, pitch and effect chain. */
export class EngineSource {
  readonly output: Tone.Gain;
  private readonly owned: Array<{ dispose(): unknown }> = [];
  private readonly native: AudioNode[] = [];
  private readonly filters: BiquadFilterNode[] = [];
  private readonly frequencyConnections: Array<() => void> = [];
  private readonly motion: Tone.Envelope;
  private readonly sources: Array<Tone.Noise | Tone.Oscillator> = [];
  private readonly bandGains: Tone.Gain[] = [];
  private readonly ensemble: ChoirEnsemble | null;
  private readonly noise: Tone.Noise;
  private readonly noiseGain: Tone.Gain;
  private readonly brightness: BiquadFilterNode;
  private readonly mod: Tone.Multiply;
  private readonly lfo: Tone.LFO | null;
  private readonly pitch: Tone.Multiply;
  private dry: Tone.Gain | null = null;
  private readonly frequency: Tone.Signal<'frequency'>;
  private monoRunning = false;
  private disposed = false;
  private scheduledSourceEnd = 0;
  private settings: SynthEngineSettings;
  private readonly context: Tone.BaseContext;

  constructor(context: Tone.BaseContext, frequency: Tone.Signal<'frequency'>, detune: Tone.Signal<'cents'>, settings: SynthEngineSettings) {
    this.context = context;
    this.frequency = frequency;
    this.settings = settings;
    const own = <T extends { dispose(): unknown }>(node: T): T => { this.owned.push(node); return node; };
    const native = <T extends AudioNode>(node: T): T => { this.native.push(node); return node; };
    const connectSignal = (source: typeof frequency | typeof detune, destination: Parameters<Tone.Signal['connect']>[0]) => {
      source.connect(destination);
      this.frequencyConnections.push(() => { source.disconnect(destination); });
    };
    this.output = own(new Tone.Gain({ context, gain: 1 }));
    const s = settings.noiseEngine, c = settings.choirEngine;
    this.motion = own(new Tone.Envelope({ context, attack: s.attack, decay: s.decay, sustain: s.sustain, release: s.release,
      attackCurve: 'linear', decayCurve: 'linear', releaseCurve: 'linear' }));
    const input = own(new Tone.Gain({ context, gain: 1 }));
    const noise = own(new Tone.Noise({ context, type: settings.synthMode === 'choir' ? 'pink' : s.color }));
    const noiseGain = own(new Tone.Gain({ context, gain: settings.synthMode === 'choir' ? c.breath : 1 }));
    this.noise = noise;
    this.noiseGain = noiseGain;
    noise.chain(noiseGain, input);
    this.sources.push(noise);
    if (settings.synthMode === 'choir') {
      const doubled = own(new Tone.Multiply({ context, value: 2 }));
      connectSignal(frequency, doubled);
      this.ensemble = new ChoirEnsemble(context, doubled, detune, input, c);
    } else this.ensemble = null;
    const brightness = native(context.createBiquadFilter());
    this.brightness = brightness;
    brightness.type = 'lowpass';
    brightness.frequency.value = Math.min(context.sampleRate * 0.45, c.brightness);
    brightness.Q.value = 0;
    if (settings.synthMode === 'choir') Tone.connect(input, brightness);
    const source = settings.synthMode === 'choir' ? brightness : input;
    const resonators = noiseBands(s);
    const bands = settings.synthMode === 'choir' ? choirBands(c) : Array.from({ length: 8 }, (_, i) => ({
      frequency: s.frequency * (resonators[i]?.ratio ?? 1), Q: s.resonance, gain: resonators[i]?.gain ?? 0,
    }));
    const mod = own(new Tone.Multiply({ context, value: s.envelopeAmount * 100 }));
    this.motion.connect(mod);
    const lfo = settings.synthMode === 'resonant-noise'
      ? own(new Tone.LFO({ context, frequency: s.lfoRate, min: -s.lfoDepth * 100, max: s.lfoDepth * 100 })) : null;
    const pitch = own(new Tone.Multiply({ context, value: s.keyTrack }));
    this.mod = mod;
    this.lfo = lfo;
    this.pitch = pitch;
    if (settings.synthMode === 'resonant-noise') connectSignal(detune, pitch);
    for (const band of bands) {
      const filter = native(context.createBiquadFilter());
      filter.type = 'bandpass';
      filter.frequency.value = Math.min(context.sampleRate * 0.45, band.frequency);
      filter.Q.value = band.Q;
      this.filters.push(filter);
      const gain = own(new Tone.Gain({ context, gain: band.gain }));
      this.bandGains.push(gain);
      Tone.connect(source, filter);
      Tone.connect(filter, gain);
      gain.connect(this.output);
      if (settings.synthMode === 'resonant-noise') {
        Tone.connect(mod, filter.detune);
        Tone.connect(lfo!, filter.detune);
        Tone.connect(pitch, filter.detune);
      }
    }
    if (settings.synthMode === 'resonant-noise') {
      const dry = own(new Tone.Gain({ context, gain: s.dry }));
      this.dry = dry;
      input.chain(dry, this.output);
    }
    this.note(Tone.Frequency(frequency.value).toFrequency(), context.currentTime);
  }

  /** Update controls without discarding source state or scheduled note events. */
  set(settings: SynthEngineSettings): void {
    this.settings = settings;
    const time = this.context.now(), ramp = 0.02;
    const s = settings.noiseEngine, c = settings.choirEngine;
    if (settings.synthMode === 'resonant-noise') {
      this.noise.type = s.color;
      this.motion.set({ attack: s.attack, decay: s.decay, sustain: s.sustain, release: s.release });
      this.mod.factor.rampTo(s.envelopeAmount * 100, ramp, time);
      this.pitch.factor.rampTo(s.keyTrack, ramp, time);
      this.lfo!.frequency.rampTo(s.lfoRate, ramp, time);
      this.lfo!.min = -s.lfoDepth * 100;
      this.lfo!.max = s.lfoDepth * 100;
      this.dry!.gain.rampTo(s.dry, ramp, time);
      const bands = noiseBands(s);
      this.filters.forEach((filter, i) => {
        filter.Q.setTargetAtTime(s.resonance, time, 0.005);
        this.bandGains[i].gain.rampTo(bands[i]?.gain ?? 0, ramp, time);
      });
      this.note(Tone.Frequency(this.frequency.getValueAtTime(time)).toFrequency(), time);
    } else {
      this.noiseGain.gain.rampTo(c.breath, ramp, time);
      this.brightness.frequency.setTargetAtTime(Math.min(this.context.sampleRate * 0.45, c.brightness), time, 0.005);
      this.ensemble!.set(c, time);
      choirBands(c).forEach((band, i) => {
        const filter = this.filters[i];
        filter.frequency.cancelScheduledValues(time);
        filter.frequency.setTargetAtTime(Math.min(this.context.sampleRate * 0.45, band.frequency), time, 0.005);
        filter.Q.setTargetAtTime(band.Q, time, 0.005);
        this.bandGains[i].gain.rampTo(band.gain, ramp, time);
      });
    }
  }

  note(frequency: number, time: number, fromFrequency?: number, glideSeconds = 0): void {
    if (this.settings.synthMode !== 'resonant-noise') return;
    const s = this.settings.noiseEngine;
    noiseBands(s).forEach((b, i) => {
      const hz = (f: number) => Math.max(20, Math.min(this.context.sampleRate * 0.45, s.frequency * (f * 2 / 440) ** s.keyTrack * b.ratio));
      const param = this.filters[i].frequency;
      param.cancelScheduledValues(time);
      param.setValueAtTime(hz(fromFrequency ?? frequency), time);
      if (glideSeconds > 0) param.exponentialRampToValueAtTime(hz(frequency), time + glideSeconds);
    });
  }

  attack(time: number, mono = false, stopTime?: number): void {
    this.scheduledSourceEnd = Math.max(this.scheduledSourceEnd, time, stopTime ?? 0);
    if (!mono || !this.monoRunning) {
      this.sources.forEach(source => source.start(time));
      this.ensemble?.start(time);
      this.lfo?.start(time);
    }
    this.monoRunning = mono;
    if (!mono && stopTime !== undefined) this.stopSources(stopTime);
    this.motion.triggerAttack(time);
    if (this.settings.synthMode === 'choir') {
      const c = this.settings.choirEngine;
      const from = choirBands(c, c.morphTime > 0 ? 0 : c.morph), to = choirBands(c);
      this.filters.forEach((filter, i) => {
        filter.frequency.cancelScheduledValues(time);
        filter.frequency.setValueAtTime(Math.min(this.context.sampleRate * 0.45, from[i].frequency), time);
        filter.frequency.exponentialRampToValueAtTime(Math.min(this.context.sampleRate * 0.45, to[i].frequency), time + Math.max(0.001, c.morphTime));
      });
    }
  }
  cancel(time: number): void { this.motion.cancel(time); }
  release(time: number, ampRelease?: number): void {
    this.scheduledSourceEnd = Math.max(this.scheduledSourceEnd, time + (ampRelease ?? 0));
    this.motion.triggerRelease(time);
    if (ampRelease !== undefined) this.stopSources(time + ampRelease);
  }
  private stopSources(time: number): void {
    this.sources.forEach(source => source.stop(time));
    this.ensemble?.stop(time);
    this.lfo?.stop(time);
  }
  reset(time: number): void {
    this.stopSources(time);
    this.monoRunning = false;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ensemble?.dispose();
    this.output.disconnect();
    this.frequencyConnections.forEach(disconnect => disconnect());
    const cleanup = () => {
      this.owned.reverse().forEach(n => n.dispose());
      this.native.forEach(n => n.disconnect());
    };
    if (this.context.isOffline) cleanup();
    else {
      // Tone's earlier oscillator instances still have onended callbacks queued.
      // Keep their frequency/detune signals alive until those callbacks finish.
      const now = this.context.currentTime;
      this.stopSources(now);
      this.context.setTimeout(cleanup, Math.max(this.context.now() - now, this.scheduledSourceEnd - now) + 0.05);
    }
  }
}
