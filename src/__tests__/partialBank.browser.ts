import * as Tone from 'tone';
import { PitchEnvelopeSynth } from '../audio/pitchEnvelopeSynth';
import { MonoGlideSynth } from '../audio/monoGlideSynth';
import { normalizePresetTrackData } from '../presets';
import { normalizeSynthEngine } from '../audio/synthEngine';
import { normalizePartialGenerator } from '../audio/partialGenerator';
import { normalizePartialBank } from '../audio/partialBank';
import { renderOfflineAudio } from '../audio/offlineRender';
import { createPartialBankOscillator } from '../../cli/partialBankOscillator';
import { compileModulation, normalizeModulation } from '../audio/modulation';

const rate = 24000;
const energy = (x: Float32Array) => x.reduce((sum, v) => sum + v * v, 0);
function magnitude(x: Float32Array, hz: number) {
  let re = 0, im = 0;
  x.forEach((v, i) => { re += v * Math.cos(2 * Math.PI * hz * i / rate); im += v * Math.sin(2 * Math.PI * hz * i / rate); });
  return Math.hypot(re, im);
}
export async function runPartialBankChecks() {
  const makeTrack = (change: Record<string, unknown> = {}) => normalizePresetTrackData({ synthMode: 'partial-bank',
    waveform: 'sawtooth', partialGenerator: { type: 'waveform', harmonicCount: 2 },
    partialBank: { position: { type: 'linear', a: 1.37 } }, ...change });
  const render = async (track = makeTrack(), options: { mono?: boolean; edit?: boolean; notes?: number; duration?: number; start?: number } = {}) => {
    const voices: PitchEnvelopeSynth[] = [];
    const duration = options.duration ?? 1.1;
    const started = performance.now();
    let graphMs = 0;
    try {
      const buffer = await renderOfflineAudio(context => {
        const Voice = options.mono ? MonoGlideSynth : PitchEnvelopeSynth;
        for (let i = 0; i < (options.notes ?? 1); i++) {
          const voice = new Voice({ engine: normalizeSynthEngine(track),
            spectralSource: { ...track, partialGenerator: normalizePartialGenerator(track.partialGenerator) },
            oscillator: { type: 'sine' }, envelope: { attack: 0.005, decay: 0, sustain: 1, release: 0.05 },
          }).toDestination();
          voices.push(voice);
          if (voice instanceof MonoGlideSynth) {
            voice.setGlide({ time: 0.05, mode: 'always', constantRate: false, curve: 'linear', legato: true });
            voice.triggerNotes([50], 0.4, 0.02, 0.1);
            voice.triggerNotes([75], 0.4, 0.3, 0.1);
          } else voice.triggerAttackRelease(50 * 2 ** (i / 12), Math.min(0.9, duration - 0.15), options.start ?? 0.02, 0.1);
          if (options.edit) context.transport.schedule(() => {
            voice.set({ engine: normalizeSynthEngine({ ...track, partialBank: { position: { type: 'linear', a: 2 } } }) });
          }, 0.45);
        }
        context.transport.start(0);
        graphMs = performance.now() - started;
      }, duration, 1, rate);
      const samples = buffer.getChannelData(0).slice(); buffer.dispose();
      if (!samples.every(Number.isFinite)) throw new Error('Nonfinite bank output');
      return { samples, graphMs, totalMs: performance.now() - started };
    } finally { voices.forEach(v => v.dispose()); }
  };
  const result: Record<string, unknown> = {};
  const plain = await render();
  const held = plain.samples.slice(4800, 16800);
  const fractional = magnitude(held, 237), integer = magnitude(held, 200);
  if (fractional < integer * 30 || energy(held) < 0.001) throw new Error(`Fractional oscillator failed: ${fractional}/${integer}`);
  result.fractionalRejection = fractional / integer;
  if (energy(plain.samples.slice(24000)) > 1e-10) throw new Error('Bank continued sounding after release');
  result.release = true;

  const track = makeTrack();
  // Chrome's native oscillator uses the leading automation samples when starting inside a quantum.
  // Compare phase on a quantum boundary; the unaligned test above checks actual spectral placement.
  const aligned = await render(track, { start: 384 / rate });
  const native = createPartialBankOscillator({ ...track, partialGenerator: normalizePartialGenerator(track.partialGenerator) },
    normalizePartialBank(track.partialBank), compileModulation(normalizeModulation({})), { noteStart: 384 / rate, bpm: 120 });
  const reference = Float32Array.from({ length: Math.round(rate * 0.9) }, (_, i) => native.sample(100, (384 + i) / rate, rate) * 0.1);
  let squareError = 0, squareReference = 0;
  for (let i = 4800; i < 16800; i++) {
    squareError += (aligned.samples[i + 384] - reference[i]) ** 2;
    squareReference += reference[i] ** 2;
  }
  result.nativeRelativeError = Math.sqrt(squareError / squareReference);
  if (Number(result.nativeRelativeError) > 0.025) throw new Error(`Browser/CLI phase or gain differs: ${result.nativeRelativeError}`);

  const modulated = await render(makeTrack({ partialBank: { position: { type: 'linear', a: 1 } }, modulation: {
    sources: [{ id: 'env', type: 'envelope', attack: 0.3, decay: 0, sustain: 1 }],
    routes: [{ source: 'env', target: 'positionA', amount: 0.5 }],
  } }));
  const tail = modulated.samples.slice(12000, 21600);
  if (magnitude(tail, 250) < magnitude(tail, 200) * 20) throw new Error('Position envelope did not move the partial');
  result.positionEnvelope = true;
  const edited = await render(undefined, { edit: true });
  if (magnitude(edited.samples.slice(14400, 21600), 300) < magnitude(edited.samples.slice(14400, 21600), 237) * 20) throw new Error('Live position edit was lost in export');
  result.scheduledPositionEdit = true;
  const mono = await render(undefined, { mono: true });
  if (energy(mono.samples.slice(12000, 14400)) < 0.001) throw new Error('Mono bank stopped during legato');
  result.monoLegato = true;
  const dense = await render(makeTrack({ unisonVoices: 2, unisonDetune: 15,
    partialGenerator: { type: 'waveform', harmonicCount: 32 } }), { notes: 8, duration: 0.5 });
  result.bank512 = { graphMs: dense.graphMs, renderAndScheduleMs: dense.totalMs, energy: energy(dense.samples) };
  return result;
}

