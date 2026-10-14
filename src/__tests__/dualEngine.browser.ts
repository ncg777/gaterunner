import * as Tone from 'tone';
import { nextTick } from 'vue';
import { normalizePresetData, normalizePresetTrackData } from '../presets';
import { normalizeEngineCombination, resolveGeneratorEngine } from '../audio/synthEngine';
import { prepareProjectGenerators } from '../audio/generatorSource';
import { PitchEnvelopeSynth } from '../audio/pitchEnvelopeSynth';
import { MonoGlideSynth } from '../audio/monoGlideSynth';
import { ModulatorSource } from '../audio/modulatorSource';
import { PartialBankVoice } from '../audio/partialBankVoice';
import { renderOfflineAudio } from '../audio/offlineRender';
import { createSampleAsset } from '../audio/sampleAssets';
import type App from '../App.vue';
import type EditorSurface from '../components/EditorSurface.vue';
import type { ComponentInternalInstance } from 'vue';

const rate = 48000;
const check = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
const energy = (data: Float32Array, start = 0, end = data.length) => data.subarray(start, end).reduce((s, v) => s + v * v, 0) / Math.max(1, end - start);
const spectralEnergy = (data: Float32Array, hz: number) => {
  let real = 0, imaginary = 0;
  for (let i = 4800; i < 14400; i++) { const angle = 2 * Math.PI * hz * i / rate; real += data[i] * Math.cos(angle); imaginary += data[i] * Math.sin(angle); }
  return real * real + imaginary * imaginary;
};

