import assert from 'node:assert/strict';
import test from 'node:test';
import ToneMidi from '@tonejs/midi';
import { createWaveshaperProcessor, lookupTransferCurve, TANH_CURVE } from '../src/audio/trackDistortion.js';
import { normalizeWaveshaperSettings } from '../src/audio/waveshaper.js';
import { getTrackFadeGain } from '../src/audio/trackFade.js';
import { normalizeDrumLanes } from '../src/domain/rhythmTrack.js';
import { renderDrumHitIntoBuffers } from './drumWav.js';
import { generateMidi, renderWavChannels, type GenerateTrackOptions } from './generate.js';

const source: GenerateTrackOptions = {
  sequence: '1', waveform: 'sine', denominator: 4,
  attack: 0, decay: 0, sustain: 1, release: 0,
  reverbWet: -96, echoEnabled: false, filterEnabled: false,
};

test('CLI always applies native-table tanh with limiter drive even when waveshaping is disabled', async () => {
  const clean = await renderWavChannels({ bpm: 240, tracks: [{ ...source, limiterGain: 0 }] });
  const driven = await renderWavChannels({ bpm: 240, tracks: [{ ...source, limiterGain: 72 }] });
  assert.notDeepEqual(driven.left, clean.left);
  let peak = 0;
  for (const sample of driven.left) peak = Math.max(peak, Math.abs(sample));
  assert.equal(peak, TANH_CURVE[TANH_CURVE.length - 1]);
  assert.ok(peak < 0.762);
});

const shaped = normalizeWaveshaperSettings({ enabled: true, curve: 'custom', expression: 'sin(9*x)+x*x', dcBlock: false });
const gain = (decibels: number) => Math.pow(10, decibels / 20);
const tanh = (sample: number) => Math.fround(lookupTransferCurve(TANH_CURVE, Math.fround(sample)));

function recoverSource(sample: number): number {
  let lower = 0;
  let upper = TANH_CURVE.length - 1;
  while (upper - lower > 1) {
    const middle = Math.floor((lower + upper) / 2);
    if (TANH_CURVE[middle] <= sample) lower = middle;
    else upper = middle;
  }
  const position = lower + (sample - TANH_CURVE[lower]) / (TANH_CURVE[upper] - TANH_CURVE[lower]);
  return position / (TANH_CURVE.length - 1) * 2 - 1;
}

function assertSamples(actual: ArrayLike<number>, expected: ArrayLike<number>, tolerance = 1e-6): void {
  assert.equal(actual.length, expected.length);
  let maximumError = 0;
  for (let frame = 0; frame < actual.length; frame += 1) {
    assert.ok(Number.isFinite(actual[frame]), `Nonfinite sample at ${frame}`);
    maximumError = Math.max(maximumError, Math.abs(actual[frame] - expected[frame]));
  }
  assert.ok(maximumError <= tolerance, `Maximum sample error ${maximumError} exceeds ${tolerance}`);
}

function referenceLowpass(sampleRate: number): (sample: number, frequency: number) => number {
  const inputs = [0, 0];
  const outputs = [0, 0];
  return (sample, frequency) => {
    const omega = 2 * Math.PI * frequency / sampleRate;
    const cosine = Math.cos(omega);
    const alpha = Math.sin(omega) / 2;
    const output = ((1 - cosine) / 2 * (sample + 2 * inputs[0] + inputs[1])
      + 2 * cosine * outputs[0] - (1 - alpha) * outputs[1]) / (1 + alpha);
    inputs[1] = inputs[0];
    inputs[0] = sample;
    outputs[1] = outputs[0];
    outputs[0] = output;
    return output;
  };
}

for (const filterType of ['lowpass', 'highpass', 'bandpass', 'notch', 'peaking', 'lowshelf', 'highshelf', 'allpass'] as const) {
  test(`short-note high-cutoff ${filterType} remains finite through the downstream tail`, async () => {
    for (const [filterQ, filterGain] of [[1, 0], [0.0001, -48], [30, 48]]) {
      const result = await renderWavChannels({ bpm: 240, tracks: [{ ...source, denominator: 64,
        lengthFactor: 1, filterEnabled: true, filterFrequency: 127, filterType, filterQ, filterGain }] });
      const noteFrames = Math.ceil(result.sampleRate * (60 / 240) / 64);
      assert.ok(result.left.length > noteFrames + 154);
      for (const channel of [result.left, result.right]) {
        let peak = 0;
        for (let frame = 0; frame < channel.length; frame += 1) {
          assert.ok(Number.isFinite(channel[frame]), `${filterType}, Q=${filterQ}, gain=${filterGain}, frame=${frame}`);
          peak = Math.max(peak, Math.abs(channel[frame]));
        }
        assert.ok(peak > 0 && peak < 1000, `Unexpected peak ${peak}`);
        assert.ok(channel.subarray(-100).every(sample => Math.abs(sample) < 0.01), 'Tail must decay');
      }
    }
  });
}

