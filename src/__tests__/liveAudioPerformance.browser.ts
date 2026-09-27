import * as Tone from 'tone';
import type App from '../App.vue';
import { createLiveContext, saveLiveBuffering } from '../audio/liveAudio';
import { PitchEnvelopeSynth } from '../audio/pitchEnvelopeSynth';
import { MonoGlideSynth } from '../audio/monoGlideSynth';
import { disposeMasterBus } from '../audio/masterBus';
import { disposeReverbAudioChain } from '../audio/reverb';

type VoiceInternals = {
  outputAwake: boolean;
  routeFilter(): void;
  scheduleOutputSleep(): void;
};
const internals = (voice: PitchEnvelopeSynth) => voice as unknown as VoiceInternals;

/** Fresh-page benchmark only: reproduce the previous context and always-connected pool. */
export async function configureLiveAudioProfile(app: InstanceType<typeof App>, compatibility: boolean, keepAwake: boolean) {
  const old = Tone.getContext() as Tone.Context;
  await app.audioSleep?.cancel(); app.audioSleep = null;
  for (const chain of Object.values(app.trackSynths)) app.disposeTrackChain(chain);
  app.trackSynths = {};
  if (app.reverbChain) disposeReverbAudioChain(app.reverbChain);
  app.reverbChain = null;
  disposeMasterBus(old);
  const context = compatibility
    ? new Tone.Context({ latencyHint: 0.17 as unknown as AudioContextLatencyCategory, lookAhead: 0.4, updateInterval: 0.01 })
    : createLiveContext('extended');
  Tone.setContext(context);
  app.liveBuffering = 'extended';
  saveLiveBuffering('extended');
  await old.close(); old.dispose();
  if (keepAwake) {
    const prototype = PitchEnvelopeSynth.prototype as unknown as VoiceInternals;
    const route = prototype.routeFilter;
    prototype.routeFilter = function () { this.outputAwake = true; route.call(this); };
    prototype.scheduleOutputSleep = () => {};
  }
}

