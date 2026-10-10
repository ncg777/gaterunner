import * as Tone from 'tone';
import { GeneratorDSP } from '../audio/generatorDSP';
import { GeneratorSource, prepareGeneratorContext, prepareProjectGenerators } from '../audio/generatorSource';
import { GENERATOR_MODES } from '../audio/generatorSettings';
import { resolveGeneratorEngine } from '../audio/synthEngine';
import { createSampleAsset } from '../audio/sampleAssets';
import { renderOfflineAudio } from '../audio/offlineRender';
import { PitchEnvelopeSynth } from '../audio/pitchEnvelopeSynth';
import { MonoGlideSynth } from '../audio/monoGlideSynth';
import { normalizePresetData } from '../presets';
import type App from '../App.vue';
import { nextTick } from 'vue';

const rate = 48000;
const check = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
const energy = (data: Float32Array, begin = 0, end = data.length) => data.subarray(begin, end).reduce((sum, v) => sum + v * v, 0) / Math.max(1, end - begin);
/** Real AudioWorklet/offline/native comparisons, including the app's voice adapter. */
export async function runGeneratorChecks() {
  const asset = await createSampleAsset([Float32Array.from({ length: rate }, (_, i) => Math.sin(2 * Math.PI * 261.625565 * i / rate))], rate, 'Generator test sine');
  const reports: Record<string, unknown>[] = [];
  for (const mode of GENERATOR_MODES) {
    const engine = resolveGeneratorEngine({ synthMode: mode, generatorEngines: { granular: { asset: asset.hash } } }, [asset]);
    let source: GeneratorSource | undefined, frequency: Tone.Signal<'frequency'> | undefined, detune: Tone.Signal<'cents'> | undefined;
    const buffer = await renderOfflineAudio(async context => {
      await prepareGeneratorContext(context, mode === 'granular' ? [asset] : []);
      frequency = new Tone.Signal({ context, value: 110, units: 'frequency' });
      detune = new Tone.Signal({ context, value: 0, units: 'cents' });
      source = new GeneratorSource(context, frequency, detune, engine); source.output.toDestination();
      source.attack(0.01, false); source.release(0.2, 0.04);
    }, 0.3, 1, rate);
    const pcm = buffer.getChannelData(0);
    check(pcm.every(Number.isFinite) && energy(pcm) > 1e-6, `${mode}: worklet must produce finite audible sound`);
    check(energy(pcm, 12000) === 0, `${mode}: source must stop after release`);
    const native = new GeneratorDSP(mode, engine.generatorEngines, rate, mode === 'granular' ? asset : undefined); native.attack(220);
    let maximumDifference = 0;
    for (let frame = 480; frame < 9600; frame++) {
      const expected = native.sample(220, (frame - 480) / rate, 0.19);
      maximumDifference = Math.max(maximumDifference, Math.abs(expected - pcm[frame]));
    }
    check(maximumDifference < 2e-6, `${mode}: browser/native source mismatch ${maximumDifference}`);
    reports.push({ mode, rms: Math.sqrt(energy(pcm)), maximumDifference, releaseSilent: true });
    source?.dispose(); frequency?.dispose(); detune?.dispose();

    let synth: PitchEnvelopeSynth | undefined;
    const synthBuffer = await renderOfflineAudio(async context => {
      await prepareGeneratorContext(context, mode === 'granular' ? [asset] : []);
      synth = new PitchEnvelopeSynth({ context, engine, envelope: { attack: 0.005, decay: 0.02, sustain: 0.7, release: 0.03 } });
      synth.toDestination(); synth.triggerAttackRelease(110, 0.2, 0.01, 0.5);
    }, 0.35, 1, rate);
    check(energy(synthBuffer.getChannelData(0)) > 1e-6, `${mode}: shared voice must be audible`);
    check(energy(synthBuffer.getChannelData(0), 14400) < 1e-10, `${mode}: shared voice must release`);
    synth?.dispose();
  }

  let pulse: PitchEnvelopeSynth | undefined;
  const modulated = await renderOfflineAudio(async context => {
    await prepareGeneratorContext(context);
    pulse = new PitchEnvelopeSynth({ context, engine: resolveGeneratorEngine({ synthMode: 'pulse', modulation: {
      sources: [{ id: 'width', type: 'envelope', attack: 0, decay: 0, sustain: 1 }],
      routes: [{ id: 'width-route', source: 'width', target: 'pulseWidth', amount: -0.3 }],
    } }), envelope: { attack: 0.005, decay: 0.02, sustain: 1, release: 0.03 } });
    pulse.toDestination(); pulse.triggerAttackRelease(110, 0.2, 0.01);
  }, 0.3, 1, rate);
  check(energy(modulated.getChannelData(0)) > 1e-6, 'Voice matrix must drive worklet parameters'); pulse?.dispose();
  const unmodulated = await renderOfflineAudio(async context => {
    await prepareGeneratorContext(context);
    pulse = new PitchEnvelopeSynth({ context, engine: resolveGeneratorEngine({ synthMode: 'pulse' }),
      envelope: { attack: 0.005, decay: 0.02, sustain: 1, release: 0.03 } });
    pulse.toDestination(); pulse.triggerAttackRelease(110, 0.2, 0.01);
  }, 0.3, 1, rate);
  const baseline = unmodulated.getChannelData(0), changed = modulated.getChannelData(0);
  check(baseline.some((v, i) => Math.abs(v - changed[i]) > 0.01), 'Pulse width matrix route must change the sounding spectrum'); pulse?.dispose();

  let mono: MonoGlideSynth | undefined;
  const monoBuffer = await renderOfflineAudio(async context => {
    await prepareGeneratorContext(context);
    mono = new MonoGlideSynth({ context, engine: resolveGeneratorEngine({ synthMode: 'pluck' }),
      envelope: { attack: 0.005, decay: 0.02, sustain: 1, release: 0.03 } });
    mono.setGlide({ time: 0.05, mode: 'legato', constantRate: false, curve: 'exponential', legato: true });
    mono.toDestination(); mono.triggerNotes([110], 0.18, 0.01, 0.7); mono.triggerNotes([165], 0.2, 0.12, 0.7);
    context.setTimeout(() => mono!.resetGlide(), 0.4);
  }, 0.5, 1, rate);
  check(energy(monoBuffer.getChannelData(0), 5760, 9600) > 1e-6, 'Mono pluck must continue across legato glide'); mono?.dispose();

  let gapSource: GeneratorSource | undefined, gapFrequency: Tone.Signal<'frequency'> | undefined, gapDetune: Tone.Signal<'cents'> | undefined;
  const gapEngine = resolveGeneratorEngine({ synthMode: 'pulse' });
  const gapBuffer = await renderOfflineAudio(async context => {
    await prepareGeneratorContext(context);
    gapFrequency = new Tone.Signal({ context, value: 110, units: 'frequency' });
    gapDetune = new Tone.Signal({ context, value: 0, units: 'cents' });
    gapSource = new GeneratorSource(context, gapFrequency, gapDetune, gapEngine); gapSource.output.toDestination();
    gapSource.attack(0.01, true); gapSource.release(0.06, 0.01);
    gapSource.attack(0.12, true); gapSource.release(0.18, 0.02);
  }, 0.25, 1, rate);
  const gapNative = new GeneratorDSP('pulse', gapEngine.generatorEngines, rate); gapNative.attack(220);
  const gapPcm = gapBuffer.getChannelData(0); let gapDifference = 0;
  for (let frame = 480; frame < 9600; frame++) {
    if (frame === 5760) gapNative.attack(220, true);
    const value = gapNative.sample(220, 0, Infinity);
    const expected = frame >= 3360 && frame < 5760 ? 0 : value;
    gapDifference = Math.max(gapDifference, Math.abs(expected - gapPcm[frame]));
  }
  check(gapDifference < 2e-6, `Mono phase must continue through silent gaps: ${gapDifference}`);
  gapSource?.dispose(); gapFrequency?.dispose(); gapDetune?.dispose();

  const app = (document.querySelector('#app') as Element & { __vue_app__: { _instance: { proxy: InstanceType<typeof App> } } }).__vue_app__._instance.proxy;
  for (const synthMode of GENERATOR_MODES) {
    const project = normalizePresetData({ forte: '7-35.11', bpm: 240, tracks: [{ synthMode, sequenceInput: '1 3',
      lengthFactor: 50, release: 0.05, generatorEngines: { granular: { asset: asset.hash } } }],
      studio: { version: 1, seed: 0, returns: [], assets: [asset] } });
    app.applyDraftData(project); await nextTick();
    const tab = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]')).find(el => el.textContent?.trim() === 'Generator');
    check(!!tab, 'Generator tab must be available'); tab!.click(); await nextTick();
    check(!!document.querySelector(`[aria-label="${synthMode} generator controls"]`), `${synthMode}: generator editor must mount`);
    await prepareProjectGenerators(Tone.getContext(), project.tracks, project.studio!.assets);
    await app.startSequencer(); check(app.isRunning, `${synthMode}: app playback must start`);
    await new Promise(resolve => setTimeout(resolve, 150)); app.stopSequencer();
    const wav = await app.renderMixWav(); check(wav.length > 44, `${synthMode}: browser WAV export must succeed`);
  }
  let rejectedTampered = false;
  try { await prepareGeneratorContext(Tone.getContext(), [{ ...asset, channels: [new Float32Array(rate)] }]); }
  catch { rejectedTampered = true; }
  check(rejectedTampered, 'Cached granular samples must still reject changed PCM under the same hash');
  return { sources: reports, sharedVoices: 5, modulation: true, monoGlide: true, monoPhaseAcrossGaps: true,
    tamperedSampleRejected: true, appPlayback: 5, browserWavExports: 5, version: app.appVersion };
}
