import * as Tone from 'tone';
import { normalizePresetTrackData, PHASER_MAX_SWEEP_OCTAVES, type PresetTrackData } from '../presets';
import { Phaser } from '../audio/phaser';
import { getLfoSyncRateHz } from '../audio/lfo';
import { renderOfflineAudio } from '../audio/offlineRender';
import { applyNativeTrackEffects, applyNativeEcho } from '../../cli/nativeTrackEffects';
import { createStereoFilter } from '../../cli/biquad';
import { createPinkNoiseImpulseChannels } from '../audio/reverbImpulse';
import { convolveInto } from '../../cli/convolution';
import { sampleAmplitudeEnvelope, createNativePitchEnvelope, nativeUnisonGain } from '../../cli/nativeEnvelope';
import { NativeEnvelopeAutomation } from '../../cli/nativeEnvelopeAutomation';
import { preparePartialOscillator } from '../../cli/partialOscillator';
import { generatePartialSpectrum } from '../audio/partialGenerator';
import { getPartialSpectrumGain } from '../audio/partialSpectrumGain';
import { buildPitchEnvelopeCurve } from '../audio/pitchEnvelope';
import { createDrumInstrument } from '../audio/drumKit';
import { normalizeDrumParameters, type DrumVoiceId } from '../domain/rhythmTrack';
import { renderDrumHitIntoBuffers } from '../../cli/drumWav';
import { createReverbAudioChain, updateReverbAudioChain, setReverbOutputEnabled, disposeReverbAudioChain } from '../audio/reverb';
import { disposeMasterBus } from '../audio/masterBus';

export async function runNativeDrumChecks() {
  const sampleRate = 48000, frames = 24000, duration = 0.08, velocity = 0.6;
  const results = [];
  for (const id of ['kick', 'chimes', 'triangle', 'triangleMuted'] as DrumVoiceId[]) {
    const startFrame = 512;
    const parameters = normalizeDrumParameters(id, id === 'kick' ? { sweep: 0, tune: 320 } : {});
    const native = [new Float32Array(frames), new Float32Array(frames)];
    renderDrumHitIntoBuffers({ left: native[0], right: native[1], sampleRate, startFrame, duration,
      velocity, voiceId: id, parameters });
    let instrument: ReturnType<typeof createDrumInstrument> | undefined;
    const browser = await renderOfflineAudio(context => {
      instrument = createDrumInstrument(id, parameters);
      instrument.node.connect(context.destination);
      instrument.trigger(startFrame / sampleRate, velocity, duration);
    }, frames / sampleRate, 2, sampleRate);
    instrument!.dispose();
    let peakError = 0;
    for (let channel = 0; channel < 2; channel++) for (let frame = 0; frame < frames; frame++) {
      peakError = Math.max(peakError, Math.abs(native[channel][frame] - browser.getChannelData(channel)[frame]));
    }
    if (peakError > 3e-4) throw new Error(`Native ${id} voice differs: ${peakError}`);
    results.push({ id, peakError });
  }
  return results;
}

export async function runReverbImpulseLifecycleChecks() {
  const context = new Tone.OfflineContext(2, 0.1, 48000), original = Tone.getContext();
  Tone.setContext(context);
  let chain: ReturnType<typeof createReverbAudioChain> | undefined;
  try {
    const settings = { decay: 0.1, preDelay: 0.02, lowCutFrequency: 100, highCutFrequency: 8000 };
    chain = createReverbAudioChain(settings);
    if (chain.convolver.normalize) throw new Error('Initial impulse must retain shared calibration');
    const previous = chain.convolver;
    setReverbOutputEnabled(chain, false);
    updateReverbAudioChain(chain, { ...settings, decay: 0.2 });
    if (chain.outputConnected || chain.convolver === previous || chain.convolver.normalize) throw new Error('Impulse update must preserve bypass and calibration');
    const expected = createPinkNoiseImpulseChannels(0.2, 0.02, context.sampleRate);
    const buffer = chain.convolver.buffer!;
    for (let channel = 0; channel < 2; channel++) {
      const actual = buffer.getChannelData(channel);
      if (actual.length !== expected[channel].length || actual.some((sample, frame) => sample !== expected[channel][frame])) throw new Error('Updated impulse differs from native impulse');
    }
    setReverbOutputEnabled(chain, true);
    if (!chain.outputConnected) throw new Error('Updated reverb must reconnect when enabled');
    return { initialCalibration: true, updatedCalibration: true, bypassPreserved: true, sharedImpulse: true };
  } finally {
    if (chain) disposeReverbAudioChain(chain);
    disposeMasterBus(context);
    context.dispose();
    Tone.setContext(original);
  }
}