/** Compare sleeping/reawakened voices with an always-connected reference on the audio thread. */
export async function runVoiceSleepChecks(_app?: unknown, mono = false) {
  const original = Tone.getContext(), context = createLiveContext('extended');
  Tone.setContext(context);
  const voices: PitchEnvelopeSynth[] = [];
  let meter: AudioWorkletNode | undefined;
  let modulation: Tone.LFO | undefined;
  let peakDifference = 0, peakSignal = 0, frames = 0, differenceTime = 0;
  const windows: number[] = [];
  const waitUntil = async (time: number) => {
    const deadline = performance.now() + 15000;
    while (context.currentTime < time) {
      if (performance.now() > deadline) throw new Error('Live audio clock stalled');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  };
  try {
    await context.resume();
    const name = `voice-sleep-${Date.now()}`;
    const url = URL.createObjectURL(new Blob([`
class CompareVoices extends AudioWorkletProcessor {
  process(inputs) {
    const a = inputs[0]?.[0], b = inputs[1]?.[0];
    let difference = 0, peak = 0;
    for (let i = 0; i < 128; i++) {
      difference = Math.max(difference, Math.abs((a?.[i] ?? 0) - (b?.[i] ?? 0)));
      peak = Math.max(peak, Math.abs(b?.[i] ?? 0));
    }
    this.port.postMessage({ difference, peak, time: currentTime });
    return true;
  }
}
registerProcessor('${name}', CompareVoices);`], { type: 'application/javascript' }));
    try { await context.addAudioWorkletModule(url); } finally { URL.revokeObjectURL(url); }
    meter = context.createAudioWorkletNode(name, { numberOfInputs: 2 });
    // Both paths receive identical sample-clock modulation. Independent JS LFO
    // schedulers can fill their lookahead windows on opposite callback boundaries.
    modulation = new Tone.LFO({ context, frequency: 1, min: -200, max: 200 }).start(0);
    Tone.connect(meter, context.destination);
    meter.port.onmessage = ({ data }) => {
      if (data.difference > peakDifference) { peakDifference = data.difference; differenceTime = data.time; }
      peakSignal = Math.max(peakSignal, data.peak);
      frames += 128;
    };
    for (let i = 0; i < 2; i++) {
      const Voice = mono ? MonoGlideSynth : PitchEnvelopeSynth;
      const voice = new Voice({
        oscillator: { type: 'sine' } as Tone.SynthOptions['oscillator'],
        envelope: { attack: 0.01, decay: 0.01, sustain: 0.5, release: 0.1 },
        voiceFilter: { ...PitchEnvelopeSynth.getDefaults().voiceFilter,
          enabled: true, frequencyMidi: 81, Q: 3, rolloff: -24, lfoEnabled: false, lfoAmount: 2 },
      });
      voices.push(voice);
      if (i === 1) {
        internals(voice).outputAwake = true;
        internals(voice).routeFilter();
        internals(voice).scheduleOutputSleep = () => {};
      }
      voice.connect(meter, 0, i);
      modulation.connect(voice.filter.detune);
    }
    if (internals(voices[0]!).outputAwake) throw new Error('Unused voice graph is connected');
    for (let cycle = 0; cycle < 3; cycle++) {
      const start = context.now();
      windows.push(start);
      for (const voice of voices) {
        if (voice instanceof MonoGlideSynth) voice.triggerNotes([220 + cycle * 55], 0.15, start, 1);
        else voice.triggerAttackRelease(220 + cycle * 55, 0.15, start);
      }
      if (!internals(voices[0]!).outputAwake) throw new Error('Reserved attack did not reconnect');
      await waitUntil(start + 0.2);
      if (!internals(voices[0]!).outputAwake) throw new Error('Release tail disconnected early');
      await waitUntil(start + 1.1);
      if (internals(voices[0]!).outputAwake !== mono) throw new Error('Finished voice has wrong connection state');
    }
    // A later reserved note must prevent an earlier sleep timer from unplugging it.
    const start = context.now();
    windows.push(start, start + 1);
    for (const voice of voices) {
      voice.triggerAttackRelease(330, 0.1, start);
      voice.triggerAttackRelease(440, 0.1, start + 1);
    }
    await waitUntil(start + 0.7);
    if (!internals(voices[0]!).outputAwake) throw new Error('Future attack lost its connection');
    await waitUntil(start + 2);
    // Capture PCM before resetGlide(), whose API independently reads now() for
    // each voice rather than accepting a common scheduled reset timestamp.
    const pcmDifference = peakDifference;
    if (mono) {
      const onset = context.now();
      for (const voice of voices) (voice as MonoGlideSynth).triggerNotes([277], 1, onset, 1);
      await waitUntil(onset + 0.1);
      const resetTime = context.now();
      for (const voice of voices) (voice as MonoGlideSynth).resetGlide();
      await waitUntil(resetTime - 0.05);
      if (!internals(voices[0]!).outputAwake) throw new Error('Scheduled reset cut the current note early');
      await waitUntil(resetTime + 0.8);
      if (internals(voices[0]!).outputAwake) throw new Error('Reset voice did not sleep');
    }
    if (!Number.isFinite(pcmDifference) || pcmDifference > 1e-5 || peakSignal < 0.01 || frames < context.sampleRate * 4) {
      throw new Error(`Voice sleep changed PCM: ${JSON.stringify({ mono, peakDifference, differenceTime, windows, peakSignal, frames })}`);
    }
    return { mono, peakDifference: pcmDifference, peakSignal, frames, reusedAfterSilence: true, tailsAndFutureNotesPreserved: true };
  } finally {
    voices.forEach(voice => voice.dispose());
    modulation?.dispose();
    meter?.disconnect(); meter?.port.close();
    await context.close(); context.dispose();
    Tone.setContext(original);
  }
}

export const runMonoVoiceSleepChecks = () => runVoiceSleepChecks(undefined, true);
