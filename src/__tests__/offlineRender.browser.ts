import * as Tone from 'tone';
export { runFilterLfoChecks } from './filterLfo.browser';
export { runNativeEffectChecks, runNativeSynthesisChecks, runNativeDrumChecks, runReverbImpulseLifecycleChecks } from './nativeEffects.browser';
import { markRaw } from 'vue';
import { renderOfflineAudio } from '../audio/offlineRender';
import { disposeReverbAudioChain } from '../audio/reverb';
import { getWaveshaperHighpassCoefficients, getWaveshaperLevels, lookupTransferCurve, TANH_CURVE } from '../audio/trackDistortion';
import { setTremoloSpread } from '../audio/tremolo';
import { normalizeWaveshaperSettings, resolveWaveshaperCurve, type WaveshaperSettings } from '../audio/waveshaper';
import { encodeWavFromChannelsSync } from '../audio/wav';
import { encodeWavInWorker } from '../audio/wavWorker';
import { WAV_WORKER_CHUNK_FRAMES } from '../audio/wavWorkerProtocol';
import {
  createWaveshaperAudioChain,
  disposeWaveshaperAudioChain,
  updateWaveshaperAudioChain,
} from '../audio/waveshaperEffect';
import { DEFAULT_PRESET_TRACK_DATA } from '../presets';
import { normalizePresetTrackData } from '../presets';
import { generatePartialSpectrum, normalizePartialGenerator } from '../audio/partialGenerator';
import { interpolateModulatedTonewheelDrawbars } from '../audio/tonewheelWavetable';
import { blendPartialWavetableSpectra } from '../audio/partialWavetable';
import { PitchEnvelopeSynth } from '../audio/pitchEnvelopeSynth';
import { prewarmVoicePool, retainVoicePool } from '../audio/voicePool';
import type App from '../App.vue';
import { preparePeriodicWaveContext } from '../audio/periodicWave';
import { configureRealtimeScheduling } from '../audio/realtimeScheduling';

export async function runRealtimeSchedulingChecks() {
  const context = new Tone.Context({ clockSource: 'offline' });
  try {
    context.lookAhead = 0.4;
    if (context.updateInterval !== 0.2) throw new Error('Tone clock behavior changed');
    configureRealtimeScheduling(context);
    if (context.lookAhead !== 0.4 || context.updateInterval !== 0.01) {
      throw new Error('Realtime scheduling still batches modulation');
    }
    return { lookAhead: context.lookAhead, updateInterval: context.updateInterval };
  } finally {
    await context.close();
    context.dispose();
  }
}

export async function runPeriodicWavePreparationChecks() {
  const cases = [0, 1, 8, 16, 64, 128];
  let maxDifference = 0;
  const timings = { padded: 0, trimmed: 0 };
  for (const count of cases) {
    for (const sampleRate of [44100, 48000, 96000]) {
      for (const disableNormalization of [false, true]) {
        const real = new Float32Array(2048);
        const imag = new Float32Array(2048);
        for (let index = 1; index <= count; index++) {
          real[index] = Math.sin(index * 1.2) / index;
          imag[index] = Math.cos(index * 0.7) / index;
        }
        const render = async (trim: boolean) => {
          const context = new OfflineAudioContext(1, 4096, sampleRate);
          if (trim) preparePeriodicWaveContext(context);
          const started = performance.now();
          const wave = context.createPeriodicWave(real, imag, { disableNormalization });
          timings[trim ? 'trimmed' : 'padded'] += performance.now() - started;
          const oscillator = context.createOscillator();
          oscillator.frequency.value = 1379;
          oscillator.setPeriodicWave(wave);
          oscillator.connect(context.destination);
          oscillator.start();
          return (await context.startRendering()).getChannelData(0);
        };
        const padded = await render(false);
        const trimmed = await render(true);
        for (let index = 0; index < padded.length; index++) {
          maxDifference = Math.max(maxDifference, Math.abs(padded[index] - trimmed[index]));
        }
      }
    }
  }
  if (maxDifference !== 0) throw new Error(`Periodic wave PCM changed: ${maxDifference}`);
  return { maxDifference, timings };
}

export async function runOfflineVoiceLifecycleChecks() {
  const eventInterval = 0.08;
  const noteDuration = 0.025;
  const release = 0.18;
  const eventCount = 48;
  const finalNoteEnd = (eventCount - 1) * eventInterval + noteDuration;
  let synth: Tone.PolySynth<PitchEnvelopeSynth> | undefined;
  try {
    const buffer = await renderOfflineAudio((context) => {
      synth = new Tone.PolySynth(PitchEnvelopeSynth).toDestination();
      synth.maxPolyphony = 16;
      retainVoicePool(synth as unknown as Tone.PolySynth, 16);
      prewarmVoicePool(synth as unknown as Tone.PolySynth, 16);
      synth.set({
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.001, sustain: 1, release },
      });
      for (let index = 0; index < eventCount; index += 1) {
        const start = index * eventInterval;
        context.transport.schedule((time) => {
          synth!.triggerAttackRelease(220 + (index % 4) * 55, noteDuration, time, 0.5);
        }, start);
      }
      context.transport.start(0);
    }, finalNoteEnd + release + 0.5, 1, 48000);

    const samples = buffer.getChannelData(0);
    const peakBetween = (start: number, end: number) => {
      let peak = 0;
      for (let frame = Math.floor(start * buffer.sampleRate); frame < Math.min(samples.length, Math.ceil(end * buffer.sampleRate)); frame += 1) {
        peak = Math.max(peak, Math.abs(samples[frame]));
      }
      return peak;
    };
    const activePeak = peakBetween((eventCount - 8) * eventInterval, finalNoteEnd);
    const tailPeak = peakBetween(finalNoteEnd + release + 0.1, buffer.duration);
    const internals = synth as unknown as { _activeVoices: unknown[]; _availableVoices: unknown[] };
    if (activePeak < 0.01 || tailPeak > 1e-4 || internals._activeVoices.length !== 0 || internals._availableVoices.length !== 16) {
      throw new Error(`Offline voice lifecycle mismatch: active=${activePeak}, tail=${tailPeak}, voices=${internals._activeVoices.length}/${internals._availableVoices.length}`);
    }
    return { activePeak, tailPeak, availableVoices: internals._availableVoices.length };
  } finally {
    synth?.dispose();
  }
}