export async function runNativeSynthesisChecks() {
  const sampleRate = 48000, frames = 24000, startFrame = 512, duration = 0.08;
  const results = [];
  for (const gate of [0.002, duration]) {
    const track = normalizePresetTrackData({ attack: 0.025, decay: 0.045, sustain: 0.3, release: 0.04,
      pitchEnvelopeAmount: 12, pitchEnvelopeAttack: 0.025, pitchEnvelopeDecay: 0.045,
      pitchEnvelopeSustain: 0.3, pitchEnvelopeRelease: 0.04 });
    for (const kind of ['amplitude', 'pitch-linear', 'pitch-shaped'] as const) {
      track.pitchEnvelopeShape = kind === 'pitch-shaped' ? 3 : 0;
      const pitch = createNativePitchEnvelope(track);
      const native = Float32Array.from({ length: frames }, (_, frame) => frame < startFrame ? 0 : kind === 'amplitude'
        ? sampleAmplitudeEnvelope((frame - startFrame) / sampleRate, gate, track)
        : pitch((frame - startFrame) / sampleRate, gate));
      const browser = await renderOfflineAudio(context => {
        const raw = context.createBuffer(1, frames, sampleRate);
        raw.getChannelData(0).fill(1);
        const envelope = kind === 'amplitude' ? new Tone.Envelope({
          attack: track.attack, decay: track.decay, sustain: track.sustain, release: track.release,
          attackCurve: 'exponential', decayCurve: 'exponential', releaseCurve: 'exponential',
        }) : new Tone.Envelope({ attack: track.pitchEnvelopeAttack, decay: track.pitchEnvelopeDecay,
          sustain: track.pitchEnvelopeSustain, release: track.pitchEnvelopeRelease,
          attackCurve: kind === 'pitch-shaped' ? buildPitchEnvelopeCurve(3) : 'linear',
          decayCurve: kind === 'pitch-shaped' ? 'exponential' : 'linear',
          releaseCurve: kind === 'pitch-shaped' ? buildPitchEnvelopeCurve(3).reverse() : 'linear' });
        const gain = new Tone.Gain(0);
        envelope.connect(gain.gain);
        new Tone.Player(raw).chain(gain, context.destination).start(0);
        envelope.triggerAttackRelease(gate, startFrame / sampleRate);
      }, frames / sampleRate, 1, sampleRate);
      let peakError = 0;
      for (let frame = 0; frame < frames; frame++) peakError = Math.max(peakError, Math.abs(native[frame] - browser.getChannelData(0)[frame]));
      if (peakError > 3e-5) throw new Error(`Native ${kind} envelope (gate ${gate}) differs: ${peakError}`);
      results.push({ kind, gate, peakError });
    }
  }
  for (const legato of [false, true]) for (const kind of ['amplitude', 'pitch'] as const) {
    const track = normalizePresetTrackData({ attack: 0.04, decay: 0.05, sustain: 0.4, release: 0.05,
      pitchEnvelopeAttack: 0.04, pitchEnvelopeDecay: 0.05, pitchEnvelopeSustain: 0.4,
      pitchEnvelopeRelease: 0.05, pitchEnvelopeShape: 3 });
    const change = 0.03, gate = 0.05;
    const automation = new NativeEnvelopeAutomation(track, kind, sampleRate);
    const onset = startFrame / sampleRate, changeTime = onset + change;
    automation.attack(onset, kind === 'amplitude' ? 0.7 : 1);
    if (legato) automation.cancel(changeTime);
    else automation.attack(changeTime, kind === 'amplitude' ? 0.4 : 1);
    automation.release(changeTime + gate);
    const native = Float32Array.from({ length: frames }, (_, frame) => automation.sample(frame / sampleRate));
    const browser = await renderOfflineAudio(context => {
      const raw = context.createBuffer(1, frames, sampleRate);
      raw.getChannelData(0).fill(1);
      const envelope = new Tone.Envelope({ attack: 0.04, decay: 0.05, sustain: 0.4, release: 0.05,
        attackCurve: kind === 'amplitude' ? 'exponential' : buildPitchEnvelopeCurve(3),
        decayCurve: 'exponential', releaseCurve: kind === 'amplitude' ? 'exponential' : buildPitchEnvelopeCurve(3).reverse() });
      const gain = new Tone.Gain(0);
      envelope.connect(gain.gain);
      new Tone.Player(raw).chain(gain, context.destination).start(0);
      envelope.triggerAttack(startFrame / sampleRate, kind === 'amplitude' ? 0.7 : 1);
      const changeTime = startFrame / sampleRate + change;
      if (legato) envelope.cancel(changeTime);
      else envelope.triggerAttack(changeTime, kind === 'amplitude' ? 0.4 : 1);
      envelope.triggerRelease(changeTime + gate);
    }, frames / sampleRate, 1, sampleRate);
    let peakError = 0;
    for (let frame = 0; frame < frames; frame++) peakError = Math.max(peakError, Math.abs(native[frame] - browser.getChannelData(0)[frame]));
    if (peakError > 3e-5) throw new Error(`Native ${kind} continuity (legato ${legato}) differs: ${peakError}`);
    results.push({ kind: `${kind}-continuity`, legato, peakError });
  }
  for (const count of [1, 2, 3, 4]) {
    const generator = { type: 'waveform' as const };
    const partials = generatePartialSpectrum(generator, 'sine');
    const oscillator = preparePartialOscillator(generator, 'sine');
    const envelope = { attack: 0.01, decay: 0.02, sustain: 0.4, release: 0.05 };
    const native = Float32Array.from({ length: frames }, (_, frame) => {
      if (frame < startFrame) return 0;
      const t = (frame - startFrame) / sampleRate;
      let sample = 0;
      for (let voice = 0; voice < count; voice++) {
        const detune = count === 1 ? 0 : (voice / (count - 1) - 0.5) * 20;
        const frequency = 440 * 2 ** (detune / 1200);
        sample += oscillator(t * frequency - voice / count * 2, frequency, sampleRate) * nativeUnisonGain(count);
      }
      return sample * sampleAmplitudeEnvelope(t, duration, envelope) * 0.7;
    });
    const browser = await renderOfflineAudio(context => {
      const synth = new Tone.Synth({ oscillator: { type: count > 1 ? 'fatcustom' : 'custom',
        partials, count, spread: 20, volume: Tone.gainToDb(getPartialSpectrumGain(partials)) } as Tone.SynthOptions['oscillator'],
      envelope: { ...envelope, attackCurve: 'exponential', decayCurve: 'exponential', releaseCurve: 'exponential' } });
      synth.connect(context.destination).triggerAttackRelease(220, duration, startFrame / sampleRate, 0.7);
    }, frames / sampleRate, 1, sampleRate);
    let peakError = 0;
    for (let frame = 0; frame < frames; frame++) peakError = Math.max(peakError, Math.abs(native[frame] - browser.getChannelData(0)[frame]));
    if (peakError > 3e-4) throw new Error(`Native ${count}-voice synthesis differs: ${peakError}`);
    results.push({ kind: 'synthesis', count, peakError });
  }
  return results;
}

