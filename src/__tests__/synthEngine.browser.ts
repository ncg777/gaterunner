import * as Tone from 'tone';
import { PitchEnvelopeSynth } from '../audio/pitchEnvelopeSynth';
import { MonoGlideSynth } from '../audio/monoGlideSynth';
import { normalizeSynthEngine } from '../audio/synthEngine';
import { renderOfflineAudio } from '../audio/offlineRender';
import { normalizePresetTrackData } from '../presets';
import { disposeReverbAudioChain } from '../audio/reverb';
import { getMasterBus } from '../audio/masterBus';
import type App from '../App.vue';
import type EditorSurface from '../components/EditorSurface.vue';
import type { ComponentInternalInstance } from 'vue';

/** Check every sounding step, rather than accepting any audio somewhere in a loop. */
export async function runFourNoteSequencerChecks(app: InstanceType<typeof App>) {
  const results = [];
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const playStep = app.playTrackStep;
  const warn = console.warn;
  const context = Tone.getContext();
  const meterName = `four-note-step-meter-${Date.now()}`;
  // Capture on the audio thread so main-thread pauses cannot skip a note window.
  const moduleUrl = URL.createObjectURL(new Blob([`
class StepMeter extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = true;
    this.port.onmessage = () => { this.active = false; };
  }
  process(inputs) {
    let peak = 0;
    for (const channel of inputs[0] ?? []) for (const value of channel) peak = Math.max(peak, Math.abs(value));
    this.port.postMessage({ time: currentTime, peak });
    return this.active;
  }
}
registerProcessor('${meterName}', StepMeter);
`], { type: 'application/javascript' }));
  try { await context.addAudioWorkletModule(moduleUrl); } finally { URL.revokeObjectURL(moduleUrl); }
  for (const synthMode of ['additive', 'choir', 'resonant-noise'] as const) for (const polyphony of [2, 8, 1]) {
    app.stopSequencer();
    await wait(500);
    app.applyDraftData({ ...app.getDraftData(), bpm: 120, forte: '5-35.05', bitmaskSequenceInput: '', masterGain: 0,
      reverb: { ...app.getDraftData().reverb, enabled: false, dry: 0 },
      tracks: [normalizePresetTrackData({ id: `four-note-${synthMode}-${polyphony}`, synthMode, polyphony,
        sequenceInput: '1 2 4 8', repeats: 1, lengthFactor: 60, release: 0 })] });
    await app.$nextTick();
    const notes = app.computeActualNotes(app.currentTrack!);
    if (notes.length !== 4 || notes.some(note => note.length !== 1)) throw new Error('Four-note decoding failed');
    const meter = context.createAudioWorkletNode(meterName);
    const master = getMasterBus();
    master.clipper.connect(meter);
    Tone.connect(meter, context.destination);
    const steps: Array<{ step: number; time: number; peak: number; frames: number }> = [];
    let measuredTime = 0;
    meter.port.onmessage = (event: MessageEvent<{ time: number; peak: number }>) => {
      const { time, peak } = event.data;
      measuredTime = time;
      for (const step of steps) if (time >= step.time + 0.03 && time <= step.time + 0.065) {
        step.peak = Math.max(step.peak, peak);
        step.frames++;
      }
    };
    const warnings: string[] = [];
    app.playTrackStep = (track, event, time) => {
      steps.push({ step: event.step, time, peak: 0, frames: 0 });
      playStep(track, event, time);
    };
    console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')); warn(...args); };
    try {
      await app.startSequencer();
      const deadline = performance.now() + 15000;
      while (performance.now() < deadline) {
        if (steps.length >= 8 && measuredTime > steps[7].time + 0.15) break;
        await wait(5);
      }
      const first = steps.slice(0, 8);
      if (first.length !== 8 || first.some((step, i) => step.step !== (first[0].step + i) % 4
        || !Number.isFinite(step.peak) || step.peak < 1e-4)
        || warnings.some(warning => warning.includes('Note dropped'))) {
        throw new Error(`${synthMode}/${polyphony}: incomplete four-note loops ${JSON.stringify({ steps: first, warnings, measuredTime, currentTime: context.currentTime, state: context.state })}`);
      }
      results.push({ synthMode, polyphony, steps: first });
    } finally {
      console.warn = warn;
      app.playTrackStep = playStep;
      app.stopSequencer(); master.clipper.disconnect(meter); meter.disconnect(); meter.port.postMessage('stop'); meter.port.close();
    }
  }
  return results;
}