export async function runDualEngineChecks() {
  const asset = await createSampleAsset([Float32Array.from({ length: 4800 }, (_, i) => Math.sin(2 * Math.PI * 220 * i / rate))], rate, 'Engine B test');
  const results: Record<string, unknown>[] = [];
  async function render(mode: 'off' | 'am' | 'rm', bMode = 'fm', mono = false, depth = 1) {
    const track = normalizePresetTrackData({ synthMode: 'fm', generatorEngines: { fm: { index: 0 } },
      engineCombination: { mode, depth, frequencyRatio: 1.5, engineB: { synthMode: bMode,
        partialGenerator: { type: 'waveform', harmonicCount: 1 }, unisonVoices: 1,
        generatorEngines: { fm: { index: 0 }, granular: { asset: asset.hash } } } } });
    let synth: PitchEnvelopeSynth | undefined;
    const buffer = await renderOfflineAudio(async context => {
      await prepareProjectGenerators(context, [track], [asset]);
      const Voice = mono ? MonoGlideSynth : PitchEnvelopeSynth;
      synth = new Voice({ context, engine: resolveGeneratorEngine(track, [asset]),
        envelope: { attack: 0.001, decay: 0.005, sustain: 1, release: 0.03 } });
      synth.toDestination();
      if (synth instanceof MonoGlideSynth) {
        synth.setGlide({ time: 0.03, mode: 'always', constantRate: false, curve: 'linear', legato: true });
        synth.triggerNotes([110], 0.15, 0.01, 1); synth.triggerNotes([130], 0.2, 0.12, 1);
      } else synth.triggerAttackRelease(110, 0.31, 0.01, 1);
    }, 0.45, 1, rate);
    synth?.dispose(); return buffer.getChannelData(0).slice();
  }
  const dry = await render('off'), zero = await render('rm', 'granular', false, 0);
  check(dry.every((v, i) => v === zero[i]), 'Depth zero must preserve original browser PCM');
  const am = await render('am'), rm = await render('rm');
  for (const [name, pcm] of [['AM', am], ['RM', rm]] as const) {
    check(pcm.every(Number.isFinite) && energy(pcm) > 1e-5, `${name}: audible finite output`);
    check(spectralEnergy(pcm, 110) > 100 && spectralEnergy(pcm, 550) > 100, `${name}: expected sum/difference sidebands`);
    check(energy(pcm, 19200) < 1e-10, `${name}: release tail must end`);
  }
  check(spectralEnergy(am, 220) > spectralEnergy(rm, 220) * 100, 'AM retains the carrier while full RM removes it');
  const monoDry = await render('off', 'fm', true);
  for (const mode of ['additive', 'partial-bank', 'resonant-noise', 'choir', 'modal', 'pulse', 'fm', 'pluck', 'granular']) {
    const pcm = await render('rm', mode, true, 0.75);
    check(pcm.every(Number.isFinite) && energy(pcm) > 1e-7, `${mode}: B must work with mono glide`);
    check(energy(Float32Array.from(pcm, (value, i) => value - monoDry[i] * 0.25)) > 1e-7, `${mode}: B must contribute to the combination`);
    check(energy(pcm, 19200) < 1e-10, `${mode}: B must end with shared envelope`);
    results.push({ mode, rms: Math.sqrt(energy(pcm)) });
  }
  results.push(await checkMonoModulatorRelease());
  results.push(await checkModulatorBandLimit());
  // Start with A additive so preparation must discover the worklet engine in B.
  const root = document.querySelector('#app') as HTMLElement & { __vue_app__?: { _instance?: { proxy?: InstanceType<typeof App> } }; _vnode?: { component?: { proxy?: InstanceType<typeof App> } } };
  const app = root.__vue_app__?._instance?.proxy ?? root._vnode?.component?.proxy;
  if (!app) throw new Error('App not mounted');
  app.applyDraftData(normalizePresetData({ bpm: 240, tracks: [{ sequenceInput: '1 3', release: 0.03,
    engineCombination: { mode: 'am', engineB: { synthMode: 'fm' } } }] }));
  await nextTick();
  const editorElement = document.querySelector('.editor-surface') as Element & { __vueParentComponent: ComponentInternalInstance };
  let editorInstance: ComponentInternalInstance | null = editorElement.__vueParentComponent;
  while (editorInstance && editorInstance.type.name !== 'EditorSurface') editorInstance = editorInstance.parent;
  const editor = editorInstance!.proxy as InstanceType<typeof EditorSurface>;
  editor.activeControlTab = 'generator'; await nextTick();
  check(editor.$el.innerText.includes('Combine engines') && editor.$el.innerText.includes('Engine B · Modulator'), 'GUI must describe routing and both engine roles');
  editor.engineSlot = 'b'; await nextTick(); await nextTick();
  check(editor.$el.innerText.includes('Two-operator FM'), 'B must expose the selected engine controls');
  const inner = editor.$el.querySelector('.editor-surface') as Element & { __vueParentComponent: ComponentInternalInstance };
  let component: ComponentInternalInstance | null = inner?.__vueParentComponent;
  while (component && component.type.name !== 'EditorSurface') component = component.parent;
  const sourceEditor = component?.proxy as InstanceType<typeof EditorSurface> | undefined;
  check(!!sourceEditor, 'B editor must be present');
  check(sourceEditor!.$el.querySelector('.control-tab-content')!.getBoundingClientRect().width > editor.$el.querySelector('.control-tab-content')!.getBoundingClientRect().width * 0.85,
    'B controls must use the available panel width');
  sourceEditor!.handleSynthEngineChange(resolveGeneratorEngine({ ...sourceEditor!.draftTrack, synthMode: 'pulse' }));
  await nextTick(); await nextTick();
  check(app.getDraftData().tracks[0].synthMode === 'additive' && app.getDraftData().tracks[0].engineCombination?.engineB.synthMode === 'pulse', 'Editing B must keep A independent');
  await app.startSequencer(); check(app.isRunning, 'B worklet preparation must allow app playback');
  await new Promise(resolve => setTimeout(resolve, 200));
  editor.updateCombination(normalizeEngineCombination({ ...editor.draftTrack.engineCombination, mode: 'rm' }));
  await nextTick(); app.stopSequencer();
  const wav = await app.renderMixWav(); check(wav.length > 44, 'Combined app WAV export must complete');
  results.push({ browserBypassExact: true, sidebands: true, guiIndependent: true, playback: true, wavBytes: wav.length });
  return results;
}

