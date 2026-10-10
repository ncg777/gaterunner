import { GeneratorDSP, type GeneratorSample } from './generatorDSP.js';
import { GENERATOR_MODULATION, type GeneratorEngines, type GeneratorMode, type GeneratorModulation } from './generatorSettings.js';

// AudioWorklet globals are absent from TypeScript's DOM library.
declare const sampleRate: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;
type Event = { type: 'attack' | 'release' | 'reset' | 'settings' | 'cancel'; frame: number; stop?: number;
  mono?: boolean; settings?: GeneratorEngines };
// All voices in a context share one copy of each imported PCM asset.
const assets = new Map<string, GeneratorSample>();
const modulationKeys = Object.keys(GENERATOR_MODULATION) as (keyof GeneratorModulation)[];
class GeneratorProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return Object.entries(GENERATOR_MODULATION).map(([name, bounds]) => ({ name, defaultValue: 0,
      minValue: bounds.min, maxValue: bounds.max, automationRate: 'a-rate' }));
  }
  private mode?: GeneratorMode;
  private dsp?: GeneratorDSP;
  private events: Event[] = [];
  private active = false;
  private continuous = false;
  private disposed = false;
  private start = 0;
  private releaseFrame = Infinity;
  private end = Infinity;
  private values: GeneratorModulation = {};
  constructor(options?: AudioWorkletNodeOptions) {
    super(options);
    const initial = options?.processorOptions as { mode?: GeneratorMode; settings?: GeneratorEngines } | undefined;
    this.mode = initial?.mode;
    if (this.mode && initial?.settings) this.dsp = this.create(initial.settings);
    this.port.onmessage = ({ data }) => {
      if (data.type === 'asset') {
        assets.set(data.asset.hash, data.asset);
        this.port.postMessage({ hash: data.asset.hash });
      } else if (data.type === 'dispose') {
        this.disposed = true; this.active = false; this.events = []; this.dsp = undefined;
      } else if (data.type === 'cancel') {
        this.events = this.events.filter(e => e.frame < data.frame || e.type === 'settings');
        this.events.push(data as Event); this.events.sort((a, b) => a.frame - b.frame);
      } else {
        this.events.push(data as Event); this.events.sort((a, b) => a.frame - b.frame);
      }
    };
  }
  private create(settings: GeneratorEngines) {
    return new GeneratorDSP(this.mode!, settings, sampleRate, assets.get(settings.granular.asset));
  }
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>) {
    if (this.disposed) return false;
    if (!this.mode || !this.dsp) return true;
    const output = outputs[0]?.[0];
    if (!output) return true;
    const frequencies = inputs[0]?.[0], detunes = inputs[1]?.[0];
    for (let i = 0; i < output.length; i++) {
      const frame = currentFrame + i;
      const frequency = (frequencies?.[i] ?? 0) * 2 * 2 ** ((detunes?.[i] ?? 0) / 1200);
      while (this.events.length && this.events[0].frame <= frame) {
        const event = this.events.shift()!;
        if (event.type === 'attack') {
          this.dsp.attack(frequency, this.continuous && !!event.mono);
          this.continuous = !!event.mono;
          this.start = event.frame; this.releaseFrame = Infinity; this.end = event.stop ?? Infinity;
          this.active = true;
        } else if (event.type === 'release') {
          this.releaseFrame = event.frame;
          if (event.stop !== undefined) this.end = event.stop;
        } else if (event.type === 'cancel') {
          this.releaseFrame = Infinity; this.end = Infinity;
        } else if (event.type === 'reset') { this.active = false; this.continuous = false; }
        else if (event.settings) {
          if (this.mode === 'granular') {
            // Asset changes start a fresh cloud; other edits preserve sounding grains.
            const asset = assets.get(event.settings.granular.asset);
            if (asset && this.dsp.sampleHash !== asset.hash) {
              this.dsp = this.create(event.settings); this.dsp.attack(frequency);
            } else this.dsp.set(event.settings);
          } else this.dsp.set(event.settings);
        }
      }
      if (frame >= this.end) this.active = false;
      if (!this.active && !this.continuous) { output[i] = 0; continue; }
      for (const key of modulationKeys) {
        const p = parameters[key]; this.values[key] = p.length === 1 ? p[0] : p[i];
      }
      // Mono oscillators keep phase/string state across gaps. Granular stops launching
      // grains at release and resumes after a legato cancellation or another attack.
      const value = this.dsp.sample(frequency, (frame - this.start) / sampleRate,
        (this.releaseFrame - this.start) / sampleRate, this.values);
      output[i] = this.active ? value : 0;
    }
    return true;
  }
}
registerProcessor('gaterunner-generators', GeneratorProcessor);
