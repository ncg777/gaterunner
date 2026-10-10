import * as Tone from 'tone';
import { GENERATOR_MODULATION, isGeneratorMode, type GeneratorMode } from './generatorSettings.js';
import type { GeneratorSample } from './generatorDSP.js';
import { resolveGeneratorEngine, resolveSynthMode, type SynthEngineSettings } from './synthEngine.js';
import { sampleContentHash } from './sampleAssets.js';
import type { ModulationTime, ModulationValues } from './modulation.js';

const modules = new WeakMap<Tone.BaseContext, Promise<void>>();
const uploads = new WeakMap<Tone.BaseContext, Map<string, Promise<void>>>();
const prepared = new WeakSet<Tone.BaseContext>();
const uploaded = new WeakMap<Tone.BaseContext, Set<string>>();
/** Load before constructing/offline-scheduling voices. Existing engines need no worklet. */
export async function prepareGeneratorContext(context: Tone.BaseContext, samples: readonly GeneratorSample[] = []): Promise<void> {
  let ready = modules.get(context);
  if (!ready) {
    ready = (async () => {
      const { default: url } = await import('./generator.worklet?worker&url');
      await context.addAudioWorkletModule(url);
    })();
    modules.set(context, ready);
    ready.catch(() => modules.delete(context));
  }
  await ready;
  prepared.add(context);
  let loaded = uploads.get(context);
  if (!loaded) { loaded = new Map(); uploads.set(context, loaded); }
  for (const asset of new Map(samples.map(asset => [asset.hash, asset])).values()) {
    if (await sampleContentHash(asset.channels, asset.sampleRate) !== asset.hash) throw new Error('Granular sample content hash mismatch');
    let upload = loaded.get(asset.hash);
    if (!upload) {
      upload = (async () => {
        await new Promise<void>((resolve, reject) => {
          const node = context.createAudioWorkletNode('gaterunner-generators', { numberOfInputs: 1, numberOfOutputs: 0 });
          const timer = globalThis.setTimeout(() => { node.port.close(); reject(new Error('Granular sample upload timed out')); }, 15000);
          node.onprocessorerror = () => { globalThis.clearTimeout(timer); node.port.close(); reject(new Error('Granular sample upload failed')); };
          node.port.onmessage = () => { globalThis.clearTimeout(timer); node.port.postMessage({ type: 'dispose' }); node.port.close(); resolve(); };
          const channels = asset.channels.map(channel => Float32Array.from(channel));
          node.port.postMessage({ type: 'asset', asset: { hash: asset.hash, sampleRate: asset.sampleRate, channels } }, channels.map(c => c.buffer));
        });
      })();
      loaded.set(asset.hash, upload);
      upload.catch(() => loaded!.delete(asset.hash));
    }
    await upload;
    let hashes = uploaded.get(context);
    if (!hashes) { hashes = new Set(); uploaded.set(context, hashes); }
    hashes.add(asset.hash);
  }
}

export async function prepareProjectGenerators(context: Tone.BaseContext, tracks: readonly unknown[], assets: readonly GeneratorSample[] = []) {
  const generators = tracks.filter(track => isGeneratorMode(resolveSynthMode(track)));
  if (!generators.length) return;
  const samples = generators.map(track => resolveGeneratorEngine(track, assets).generatorSample).filter((a): a is GeneratorSample => !!a);
  await prepareGeneratorContext(context, samples);
}

