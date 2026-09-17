import assert from 'node:assert/strict';
import test from 'node:test';
import ToneMidi from '@tonejs/midi';
import { normalizePresetData, normalizePresetTrackData } from '../src/presets.js';
import { createPinkNoiseImpulseChannels } from '../src/audio/reverbImpulse.js';
import { getLfoFrequencyHz, createSkewLfoState, sampleLfoAtTime } from '../src/audio/lfo.js';
import { presetDataToGeneratorInput } from './cli.js';
import { generateMidi, generateWav, renderWavChannels, type GenerateTrackOptions } from './generate.js';
import { applyNativeEcho, applyNativeTrackEffects, normalizeNativeEffectSettings } from './nativeTrackEffects.js';
import { planNativeVoices } from './nativeVoices.js';
import { convolveInto } from './convolution.js';
import { getDefaultDrumParameters, DRUM_VOICE_IDS } from '../src/domain/rhythmTrack.js';
import { renderDrumHitIntoBuffers } from './drumWav.js';
import { sampleAmplitudeEnvelope, nativeUnisonGain } from './nativeEnvelope.js';
import { NativeEnvelopeAutomation, prepareNativeMonoEnvelopes } from './nativeEnvelopeAutomation.js';

const source: GenerateTrackOptions = { sequence: '1', denominator: 4, gain: -12,
  attack: 0, decay: 0, sustain: 1, release: 0.01, reverbWet: -96 };

test('amplitude envelopes retain browser smoothing, exponential curves and the held level on early release', () => {
  const envelope = { attack: 0, decay: 0, sustain: 1, release: 0 };
  assert.equal(sampleAmplitudeEnvelope(0, 0.002, envelope), 0);
  const held = sampleAmplitudeEnvelope(0.002, 0.002, envelope);
  assert.ok(held > 0.8 && held < 1);
  assert.ok(sampleAmplitudeEnvelope(0.0021, 0.002, envelope) < held);
  assert.equal(sampleAmplitudeEnvelope(0.007, 0.002, envelope), 0);
  assert.equal(sampleAmplitudeEnvelope(0.01, 0.02, envelope), 1);
});

test('mono legato cancels future ramps and releases while preserving an active target and the original velocity', () => {
  const track = normalizePresetTrackData({ attack: 0.04, decay: 0.05, sustain: 0.4, release: 0.05,
    pitchEnvelopeAttack: 0.04, pitchEnvelopeShape: 3 });
  const events = planNativeVoices([
    { time: 0, duration: 0.2, velocity: 0.7, notes: [60], order: 0 },
    { time: 0.03, duration: 0.05, velocity: 0.4, notes: [67], order: 1 },
  ], 1, true);
  const legato = prepareNativeMonoEnvelopes(events, track, 48000);
  assert.ok(legato.amplitude.sample(0.07) > legato.amplitude.sample(0.03));
  assert.ok(legato.amplitude.sample(0.07) < 0.701);
  assert.ok(legato.amplitude.sample(0.09) < legato.amplitude.sample(0.08));
  assert.equal(legato.amplitude.sample(0.2), 0);
  assert.equal(legato.pitch.sample(0.035), legato.pitch.sample(0.075));
  const retrigger = new NativeEnvelopeAutomation(track, 'amplitude');
  retrigger.attack(0, 0.7);
  const previous = retrigger.sample(0.03);
  retrigger.attack(0.03, 0.4);
  assert.ok(Math.abs(retrigger.sample(0.03) - previous) < 1e-6);
  assert.ok(retrigger.sample(0.07) < previous);
});

test('unison uses a mono bus, browser phase offsets and per-oscillator gain', async () => {
  const options: GenerateTrackOptions = { ...source, partialGenerator: { type: 'waveform' }, waveform: 'sine',
    limiterGain: -48, unisonDetune: 0 };
  const plain = await renderWavChannels({ bpm: 240, tracks: [options] });
  const pair = await renderWavChannels({ bpm: 240, tracks: [{ ...options, unisonVoices: 2 }] });
  assert.deepEqual(pair.left, pair.right);
  assertSamples(pair.left, Float32Array.from(plain.left, value => value * 2 * nativeUnisonGain(2)), 1e-7);
});

test('breath and noise percussion keep deterministic independent stereo channels and obey note velocity', async () => {
  const track: GenerateTrackOptions = { ...source, breathEnabled: true, breathLevel: 0,
    partialGenerator: { type: 'tonewheel' }, tonewheelDrawbars: Array(9).fill(0) };
  const breath = await renderWavChannels({ bpm: 240, tracks: [track] });
  assert.notDeepEqual(breath.left, breath.right);
  const silent = await renderWavChannels({ bpm: 240, tracks: [{ ...track, velocityMultiplier: 0 }] });
  // Tone's ramp-point floor leaves at most 1e-7 during a zero-velocity attack.
  assert.ok(silent.left.every(sample => Math.abs(sample) < 1e-7));
  const left = new Float32Array(12000), right = left.slice();
  renderDrumHitIntoBuffers({ left, right, sampleRate: 48000, startFrame: 0, velocity: 0.5, duration: 0.1,
    voiceId: 'snare', parameters: {} });
  assert.notDeepEqual(left, right);
});