export async function runVoiceFilterChecks() {
  const labels: string[] = [];
  const check = (condition: boolean, label: string) => {
    if (!condition) throw new Error(label);
    labels.push(label);
  };

  await Tone.Offline(() => {
    const synth = new Tone.PolySynth(PitchEnvelopeSynth);
    synth.maxPolyphony = 2;
    prewarmVoicePool(synth as unknown as Tone.PolySynth, 2);
    const voices = (synth as unknown as { _voices: PitchEnvelopeSynth[] })._voices;
    check(voices.length === 2, 'PolySynth prewarms both requested voices');
    check(voices[0].filter !== voices[1].filter, 'Each pooled synth voice owns a distinct filter');

    const voiceFilter = {
      ...PitchEnvelopeSynth.getDefaults().voiceFilter,
      enabled: true,
      frequencyMidi: 69,
      keyFollow: 100,
      attack: 0.01,
      amount: 0,
    };
    synth.set({ voiceFilter } as Parameters<typeof synth.set>[0]);
    voices[0].triggerAttackRelease(220, 0.1, 0);
    voices[1].triggerAttackRelease(880, 0.1, 0);
    const lowNoteCutoff = voices[0].filter.frequency.getValueAtTime(0.02);
    const highNoteCutoff = voices[1].filter.frequency.getValueAtTime(0.02);
    check(highNoteCutoff > lowNoteCutoff * 3.9, 'Voice filters retain independent key-follow automation');
  }, 0.2);

  return labels;
}