/** Compare native DSP with the actual browser nodes using an identical stereo source. */
export async function runNativeEffectChecks() {
  return [...await compareNativeEffects('impulse'), ...await compareNativeEffects('tone')];
}

async function compareNativeEffects(signal: 'impulse' | 'tone') {
  const sampleRate = 48000;
  const bpm = 120;
  const frames = 24000;
  const sources = [0, 1].map(channel => Float32Array.from({ length: frames }, (_, frame) =>
    signal === 'impulse' ? (frame === 256 ? 0.1 : 0)
      : frame >= 256 && frame < 6000 ? 0.1 * Math.sin(2 * Math.PI * (330 + channel * 110) * (frame - 256) / sampleRate) : 0));
  const cases: Array<Partial<PresetTrackData>> = [
    { vibratoEnabled: true },
    { tremoloEnabled: true, tremoloSpread: 180 },
    { tremoloEnabled: true, tremoloSpread: 0 },
    { chorusEnabled: true, chorusFeedback: 0 },
    { chorusEnabled: true, chorusFeedback: 0.4 },
    { flangerEnabled: true, flangerFeedback: 0 },
    { flangerEnabled: true },
    // Feedback traversal in Web Audio can shift the forward phaser path by a quantum.
    // Test its deterministic cascade here; native feedback has separate regression coverage.
    { phaserEnabled: true, phaserFeedback: 0 },
    { echoEnabled: true, echoFeedback: 0, echoPingPong: false },
    { echoEnabled: true, echoFeedback: 0.4, echoPingPong: false },
    { echoEnabled: true, echoFeedback: 0, echoPingPong: true },
    { echoEnabled: true, echoFeedback: 0.4, echoPingPong: true },
  ];
  const results = [];
  for (const settings of cases) {
    const track = normalizePresetTrackData(settings);
    const native = sources.map(source => source.slice());
    applyNativeTrackEffects(native[0], native[1], track, sampleRate, bpm, 440);
    applyNativeEcho(native[0], native[1], track, sampleRate, 0.02);
    const rendered = await renderOfflineAudio(context => {
      const raw = context.createBuffer(2, frames, sampleRate);
      sources.forEach((source, channel) => raw.getChannelData(channel).set(source));
      const player = new Tone.Player(raw);
      const wet = (db: number) => db <= -96 ? 0 : 10 ** (db / 20);
      const effects: Tone.ToneAudioNode[] = [];
      if (track.vibratoEnabled) effects.push(new Tone.Vibrato({ frequency: track.vibratoFrequency, depth: track.vibratoDepth, wet: 1 }));
      if (track.tremoloEnabled) effects.push(new Tone.Tremolo({ frequency: track.tremoloFrequency, depth: track.tremoloDepth, spread: track.tremoloSpread, wet: 1 }).start(0));
      if (track.chorusEnabled) effects.push(new Tone.Chorus({ frequency: getLfoSyncRateHz(track.chorusRate, bpm),
        delayTime: track.chorusDelay, depth: track.chorusDepth, spread: track.chorusSpread,
        feedback: track.chorusFeedback, wet: wet(track.chorusWet) }).start(0));
      if (track.flangerEnabled) {
        const effect = new Tone.FeedbackDelay({ maxDelay: 0.04, feedback: track.flangerFeedback, wet: wet(track.flangerWet) });
        const base = track.flangerDelay / 1000;
        new Tone.LFO({ frequency: getLfoSyncRateHz(track.flangerRate, bpm),
          min: Math.max(0.00005, base * (1 - track.flangerDepth)), max: Math.min(0.04, base * (1 + track.flangerDepth)) })
          .connect(effect.delayTime).start(0);
        effects.push(effect);
      }
      if (track.phaserEnabled) {
        const effect = new Phaser({ stages: track.phaserStages, centerFrequency: 440 * 2 ** ((track.phaserCenter - 69) / 12) });
        effect.apply({ frequency: getLfoSyncRateHz(track.phaserRate, bpm), sweepOctaves: track.phaserDepth / 100 * PHASER_MAX_SWEEP_OCTAVES,
          Q: track.phaserQ, feedback: track.phaserFeedback, wet: wet(track.phaserWet) });
        effects.push(effect);
      }
      if (track.echoEnabled) effects.push(new (track.echoPingPong ? Tone.PingPongDelay : Tone.FeedbackDelay)({
        delayTime: 0.02, feedback: track.echoFeedback, wet: wet(track.echoWet), maxDelay: 1 }));
      Tone.connectSeries(player, ...effects, context.destination);
      player.start(0);
    }, frames / sampleRate, 2, sampleRate);
    let peakError = 0;
    let squareError = 0;
    for (let channel = 0; channel < 2; channel++) {
      const browser = rendered.getChannelData(channel);
      for (let frame = 0; frame < frames; frame++) {
        const error = native[channel][frame] - browser[frame];
        peakError = Math.max(peakError, Math.abs(error));
        squareError += error * error;
      }
    }
    if (peakError > 3e-4) throw new Error(`Native ${signal} effect differs: ${JSON.stringify(settings)}, peak error ${peakError}`);
    results.push({ signal, settings, peakError, rmsError: Math.sqrt(squareError / (frames * 2)) });
  }
  for (const rolloff of [-12, -24, -48, -96]) {
    const [filter] = createStereoFilter({ filterEnabled: true, filterType: 'lowpass', filterQ: 1, filterGain: 0, filterRolloff: rolloff }, sampleRate);
    const native = Float32Array.from(sources[0], sample => filter(sample, 1000));
    const browser = await renderOfflineAudio(context => {
      const raw = context.createBuffer(1, frames, sampleRate);
      raw.getChannelData(0).set(sources[0]);
      new Tone.Player(raw).chain(new Tone.Filter({ frequency: 1000, type: 'lowpass', Q: 1, rolloff: rolloff as -12 }), context.destination).start(0);
    }, frames / sampleRate, 1, sampleRate);
    let peakError = 0;
    for (let frame = 0; frame < frames; frame++) peakError = Math.max(peakError, Math.abs(native[frame] - browser.getChannelData(0)[frame]));
    if (peakError > 2e-6) throw new Error(`Native filter rolloff ${rolloff} differs: ${peakError}`);
    results.push({ signal, settings: { filterRolloff: rolloff }, peakError, rmsError: 0 });
  }
  const impulses = createPinkNoiseImpulseChannels(0.1, 0.02, sampleRate);
  const nativeReverb = sources.map((source, channel) => {
    const result = new Float32Array(frames);
    convolveInto(source, impulses[channel], result);
    return result;
  });
  const browserReverb = await renderOfflineAudio(context => {
    const raw = context.createBuffer(2, frames, sampleRate);
    const impulse = context.createBuffer(2, impulses[0].length, sampleRate);
    sources.forEach((source, channel) => raw.getChannelData(channel).set(source));
    impulses.forEach((source, channel) => impulse.getChannelData(channel).set(source));
    const convolver = new Tone.Convolver({ normalize: false });
    convolver.buffer = new Tone.ToneAudioBuffer(impulse);
    new Tone.Player(raw).chain(convolver, context.destination).start(0);
  }, frames / sampleRate, 2, sampleRate);
  let peakError = 0;
  for (let channel = 0; channel < 2; channel++) for (let frame = 0; frame < frames; frame++) {
    peakError = Math.max(peakError, Math.abs(nativeReverb[channel][frame] - browserReverb.getChannelData(channel)[frame]));
  }
  if (peakError > 2e-6) throw new Error(`Native reverb differs: ${peakError}`);
  results.push({ signal, settings: { reverbWet: 0 }, peakError, rmsError: 0 });
  return results;
}