test('overlapping voices are summed before waveshaping, drive and output gain', async () => {
  const first = await renderWavChannels({ bpm: 240, tracks: [source] });
  const second = await renderWavChannels({ bpm: 240, tracks: [{ ...source, sequence: '2' }] });
  const together = await renderWavChannels({ bpm: 240, tracks: [{ ...source, sequence: '3',
    velocityMultiplier: Math.SQRT2, limiterGain: 12, gain: -9, waveshaper: shaped }] });
  const shape = createWaveshaperProcessor(shaped, first.sampleRate);
  const expected = Float32Array.from(first.left, (sample, frame) =>
    tanh(shape(Math.fround(recoverSource(sample) + recoverSource(second.left[frame]))) * gain(12)) * gain(-9));
  assertSamples(together.left, expected);
  const separate = await renderWavChannels({ bpm: 240, tracks: [source, { ...source, sequence: '2' }]
    .map(track => ({ ...track, limiterGain: 12, gain: -9, waveshaper: shaped })) });
  assert.ok(together.left.some((sample, frame) => Math.abs(sample - separate.left[frame]) > 0.01));
});

test('track gain scales the shaped sum including breath without changing its drive', async () => {
  const track = { ...source, breathEnabled: true, breathLevel: 0, waveshaper: shaped, limiterGain: 12 };
  const unity = await renderWavChannels({ bpm: 240, tracks: [track] });
  const quieter = await renderWavChannels({ bpm: 240, tracks: [{ ...track, gain: -12 }] });
  assertSamples(quieter.left, Float32Array.from(unity.left, sample => sample * gain(-12)));
  const oscillator = await renderWavChannels({ bpm: 240, tracks: [source] });
  const breath = await renderWavChannels({ bpm: 240, tracks: [{ ...source,
    breathEnabled: true, breathLevel: 0, velocityMultiplier: 0 }] });
  assert.ok(breath.left.some(sample => Math.abs(sample) > 0.0001));
  const shape = createWaveshaperProcessor(shaped, unity.sampleRate);
  assertSamples(unity.left, Float32Array.from(oscillator.left, (sample, frame) =>
    tanh(shape(Math.fround(recoverSource(sample) + recoverSource(breath.left[frame]))) * gain(12))));
});

test('stereo waveshaper state is independent and processes silent tails', async () => {
  const track = { ...source, unisonVoices: 3, unisonDetune: 70 };
  const clean = await renderWavChannels({ bpm: 240, tracks: [track] });
  const settings = normalizeWaveshaperSettings({ enabled: true, curve: 'gaussian', dcBlock: true });
  const result = await renderWavChannels({ bpm: 240, tracks: [{ ...track, waveshaper: settings }] });
  for (const channel of ['left', 'right'] as const) {
    const shape = createWaveshaperProcessor(settings, result.sampleRate);
    assertSamples(result[channel], Float32Array.from(clean[channel], sample => tanh(shape(recoverSource(sample)))), 2e-6);
  }
  assert.ok(result.left[4000] !== 0);
  const biased = await renderWavChannels({ bpm: 240, tracks: [{ ...source,
    waveshaper: normalizeWaveshaperSettings({ enabled: true, curve: 'gaussian', dcBlock: false }) }] });
  assert.equal(biased.left[biased.left.length - 1], TANH_CURVE[1023]);
});

test('limiter bounds, defaults, invalid curves and zero mix have deterministic finite bypass', async () => {
  const render = (track: GenerateTrackOptions) => renderWavChannels({ bpm: 240, tracks: [{ ...source, ...track }] });
  const normal = await render({});
  for (const track of [
    { limiterGain: Number.NaN },
    { waveshaper: normalizeWaveshaperSettings({ enabled: true, curve: 'custom', expression: '1/0' }) },
    { waveshaper: normalizeWaveshaperSettings({ enabled: true, mix: 0, inputDriveDb: 36 }) },
  ]) assert.deepEqual((await render(track)).left, normal.left);
  assert.deepEqual((await render({ limiterGain: -1000 })).left, (await render({ limiterGain: -48 })).left);
  assert.deepEqual((await render({ limiterGain: 1000 })).left, (await render({ limiterGain: 72 })).left);
  const stereo = await render({ waveshaper: normalizeWaveshaperSettings({ enabled: true, dcBlock: true }) });
  assert.deepEqual(stereo.left, stereo.right);
});