/** Measure the final mix, including master gain and clipping, across engine selections. */
export async function runSynthEngineMasterOutputChecks(app: InstanceType<typeof App>) {
  const results = [];
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  for (const polyphony of [1, 8]) {
    app.stopSequencer();
    app.applyDraftData({ ...app.getDraftData(), masterGain: 0,
      reverb: { ...app.getDraftData().reverb, enabled: false, dry: 0 },
      tracks: [normalizePresetTrackData({ id: `master-output-${polyphony}`, polyphony,
        sequenceInput: '1 2 4 8', repeats: 8, synthMode: 'additive' })] });
    await app.$nextTick();
    const meter = new Tone.Analyser({ type: 'waveform', size: 2048 });
    const master = getMasterBus();
    master.clipper.connect(meter);
    try {
      await app.startSequencer();
      for (const synthMode of ['additive', 'choir', 'resonant-noise', 'additive'] as const) {
        app.handleTrackDraftChange(normalizePresetTrackData({ ...app.currentTrack, synthMode }));
        let peak = 0;
        for (let i = 0; i < 24; i++) {
          await wait(50);
          const samples = meter.getValue() as Float32Array;
          if (!samples.every(Number.isFinite)) throw new Error(`${synthMode}: invalid master output`);
          peak = Math.max(peak, ...samples.map(Math.abs));
        }
        if (!app.isRunning || peak < 1e-4) throw new Error(`${synthMode}/${polyphony}: silent master output (${peak})`);
        results.push({ synthMode, polyphony, peak });
      }
    } finally { app.stopSequencer(); master.clipper.disconnect(meter); meter.dispose(); }
    await wait(500);
  }
  return results;
}

/** Choir setup must stay lightweight even when a voice is built by a transport callback. */
export async function runChoirRealtimeSetupChecks() {
  const original = Tone.getContext();
  const context = new Tone.Context();
  Tone.setContext(context);
  await context.resume();
  const synth = new PitchEnvelopeSynth();
  const meter = new Tone.Analyser({ type: 'waveform', size: 2048 });
  synth.connect(meter);
  const warnings: string[] = [];
  const warn = console.warn;
  const createWaveShaper = context.createWaveShaper;
  let waveshapers = 0;
  context.createWaveShaper = () => { waveshapers++; return createWaveShaper.call(context); };
  console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')); warn(...args); };
  try {
    context.transport.schedule(time => {
      synth.set({ engine: normalizeSynthEngine({ synthMode: 'choir', choirEngine: { voices: 8, breath: 0 } }) });
      synth.triggerAttackRelease(110, 0.5, time, 0.5);
    }, 0.05);
    context.transport.start(context.now());
    await new Promise(resolve => setTimeout(resolve, 350));
    const peak = Math.max(...(meter.getValue() as Float32Array).map(Math.abs));
    if (waveshapers !== 0) throw new Error(`Choir setup allocated ${waveshapers} modulation waveshapers`);
    if (warnings.some(warning => warning.includes('Schedulable methods'))) throw new Error('Choir setup started an implicit-time source');
    if (peak < 1e-4 || context.state !== 'running') throw new Error(`Choir setup stopped realtime audio (${peak}, ${context.state})`);
    return { waveshapers, peak, state: context.state };
  } finally {
    console.warn = warn;
    context.createWaveShaper = createWaveShaper;
    context.transport.stop();
    synth.dispose(); meter.dispose();
    await context.close(); context.dispose(); Tone.setContext(original);
  }
}