export async function runPartialGeneratorChecks(app: InstanceType<typeof App>) {
  const labels: string[] = [];
  const check = (condition: boolean, label: string) => {
    if (!condition) throw new Error(label);
    labels.push(label);
  };
  const trim = (values: number[]) => {
    while (values.length > 1 && values.at(-1) === 0) values.pop();
    return values;
  };
  const track = normalizePresetTrackData({
    waveform: 'sawtooth', partialGenerator: { type: 'sequence', sequence: 'natural' },
  });
  const first = app.getTonewheelPartials(track);
  check(JSON.stringify(first) === JSON.stringify(trim(generatePartialSpectrum(track.partialGenerator, track.waveform))),
    'Browser uses shared procedural spectrum');
  check(first === app.getTonewheelPartials(track, 10, 5), 'Static spectrum cache reuses arrays across time');
  const signature = app.getTrackVoiceSignature(track);
  track.partialGenerator = normalizePartialGenerator({
    type: 'sequence', sequence: 'recaman', mapping: 'modulo', mappingModulus: 5,
    mask: 'periodic', maskPeriod: 4, maskOffset: 1, invertMask: true,
  });
  check(JSON.stringify(app.getTonewheelPartials(track)) === JSON.stringify(trim(
    generatePartialSpectrum(track.partialGenerator, track.waveform),
  )), 'Browser uses expanded sequence, mapping, and mask settings');
  check(signature !== app.getTrackVoiceSignature(track), 'Expanded generator settings update voice settings');
  const sequenceSignature = app.getTrackVoiceSignature(track);
  track.partialGenerator = normalizePartialGenerator({
    type: 'binary', mode: 'bit-reversal', bitWidth: 4, mapping: 'logarithmic',
  });
  check(JSON.stringify(app.getTonewheelPartials(track)) === JSON.stringify(trim(
    generatePartialSpectrum(track.partialGenerator, track.waveform),
  )), 'Browser uses enriched binary modes and bit width');
  check(sequenceSignature !== app.getTrackVoiceSignature(track), 'Enriched binary settings update voice settings');
  track.partialGenerator = normalizePartialGenerator({ type: 'binary', mode: 'parity' });
  check(first !== app.getTonewheelPartials(track), 'Generator changes invalidate cached spectrum');
  check(signature !== app.getTrackVoiceSignature(track), 'Generator changes update voice settings');
  const binary = app.getTonewheelPartials(track);
  const binarySignature = app.getTrackVoiceSignature(track);
  const routingSignature = app.getTrackRoutingSignature(track);
  track.waveform = 'square';
  check(binary === app.getTonewheelPartials(track), 'Inactive waveform leaves cached spectrum unchanged');
  for (const waveform of ['choir-ah', 'choir-oh', 'pink-noise', 'brown-noise']) {
    track.waveform = waveform;
    check(binary === app.getTonewheelPartials(track), `Binary ignores inactive ${waveform} spectrum`);
    check(binarySignature === app.getTrackVoiceSignature(track), `Binary ignores inactive ${waveform} voice settings`);
    check(routingSignature === app.getTrackRoutingSignature(track), `Binary ignores inactive ${waveform} routing`);
  }
  track.partialGenerator = { type: 'waveform' };
  track.waveform = 'triangle';
  const triangle = app.getTonewheelPartials(track);
  track.waveform = 'square';
  check(triangle !== app.getTonewheelPartials(track), 'Active waveform changes invalidate cached spectrum');
  track.waveform = 'pink-noise';
  check(JSON.stringify(app.getTonewheelPartials(track)) === JSON.stringify(trim(
    generatePartialSpectrum(track.partialGenerator, track.waveform),
  )), 'Pink spectrum uses shared harmonic generation');

  const animated = normalizePresetTrackData({
    waveform: 'sine',
    tonewheelWavetable: {
      enabled: true, dimensions: [{ name: 'X', value: 0.5 }],
      configurations: [
        { name: 'A', position: [0], drawbars: [8, 0, 0, 0, 0, 0, 0, 0, 0] },
        { name: 'B', position: [1], drawbars: [0, 0, 0, 0, 0, 0, 0, 0, 8] },
      ],
      lfos: [{ enabled: true, waveform: 'sine', sync: false, rateHz: 1, depth: 0.5, routes: [1] }],
    },
  });
  const animatedFirst = app.getTonewheelPartials(animated, 0);
  const animatedNext = app.getTonewheelPartials(animated, 0.25);
  check(JSON.stringify(animatedFirst) !== JSON.stringify(animatedNext), 'Animated tonewheel spectra follow LFO time');
  const drawbars = interpolateModulatedTonewheelDrawbars(animated.tonewheelWavetable, animated.tonewheelDrawbars,
    { timeSeconds: 0.25, noteStartSeconds: 0, bpm: app.bpm });
  check(JSON.stringify(animatedNext) === JSON.stringify(trim(generatePartialSpectrum({ type: 'tonewheel' }, 'sine', drawbars))),
    'Legacy tonewheel delegates with current interpolated drawbars');
  animated.partialGenerator = normalizePartialGenerator({ type: 'sequence', sequence: 'natural' });
  check(app.getTonewheelPartials(animated, 0) === app.getTonewheelPartials(animated, 0.25),
    'Inactive wavetable modulation does not affect procedural cache');
  const proceduralSignature = app.getTrackVoiceSignature(animated);
  animated.tonewheelDrawbars.fill(0);
  animated.tonewheelWavetable.enabled = false;
  check(proceduralSignature === app.getTrackVoiceSignature(animated),
    'Inactive drawbars and wavetable leave procedural voice settings unchanged');

  const mixed = normalizePresetTrackData({
    partialGenerator: { type: 'sequence', sequence: 'natural' },
    tonewheelWavetable: {
      enabled: true,
      dimensions: [{ name: 'Source', value: 0 }],
      configurations: [
        {
          name: 'Tonewheel', position: [0], drawbars: [8, 0, 0, 0, 0, 0, 0, 0, 0],
          source: {
            partialGenerator: { type: 'tonewheel' }, waveform: 'sine',
            tonewheelDrawbars: [8, 0, 0, 0, 0, 0, 0, 0, 0],
          },
        },
        {
          name: 'Sequence', position: [1], drawbars: Array(9).fill(0),
          source: {
            partialGenerator: {
              type: 'sequence', sequence: 'natural', harmonicCount: 1, normalize: true,
              mapping: 'linear', exponent: 1, mappingModulus: 2,
              mask: 'none', invertMask: false, maskPeriod: 2, maskOffset: 0, tilt: 0,
            },
            waveform: 'sine', tonewheelDrawbars: Array(9).fill(0),
          },
        },
      ],
      lfos: [],
    },
  });
  const fallbackSource = {
    partialGenerator: mixed.partialGenerator ?? { type: 'tonewheel' as const },
    waveform: mixed.waveform,
    tonewheelDrawbars: mixed.tonewheelDrawbars,
  };
  const endpoint = app.getTonewheelPartials(mixed);
  check(JSON.stringify(endpoint) === JSON.stringify(trim(
    blendPartialWavetableSpectra(mixed.tonewheelWavetable, fallbackSource),
  )),
    'Browser resolves exact mixed-wavetable endpoints');
  check(endpoint === app.getTonewheelPartials(mixed, 10, 5), 'Static mixed wavetable reuses its blended spectrum');
  for (const waveform of ['choir-ah', 'choir-oh', 'pink-noise', 'brown-noise']) {
    mixed.waveform = waveform;
    check(app.getEffectiveTrackWaveform(mixed) === 'sine', `Mixed wavetable ignores inactive ${waveform} routing`);
    check(app.getTonewheelPartials(mixed).length > 0, `Mixed wavetable remains harmonic with inactive ${waveform}`);
  }
  mixed.waveform = 'sine';
  mixed.tonewheelWavetable.dimensions[0].value = 0.5;
  const midpoint = app.getTonewheelPartials(mixed);
  check(midpoint[0] === 0.5 && midpoint[1] === 0.5, 'Browser crossfades mixed spectra at the midpoint');
  mixed.tonewheelWavetable.lfos = [{
    enabled: true, name: 'Source sweep', waveform: 'sine', sync: false, rateHz: 1,
    syncRate: '1/4', phase: 0, depth: 0.5, polarity: 'bipolar', retrigger: 'note',
    smoothing: 0, fmSource: -1, fmAmount: 0, routes: [1],
  }];
  check(JSON.stringify(app.getTonewheelPartials(mixed, 0, 0)) !== JSON.stringify(app.getTonewheelPartials(mixed, 0.25, 0)),
    'Browser animates mixed spectra through the shared LFO position');

  track.waveform = 'square';
  for (const partialGenerator of [
    normalizePartialGenerator({ type: 'waveform' }),
    normalizePartialGenerator({ type: 'sequence' }),
    normalizePartialGenerator({ type: 'binary', mode: 'bit', bit: 5, harmonicCount: 1 }),
  ]) {
    track.partialGenerator = partialGenerator;
    const partials = app.getTonewheelPartials(track);
    const buffer = await renderOfflineAudio(() => {
      new Tone.Oscillator({ frequency: 110, type: 'custom', partials }).toDestination().start(0).stop(0.02);
    }, 0.025, 1, 48000);
    const samples = buffer.getChannelData(0);
    check(samples.every(Number.isFinite), `Finite browser audio for ${partialGenerator.type}`);
    check(partialGenerator.type === 'binary' ? samples.every(sample => sample === 0) : samples.some(sample => Math.abs(sample) > 0.001),
      `Expected browser ${partialGenerator.type === 'binary' ? 'silence' : 'signal'}`);
    buffer.dispose();
  }
  const peaks: number[] = [];
  for (const normalize of [true, false]) {
    const sineTrack = normalizePresetTrackData({
      waveform: 'sine', partialGenerator: { type: 'sequence', sequence: 'natural', harmonicCount: 16, normalize },
    });
    const partials = app.getTonewheelPartials(sineTrack);
    const buffer = await renderOfflineAudio(() => {
      new Tone.Oscillator({
        frequency: 110, type: 'custom', partials, volume: app.getPartialOscillatorVolume(sineTrack, partials),
      }).toDestination().start(0).stop(0.02);
    }, 0.025, 1, 48000);
    peaks.push(Math.max(...buffer.getChannelData(0).map(Math.abs)));
    buffer.dispose();
  }
  check(peaks[0] > 0 && Math.abs(peaks[1] / peaks[0] - 16) < 0.001,
    'Browser oscillator preserves procedural peak normalization levels');
  check(app.getPartialOscillatorVolume(normalizePresetTrackData({}), [0.125]) === 0,
    'Legacy tonewheel oscillator gain is unchanged');
  for (const type of ['tonewheel', 'sequence', 'binary', 'waveform'] as const) {
    for (const waveform of ['choir-ah', 'choir-oh', 'pink-noise', 'brown-noise']) {
      const source = normalizePresetTrackData({
        partialGenerator: { type }, waveform, polyphony: 1,
        attack: 0.001, decay: 0, sustain: 1, release: 0.005,
        breathEnabled: false, reverbWet: -96,
      });
      const savedReverb = app.reverbChain;
      let chain: ReturnType<typeof app.createTrackAudioChain> | undefined;
      let reverb: ReturnType<typeof app.getOrCreateReverbChain> | undefined;
      let buffer: Tone.ToneAudioBuffer | undefined;
      try {
        app.reverbChain = null;
        buffer = await renderOfflineAudio(() => {
          reverb = app.getOrCreateReverbChain();
          chain = app.createTrackAudioChain();
          app.updateTrackChainSettings(source, chain);
          check(!chain.noiseSynth, `${type}/${waveform} does not allocate source noise without breath`);
          check(Boolean(chain.choir) === (type === 'waveform' && waveform.startsWith('choir-')),
            `${type}/${waveform} uses only its active choir routing`);
          chain.mixGain.gain.value = 1;
          app.triggerTrackVoice(source, chain, [69], 0.03, 0, 0.5, 0);
        }, 0.04, 1, 48000);
        const samples = buffer.getChannelData(0);
        check(samples.every(Number.isFinite) && samples.some(sample => Math.abs(sample) > 0.00001),
          `${type}/${waveform} produces finite audible browser audio`);
      } finally {
        buffer?.dispose();
        if (chain) app.disposeTrackChain(chain);
        if (reverb) disposeReverbAudioChain(reverb);
        app.reverbChain = savedReverb;
      }
    }
  }
  return labels;
}

