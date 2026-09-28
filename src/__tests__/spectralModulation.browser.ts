import * as Tone from 'tone';
import { PitchEnvelopeSynth } from '../audio/pitchEnvelopeSynth';
import { MonoGlideSynth } from '../audio/monoGlideSynth';
import { normalizeSynthEngine } from '../audio/synthEngine';
import { normalizePresetTrackData } from '../presets';
import { generatePartialSpectrum, normalizePartialGenerator } from '../audio/partialGenerator';
import { getPartialSpectrumGain } from '../audio/partialSpectrumGain';
import { renderOfflineAudio } from '../audio/offlineRender';
import type App from '../App.vue';

export async function runSpectralModulationChecks(app: InstanceType<typeof App>) {
  const energy = (x: Float32Array) => x.reduce((sum, v) => sum + v * v, 0);
  const makeTrack = (target: string, amount: number, attack = 0, generator = {}) => normalizePresetTrackData({
    partialGenerator: { type: 'waveform', harmonicCount: 12, ...generator }, waveform: 'sawtooth', unisonVoices: 1,
    modulation: { sources: [{ id: 'env', type: 'envelope', attack, decay: 0, sustain: 1, release: 0.1 }],
      routes: [{ source: 'env', target, amount }] },
  });
  const render = async (track: ReturnType<typeof makeTrack>, mono = false, editUnison = false) => {
    let synth: PitchEnvelopeSynth | undefined;
    try {
      return await renderOfflineAudio(context => {
        const partialGenerator = normalizePartialGenerator(track.partialGenerator);
        const partials = generatePartialSpectrum(partialGenerator, track.waveform, track.tonewheelDrawbars);
        const Voice = mono ? MonoGlideSynth : PitchEnvelopeSynth;
        synth = new Voice({ engine: normalizeSynthEngine(track),
          spectralSource: { ...track, partialGenerator },
          oscillator: { type: 'custom', partials, volume: Tone.gainToDb(getPartialSpectrumGain(partials)) },
          envelope: { attack: 0.005, decay: 0, sustain: 1, release: 0.1 },
        }).toDestination();
        if (synth instanceof MonoGlideSynth) {
          synth.setGlide({ time: 0.03, mode: 'always', constantRate: false, curve: 'linear', legato: true });
          synth.triggerNotes([110], 0.4, 0.05, 0.1);
          synth.triggerNotes([165], 0.4, 0.3, 0.1);
        } else synth.triggerAttackRelease(110, 0.8, 0.05, 0.1);
        if (editUnison) {
          context.transport.schedule(() => synth!.set({ spectralSource: { ...track, partialGenerator,
            unisonVoices: 2, unisonDetune: 0 } }), 0.3);
          context.transport.schedule(() => synth!.set({ spectralSource: { ...track, partialGenerator,
            unisonVoices: 2, unisonDetune: 20 } }), 0.5);
        }
        context.transport.start(0);
      }, 1, 2, 24000);
    } finally { synth?.dispose(); }
  };
  const results: Record<string, number | boolean> = {};
  for (const [target, amount, generator] of [
    ['spectralTilt', -9, { tilt: -9 }], ['spectralContrast', 1, { contrast: 2 }],
    ['spectralBalance', 12, { oddEvenBalance: 12 }], ['harmonicCount', -8, { harmonicCount: 4 }],
  ] as const) {
    const modulated = (await render(makeTrack(target, amount))).getChannelData(0).slice(2400, 14400);
    const reference = (await render(makeTrack(target, 0, 0, generator))).getChannelData(0).slice(2400, 14400);
    const ratio = energy(modulated) / energy(reference);
    if (!modulated.every(Number.isFinite) || Math.abs(ratio - 1) > 0.03) throw new Error(`${target} differs from its static control: ${ratio}`);
    results[target] = ratio;
  }
  const evolving = (await render(makeTrack('spectralTilt', -12, 0.4))).getChannelData(0);
  const bin = (start: number, hz: number) => {
    let re = 0, im = 0;
    for (let i = Math.round(start * 24000); i < Math.round((start + 0.1) * 24000); i++) {
      re += evolving[i] * Math.cos(2 * Math.PI * hz * i / 24000);
      im += evolving[i] * Math.sin(2 * Math.PI * hz * i / 24000);
    }
    return Math.hypot(re, im);
  };
  const early = bin(0.07, 880) / bin(0.07, 220), late = bin(0.6, 880) / bin(0.6, 220);
  if (!(early > late * 2)) throw new Error(`Spectral envelope was flattened during export: ${early}/${late}`);
  results.envelopeBrightnessChange = early / late;
  const mono = (await render(makeTrack('spectralTilt', -12, 0.4), true)).getChannelData(0);
  if (energy(mono.slice(12000, 14400)) < 1e-5) throw new Error('Mono legato spectral voice stopped early');
  const lfoTrack = makeTrack('spectralTilt', -6);
  lfoTrack.modulation!.sources = [{ id: 'env', name: 'Motion', type: 'lfo', enabled: true,
    waveform: 'sine', rateHz: 2, sync: false, syncRate: '1/4', phase: 0, retrigger: 'note', unipolar: true }];
  const lfo = (await render(lfoTrack)).getChannelData(0);
  if (!lfo.every(Number.isFinite) || energy(lfo) < 1e-5) throw new Error('Spectral LFO failed');
  results.lfoAndMono = true;
  const edited = (await render(makeTrack('spectralTilt', -6), false, true)).getChannelData(0);
  if (!edited.every(Number.isFinite) || energy(edited.slice(14400, 16800)) < 1e-5) throw new Error('Live unison edit interrupted spectral audio');
  results.liveUnisonEdits = true;
  // Verify application voice wiring carries the generator metadata into newly pooled voices.
  const chain = app.createTrackAudioChain();
  try {
    const synth = app.ensureTrackSynth(chain, makeTrack('spectralTilt', -12));
    const set = synth.set.bind(synth);
    let forwarded = false;
    synth.set = ((options: Parameters<typeof synth.set>[0] & { spectralSource?: unknown }) => {
      if (options.spectralSource) forwarded = true;
      return set(options);
    }) as typeof synth.set;
    app.updateTrackChainSettings(makeTrack('spectralTilt', -12), chain);
    if (!forwarded) throw new Error('App omitted spectral source settings');
    results.appSettings = true;
  } finally { app.disposeTrackChain(chain); }
  return results;
}