export async function runChoirAudibilityChecks(app: InstanceType<typeof App>) {
  const results = [];
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  app.stopSequencer();
  for (const polyphony of [1, 8]) {
    await wait(200);
    app.applyDraftData({ ...app.getDraftData(), reverb: { ...app.getDraftData().reverb, enabled: false, dry: 0 }, tracks: [normalizePresetTrackData({
      id: 'choir-audible', synthMode: 'additive', polyphony, sequenceInput: '1 2 4 8', repeats: 8,
      unisonVoices: 1, choirEngine: { ...normalizeSynthEngine({}).choirEngine, breath: 0 },
    })] });
    await app.$nextTick();
    await app.startSequencer();
    await wait(300);
    await app.$nextTick();
    const element = document.querySelector('.editor-surface') as Element & { __vueParentComponent: ComponentInternalInstance };
    let instance: ComponentInternalInstance | null = element.__vueParentComponent;
    while (instance && instance.type.name !== 'EditorSurface') instance = instance.parent;
    const editor = instance!.proxy as InstanceType<typeof EditorSurface>;
    editor.activeControlTab = 'generator';
    await app.$nextTick();
    const chain = app.getOrCreateTrackChain(app.currentTrack!);
    const meter = new Tone.Analyser({ type: 'waveform', size: 2048 });
    chain.dryGain.connect(meter);
    const errors: string[] = [];
    const onError = (event: ErrorEvent) => errors.push(event.error?.name ?? event.message);
    window.addEventListener('error', onError);
    const peak = async () => {
      let maximum = 0;
      for (let i = 0; i < 6; i++) {
        await wait(50);
        maximum = Math.max(maximum, ...(meter.getValue() as Float32Array).map(Math.abs));
      }
      return maximum;
    };
    try {
      // The app schedules 400 ms ahead; establish actual playback before selection.
      let initialPeak = 0;
      for (let i = 0; i < 8 && initialPeak < 1e-4; i++) initialPeak = await peak();
      if (initialPeak < 1e-4) throw new Error('Initial additive playback did not begin');
      for (const mode of ['choir', 'resonant-noise', 'choir'] as const) {
        const select = document.querySelector('.v-window-item--active .v-select input') as HTMLElement;
        select.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        select.click();
        await app.$nextTick();
        await wait(100);
        const title = mode === 'choir' ? 'Vocal choir' : 'Resonant noise';
        const option = [...document.querySelectorAll('.v-overlay .v-list-item')].find(item => item.textContent?.includes(title)) as HTMLElement;
        if (!option) throw new Error(`Missing ${title} selector option: ${document.body.innerText.slice(-1500)}`);
        option.click();
        await app.$nextTick();
        if (app.currentTrack?.synthMode !== mode) throw new Error('Selector did not set engine mode');
        await wait(100);
        const maximum = await peak();
        if (maximum < 1e-4) throw new Error(`${mode}/${polyphony}: mode switch is silent ${maximum}`);
        results.push({ mode, polyphony, maximum });
      }
      app.stopSequencer();
      await wait(200);
      await app.startSequencer();
      await wait(600);
      const maximum = await peak();
      if (maximum < 1e-4) throw new Error(`Choir/${polyphony}: restart is silent ${maximum}`);
      results.push({ mode: 'choir restart', polyphony, maximum });
      if (errors.length) throw new Error(`Choir source cleanup failed: ${errors.join(', ')}`);
    } finally {
      window.removeEventListener('error', onError);
      chain.dryGain.disconnect(meter); meter.dispose(); app.stopSequencer();
    }
  }
  return results;
}

export async function runSynthEngineLiveParameterChecks() {
  const original = Tone.getContext();
  const context = new Tone.Context();
  Tone.setContext(context);
  await context.resume();
  const results = [];
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  try {
    for (const synthMode of ['resonant-noise', 'choir'] as const) for (const mono of [false, true]) {
      const synth = mono ? new MonoGlideSynth() : new PitchEnvelopeSynth();
      const meter = new Tone.Analyser({ type: 'waveform', size: 2048 });
      synth.connect(meter);
      let engine = normalizeSynthEngine({ synthMode });
      synth.set({ engine, envelope: { attack: 0.01, decay: 0.03, sustain: 0.7, release: 0.1 } as Tone.SynthOptions['envelope'] });
      const rms = () => {
        const samples = meter.getValue() as Float32Array;
        return Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
      };
      try {
        synth.triggerAttackRelease(110, 2, context.now(), 0.5);
        await wait(250);
        const before = rms();
        for (let i = 0; i < 6; i++) {
          engine = normalizeSynthEngine({ ...engine,
            noiseEngine: { ...engine.noiseEngine, resonance: 25 + i, bands: 1 + i, color: i % 2 ? 'white' : 'pink', lfoDepth: i },
            choirEngine: { ...engine.choirEngine, formantShift: i / 2, voices: 1 + i, breath: i / 10 },
          });
          synth.set({ engine });
          await wait(30);
        }
        await wait(200);
        const after = rms();
        if (before < 1e-5 || after < 1e-5) throw new Error(`${synthMode}/${mono}: edit silenced held note (${before} -> ${after})`);
        synth.triggerAttackRelease(220, 0.2, context.now(), 0.5);
        await wait(200);
        const next = rms();
        if (next < 1e-5) throw new Error(`${synthMode}/${mono}: next note silent`);
        results.push({ synthMode, mono, before, after, next });
      } finally { synth.dispose(); meter.dispose(); }
    }
  } finally { await context.close(); context.dispose(); Tone.setContext(original); }
  return results;
}

