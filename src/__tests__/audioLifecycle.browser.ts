import * as Tone from 'tone';
import type App from '../App.vue';
import { PitchEnvelopeSynth } from '../audio/pitchEnvelopeSynth';
import { retainVoicePool, prewarmVoicePool } from '../audio/voicePool';
import { normalizePresetTrackData } from '../presets';
import { disposeReverbAudioChain } from '../audio/reverb';
import { getMasterBus, disposeMasterBus } from '../audio/masterBus';
import { sleepWhenSilent } from '../audio/idleAudio';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const check = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };

export async function runAudioLifecycleChecks(app: InstanceType<typeof App>) {
  // Tone's global wave cache must not leak live-context waves into later offline
  // fixtures at another sample rate (the Unison sound tests isolate it likewise).
  const cache = Tone.Oscillator as unknown as { _periodicWaveCache: unknown[] };
  const savedWaves = cache._periodicWaveCache;
  cache._periodicWaveCache = [];
  const savedContext = Tone.getContext(), savedReverb = app.reverbChain;
  const context = new Tone.Context({ lookAhead: 0.4, updateInterval: 0.01 });
  Tone.setContext(context); app.reverbChain = null;
  let synth: Tone.PolySynth<PitchEnvelopeSynth> | undefined;
  let chain: ReturnType<typeof app.createTrackAudioChain> | undefined;
  let sleep: ReturnType<typeof sleepWhenSilent>;
  try {
    await context.resume();
    synth = new Tone.PolySynth(PitchEnvelopeSynth, {
      voiceFilter: { ...PitchEnvelopeSynth.getDefaults().voiceFilter,
        enabled: true, frequencyMidi: 69, lfoEnabled: true, lfoAmount: 12 },
      envelope: { attack: 0.01, decay: 0.01, sustain: 0.5, release: 0.1 },
      volume: -24,
    });
    synth.connect(getMasterBus(context).input);
    retainVoicePool(synth as unknown as Tone.PolySynth, 32);
    prewarmVoicePool(synth as unknown as Tone.PolySynth, 32);
    const voices = (synth as unknown as { _voices: PitchEnvelopeSynth[] })._voices;
    const listeners = () => voices.filter(voice =>
      (voice as unknown as { filterLfo: { listening: boolean } }).filterLfo?.listening).length;
    check(voices.length === 32 && listeners() === 0, 'Prewarmed voices subscribed to filter ticks');
    await wait(150);
    check(listeners() === 0, 'Silent pool started scheduling');
    const when = context.now();
    synth.triggerAttackRelease(220, 0.15, when);
    check(listeners() === 1, 'Reserved future note did not wake exactly one LFO');
    await wait(500);
    check(listeners() === 1, 'LFO stopped before the source/release tail ended');
    await wait(550);
    check(listeners() === 0, 'Released voice did not stop its ticker');
    synth.triggerAttackRelease(330, 0.1, context.now());
    check(listeners() === 1, 'Reused voice did not wake');

    const track = normalizePresetTrackData({ polyphony: 1, sequenceInput: '1',
      tremoloEnabled: true, vibratoEnabled: true, chorusEnabled: true,
      flangerEnabled: true, phaserEnabled: true });
    chain = app.createTrackAudioChain();
    app.updateTrackChainSettings(track, chain);
    const effects = ['tremolo', 'vibrato', 'chorus', 'flanger', 'phaser'] as const;
    const original = effects.map(key => chain![key]!);
    // An unrelated edit must neither replace nor restart enabled effects.
    app.updateTrackChainSettings({ ...track, gain: -12 }, chain);
    effects.forEach((key, i) => check(chain![key] === original[i], `Unrelated edit rebuilt ${key}`));
    app.updateTrackChainSettings({ ...track, chorusSpread: 90 }, chain);
    const chorusLfos = chain.chorus as unknown as { _lfoL: { _stoppedSignal: Tone.Signal }; _lfoR: { _stoppedSignal: Tone.Signal } };
    for (const lfo of [chorusLfos._lfoL, chorusLfos._lfoR]) {
      check(lfo._stoppedSignal.getValueAtTime(context.now()) === 0, 'Chorus spread introduced a resting DC offset');
    }
    const disabled = { ...track, tremoloEnabled: false, vibratoEnabled: false,
      chorusEnabled: false, flangerEnabled: false, phaserEnabled: false };
    for (let i = 0; i < 3; i++) {
      const retiring = effects.map(key => chain![key]!);
      app.updateTrackChainSettings(disabled, chain);
      effects.forEach((key, j) => check(chain![key] === null && retiring[j].disposed, `${key} was retained`));
      check(chain.flangerLfo === null, 'Disabled flanger LFO survived');
      app.updateTrackChainSettings(track, chain);
      effects.forEach(key => check(!!chain![key] && !chain![key]!.disposed, `${key} did not recover`));
    }
    app.disposeTrackChain(chain); chain = undefined;
    if (app.reverbChain) { disposeReverbAudioChain(app.reverbChain); app.reverbChain = null; }

    // Sleep cannot win a rapid Stop/Play race, even after suspend has been issued.
    sleep = sleepWhenSilent(context, getMasterBus(context).clipper, context.currentTime + 1, 0.1);
    await sleep!.cancel();
    await wait(120);
    check(context.state === 'running', 'Cancelled sleep suspended playback');
    await wait(900);
    sleep = sleepWhenSilent(context, getMasterBus(context).clipper, context.currentTime, 0.15);
    await wait(1000);
    check(context.state === 'suspended', 'Silent realtime context did not sleep');
    await sleep!.cancel();
    await context.resume();
    check(context.state === 'running', 'Sleeping context did not resume');
    return { allocatedVoices: 32, idleFilterListeners: 0, soundingFilterListeners: 1,
      effectToggleCycles: 3, sleepAndResume: true };
  } finally {
    await sleep?.cancel();
    synth?.dispose();
    if (chain) app.disposeTrackChain(chain);
    if (app.reverbChain) disposeReverbAudioChain(app.reverbChain);
    disposeMasterBus(context);
    await context.close(); context.dispose();
    Tone.setContext(savedContext); app.reverbChain = savedReverb;
    cache._periodicWaveCache = savedWaves;
  }
}