test('melodic tremolo, echo, stereo filter and fade follow track distortion', async () => {
  const track = { ...source, sequence: '1 2', unisonVoices: 3, unisonDetune: 70, limiterGain: 18, waveshaper: shaped };
  const clean = await renderWavChannels({ bpm: 240, tracks: [track] });
  const result = await renderWavChannels({ bpm: 240, tracks: [{ ...track,
    tremoloEnabled: true, tremoloDepth: 0.6, tremoloFrequency: 7,
    echoEnabled: true, echoDelay: 0.01, echoWet: -6, echoFeedback: 0.4, echoPingPong: true,
    filterEnabled: true, filterFrequency: 55, filterQ: 1, fadeIn: 0.05, fadeOut: 0.025,
  }] });
  const expectedLeft = Float32Array.from(clean.left, (sample, frame) => sample * (1 - 0.6 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 7 * frame / clean.sampleRate))));
  const expectedRight = Float32Array.from(clean.right, (sample, frame) => sample * (1 - 0.6 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 7 * frame / clean.sampleRate))));
  const delay = Math.round(0.01 * clean.sampleRate);
  for (let frame = delay; frame < expectedLeft.length; frame += 1) {
    expectedLeft[frame] += expectedRight[frame - delay] * 0.4 * gain(-6);
    expectedRight[frame] += expectedLeft[frame - delay] * 0.4 * gain(-6);
  }
  for (const [actual, expected] of [[result.left, expectedLeft], [result.right, expectedRight]]) {
    const filter = referenceLowpass(clean.sampleRate);
    const frequency = 440 * Math.pow(2, (55 - 69) / 12);
    for (let frame = 0; frame < expected.length; frame += 1) {
      expected[frame] = filter(expected[frame], frequency) * getTrackFadeGain(frame / clean.sampleRate, 0.125, 0.05, 0.025);
    }
    assertSamples(actual, expected);
  }
});

test('track filter uses the latest event elapsed time with stable same-time ordering', async () => {
  for (const collide of [false, true]) {
    const track = { ...source, sequence: '1 2', lengthFactor: 200, limiterGain: 18,
      timeWarpEnabled: collide, timeWarpCurve: 'custom', timeWarpExpression: '0', timeWarpNoteLengths: false };
    const clean = await renderWavChannels({ bpm: 240, tracks: [track] });
    const result = await renderWavChannels({ bpm: 240, tracks: [{ ...track,
      filterEnabled: true, filterFrequency: 45, filterQ: 1, filterKeyFollow: 100,
      filterEnvelopeAttack: 0.03, filterEnvelopeDecay: 0.04, filterEnvelopeSustain: 0.25,
      filterEnvelopeRelease: 0.1, filterEnvelopeAmount: 12,
    }] });
    const midi = new ToneMidi.Midi(await generateMidi({ bpm: 240, tracks: [track] }));
    const notes = midi.tracks[0].notes;
    const filter = referenceLowpass(clean.sampleRate);
    const expected = new Float32Array(clean.left.length);
    for (let frame = 0; frame < expected.length; frame += 1) {
      const time = frame / clean.sampleRate;
      const event = notes.filter(note => note.time <= time).at(-1)!;
      const elapsed = time - event.time;
      const held = Math.min(elapsed, event.duration);
      let envelope = held < 0.03 ? held / 0.03 : held < 0.07 ? 1 - (held - 0.03) / 0.04 * 0.75 : 0.25;
      if (elapsed > event.duration) envelope *= Math.max(0, 1 - (elapsed - event.duration) / 0.1);
      const pitch = Math.max(0, Math.min(127, 45 + event.midi - 69 + 12 * envelope));
      expected[frame] = filter(clean.left[frame], 440 * Math.pow(2, (pitch - 69) / 12));
    }
    assertSamples(result.left, expected);
  }
});