test('a drum restrike replaces its pooled source and sends instead of stacking an old tail', () => {
  const left = new Float32Array(12000), right = left.slice(), send = left.slice();
  renderDrumHitIntoBuffers({ left, right, sampleRate: 48000, startFrame: 0, velocity: 1, duration: 0.2,
    voiceId: 'kick', parameters: {}, retriggerUntil: 0.05, onSample: (frame, sample) => { send[frame] += sample; } });
  assert.ok(left.subarray(2400).every(sample => sample === 0));
  assert.deepEqual(send, left);
});

function assertSamples(actual: ArrayLike<number>, expected: ArrayLike<number>, tolerance = 2e-6) {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < actual.length; index++) {
    assert.ok(Number.isFinite(actual[index]));
    assert.ok(Math.abs(actual[index] - expected[index]) <= tolerance, `Sample ${index}: ${actual[index]} vs ${expected[index]}`);
  }
}

test('preset conversion preserves every audio and timing field from the browser schema', () => {
  const data = normalizePresetData({ tracks: [{ sequenceInput: '3 1', phase: 0.75, chorusEnabled: true,
    flangerEnabled: true, phaserEnabled: true, filterLfoEnabled: true, filterRolloff: -96, tremoloSpread: 73 }] });
  const converted = presetDataToGeneratorInput(data).tracks[0];
  const { id: _id, sequenceInput, ...expected } = data.tracks[0];
  assert.deepEqual(converted, { ...expected, sequence: sequenceInput });
});

test('new effect settings share browser bounds, defaults and legacy phaser migration', () => {
  const raw = { phase: 8, filterRolloff: -36, chorusDelay: Number.NaN, phaserCenter: Number.NaN,
    phaserBaseFrequency: 1000, phaserOctaves: 3, phaserQ: -10, chorusSpread: 800 };
  const native = normalizeNativeEffectSettings(raw);
  const browser = normalizePresetTrackData(raw);
  for (const [key, value] of Object.entries(native)) assert.deepEqual(value, browser[key as keyof typeof browser]);
});

test('track phase delays MIDI, WAV and fades by a fraction of one quantization step', async () => {
  const options = { bpm: 240, tracks: [{ ...source, phase: 0.5 }], reverb: { enabled: false } };
  const midi = new ToneMidi.Midi(await generateMidi(options));
  assert.equal(midi.tracks[0].notes[0].time, 0.03125);
  const result = await renderWavChannels(options);
  assert.ok(result.left.subarray(0, 1500).every(sample => sample === 0));
  const plain = await renderWavChannels({ ...options, tracks: [source] });
  assertSamples(result.left.subarray(1500, 4000), plain.left.subarray(0, 2500));
});

test('stereo tremolo uses browser phase spread and a track-wide clock on melodic and drum buses', () => {
  const track = normalizePresetTrackData({ tremoloEnabled: true, tremoloDepth: 0.6, tremoloSpread: 180, tremoloFrequency: 5 });
  const left = new Float32Array(4800).fill(1);
  const right = left.slice();
  applyNativeTrackEffects(left, right, track, 48000, 120, 440);
  assert.equal(left[0], 0.5);
  assert.equal(right[0], 0.5);
  assert.ok(Math.abs(left[2400] - 0.2) < 1e-7);
  assert.ok(Math.abs(right[2400] - 0.8) < 1e-7);
});

test('filter LFO keeps moving during held notes and release for every waveform', async () => {
  for (const waveform of ['sine', 'triangle', 'square', 'saw-up', 'saw-down', 'sample-hold'] as const) {
    const track: GenerateTrackOptions = { ...source, sequence: '0 1', denominator: 1, release: 0.3,
      filterEnabled: true, filterFrequency: 69,
      filterLfoEnabled: true, filterLfoSync: false, filterLfoRateHz: 3, filterLfoAmount: 12,
      filterLfoInitPhase: 0.23, filterLfoWaveform: waveform };
    const offset = sampleLfoAtTime(createSkewLfoState(), 0.5, 3, waveform, 0.23) * 12;
    const modulated = await renderWavChannels({ bpm: 120, tracks: [track] });
    const fixed = await renderWavChannels({ bpm: 120, tracks: [{ ...track, filterLfoEnabled: false, filterFrequency: 69 + offset }] });
    const held = Math.floor(0.6 * modulated.sampleRate);
    const released = Math.floor(1.05 * modulated.sampleRate);
    assert.notDeepEqual(modulated.left.subarray(held, held + 4800), fixed.left.subarray(held, held + 4800), waveform);
    assert.notDeepEqual(modulated.left.subarray(released, released + 4800), fixed.left.subarray(released, released + 4800), `${waveform} release`);
    assert.ok(modulated.left.every(Number.isFinite));
    const zeroDepth = await renderWavChannels({ bpm: 120, tracks: [{ ...track, filterLfoAmount: 0 }] });
    const disabled = await renderWavChannels({ bpm: 120, tracks: [{ ...track, filterLfoEnabled: false }] });
    assertSamples(zeroDepth.left, disabled.left);
  }
});