async function checkScheduledEngineEdits(switchMode: boolean) {
  const results = [];
  for (const synthMode of ['resonant-noise', 'choir'] as const) for (const mono of [false, true]) {
    let synth: PitchEnvelopeSynth | undefined;
    let engine = normalizeSynthEngine({ synthMode: switchMode ? 'additive' : synthMode });
    const buffer = await renderOfflineAudio(context => {
      synth = mono ? new MonoGlideSynth() : new PitchEnvelopeSynth();
      synth.set({ engine, envelope: { attack: 0.01, decay: 0.02, sustain: 0.7, release: 0.05 } as Tone.SynthOptions['envelope'] });
      synth.connect(context.destination);
      synth.triggerAttackRelease(110, 0.3, 0.2, 0.5);
      // Edits between scheduling and sounding must retain the queued attack/release.
      context.setTimeout(() => {
        engine = normalizeSynthEngine({ ...engine, synthMode, noiseEngine: { ...engine.noiseEngine, bands: 8, resonance: 30 },
          choirEngine: { ...engine.choirEngine, voices: 8, formantShift: 1 } });
        synth!.set({ engine });
      }, 0.08);
      context.setTimeout(() => {
        engine = normalizeSynthEngine({ ...engine, noiseEngine: { ...engine.noiseEngine, bands: 2, resonance: 12 },
          choirEngine: { ...engine.choirEngine, voices: 2, breath: 0.2 } });
        synth!.set({ engine });
      }, 0.3);
    }, 0.8, 1, 48000);
    synth!.dispose();
    const samples = buffer.getChannelData(0);
    const rms = (from: number, to: number) => {
      const window = samples.slice(from * 48000, to * 48000);
      return Math.sqrt(window.reduce((sum, v) => sum + v * v, 0) / window.length);
    };
    const sounding = rms(0.23, 0.28), edited = rms(0.36, 0.46), tail = rms(0.7, 0.8);
    if (sounding < 1e-5 || edited < 1e-5 || tail > 1e-5) {
      throw new Error(`${synthMode}/${mono}: parameter edit lost scheduled note: ${JSON.stringify({ sounding, edited, tail })}`);
    }
    results.push({ synthMode, mono, sounding, edited, tail });
    buffer.dispose();
  }
  return results;
}

export async function runSynthEngineScheduledSwitchChecks() {
  return checkScheduledEngineEdits(true);
}

export async function runSynthEngineScheduledEditChecks() {
  return checkScheduledEngineEdits(false);
}

export async function runSynthEngineLiveSwitchChecks() {
  const original = Tone.getContext();
  const context = new Tone.Context();
  Tone.setContext(context);
  await context.resume();
  const results = [];
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  try {
    for (const mono of [false, true]) {
      const synth = mono ? new MonoGlideSynth() : new PitchEnvelopeSynth();
      const meter = new Tone.Analyser({ type: 'waveform', size: 2048 });
      synth.connect(meter);
      synth.set({ envelope: { attack: 0.01, decay: 0.02, sustain: 0.7, release: 0.2 } as Tone.SynthOptions['envelope'] });
      const peak = () => Math.max(...(meter.getValue() as Float32Array).map(Math.abs));
      const choir = normalizeSynthEngine({ synthMode: 'choir', choirEngine: { breath: 0 } });
      try {
        synth.triggerAttackRelease(110, 0.6, context.now() + 0.2, 0.5);
        synth.set({ engine: choir });
        await wait(400);
        const queued = peak();
        synth.set({ engine: normalizeSynthEngine({ synthMode: 'resonant-noise' }) });
        await wait(150);
        const held = peak();
        synth.set({ engine: choir });
        await wait(350);
        // Switch again during the release, preserving its original end time.
        synth.set({ engine: normalizeSynthEngine({ synthMode: 'resonant-noise' }) });
        await wait(300);
        const tail = peak();
        if (queued < 1e-4 || held < 1e-4 || tail > 1e-5) {
          throw new Error(`Live engine switch/${mono}: ${JSON.stringify({ queued, held, tail })}`);
        }
        results.push({ mono, queued, held, tail });
      } finally { synth.dispose(); meter.dispose(); }
    }
  } finally { await context.close(); context.dispose(); Tone.setContext(original); }
  return results;
}

