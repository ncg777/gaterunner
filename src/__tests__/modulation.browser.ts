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
  editor.activeControlTab = 'generator';
  editor.handleSynthEngineChange(normalizeSynthEngine({ synthMode: 'additive' }));
  const settle = async () => { await app.$nextTick(); await app.$nextTick(); };
  await settle();
  const button = (text: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('.v-window-item--active button'))
    .find(b => b.textContent?.trim() === text);
  const heading = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent?.includes('Modulation ·'));
  if (!heading) throw new Error('Modulation panel missing');
  heading.click(); await settle();
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
  return { addSources: true, addRoute: true, removeSourceAndRoutes: true };
}