export async function runWaveshaperChecks(app: InstanceType<typeof App>) {
  const originalContext = Tone.getContext();
  const sampleRate = 48000;
  const frameCount = 4800;
  const inputs = [0, 1].map(channel => Float32Array.from({ length: frameCount }, (_, frame) =>
    1.7 * Math.sin(2 * Math.PI * (317 + channel * 193) * frame / sampleRate + channel * 0.4)
      + (frame < frameCount / 2 ? 0.23 : -0.17),
  ));
  const results: { label: string; peakDifference: number; peakSignal: number; tolerance: number }[] = [];
  type TrackChain = ReturnType<typeof app.createTrackAudioChain>;
  type ReverbChain = ReturnType<typeof app.getOrCreateReverbChain>;
  type Adapter = ReturnType<typeof createWaveshaperAudioChain>;

  const compare = (expected: Float32Array[], actual: Float32Array[], label: string, tolerance: number) => {
    if (actual.length !== expected.length) throw new Error(`${label}: channel count changed.`);
    let peakDifference = 0;
    let peakSignal = 0;
    expected.forEach((reference, channel) => {
      const samples = actual[channel];
      if (samples.length !== reference.length) throw new Error(`${label}: frame count changed.`);
      for (let frame = 0; frame < reference.length; frame += 1) {
        if (!Number.isFinite(samples[frame]) || !Number.isFinite(reference[frame])) {
          throw new Error(`${label}: non-finite PCM at channel=${channel}, frame=${frame}.`);
        }
        peakDifference = Math.max(peakDifference, Math.abs(samples[frame] - reference[frame]));
        peakSignal = Math.max(peakSignal, Math.abs(reference[frame]));
      }
    });
    if (peakDifference > tolerance || peakSignal < 0.01) {
      throw new Error(`${label}: difference=${peakDifference}, signal=${peakSignal}, tolerance=${tolerance}`);
    }
    results.push({ label, peakDifference, peakSignal, tolerance });
  };

  const render = async (connect: (context: Tone.OfflineContext, source: AudioBufferSourceNode) => () => void) => {
    let source: AudioBufferSourceNode | undefined;
    let rendered: Tone.ToneAudioBuffer | undefined;
    let cleanup: (() => void) | undefined;
    try {
      rendered = await renderOfflineAudio(context => {
        if (!context.isOffline || context.sampleRate !== sampleRate || Tone.getContext() !== context) {
          throw new Error('Waveshaper checks require the active 48 kHz offline context.');
        }
        const buffer = context.createBuffer(inputs.length, frameCount, sampleRate);
        inputs.forEach((samples, channel) => buffer.getChannelData(channel).set(samples));
        source = context.createBufferSource();
        source.buffer = buffer;
        cleanup = connect(context, source);
        source.start(0);
      }, frameCount / sampleRate, inputs.length, sampleRate);
      if (rendered.sampleRate !== sampleRate) throw new Error('Offline output sample rate changed.');
      return inputs.map((_, channel) => rendered!.getChannelData(channel).slice());
    } finally {
      try {
        source?.disconnect();
        if (source) source.buffer = null;
        cleanup?.();
        rendered?.dispose();
      } finally {
        if (Tone.getContext() !== originalContext) {
          Tone.setContext(originalContext);
          throw new Error('Waveshaper render did not restore the live Tone context.');
        }
      }
    }
  };

  const cases: { label: string; settings: WaveshaperSettings }[] = [];
  // The native browser path uses 4x oversampling, unlike the CLI's scalar LUT.
  // Compare against an independent single-shaper graph at the same quality.
  const renderReference = (settings: WaveshaperSettings, track = false) => render((context, source) => {
    const nodes: AudioNode[] = [];
    const gain = (value: number) => {
      const node = context.createGain();
      node.gain.value = value;
      nodes.push(node);
      return node;
    };
    const output = new Tone.Gain(1).toDestination();
    const { drive, mix } = getWaveshaperLevels(settings);
    const { curve } = resolveWaveshaperCurve(settings);
    const wetMix = settings.enabled && curve ? mix : 0;
    const sum = gain(1);
    const dry = gain(1 - wetMix);
    source.connect(dry);
    dry.connect(sum);
    if (wetMix > 0 && curve) {
      const inputGain = gain(drive);
      const wet = gain(wetMix);
      const shaper = context.createWaveShaper();
      shaper.oversample = '4x';
      shaper.curve = Float32Array.from(curve);
      nodes.push(shaper);
      source.connect(inputGain);
      inputGain.connect(shaper);
      if (settings.dcBlock) {
        const c = getWaveshaperHighpassCoefficients(sampleRate);
        const filter = context.createIIRFilter([c.b0, c.b1, c.b2], [1, c.a1, c.a2]);
        nodes.push(filter);
        shaper.connect(filter);
        filter.connect(wet);
      } else shaper.connect(wet);
      wet.connect(sum);
    }
    if (track) {
      const drive = gain(Math.pow(10, -7 / 20));
      const level = gain(Math.pow(10, -4 / 20));
      const limiter = context.createWaveShaper();
      limiter.curve = Float32Array.from(TANH_CURVE);
      nodes.push(limiter);
      sum.connect(drive);
      drive.connect(limiter);
      limiter.connect(level);
      Tone.connect(level, output);
    } else Tone.connect(sum, output);
    return () => { nodes.forEach(node => node.disconnect()); output.dispose(); };
  });
  for (const dcBlock of [false, true]) {
    for (const curve of ['sine-fold', 'custom', 'asymmetric-power']) {
      cases.push({
        label: `${curve}, dcBlock=${dcBlock}`,
        settings: normalizeWaveshaperSettings({
          enabled: true, curve, dcBlock, inputDriveDb: 5, mix: 73,
          expression: 'a*x+b*x^2',
          customParameters: [
            { name: 'a', value: 0.7, min: -2, max: 2, step: 0.01 },
            { name: 'b', value: 0.3, min: -2, max: 2, step: 0.01 },
          ],
          builtinParameters: { 'sine-fold': { k: 2.7 }, 'asymmetric-power': { p: 2, q: 0.7 } },
        }),
      });
    }
  }
  cases.push(
    { label: 'disabled input above unity', settings: normalizeWaveshaperSettings({ enabled: false, inputDriveDb: 24, dcBlock: true }) },
    { label: 'mix=0 input above unity', settings: normalizeWaveshaperSettings({ enabled: true, mix: 0, inputDriveDb: 24, dcBlock: true }) },
  );

  for (const { label, settings } of cases) {
    const expected = await renderReference(settings);
    const actual = await render((context, source) => {
      let adapter: Adapter | undefined;
      try {
        adapter = createWaveshaperAudioChain(normalizeWaveshaperSettings({ enabled: false }));
        updateWaveshaperAudioChain(adapter, settings);
        updateWaveshaperAudioChain(adapter, settings);
        if (adapter.context !== context || adapter.shapers.some(shaper => shaper.context !== source.context)
          || adapter.error || adapter.debounceTimer !== null || adapter.transitionTimer !== null) {
          throw new Error(`${label}: adapter did not apply immediately in the source's offline context.`);
        }
        Tone.connect(source, adapter.input);
        adapter.output.toDestination();
        const ownedAdapter = adapter;
        return () => disposeWaveshaperAudioChain(ownedAdapter);
      } catch (error) {
        if (adapter) disposeWaveshaperAudioChain(adapter);
        throw error;
      }
    });
    const tolerance = settings.enabled && settings.mix !== 0 && settings.dcBlock ? 1e-5 : 1e-6;
    compare(expected, actual, `adapter ${label}`, tolerance);
    if (!settings.enabled || settings.mix === 0) compare(inputs, actual, `unclipped bypass ${label}`, 1e-6);
  }

  const limiterReference = inputs.map(samples => Float32Array.from(samples, sample => lookupTransferCurve(TANH_CURVE, sample)));
  const renderLimiter = (legacy: boolean) => render((_context, source) => {
    const limiter = legacy ? new Tone.WaveShaper(Math.tanh) : new Tone.WaveShaper(TANH_CURVE);
    try {
      Tone.connect(source, limiter);
      limiter.toDestination();
      return () => { limiter.dispose(); };
    } catch (error) {
      limiter.dispose();
      throw error;
    }
  });
  const legacy = await renderLimiter(true);
  const explicit = await renderLimiter(false);
  compare(limiterReference, legacy, 'legacy Tone.WaveShaper(Math.tanh) lookup', 1e-6);
  compare(limiterReference, explicit, 'explicit TANH_CURVE lookup', 1e-6);
  compare(legacy, explicit, 'legacy versus explicit limiter', 1e-6);

  const renderTrack = (settings: WaveshaperSettings, reroute: boolean) => render((context, source) => {
    const saved = {
      reverbEnabled: app.reverbEnabled,
      reverbDry: app.reverbDry,
      reverbChain: app.reverbChain,
      trackSynths: app.trackSynths,
    };
    let chain: TrackChain | undefined;
    let reverb: ReverbChain | undefined;
    const cleanup = () => {
      try {
        if (chain) app.disposeTrackChain(chain);
      } finally {
        if (reverb) disposeReverbAudioChain(reverb);
      }
    };
    try {
      app.reverbEnabled = false;
      app.reverbDry = 0;
      app.reverbChain = null;
      app.trackSynths = markRaw({});
      const track = {
        ...DEFAULT_PRESET_TRACK_DATA,
        id: '__waveshaper_native_check__',
        waveform: 'sine', polyphony: 1,
        gain: -4, limiterGain: -7,
        fadeIn: 0, fadeOut: 0,
        filterEnabled: false, filterLfoEnabled: false,
        breathEnabled: false, vibratoEnabled: false, tremoloEnabled: false,
        chorusEnabled: false, flangerEnabled: false, phaserEnabled: false, echoEnabled: false,
        waveshaper: normalizeWaveshaperSettings({ enabled: false }),
      };
      reverb = app.getOrCreateReverbChain();
      app.updateReverbChain();
      chain = app.createTrackAudioChain();
      app.trackSynths[track.id] = chain;
      app.updateTrackChainSettings(track, chain);
      const baselineWaveshaper = chain.waveshaper;
      if (baselineWaveshaper !== null) throw new Error('Disabled baseline allocated a waveshaper.');
      track.waveshaper = settings;
      app.updateTrackChainSettings(track, chain);
      if (settings.enabled && (!chain.waveshaper || chain.waveshaper.context !== context)) {
        throw new Error('Enabled App track did not allocate its offline waveshaper adapter.');
      }
      Tone.connect(source, chain.sourceBus);
      if (reroute) {
        track.waveshaper = normalizeWaveshaperSettings({ ...settings, enabled: !settings.enabled });
        app.updateTrackChainSettings(track, chain);
        app.routeTrackAudioChain(track, chain);
        track.waveshaper = settings;
        app.updateTrackChainSettings(track, chain);
        app.routeTrackAudioChain(track, chain);
        app.routeTrackAudioChain(track, chain);
      }
      chain.mixGain.gain.setValueAtTime(1, 0);
      chain.fadeGain.gain.setValueAtTime(1, 0);
      return cleanup;
    } catch (error) {
      cleanup();
      throw error;
    } finally {
      app.reverbEnabled = saved.reverbEnabled;
      app.reverbDry = saved.reverbDry;
      app.reverbChain = saved.reverbChain;
      app.trackSynths = saved.trackSynths;
    }
  });

  for (const { label, settings } of cases) {
    const expected = await renderReference(settings, true);
    const direct = await renderTrack(settings, false);
    const rerouted = await renderTrack(settings, true);
    const tolerance = settings.enabled && settings.mix !== 0 && settings.dcBlock ? 1e-5 : 1e-6;
    compare(expected, direct, `App waveshaper before limiter/output ${label}`, tolerance);
    compare(expected, rerouted, `App rerouted composition ${label}`, tolerance);
    compare(direct, rerouted, `App no duplicate connections ${label}`, tolerance);
  }
  return { sampleRate, frameCount, adapterCases: cases.length, graphCases: cases.length * 2, contextRestored: true, results };
}

