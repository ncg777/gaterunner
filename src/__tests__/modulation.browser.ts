import * as Tone from 'tone';
import { PitchEnvelopeSynth } from '../audio/pitchEnvelopeSynth';
import { MonoGlideSynth } from '../audio/monoGlideSynth';
import { normalizeSynthEngine } from '../audio/synthEngine';
import { normalizeModulation } from '../audio/modulation';
import { renderOfflineAudio } from '../audio/offlineRender';
import type App from '../App.vue';
import type EditorSurface from '../components/EditorSurface.vue';
import type { ComponentInternalInstance } from 'vue';

export async function runAdditiveModulationChecks() {
  const energy = (samples: Float32Array) => samples.reduce((n, v) => n + v * v, 0);
  const patch = (target: string, amount: number) => normalizeSynthEngine({ modulation: {
    sources: [{ id: 'env', type: 'envelope', attack: 0, decay: 0, sustain: 1, release: 0.1 }],
    routes: [{ source: 'env', target, amount }],
  } });
  async function render(target: string, amount: number, disable = false, mono = false, custom?: ReturnType<typeof normalizeSynthEngine>) {
    let voice: PitchEnvelopeSynth | undefined;
    try {
      return await renderOfflineAudio(context => {
        const Voice = mono ? MonoGlideSynth : PitchEnvelopeSynth;
        voice = new Voice({ engine: custom ?? patch(target, amount), oscillator: { type: 'sawtooth' },
          envelope: { attack: 0.005, decay: 0, sustain: 1, release: 0.15 },
          voiceFilter: { ...PitchEnvelopeSynth.getDefaults().voiceFilter, enabled: true, frequencyMidi: 70,
            type: target === 'filterGain' ? 'peaking' : 'lowpass' },
        }).toDestination();
        if (disable) voice.set({ engine: normalizeSynthEngine({}) });
        if (voice instanceof MonoGlideSynth) {
          voice.setGlide({ time: 0.05, mode: 'always', constantRate: false, curve: 'linear', legato: true });
          voice.triggerNotes([220], 0.25, 0.05, 0.3);
          voice.triggerNotes([330], 0.2, 0.2, 0.3);
        } else {
          voice.triggerAttackRelease(220, 0.3, 0.05, 0.3);
          voice.triggerAttackRelease(330, 0.15, 0.6, 0.3);
        }
        context.transport.start(0);
      }, 1, 2, 24000);
    } finally { voice?.dispose(); }
  }
  const plain = await render('pitch', 0);
  const baseline = plain.getChannelData(0);
  const bypass = await render('pitch', 12, true);
  const ratio = energy(bypass.getChannelData(0)) / energy(baseline);
  if (Math.abs(ratio - 1) > 0.01) throw new Error(`Matrix bypass changed level: ${ratio}`);
  const results: Record<string, number> = { bypassEnergyRatio: ratio };
  for (const [target, amount] of [['pitch', 12], ['level', -18], ['pan', 1], ['cutoff', 12], ['resonance', 8], ['filterGain', 12]] as const) {
    const buffer = await render(target, amount);
    const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
    if (!left.every(Number.isFinite) || !right.every(Number.isFinite) || energy(right) < 1e-6) throw new Error(`${target}: invalid audio`);
    const reference = target === 'filterGain' ? (await render('filterGain', 0)).getChannelData(0) : baseline;
    const difference = left.reduce((n, v, i) => n + (v - reference[i]) ** 2, 0);
    if (difference < 1e-5) throw new Error(`${target}: inaudible route`);
    if (target === 'pan' && energy(left) > energy(right) * 0.01) throw new Error('Pan did not reach stereo output');
    results[target] = difference;
  }
  const mono = await render('cutoff', 18, false, true);
  if (energy(mono.getChannelData(0)) < 1e-6) throw new Error('Mono modulation silent');
  for (const retrigger of ['note', 'song', 'free']) {
    const buffer = await render('pitch', 0, false, false, normalizeSynthEngine({ modulation: {
      sources: [{ id: 'lfo', type: 'lfo', retrigger, waveform: 'sine', rateHz: 5 }],
      routes: [{ source: 'lfo', target: 'pitch', amount: 6 }],
    } }));
    const difference = buffer.getChannelData(0).reduce((n, v, i) => n + (v - baseline[i]) ** 2, 0);
    if (difference < 1e-5) throw new Error(`${retrigger} LFO did not modulate`);
    results[`${retrigger}Lfo`] = difference;
  }
  const many = normalizeModulation({ sources: Array.from({ length: 64 }, (_, i) => ({ id: `l${i}`, type: 'lfo' })), routes: [] });
  if (many.sources.length !== 64) throw new Error('Source ceiling');
  return results;
}