test('chorus, flanger, phaser and vibrato process both kinds of track and leave MIDI unchanged', async () => {
  const cases: GenerateTrackOptions[] = [
    { chorusEnabled: true, chorusFeedback: 0.4 }, { flangerEnabled: true },
    { phaserEnabled: true }, { vibratoEnabled: true },
  ];
  for (const track of [source, { ...source, trackKind: 'rhythmic' as const }]) {
    const plain = await renderWavChannels({ bpm: 240, tracks: [track] });
    const midi = await generateMidi({ bpm: 240, tracks: [track] });
    for (const settings of cases) {
      const options = { bpm: 240, tracks: [{ ...track, ...settings }] };
      const result = await renderWavChannels(options);
      assert.ok(result.left.every(Number.isFinite));
      assert.notDeepEqual(result.left, plain.left);
      assert.deepEqual(await generateMidi(options), midi);
    }
  }
});

test('echo returns a first repeat with zero feedback and keeps feedback independent of wet mix', () => {
  const input = new Float32Array(2000);
  input[0] = 1;
  for (const pingPong of [false, true]) {
    const left = input.slice();
    const right = input.slice();
    applyNativeEcho(left, right, { echoEnabled: true, echoWet: 0, echoFeedback: 0, echoPingPong: pingPong }, 48000, 0.01);
    assert.equal(left[480], 1);
    assert.equal(right[pingPong ? 960 : 480], 1);
    assert.ok(Math.abs(left[0]) < 1e-15);
  }
  for (const echoWet of [-12, -6, 0]) {
    const left = new Float32Array(3000);
    const right = left.slice();
    left[256] = 1;
    applyNativeEcho(left, right, { echoEnabled: true, echoWet, echoFeedback: 0.4, echoPingPong: false }, 48000, 0.02);
    assert.ok(Math.abs(left[2304] / left[1216] - 0.4) < 1e-7);
  }
});

test('minimum chorus delays and maximum modulation bounds remain finite through feedback tails', () => {
  for (const settings of [
    { chorusEnabled: true, chorusDelay: 0.5, chorusDepth: 1, chorusFeedback: 0.95 },
    { flangerEnabled: true, flangerDelay: 0.1, flangerDepth: 1, flangerFeedback: 0.95 },
    { phaserEnabled: true, phaserStages: 12, phaserDepth: 100, phaserQ: 30, phaserFeedback: 0.95 },
  ]) {
    const track = normalizePresetTrackData(settings);
    const left = new Float32Array(48000);
    const right = left.slice();
    left[256] = 0.1;
    right[256] = -0.1;
    applyNativeTrackEffects(left, right, track, 48000, 499, 500);
    assert.ok(left.every(Number.isFinite));
    assert.ok(right.every(Number.isFinite));
  }
});

test('native convolution matches direct convolution across FFT blocks, tails and output cropping', () => {
  const input = Float32Array.from({ length: 1103 }, (_, index) => Math.sin(index * 3.2) / 10);
  const impulse = Float32Array.from({ length: 99 }, (_, index) => Math.cos(index * 1.7) / 10);
  for (const frames of [1, 1103, 1201, 1400]) {
    const actual = new Float32Array(frames).fill(0.125);
    convolveInto(input, impulse, actual, 0.3);
    const expected = new Float32Array(frames).fill(0.125);
    for (let frame = 0; frame < frames; frame++) {
      let sample = 0;
      for (let tap = 0; tap < impulse.length; tap++) if (frame >= tap && frame - tap < input.length) sample += input[frame - tap] * impulse[tap];
      expected[frame] += sample * 0.3;
    }
    assertSamples(actual, expected, 1e-7);
  }
});