/** A reusable worklet source feeding the existing per-voice envelope/filter chain. */
export class GeneratorSource {
  readonly output: Tone.Gain;
  private node?: AudioWorkletNode;
  private disposed = false;
  private initializing = false;
  private pending: unknown[] = [];
  private settings: SynthEngineSettings;
  private readonly keys = Object.keys(GENERATOR_MODULATION) as (keyof typeof GENERATOR_MODULATION)[];
  constructor(private context: Tone.BaseContext, private frequency: Tone.Signal<'frequency'>,
    private detune: Tone.Signal<'cents'>, settings: SynthEngineSettings) {
    this.settings = settings;
    this.output = new Tone.Gain({ context, gain: 1 });
    if (this.isPrepared()) this.connectNode();
    else void this.initialize();
  }
  private isPrepared() { return prepared.has(this.context) && (!this.settings.generatorSample || uploaded.get(this.context)?.has(this.settings.generatorSample.hash)); }
  private connectNode() {
    if (this.disposed || this.node || (this.settings.synthMode === 'granular' && !this.settings.generatorSample)) return;
    const node = this.context.createAudioWorkletNode('gaterunner-generators', {
      numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1,
      processorOptions: { mode: this.settings.synthMode as GeneratorMode, settings: this.settings.generatorEngines },
    });
    this.node = node;
    Tone.connect(this.frequency, node, 0, 0); Tone.connect(this.detune, node, 0, 1);
    Tone.connect(node, this.output);
    for (const event of this.pending) node.port.postMessage(event);
    this.pending = [];
  }
  private async initialize() {
    if (this.initializing || this.disposed || (this.settings.synthMode === 'granular' && !this.settings.generatorSample)) return;
    this.initializing = true;
    try {
      await prepareGeneratorContext(this.context, this.settings.generatorSample ? [this.settings.generatorSample] : []);
      this.connectNode();
    } catch (error) {
      if (!this.disposed) console.error('Generator could not initialize', error);
    } finally { this.initializing = false; }
  }
  private send(event: unknown) { if (this.node) this.node.port.postMessage(event); else this.pending.push(event); }
  private frame(time: number) { return Math.round(time * this.context.sampleRate); }
  set(settings: SynthEngineSettings) {
    const sampleChanged = settings.generatorSample?.hash !== this.settings.generatorSample?.hash;
    this.settings = settings;
    const apply = () => {
      if (this.disposed || this.settings !== settings) return;
      if (settings.synthMode === 'granular' && !settings.generatorSample) {
        this.cancel(this.context.now()); this.reset(this.context.now()); return;
      }
      if (!this.node) { if (this.isPrepared()) this.connectNode(); else void this.initialize(); }
      this.send({ type: 'settings', frame: this.frame(this.context.now()), settings: settings.generatorEngines });
    };
    if (sampleChanged && settings.generatorSample) void prepareGeneratorContext(this.context, [settings.generatorSample]).then(apply).catch(error => {
      if (!this.disposed) console.error('Granular sample could not load', error);
    });
    else apply();
  }
  note(_frequency: number, _time: number, _fromFrequency?: number, _glideSeconds = 0) { /* Audio input buses carry scheduled pitch and glide. */ }
  attack(time: number, mono = false, stopTime?: number) {
    if (this.settings.synthMode === 'granular' && !this.settings.generatorSample) return;
    this.send({ type: 'attack', frame: this.frame(time), mono, stop: stopTime === undefined ? undefined : this.frame(stopTime) });
  }
  release(time: number, ampRelease?: number) { this.send({ type: 'release', frame: this.frame(time), stop: ampRelease === undefined ? undefined : this.frame(time + ampRelease) }); }
  cancel(time: number) { this.send({ type: 'cancel', frame: this.frame(time) }); }
  reset(time: number) { this.send({ type: 'reset', frame: this.frame(time) }); }
  refresh(time: number) { this.keys.forEach(key => this.node?.parameters.get(key)?.cancelAndHoldAtTime(time)); }
  write(values: ModulationValues, timing: ModulationTime, ramp: boolean) {
    for (const key of this.keys) {
      const parameter = this.node?.parameters.get(key);
      if (parameter) {
        if (ramp) parameter.linearRampToValueAtTime(values[key], timing.time);
        else parameter.setValueAtTime(values[key], timing.time);
      }
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.pending = [];
    if (this.node) {
      Tone.disconnect(this.frequency, this.node, 0, 0); Tone.disconnect(this.detune, this.node, 0, 1);
      this.node.port.postMessage({ type: 'dispose' }); this.node.disconnect(); this.node.port.close();
    }
    this.output.dispose();
  }
}