export async function runOfflineRenderChecks() {
  const originalContext = Tone.getContext();
  const duration = 60;
  const render = async (optimized: boolean) => {
    let synth: Tone.Synth | undefined;
    let offlineContext: Tone.OfflineContext | undefined;
    const started = performance.now();
    try {
      const buffer = await (optimized ? renderOfflineAudio : Tone.Offline)((context) => {
        offlineContext = context;
        synth = new Tone.Synth({ oscillator: { type: 'sine', phase: 0 } }).toDestination();
        for (let second = 0; second < duration; second += 2) {
          context.transport.schedule((time) => synth!.triggerAttackRelease(220, 0.5, time), second);
        }
        context.transport.start(0);
      }, duration, 2, 48000);
      return { samples: buffer.getChannelData(0), milliseconds: performance.now() - started };
    } finally {
      synth?.dispose();
      offlineContext?.dispose();
    }
  };
  const reference = await render(false);
  const optimized = await render(true);
  if (reference.samples.length !== optimized.samples.length) {
    throw new Error('Offline render length changed.');
  }
  let peakDifference = 0;
  let peakSignal = 0;
  for (let index = 0; index < reference.samples.length; index += 1) {
    peakDifference = Math.max(peakDifference, Math.abs(reference.samples[index] - optimized.samples[index]));
    peakSignal = Math.max(peakSignal, Math.abs(optimized.samples[index]));
  }
  if (peakDifference !== 0 || peakSignal === 0) {
    throw new Error(`Offline PCM mismatch: difference=${peakDifference}, signal=${peakSignal}`);
  }
  const expectedFailure = new Error('Scheduling failed');
  try {
    await renderOfflineAudio(() => { throw expectedFailure; }, 1, 2, 48000);
    throw new Error('Scheduling failure was swallowed.');
  } catch (error) {
    if (error !== expectedFailure) {
      throw error;
    }
  }
  if (Tone.getContext() !== originalContext) {
    throw new Error('Live audio context was not restored.');
  }
  return {
    referenceMilliseconds: reference.milliseconds,
    optimizedMilliseconds: optimized.milliseconds,
    peakDifference,
    peakSignal,
    contextRestored: true,
  };
}

