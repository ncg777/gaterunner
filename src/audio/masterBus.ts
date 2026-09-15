import { markRaw } from 'vue';
import * as Tone from 'tone';
import { MASTER_CLIP_CURVE, MASTER_CLIP_DOMAIN } from './masterClip.js';

export interface MasterBus {
  /** Everything audible connects here; nothing else may reach the destination. */
  input: Tone.Gain;
  preScale: Tone.Gain;
  clipper: Tone.WaveShaper;
}

const buses = new WeakMap<Tone.BaseContext, MasterBus>();

/**
 * One bus per context: an offline render builds its own so the exported mix passes
 * through exactly the same output stage as realtime playback.
 */
export function getMasterBus(context: Tone.BaseContext = Tone.getContext()): MasterBus {
  const existing = buses.get(context);
  if (existing) {
    return existing;
  }

  const input = markRaw(new Tone.Gain(1));
  // The shaper only sees -1..1, so the mix is scaled into the curve's wider input domain.
  const preScale = markRaw(new Tone.Gain(1 / MASTER_CLIP_DOMAIN));
  const clipper = markRaw(new Tone.WaveShaper(MASTER_CLIP_CURVE));
  input.connect(preScale);
  preScale.connect(clipper);
  clipper.connect(context.destination);

  const bus = markRaw({ input, clipper, preScale });
  buses.set(context, bus);
  return bus;
}

export function setMasterGainDb(bus: MasterBus, db: number) {
  bus.input.gain.value = Math.pow(10, db / 20);
}

export function disposeMasterBus(context: Tone.BaseContext) {
  const bus = buses.get(context);
  if (!bus) {
    return;
  }

  buses.delete(context);
  bus.input.dispose();
  bus.preScale.dispose();
  bus.clipper.dispose();
}