async function checkModulatorBandLimit() {
  const settings = normalizeEngineCombination({ engineB: { synthMode: 'partial-bank',
    partialGenerator: { type: 'waveform', waveform: 'sine', harmonicCount: 1 } } }).engineB;
  let source: ModulatorSource | undefined, frequency: Tone.Signal<'frequency'> | undefined, detune: Tone.Signal<'cents'> | undefined;
  const buffer = await renderOfflineAudio(context => {
    frequency = new Tone.Signal({ context, value: 1406.25, units: 'frequency' });
    detune = new Tone.Signal({ context, value: 0, units: 'cents' });
    source = new ModulatorSource(context, frequency, detune, settings, 8);
    source.output.toDestination(); source.note(1406.25, 0.01); source.attack(0.01, false, 0.25);
  }, 0.3, 1, rate);
  source?.dispose(); frequency?.dispose(); detune?.dispose();
  let reference: PartialBankVoice | undefined;
  const expected = await renderOfflineAudio(context => {
    frequency = new Tone.Signal({ context, value: 11250, units: 'frequency' });
    detune = new Tone.Signal({ context, value: 0, units: 'cents' });
    reference = new PartialBankVoice(context, frequency, detune, settings, settings.partialBank);
    reference.output.toDestination(); reference.attack(0.01, false, 0.25);
  }, 0.3, 1, rate);
  reference?.dispose(); frequency?.dispose(); detune?.dispose();
  const browserEnergy = energy(buffer.getChannelData(0), 2400, 9600), referenceEnergy = energy(expected.getChannelData(0), 2400, 9600);
  check(Math.abs(browserEnergy / referenceEnergy - 1) < 0.02,
    `Engine B Partial Bank must apply its frequency ratio to the Nyquist taper: ${browserEnergy} vs ${referenceEnergy}`);
  return { modulatorBandLimit: true };
}

async function checkMonoModulatorRelease() {
  class InspectableMono extends MonoGlideSynth {
    get modulatorOutput() { return this.modulatorSource!.output; }
  }
  const context = new Tone.Context({ lookAhead: 0.02, updateInterval: 0.005 });
  let synth: InspectableMono | undefined, meter: Tone.Analyser | undefined;
  try {
    await context.resume();
    const track = normalizePresetTrackData({ engineCombination: { mode: 'rm', engineB: {
      synthMode: 'fm', generatorEngines: { fm: { index: 0 } }, modulation: {
        sources: [{ id: 'fade', type: 'envelope', attack: 0, decay: 0, sustain: 1, release: 0.3 }],
        routes: [{ source: 'fade', target: 'level', amount: -24 }],
      },
    } } });
    await prepareProjectGenerators(context, [track]);
    synth = new InspectableMono({ context, engine: resolveGeneratorEngine(track),
      envelope: { attack: 0.001, decay: 0, sustain: 1, release: 1 } });
    meter = new Tone.Analyser({ context, type: 'waveform', size: 2048 });
    synth.modulatorOutput.connect(meter);
    synth.triggerAttack(110, context.now());
    await new Promise(resolve => setTimeout(resolve, 150));
    const held = energy(meter.getValue() as Float32Array);
    synth.triggerRelease(context.now());
    await new Promise(resolve => setTimeout(resolve, 450));
    const released = energy(meter.getValue() as Float32Array);
    check(held > 1e-6 && released > held * 20,
      `Engine B modulation must continue through the shared mono release: ${held} -> ${released}`);
    return { monoModulatorRelease: true };
  } finally { synth?.dispose(); meter?.dispose(); await context.close(); }
}