export async function runModulationChecks(app: InstanceType<typeof App>) {
  const track = {
    ...DEFAULT_PRESET_TRACK_DATA,
    vibratoFrequency: 3.7,
    vibratoDepth: 0.6,
    tremoloFrequency: 3.7,
    tremoloDepth: 0.6,
    tremoloSpread: 90,
  };
  type Chain = Parameters<typeof app.ensureTrackVibrato>[0];
  const assertSameAudio = (reference: Tone.ToneAudioBuffer, actual: Tone.ToneAudioBuffer, label: string) => {
    let peakDifference = 0;
    let peakSignal = 0;
    for (let channel = 0; channel < 2; channel += 1) {
      const expected = reference.getChannelData(channel);
      const samples = actual.getChannelData(channel);
      for (let index = 0; index < samples.length; index += 1) {
        peakDifference = Math.max(peakDifference, Math.abs(expected[index] - samples[index]));
        peakSignal = Math.max(peakSignal, Math.abs(expected[index]));
      }
    }
    if (peakDifference > 1e-6 || peakSignal < 0.01) {
      throw new Error(`${label}: difference=${peakDifference}, signal=${peakSignal}`);
    }
  };

  for (const kind of ['vibrato', 'tremolo'] as const) {
    const render = async (rewire: boolean) => {
      let effect: Tone.Vibrato | Tone.Tremolo | undefined;
      let oscillator: Tone.Oscillator | undefined;
      try {
        return await renderOfflineAudio((context) => {
          // These methods only need the effect slots, not the rest of the audio graph.
          const chain = { vibrato: null, tremolo: null, routingSignature: '' } as unknown as Chain;
          effect = kind === 'vibrato'
            ? app.ensureTrackVibrato(chain, track)
            : app.ensureTrackTremolo(chain, track);
          effect.toDestination();
          oscillator = new Tone.Oscillator(440).connect(effect).start(0).stop(0.45);
          if (rewire) {
            app.ensureTrackModulationRunning(chain);
            app.ensureTrackModulationRunning(chain);
            context.transport.schedule(() => app.ensureTrackModulationRunning(chain), 0.137);
            context.transport.start(0);
          }
        }, 0.5, 2, 48000);
      } finally {
        oscillator?.dispose();
        effect?.dispose();
      }
    };
    assertSameAudio(await render(false), await render(true), `${kind} startup/rewire phase`);
  }

  for (const spread of [0, 90, 180, 270, 360]) {
    for (const depth of [0, 0.6, 1]) {
      const render = async (update: boolean) => {
        let tremolo: Tone.Tremolo | undefined;
        let oscillator: Tone.Oscillator | undefined;
        try {
          return await renderOfflineAudio(() => {
            tremolo = new Tone.Tremolo({
              frequency: 3.7, depth, spread: update ? 180 : spread,
            }).toDestination().start(0);
            if (update) {
              setTremoloSpread(tremolo, spread);
              setTremoloSpread(tremolo, spread);
            }
            oscillator = new Tone.Oscillator(440).connect(tremolo).start(0).stop(0.15);
          }, 0.2, 2, 48000);
        } finally {
          oscillator?.dispose();
          tremolo?.dispose();
        }
      };
      assertSameAudio(await render(false), await render(true), `tremolo spread=${spread}, depth=${depth}`);
    }
  }
  return { phaseContinuity: true, tremoloSpreadAndDepthCases: 15 };
}