test('shared reverb impulses retain pre-delay, stereo seeds and browser RMS calibration', () => {
  for (const sampleRate of [44100, 48000, 96000]) {
    const channels = createPinkNoiseImpulseChannels(0.1, 0.02, sampleRate);
    assert.equal(channels[0].length, Math.round(0.12 * sampleRate));
    assert.ok(channels[0].subarray(0, Math.round(0.02 * sampleRate)).every(sample => sample === 0));
    assert.notDeepEqual(channels[0], channels[1]);
    assert.deepEqual(channels, createPinkNoiseImpulseChannels(0.1, 0.02, sampleRate));
    const power = channels.reduce((sum, channel) => sum + channel.reduce((total, sample) => total + sample * sample, 0), 0);
    assert.ok(Math.abs(Math.sqrt(power / (2 * channels[0].length)) - 0.00125) < 1e-10);
  }
});

test('overlapping polyphonic notes steal the oldest held voice and mono legato keeps its envelope', () => {
  const events = [
    { time: 0, duration: 3, velocity: 0.7, notes: [60, 64], order: 0 },
    { time: 1, duration: 1, velocity: 0.4, notes: [67], order: 1 },
    { time: 3, duration: 1, velocity: 0.5, notes: [69], order: 2 },
  ];
  assert.deepEqual(planNativeVoices(events, 2, true)[0].noteDurations, [1, 3]);
  const mono = planNativeVoices(events, 1, true);
  assert.deepEqual(mono[0].notes, [64]);
  assert.equal(mono[0].stopTime, 1);
  assert.equal(mono[1].envelopeStart, 0);
  assert.equal(mono[1].envelopeVelocity, 0.7);
  assert.equal(mono[2].envelopeStart, 3);
  assert.equal(planNativeVoices(events, 1, false)[1].envelopeStart, 1);
});

test('overlapping melodic voices retain independent key-follow filters and envelopes', async () => {
  const track: GenerateTrackOptions = { ...source, sequence: '1 2', lengthFactor: 200, limiterGain: -48,
    filterEnabled: true, filterFrequency: 48, filterKeyFollow: 100, filterEnvelopeAmount: 24,
    filterEnvelopeAttack: 0.02, filterEnvelopeDecay: 0.05, filterEnvelopeSustain: 0.2 };
  const together = await renderWavChannels({ bpm: 240, tracks: [track] });
  const first = await renderWavChannels({ bpm: 240, tracks: [{ ...track, sequence: '1 0', lengthFactor: 0, lengthOffset: 2 }] });
  const second = await renderWavChannels({ bpm: 240, tracks: [{ ...track, sequence: '0 2', lengthFactor: 0, lengthOffset: 2 }] });
  assertSamples(together.left, Float32Array.from(first.left, (sample, frame) => sample + second.left[frame]), 2e-7);
});

test('phaser negative feedback has its own delay and preserves independent stereo state', () => {
  const render = (feedback: number) => {
    const left = new Float32Array(4800);
    const right = left.slice();
    left[256] = 0.1;
    right[256] = -0.1;
    const track = normalizePresetTrackData({ phaserEnabled: true, phaserFeedback: feedback });
    applyNativeTrackEffects(left, right, track, 48000, 120, 440);
    assertSamples(left, Float32Array.from(right, value => -value), 1e-7);
    return left;
  };
  const clean = render(0);
  const returned = render(0.3);
  assertSamples(returned.subarray(0, 385), clean.subarray(0, 385), 0);
  assert.notDeepEqual(returned.subarray(385), clean.subarray(385));
});

test('all GM drum voices render and their input drive and lane filters reach the audible bus', () => {
  for (const voiceId of DRUM_VOICE_IDS) {
    const render = (settings: Record<string, number | string>) => {
      const left = new Float32Array(12000);
      const right = left.slice();
      renderDrumHitIntoBuffers({ left, right, sampleRate: 48000, startFrame: 0, velocity: 0.6, duration: 0.1,
        voiceId, parameters: { ...getDefaultDrumParameters(voiceId), ...settings } });
      assert.ok(left.every(Number.isFinite));
      assert.ok(left.some(sample => Math.abs(sample) > 1e-5), voiceId);
      return left;
    };
    const plain = render({});
    assert.notDeepEqual(render({ distortionInputGain: 12 }), plain, voiceId);
    assert.notDeepEqual(render({ filterFrequency: 1000, filterType: 'lowpass', filterRolloff: -48 }), plain, voiceId);
  }
});

test('complete modulation chains export deterministic WAV through reusable workers', async () => {
  const track: GenerateTrackOptions = { ...source, sequence: '1 2', unisonVoices: 3, chorusEnabled: true,
    flangerEnabled: true, phaserEnabled: true, vibratoEnabled: true, tremoloEnabled: true,
    filterEnabled: true, filterLfoEnabled: true, filterRolloff: -48, echoEnabled: true, reverbWet: -18 };
  const options = { bpm: 240, tracks: [track, { ...track, trackKind: 'rhythmic' as const }],
    reverb: { enabled: true, decay: 0.1 } };
  const serial = await generateWav(options, { threads: 1 });
  assert.deepEqual(await generateWav(options, { threads: 2 }), serial);
});
