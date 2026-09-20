import * as Tone from 'tone';
import type App from '../App.vue';
import { setFilterSettings } from '../audio/filterSettings';
import { PitchEnvelopeSynth } from '../audio/pitchEnvelopeSynth';
import { renderOfflineAudio } from '../audio/offlineRender';
import { normalizePresetTrackData } from '../presets';
import { disposeReverbAudioChain } from '../audio/reverb';

export async function runFilterUpdatePerformanceChecks() {
  const context = new Tone.Context({ clockSource: 'offline' });
  const filters: Tone.Filter[] = [];
  let creations = 0;
  const create = context.createBiquadFilter;
  context.createBiquadFilter = function () { creations++; return create.call(this); };
  try {
    for (let i = 0; i < 8; i++) filters.push(new Tone.Filter({ context, rolloff: -24, frequency: 900 }));
    const settings = { type: 'lowpass' as const, rolloff: -24 as const, Q: 2, gain: 0 };
    creations = 0;
    let start = performance.now();
    for (let edit = 0; edit < 60; edit++) for (const filter of filters) filter.set(settings);
    const baselineMilliseconds = performance.now() - start;
    const baselineBiquads = creations;
    creations = 0;
    start = performance.now();
    for (let edit = 0; edit < 60; edit++) for (const filter of filters) setFilterSettings(filter, settings);
    const optimizedMilliseconds = performance.now() - start;
    if (creations !== 0 || baselineBiquads !== 960) throw new Error(`Filter allocation regression: ${baselineBiquads} -> ${creations}`);
    setFilterSettings(filters[0], { ...settings, rolloff: -48, type: 'highpass', Q: 3 });
    if (Number(creations) !== 3 || filters[0].rolloff !== -48 || filters[0].type !== 'highpass'
      || filters[0].Q.value !== 3) throw new Error('Changed filter settings were lost');
    return { edits: 60, filters: 8, baselineBiquads, optimizedBiquads: 0, baselineMilliseconds, optimizedMilliseconds };
  } finally {
    filters.forEach(filter => filter.dispose());
    await context.close(); context.dispose();
  }
}

/** Reapplying controls during notes must preserve native filter history and tails. */
export async function runFilterUpdateSoundChecks() {
  let cases = 0;
  for (const rolloff of [-12, -24, -48, -96] as const) {
    const render = async (edits: boolean) => {
      let voice: PitchEnvelopeSynth | undefined;
      try {
        const buffer = await renderOfflineAudio(context => {
          const voiceFilter = { ...PitchEnvelopeSynth.getDefaults().voiceFilter,
            enabled: true, rolloff, frequencyMidi: 70, Q: 3, amount: 12, sustain: 0.3 };
          voice = new PitchEnvelopeSynth({ context, voiceFilter, volume: -18,
            oscillator: { ...PitchEnvelopeSynth.getDefaults().oscillator, type: 'sawtooth' },
            envelope: { ...PitchEnvelopeSynth.getDefaults().envelope, attack: 0.01, decay: 0.03, sustain: 0.7, release: 0.2 },
          }).toDestination();
          voice.triggerAttackRelease(220, 0.3, 0.02);
          voice.triggerAttackRelease(330, 0.2, 0.6);
          if (edits) for (const time of [0.1, 0.2, 0.35, 0.45, 0.7, 0.85]) {
            context.setTimeout(() => voice!.set({ voiceFilter }), time);
          }
        }, 1.1, 1, 48000);
        const samples = buffer.getChannelData(0).slice(); buffer.dispose(); return samples;
      } finally { voice?.dispose(); }
    };
    const expected = await render(false), actual = await render(true);
    if (!actual.every((value, i) => value === expected[i])) throw new Error(`Filter history changed at ${rolloff} dB/octave`);
    if (!actual.some(value => Math.abs(value) > 0.001)) throw new Error('Silent filter comparison');
    cases++;
  }
  return { identicalPcmCases: cases };
}

export async function runIdleModulationChecks(app: InstanceType<typeof App>) {
  const savedContext = Tone.getContext(), savedReverb = app.reverbChain;
  const context = new Tone.Context({ lookAhead: 0.05, updateInterval: 0.01 });
  Tone.setContext(context); app.reverbChain = null;
  let chain: ReturnType<typeof app.createTrackAudioChain> | undefined;
  const original = app.getTonewheelPartials;
  let preparations = 0;
  app.getTonewheelPartials = (...args) => { preparations++; return original(...args); };
  try {
    await context.resume();
    const track = normalizePresetTrackData({ polyphony: 4, unisonVoices: 3, release: 0.25,
      tonewheelWavetable: { enabled: true, dimensions: [{ name: 'X', value: 0.5 }],
        configurations: [{ position: [0], drawbars: [8, 0, 0, 0, 0, 0, 0, 0, 0] },
          { position: [1], drawbars: [0, 0, 8, 0, 0, 0, 0, 0, 0] }],
        lfos: [{ enabled: true, waveform: 'sine', rateHz: 1, depth: 0.3, routes: [1] }] },
    });
    chain = app.createTrackAudioChain(); app.updateTrackChainSettings(track, chain);
    const tick = () => chain!.wavetableLfoLoop!.callback(context.now());
    preparations = 0;
    for (let i = 0; i < 90; i++) tick();
    if (preparations !== 0) throw new Error('Silent pool prepared spectra');
    const when = context.now();
    app.triggerTrackVoice(track, chain, [69], 0.05, when, 0.5, 0.21);
    if (Number(preparations) !== 1) throw new Error('Attack did not refresh the idle spectrum');
    const expected = original(track, 0.21, 0.21, chain.preparedWavetable);
    if (JSON.stringify(chain.lastAppliedPartials) !== JSON.stringify(expected)) throw new Error('Attack used a stale spectrum');
    tick();
    if (Number(preparations) !== 2) throw new Error('Future scheduled note missed modulation');
    await new Promise(resolve => setTimeout(resolve, 160));
    tick();
    if (Number(preparations) !== 3) throw new Error('Release tail missed modulation');
    await new Promise(resolve => setTimeout(resolve, 700));
    tick();
    if (Number(preparations) !== 3) throw new Error('Ended tail still prepared spectra');
    app.triggerTrackVoice(track, chain, [72], 0.05, context.now(), 0.5, 0.73);
    if (Number(preparations) !== 4) throw new Error('Reused voice did not refresh modulation');
    return { silentTicksSkipped: 90, attackRefresh: true, futureNoteAndReleaseTailUpdated: true, reuseRefresh: true };
  } finally {
    app.getTonewheelPartials = original;
    if (chain) app.disposeTrackChain(chain);
    if (app.reverbChain) disposeReverbAudioChain(app.reverbChain);
    app.reverbChain = savedReverb;
    Tone.setContext(savedContext);
    await context.close(); context.dispose();
  }
}