for (const echoFeedback of [0, 0.5]) {
for (const echoWet of [-12, -6, 0]) {
test(`drum returns apply wet=${echoWet} once with feedback=${echoFeedback} and preserve reverb sends`, async () => {
  const lanes = normalizeDrumLanes([
    { voiceId: 'kick', xorGroup: 0, parameters: { tune: 55, decay: 0.04, echoSend: -6, reverbSend: -3 } },
    { voiceId: 'snare', xorGroup: 0, parameters: { decay: 0.03, noiseDecay: 0.04, echoSend: -12, reverbSend: -9 } },
  ]);
  const track: GenerateTrackOptions = { ...source, trackKind: 'rhythmic', drumLanes: lanes, sequence: '3',
    limiterGain: 18, gain: -6, waveshaper: shaped, echoEnabled: true, echoDelay: 0.01,
    echoFeedback, echoWet, echoPingPong: true, reverbWet: -8, fadeIn: 0.02 };
  const result = await renderWavChannels({ bpm: 240, tracks: [track], reverb: { enabled: true, decay: 0.1, wet: 0 } });
  const raw = new Float32Array(result.left.length);
  const rawRight = new Float32Array(raw.length);
  const echo = new Float32Array(raw.length);
  const reverb = new Float32Array(raw.length);
  for (const lane of lanes) {
    renderDrumHitIntoBuffers({ left: raw, right: rawRight, startFrame: 0, sampleRate: result.sampleRate,
      duration: 0.0625, velocity: 1, voiceId: lane.voiceId, parameters: lane.parameters,
      onSample: (frame, sample) => {
        echo[frame] += sample * gain(lane.parameters.echoSend as number);
        reverb[frame] += sample * gain(lane.parameters.reverbSend as number);
      } });
  }
  const delay = Math.round(0.01 * result.sampleRate);
  for (let frame = delay; frame < raw.length; frame += 1) {
    let returned = 0;
    for (let tap = 1; tap * delay <= frame; tap += 1) {
      returned += echo[frame - tap * delay] * Math.pow(echoFeedback, tap - 1);
    }
    raw[frame] += returned * gain(echoWet);
  }
  const shape = createWaveshaperProcessor(shaped, result.sampleRate);
  const expected = Float32Array.from(raw, (sample, frame) =>
    Math.fround(tanh(shape(sample) * gain(18)) * gain(-6)) * getTrackFadeGain(frame / result.sampleRate, 0.0625, 0.02, 0));
  assertSamples(result.left, expected, 3e-6);
  assertSamples(result.right, expected, 3e-6);
  assertSamples(result.reverbLeft!, Float32Array.from(reverb, (sample, frame) =>
    sample * gain(-6) * getTrackFadeGain(frame / result.sampleRate, 0.0625, 0.02, 0) * gain(-8)));
  const unshaped = await renderWavChannels({ bpm: 240, tracks: [{ ...track, limiterGain: -48,
    waveshaper: normalizeWaveshaperSettings({}) }], reverb: { enabled: true, decay: 0.1, wet: 0 } });
  assert.deepEqual(result.reverbLeft, unshaped.reverbLeft);
  assert.ok(result.left.some((sample, frame) => Math.abs(sample - unshaped.left[frame]) > 0.01));
  const mutedSends = lanes.map(lane => ({ ...lane, parameters: { ...lane.parameters, echoSend: -96, reverbSend: -96 } }));
  const muted = await renderWavChannels({ bpm: 240, tracks: [{ ...track, drumLanes: mutedSends }] });
  const noEcho = await renderWavChannels({ bpm: 240, tracks: [{ ...track, drumLanes: mutedSends, echoEnabled: false }] });
  assert.deepEqual(muted.left, noEcho.left);
  assert.ok(muted.reverbLeft!.every(sample => sample === 0));
});
}
}

test('drum send hooks receive the same choked samples as the raw bus', () => {
  const left = new Float32Array(2000);
  const right = new Float32Array(2000);
  const send = new Float32Array(2000);
  renderDrumHitIntoBuffers({ left, right, startFrame: 0, sampleRate: 48000, duration: 0.1,
    velocity: 1, voiceId: 'kick', parameters: {}, chokeUntil: 0.01,
    onSample: (frame, sample) => { send[frame] += sample; } });
  assert.deepEqual(send, left);
  assert.deepEqual(left, right);
  assert.ok(left.some(sample => sample !== 0));
  assert.ok(left.subarray(Math.ceil((0.01 + 0.008) * 48000)).every(sample => sample === 0));
});

test('audio-only distortion options leave MIDI bytes unchanged', async () => {
  const plain = await generateMidi({ bpm: 240, tracks: [source] });
  const distorted = await generateMidi({ bpm: 240, tracks: [{ ...source, limiterGain: 72, waveshaper: shaped }] });
  assert.deepEqual(distorted, plain);
});