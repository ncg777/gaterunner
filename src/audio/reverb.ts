import { markRaw } from 'vue';
import * as Tone from 'tone';
import { getMasterBus } from './masterBus.js';
import { createPinkNoiseImpulseChannels } from './reverbImpulse.js';

export interface ReverbAudioChain {
  lowCut: Tone.Filter;
  highCut: Tone.Filter;
  convolver: Tone.Convolver;
  impulseKey: string;
  /** Whether the convolver tail is currently plugged into the destination. */
  outputConnected: boolean;
}

export interface ReverbSettings {
  decay: number;
  preDelay: number;
  lowCutFrequency: number;
  highCutFrequency: number;
}

export function createPinkNoiseImpulse(decay: number, preDelay: number): AudioBuffer {
  const context = Tone.getContext();
  const channels = createPinkNoiseImpulseChannels(decay, preDelay, context.sampleRate);
  const impulse = context.createBuffer(2, channels[0].length, context.sampleRate);
  channels.forEach((samples, channel) => impulse.getChannelData(channel).set(samples));
  return impulse;
}

function getImpulseKey(settings: ReverbSettings): string {
  return `${settings.decay}:${settings.preDelay}:${Tone.getContext().sampleRate}`;
}

export function createReverbAudioChain(settings: ReverbSettings): ReverbAudioChain {
  const lowCut = markRaw(new Tone.Filter({ type: 'highpass', frequency: settings.lowCutFrequency, rolloff: -12 })) as Tone.Filter;
  const highCut = markRaw(new Tone.Filter({ type: 'lowpass', frequency: settings.highCutFrequency, rolloff: -12 })) as Tone.Filter;
  const convolver = createConvolver(settings);
  convolver.connect(getMasterBus(convolver.context).input);

  lowCut.chain(highCut, convolver);
  return {
    lowCut,
    highCut,
    convolver,
    impulseKey: getImpulseKey(settings),
    outputConnected: true,
  };
}

/**
 * Convolution reverb costs the same CPU whether or not anything is being sent into it,
 * so the tail is unplugged from the destination while the reverb bus is switched off.
 */
export function setReverbOutputEnabled(chain: ReverbAudioChain, enabled: boolean) {
  if (chain.outputConnected === enabled) {
    return;
  }

  if (enabled) {
    chain.convolver.connect(getMasterBus(chain.convolver.context).input);
  } else {
    // Only the master bus edge is severed; the convolver keeps any other wiring intact.
    chain.convolver.disconnect(getMasterBus(chain.convolver.context).input);
  }
  chain.outputConnected = enabled;
}

export function updateReverbAudioChain(chain: ReverbAudioChain, settings: ReverbSettings) {
  chain.lowCut.set({ frequency: settings.lowCutFrequency });
  chain.highCut.set({ frequency: settings.highCutFrequency });

  const impulseKey = getImpulseKey(settings);
  if (chain.impulseKey !== impulseKey) {
    // Tone recreates the native node on buffer replacement, resetting normalization.
    const previous = chain.convolver;
    const convolver = createConvolver(settings);
    chain.highCut.disconnect(previous);
    chain.highCut.connect(convolver);
    if (chain.outputConnected) convolver.connect(getMasterBus(convolver.context).input);
    previous.dispose();
    chain.convolver = convolver;
    chain.impulseKey = impulseKey;
  }
}

export function disposeReverbAudioChain(chain: ReverbAudioChain) {
  chain.lowCut.dispose();
  chain.highCut.dispose();
  chain.convolver.dispose();
}

function createConvolver(settings: ReverbSettings): Tone.Convolver {
  // Tone loads constructor buffers before applying normalize. Set the flag first.
  const convolver = markRaw(new Tone.Convolver({ normalize: false })) as Tone.Convolver;
  convolver.buffer = new Tone.ToneAudioBuffer(createPinkNoiseImpulse(settings.decay, settings.preDelay));
  return convolver;
}