export async function runTransportSleepChecks(app: InstanceType<typeof App>) {
  const cache = Tone.Oscillator as unknown as { _periodicWaveCache: unknown[] };
  const savedWaves = cache._periodicWaveCache;
  cache._periodicWaveCache = [];
  const savedContext = Tone.getContext();
  const saved = { tracks: app.tracks, selectedTrackId: app.selectedTrackId, bpm: app.bpm,
    reverbChain: app.reverbChain, reverbEnabled: app.reverbEnabled,
    trackSynths: app.trackSynths, trackLoops: app.trackLoops, trackFadeLoops: app.trackFadeLoops,
    lastScheduledAudioEnd: app.lastScheduledAudioEnd, audioSleep: app.audioSleep };
  const context = new Tone.Context({ lookAhead: 0.4, updateInterval: 0.01 });
  Tone.setContext(context);
  app.audioSleep = null; app.lastScheduledAudioEnd = 0;
  app.reverbChain = null; app.reverbEnabled = false;
  app.trackSynths = {}; app.trackLoops = {}; app.trackFadeLoops = {};
  app.bpm = 120;
  const track = normalizePresetTrackData({ id: 'sleep-test', sequenceInput: '1', polyphony: 2,
    release: 0.05, filterEnabled: true, filterLfoEnabled: true, filterLfoAmount: 12,
    filterFrequency: 69, gain: -24, echoEnabled: false });
  app.tracks = [track]; app.selectedTrackId = track.id;
  try {
    await app.startSequencer();
    check(app.isRunning && context.state === 'running', 'Play failed');
    await wait(300);
    app.stopSequencer();
    const firstSleep = app.audioSleep;
    app.stopSequencer();
    check(app.audioSleep === firstSleep, 'Repeated Stop lost the pending suspend');
    check(context.state === 'running', 'Stop cut an outstanding note/tail');
    await app.startSequencer();
    await wait(600);
    check(app.isRunning && context.state === 'running', 'Stop/Play race suspended playback');
    app.stopSequencer();
    // Wait for actual source duration, release, analyser window and effect-gap guard.
    const deadline = performance.now() + 12000;
    while (context.state === 'running' && performance.now() < deadline) await wait(100);
    check(context.state === 'suspended', 'Transport Stop never reached idle');
    document.dispatchEvent(new MouseEvent('click'));
    await wait(100);
    check(context.state === 'suspended', 'Stopped UI click woke the context');
    await app.startSequencer();
    check(app.isRunning && context.state === 'running', 'Play failed after idle suspension');
    return { repeatedStop: true, rapidRestart: true, tailDrained: true, idleClickStayedAsleep: true, restart: true };
  } finally {
    app.stopSequencer();
    await app.audioSleep?.cancel(); app.audioSleep = null;
    Object.values(app.trackSynths).forEach(chain => app.disposeTrackChain(chain));
    if (app.reverbChain) disposeReverbAudioChain(app.reverbChain);
    disposeMasterBus(context);
    await context.close(); context.dispose();
    Tone.setContext(savedContext); Object.assign(app, saved);
    cache._periodicWaveCache = savedWaves;
  }
}