export async function runWavWorkerChecks() {
  const context = new OfflineAudioContext(2, 1, 48000);
  const audio = context.createBuffer(2, WAV_WORKER_CHUNK_FRAMES * 4 + 17, 48000);
  const channels = [audio.getChannelData(0), audio.getChannelData(1)];
  channels.forEach((channel, index) => {
    for (let frame = 0; frame < channel.length; frame += 1) channel[frame] = Math.sin(frame * 0.031 + index) * 1.4;
  });
  let heartbeat = 0;
  const timer = setInterval(() => { heartbeat += 1; }, 0);
  const started = performance.now();
  try {
    for (const dither of [true, false]) {
      const progress: number[] = [];
      const expected = encodeWavFromChannelsSync(channels, 48000, { dither });
      const actual = await encodeWavInWorker(channels, 48000, { dither, onProgress: value => progress.push(value) });
      if (actual.length !== expected.length || !actual.every((value, index) => value === expected[index])) {
        throw new Error(`Worker encoding changed WAV bytes, dither=${dither}`);
      }
      if (progress[0] !== 0 || progress.at(-1) !== 1 || progress.length !== 6) {
        throw new Error('Expected worker acknowledgements for five chunks');
      }
      if (channels[0].byteLength === 0 || audio.getChannelData(1)[0] !== Math.fround(Math.sin(1) * 1.4)) {
        throw new Error('AudioBuffer channels were detached or modified');
      }
    }
    if (heartbeat === 0) throw new Error('Worker export did not yield to the main thread');
    return { byteIdentical: true, ditherCases: 2, heartbeat, milliseconds: performance.now() - started };
  } finally {
    clearInterval(timer);
  }
  const controller = new AbortController();
  let cancelledTicks = 0;
  try {
    await renderOfflineAudio(context => {
      context.on('tick', () => {
        if (++cancelledTicks === 3) controller.abort();
      });
    }, 1, 2, 48000, controller.signal);
    throw new Error('Clock cancellation was ignored.');
  } catch (error) {
    if (error !== controller.signal.reason) throw error;
  }
  if (cancelledTicks !== 3 || Tone.getContext() !== originalContext) {
    throw new Error('Clock cancellation did not stop ticks and restore context.');
  }
}