export async function runModulationUiChecks(app: InstanceType<typeof App>) {
  const element = document.querySelector('.editor-surface') as Element & { __vueParentComponent: ComponentInternalInstance };
  let instance: ComponentInternalInstance | null = element.__vueParentComponent;
  while (instance && instance.type.name !== 'EditorSurface') instance = instance.parent;
  if (!instance) throw new Error('Editor not mounted');
  const editor = instance.proxy as InstanceType<typeof EditorSurface>;
  editor.activeControlTab = 'modulation';
  editor.handleSynthEngineChange(normalizeSynthEngine({ synthMode: 'additive' }));
  const settle = async () => { await app.$nextTick(); await app.$nextTick(); };
  await settle();
  const button = (text: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('.v-window-item--active button'))
    .find(b => b.textContent?.trim() === text);
  for (const label of ['Envelope', 'LFO', 'Route']) {
    const control = button(label);
    if (!control) throw new Error(`Missing ${label} button`);
    control.click(); await settle();
  }
  if (app.currentTrack?.modulation?.sources.length !== 2 || app.currentTrack.modulation.routes.length !== 1) throw new Error('Editor changes did not persist');
  const firstSource = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent?.includes('Envelope 1 ·'));
  firstSource?.click(); await settle();
  const remove = document.querySelector<HTMLButtonElement>('[aria-label="Remove Envelope 1 and its routes"]');
  if (!remove) throw new Error('Source removal missing');
  remove.click(); await settle();
  if (app.currentTrack?.modulation?.sources.length !== 1 || app.currentTrack.modulation.routes.length !== 0) throw new Error('Removing source left stale routes');
  const panel = (name: string) => {
    const heading = Array.from(document.querySelectorAll<HTMLButtonElement>('.v-window-item--active .v-expansion-panel-title')).find(b => b.textContent?.includes(name));
    if (!heading) throw new Error(name + ' missing');
    return heading;
  };
  const editNumber = async (name: string, label: string, value: number) => {
    const heading = panel(name);
    if (heading.getAttribute('aria-expanded') !== 'true') heading.click();
    await settle();
    const input = Array.from(heading.closest('.v-expansion-panel')!.querySelectorAll<HTMLInputElement>('input')).find(input => input.closest('.v-input')?.querySelector('label')?.textContent === label);
    if (!input) throw new Error(name + ': ' + label + ' missing');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
  };
  await editNumber('Amp envelope', 'Attack (s)', 0.13);
  await editNumber('Pitch envelope', 'Amount (semitones)', -7);
  await editNumber('Filter envelope', 'Attack (s)', 0.24);
  await editNumber('Tremolo', 'Rate (Hz)', 3.25);
  await editNumber('Chorus LFO', 'Depth (0–1)', 0.42);
  if (app.currentTrack?.attack !== 0.13 || app.currentTrack.pitchEnvelopeAmount !== -7 || app.currentTrack.filterEnvelopeAttack !== 0.24 || app.currentTrack.tremoloFrequency !== 3.25 || app.currentTrack.chorusDepth !== 0.42) throw new Error('Fixed source edits did not persist');
  // Editing the relocated controls must not overwrite the existing matrix.
  if (app.currentTrack.modulation?.sources.length !== 1) throw new Error('Fixed source edit erased routed sources');
  editor.draftTrack.tonewheelWavetable = { enabled: false, dimensions: [], configurations: [], lfos: [] };
  editor.setTonewheelWavetableEnabled(true); await settle();
  button('Vector LFO')?.click(); await settle();
  button('Vector LFO')?.click(); await settle();
  await editNumber('Vector LFO 2', 'FM index (cycles)', 0.75);
  await editNumber('Vector LFO 1', 'Brightness route', -0.4);
  if (app.currentTrack?.tonewheelWavetable.lfos[1]?.fmAmount !== 0.75 || app.currentTrack.tonewheelWavetable.lfos[0]?.routes[0] !== -0.4) throw new Error('Vector edits did not persist');
  document.querySelector<HTMLButtonElement>('[aria-label="Remove Vector LFO 1"]')?.click(); await settle();
  if (app.currentTrack?.tonewheelWavetable.lfos.length !== 1 || app.currentTrack.tonewheelWavetable.lfos[0].fmSource !== -1) throw new Error('Vector removal left stale FM source');
  editor.handleSynthEngineChange(normalizeSynthEngine({ synthMode: 'resonant-noise' })); await settle();
  await editNumber('Resonator envelope', 'Amount (semitones)', -12);
  await editNumber('Resonator LFO', 'Depth (semitones)', 4);
  if (app.currentTrack?.noiseEngine?.envelopeAmount !== -12 || app.currentTrack.noiseEngine.lfoDepth !== 4) throw new Error('Resonator edits did not persist');
  editor.handleSynthEngineChange(normalizeSynthEngine({ synthMode: 'choir' })); await settle();
  await editNumber('Choir vibrato', 'Depth (cents)', 17);
  await editNumber('Vowel transition', 'Transition (s)', 0.9);
  if (app.currentTrack?.choirEngine?.vibratoDepth !== 17 || app.currentTrack.choirEngine.morphTime !== 0.9) throw new Error('Choir edits did not persist');
  editor.draftTrack.trackKind = 'rhythmic'; editor.handleTrackDraftChange(); await settle();
  editor.activeControlTab = 'modulation'; await settle();
  if (document.querySelector('.v-window-item--active')?.textContent?.includes('Amp envelope')) throw new Error('Melodic envelope shown on drums');
  if (document.querySelector('.v-window-item--active')?.textContent?.includes('Drum envelopes')) throw new Error('Drum envelopes moved out of Drum Sounds');
  editor.activeControlTab = 'drum-sounds'; await settle();
  const decay = Array.from(document.querySelectorAll<HTMLButtonElement>('.v-window-item--active .editable-slider__label')).find(button => button.textContent?.trim().startsWith('Decay ('));
  if (!decay) throw new Error('Drum decay missing from Drum Sounds');
  decay.click(); await settle();
  const decayInput = decay.closest('.editable-slider')?.querySelector<HTMLInputElement>('input');
  if (!decayInput) throw new Error('Drum decay editor missing');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(decayInput, '0.61');
  decayInput.dispatchEvent(new Event('input', { bubbles: true }));
  decayInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await settle();
  if (app.currentTrack?.drumLanes[0].parameters.decay !== 0.61) throw new Error('Drum envelope edit did not persist');
  return { addSources: true, addRoute: true, removeSourceAndRoutes: true, fixedSourceEdits: true, vectorRoutingAndRemoval: true, engineMotion: true, drumEnvelopesInDrumSounds: true };
}