export async function runSynthEngineLiveAppChecks(app: InstanceType<typeof App>) {
  const results = [];
  for (const synthMode of ['resonant-noise', 'choir'] as const) for (const polyphony of [1, 4]) {
    app.stopSequencer();
    await new Promise(resolve => setTimeout(resolve, 200));
    app.applyDraftData({ ...app.getDraftData(), tracks: [normalizePresetTrackData({
      id: 'live-edit', synthMode, polyphony, sequenceInput: '1 2 4 8', repeats: 4,
      attack: 0.01, decay: 0.03, sustain: 0.7, release: 0.15, reverbWet: -96,
    })] });
    await app.$nextTick();
    await app.startSequencer();
    await new Promise(resolve => setTimeout(resolve, 300));
    const chain = app.getOrCreateTrackChain(app.currentTrack!);
    const meter = new Tone.Analyser({ type: 'waveform', size: 2048 });
    // Routing rebuilds disconnect sourceBus outputs; meter the stable track output.
    chain.dryGain.connect(meter);
    try {
      await new Promise(resolve => setTimeout(resolve, 300));
      for (let i = 0; i < 8; i++) {
        const track = normalizePresetTrackData(app.currentTrack);
        track.noiseEngine!.resonance = 20 + i;
        track.choirEngine!.formantShift = i / 2;
        app.handleTrackDraftChange(track);
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      let peak = 0;
      for (let i = 0; i < 40; i++) {
        await new Promise(resolve => setTimeout(resolve, 50));
        const samples = meter.getValue() as Float32Array;
        peak = Math.max(peak, ...samples.map(Math.abs));
      }
      if (peak < 1e-5) throw new Error(`${synthMode}/${polyphony}: live app edits killed playback`);
      results.push({ synthMode, polyphony, peak });
    } finally { chain.dryGain.disconnect(meter); meter.dispose(); app.stopSequencer(); }
  }
  return results;
}

export async function runSynthEngineUiChecks(app: InstanceType<typeof App>) {
  const element = document.querySelector('.editor-surface') as Element & { __vueParentComponent: ComponentInternalInstance };
  let instance: ComponentInternalInstance | null = element.__vueParentComponent;
  while (instance && instance.type.name !== 'EditorSurface') instance = instance.parent;
  if (!instance) throw new Error('Editor not mounted');
  const editor = instance.proxy as InstanceType<typeof EditorSurface>;
  editor.activeControlTab = 'generator';
  const results = [];
  for (const synthMode of ['additive', 'resonant-noise', 'choir'] as const) {
    editor.handleSynthEngineChange(normalizeSynthEngine({ synthMode }));
    await app.$nextTick();
    await app.$nextTick();
    const panel = document.querySelector('.v-window-item--active')!;
    const text = panel.textContent ?? '';
    const expected = synthMode === 'additive' ? 'Partial source' : synthMode === 'choir' ? 'Starting vowel' : 'Noise color';
    if (!text.includes(expected)) throw new Error(`Missing ${synthMode} controls`);
    if (synthMode !== 'additive' && text.includes('Partial source')) throw new Error('Inactive additive controls remain visible');
    if (synthMode !== 'additive') {
      const curve = panel.querySelector('.engine-response path')?.getAttribute('d');
      if (!curve || /NaN|Infinity/.test(curve)) throw new Error('Invalid filter response preview');
    }
    if (app.currentTrack?.synthMode !== synthMode) throw new Error('Engine selection did not reach the track');
    results.push({ synthMode, controlsVisible: true });
  }
  return results;
}

export async function runSynthEngineAppChecks(app: InstanceType<typeof App>) {
  const results = [];
  for (const synthMode of ['resonant-noise', 'choir'] as const) for (const polyphony of [1, 4]) {
    const track = normalizePresetTrackData({ synthMode, polyphony, reverbWet: -96, gain: -12,
      attack: 0.01, decay: 0.03, sustain: 0.7, release: 0.05 });
    const savedReverb = app.reverbChain;
    let chain: ReturnType<typeof app.createTrackAudioChain> | undefined;
    let reverb: ReturnType<typeof app.getOrCreateReverbChain> | undefined;
    try {
      app.reverbChain = null;
      const buffer = await renderOfflineAudio(() => {
        reverb = app.getOrCreateReverbChain();
        chain = app.createTrackAudioChain();
        app.updateTrackChainSettings(track, chain);
        const synth = chain.synth;
        app.updateTrackChainSettings(track, chain);
        if (app.ensureTrackSynth(chain, track) !== synth) throw new Error('Engine must reuse its voice pool');
        const signature = app.getTrackVoiceSignature(track);
        track.noiseEngine!.resonance = 45;
        track.choirEngine!.morph = 0.8;
        if (signature === app.getTrackVoiceSignature(track)) throw new Error('Engine controls must invalidate voice settings');
        app.updateTrackChainSettings(track, chain);
        // Round-trip mode switching must retain one voice pool and restore source routing.
        track.synthMode = 'additive'; app.updateTrackChainSettings(track, chain);
        track.synthMode = synthMode; app.updateTrackChainSettings(track, chain);
        if (chain.synth !== synth) throw new Error('Engine switching leaked a voice pool');
        chain.mixGain.gain.value = 1;
        app.triggerTrackVoice(track, chain, [57, 64, 69], 0.25, 0.05, 0.5, 0.05);
      }, 0.5, 1, 48000);
      const samples = buffer.getChannelData(0);
      const rms = Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
      if (!samples.every(Number.isFinite) || rms < 1e-5) throw new Error(`${synthMode}/${polyphony}: app rendered silence`);
      results.push({ synthMode, polyphony, rms });
      buffer.dispose();
    } finally {
      if (chain) app.disposeTrackChain(chain);
      if (reverb) disposeReverbAudioChain(reverb);
      app.reverbChain = savedReverb;
    }
  }
  return results;
}

export async function runSynthEngineChecks() {
  const results = [];
  for (const synthMode of ['resonant-noise', 'choir'] as const) {
    for (const mono of [false, true]) {
      let synth: PitchEnvelopeSynth | undefined;
      const buffer = await renderOfflineAudio(context => {
        synth = mono ? new MonoGlideSynth() : new PitchEnvelopeSynth();
        synth.set({ engine: normalizeSynthEngine({ synthMode }), envelope: {
          attack: 0.01, decay: 0.03, sustain: 0.7, release: 0.1,
        } as Tone.SynthOptions['envelope'] });
        synth.connect(context.destination);
        if (synth instanceof MonoGlideSynth) {
          synth.setGlide({ time: 0.1, mode: 'always', constantRate: false, curve: 'exponential', legato: true });
          synth.triggerNotes([110], 0.3, 0.05, 0.5);
          synth.triggerNotes([220], 0.3, 0.2, 0.5);
        } else {
          synth.triggerAttackRelease(110, 0.3, 0.05, 0.5);
          synth.triggerAttackRelease(220, 0.3, 0.5, 0.5);
        }
      }, 1.2, 1, 48000);
      synth!.dispose();
      const samples = buffer.getChannelData(0);
      let peak = 0, energy = 0, tail = 0;
      samples.forEach((v, i) => {
        if (!Number.isFinite(v)) throw new Error(`${synthMode}: non-finite sample`);
        peak = Math.max(peak, Math.abs(v)); energy += v * v;
        if (i > 52800) tail = Math.max(tail, Math.abs(v));
      });
      if (energy / samples.length < 1e-6 || peak > 8 || tail > 1e-5) throw new Error(`${synthMode}: bad output ${JSON.stringify({ peak, energy, tail })}`);
      results.push({ synthMode, mono, peak, rms: Math.sqrt(energy / samples.length), tail });
    }
  }
  return results;
}

