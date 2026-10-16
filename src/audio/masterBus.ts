import { markRaw } from 'vue';
import * as Tone from 'tone';
import { MASTER_CLIP_CURVE, MASTER_CLIP_DOMAIN } from './masterClip.js';
import { normalizeMasterPulse, type MasterPulseSettings } from './masterPulse.js';

export interface MasterBus {
  /** Everything audible connects here; nothing else may reach the destination. */
  input: Tone.Gain;
  preScale: Tone.Gain;
  clipper: Tone.WaveShaper;
  pulse: Tone.Gain;
  pulseControl?: AudioWorkletNode;
  pulseSettings?: MasterPulseSettings;
  pulseBpm?: number;
  pulseReady?: Promise<void>;
  disposed: boolean;
  onStart: (time: number) => void;
}

const buses = new WeakMap<Tone.BaseContext, MasterBus>();
const pulseModules = new WeakMap<Tone.BaseContext, Promise<void>>();

/**
 * One bus per context: an offline render builds its own so the exported mix passes
 * through exactly the same output stage as realtime playback.
 */
export function getMasterBus(context: Tone.BaseContext = Tone.getContext()): MasterBus {
  const existing = buses.get(context);
  if (existing) {
    return existing;
  }

  const input = markRaw(new Tone.Gain({ context, gain: 1 }));
  // The shaper only sees -1..1, so the mix is scaled into the curve's wider input domain.
  const preScale = markRaw(new Tone.Gain({ context, gain: 1 / MASTER_CLIP_DOMAIN }));
  const clipper = markRaw(new Tone.WaveShaper({ context, mapping: MASTER_CLIP_CURVE }));
  const pulse = markRaw(new Tone.Gain({ context, gain: 1 }));
  input.connect(preScale);
  preScale.connect(clipper);
  clipper.connect(pulse);
  pulse.connect(context.destination);

  const bus: MasterBus = markRaw({ input, clipper, preScale, pulse, disposed: false,
    onStart: (time: number) => resetMasterPulse(bus, time) });
  context.transport.on('start', bus.onStart);
  buses.set(context, bus);
  return bus;
}

export function setMasterGainDb(bus: MasterBus, db: number) {
  bus.input.gain.value = Math.pow(10, db / 20);
}

/** Prepare before starting playback/offline rendering; live edits reuse the same oscillator. */
export async function setMasterPulse(bus: MasterBus, value: unknown, bpm: number): Promise<void> {
  bus.pulseSettings = normalizeMasterPulse(value);
  bus.pulseBpm = bpm;
  if (bus.disposed || (!bus.pulseSettings.enabled && !bus.pulseReady)) return;
  const context = bus.input.context;
  if (!bus.pulseReady) {
    bus.pulseReady = (async () => {
      let ready = pulseModules.get(context);
      if (!ready) {
        ready = (async () => {
          const { default: url } = await import('./masterPulse.worklet?worker&url');
          await context.addAudioWorkletModule(url);
        })();
        pulseModules.set(context, ready);
        ready.catch(() => pulseModules.delete(context));
      }
      await ready;
      if (bus.disposed) return;
      const node = context.createAudioWorkletNode('gaterunner-master-pulse', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
      });
      bus.pulseControl = markRaw(node);
      Tone.connect(node, bus.pulse.gain);
      bus.pulse.gain.setValueAtTime(0, context.currentTime);
    })();
    bus.pulseReady.catch(() => { bus.pulseReady = undefined; });
  }
  await bus.pulseReady;
  if (bus.disposed) return;
  bus.pulseControl?.port.postMessage({ type: 'settings', frame: Math.round(context.now() * context.sampleRate),
    settings: bus.pulseSettings, bpm: bus.pulseBpm });
}

export function resetMasterPulse(bus: MasterBus, time: number): void {
  bus.pulseControl?.port.postMessage({ type: 'reset', frame: Math.round(time * bus.input.context.sampleRate) });
}

export function disposeMasterBus(context: Tone.BaseContext) {
  const bus = buses.get(context);
  if (!bus) {
    return;
  }

  buses.delete(context);
  bus.disposed = true;
  context.transport.off('start', bus.onStart);
  bus.pulseControl?.port.postMessage({ type: 'dispose' });
  bus.pulseControl?.disconnect();
  bus.pulseControl?.port.close();
  bus.input.dispose();
  bus.preScale.dispose();
  bus.clipper.dispose();
  bus.pulse.dispose();
}