/** Held edits retain oscillator identities; release and mode switches leave no bank running. */
export async function runPartialBankRealtimeChecks() {
  const original = Tone.getContext();
  const context = new Tone.Context({ lookAhead: 0.05, updateInterval: 0.01 });
  Tone.setContext(context);
  await context.resume();
  const oscillators: Array<{ start: number; stop: number }> = [];
  const create = context.createOscillator;
  context.createOscillator = () => {
    const oscillator = create.call(context), state = { start: Infinity, stop: Infinity };
    oscillators.push(state);
    const start = oscillator.start.bind(oscillator), stop = oscillator.stop.bind(oscillator);
    oscillator.start = (time = 0) => { state.start = time; start(time); };
    oscillator.stop = (time = 0) => { state.stop = time; stop(time); };
    return oscillator;
  };
  const active = () => oscillators.filter(o => o.start <= context.currentTime && o.stop > context.currentTime).length;
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const track = normalizePresetTrackData({ synthMode: 'partial-bank', waveform: 'sawtooth',
    partialGenerator: { type: 'waveform', harmonicCount: 8 }, unisonVoices: 2 });
  const synth = new PitchEnvelopeSynth({ engine: normalizeSynthEngine(track), spectralSource: track,
    envelope: { attack: 0.01, decay: 0, sustain: 1, release: 0.05 } });
  const meter = new Tone.Analyser({ type: 'waveform', size: 2048 });
  synth.connect(meter);
  try {
    const idleBefore = active();
    synth.triggerAttack(110, context.now(), 0.1);
    await wait(160);
    const allocated = oscillators.length, sounding = active();
    for (const a of [1.05, 0.95, 1.1]) {
      synth.set({ engine: normalizeSynthEngine({ ...track, partialBank: { position: { type: 'power', a } } }) });
      await wait(60);
    }
    const held = active(), peak = Math.max(...(meter.getValue() as Float32Array).map(Math.abs));
    if (oscillators.length !== allocated || held !== sounding || sounding !== 17 || peak < 1e-4) {
      throw new Error(`Held bank was restarted or silenced: ${JSON.stringify({ allocated, total: oscillators.length, sounding, held, peak })}`);
    }
    synth.set({ engine: normalizeSynthEngine({ synthMode: 'additive' }) });
    await wait(100);
    const switched = active();
    synth.set({ engine: normalizeSynthEngine(track) });
    await wait(100);
    const restored = active();
    synth.triggerRelease(context.now());
    await wait(250);
    const idleAfter = active();
    if (idleBefore || idleAfter || switched !== 1 || restored !== 17) {
      throw new Error(`Bank lifecycle failed: ${JSON.stringify({ idleBefore, idleAfter, switched, restored })}`);
    }
    return { idleBefore, sounding, held, switched, restored, idleAfter, peak };
  } finally {
    synth.dispose(); meter.dispose();
    await context.close(); context.dispose(); Tone.setContext(original);
  }
}