/** Compare the optimized fixed graph with the previous two-fed-shaper graph. */
export async function runPerformanceOptimizationChecks(app: InstanceType<typeof App>) {
  let cases = 0;
  for (const curve of ['sine-fold', 'asymmetric-power', 'custom']) {
    for (const dcBlock of [false, true]) {
      const settings = normalizeWaveshaperSettings({
        enabled: true, curve, dcBlock, inputDriveDb: 5, mix: 73,
        expression: '0.7*x+0.3*x^2',
      });
      const render = async (legacy: boolean) => {
        let chain: ReturnType<typeof createWaveshaperAudioChain> | undefined;
        let source: Tone.Oscillator | undefined;
        try {
          return await renderOfflineAudio(() => {
            chain = createWaveshaperAudioChain(settings);
            if (legacy) chain.drive.connect(chain.shapers[1]);
            chain.output.toDestination();
            source = new Tone.Oscillator({ frequency: 317, volume: 6 })
              .connect(chain.input).start(0).stop(0.09);
          }, 0.12, 2, 48000);
        } finally {
          source?.dispose();
          if (chain) disposeWaveshaperAudioChain(chain);
        }
      };
      const reference = await render(true);
      const actual = await render(false);
      try {
        for (let channel = 0; channel < 2; channel += 1) {
          const expected = reference.getChannelData(channel);
          if (!actual.getChannelData(channel).every((sample, index) => sample === expected[index])) {
            throw new Error(`Offline standby branch changed audio: ${curve}, dcBlock=${dcBlock}`);
          }
        }
        cases += 1;
      } finally {
        reference.dispose();
        actual.dispose();
      }
    }
  }
  const calls: Array<{ oscillator: Record<string, unknown> }> = [];
  const chain = {
    synth: { set: (options: { oscillator: Record<string, unknown> }) => calls.push(options) },
    lastAppliedPartials: null, preparedWavetable: null, modulationNoteStartSeconds: 0,
  } as unknown as ReturnType<typeof app.createTrackAudioChain>;
  const track = normalizePresetTrackData({
    unisonVoices: 3,
    tonewheelWavetable: {
      enabled: true, dimensions: [{ name: 'X', value: 0.5 }],
      configurations: [
        { position: [0], drawbars: [8, 0, 0, 0, 0, 0, 0, 0, 0] },
        { position: [1], drawbars: [0, 0, 8, 0, 0, 0, 0, 0, 0] },
      ],
      lfos: [{ enabled: true, waveform: 'sine', rateHz: 1, depth: 0.3, routes: [1] }],
    },
  });
  app.applyTonewheelModulation(track, chain, 0);
  app.applyTonewheelModulation(track, chain, 0);
  if (calls.length !== 1 || Object.keys(calls[0].oscillator).sort().join(',') !== 'partials,volume') {
    throw new Error('Modulation must skip equal spectra and avoid structural oscillator updates');
  }
  return { identicalOversampledRenders: cases, modulationUpdatesDeduplicated: true };
}
