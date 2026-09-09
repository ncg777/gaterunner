import assert from 'node:assert/strict';
import test from 'node:test';
import { renderWavChannels, type GenerateOptions } from './generate.js';
import { iterateWavChannelRenders, renderWavChannelsInPool } from './renderPool.js';
import { normalizeWaveshaperSettings } from '../src/audio/waveshaper.js';

const options: GenerateOptions = {
  bpm: 180,
  tracks: Array.from({ length: 5 }, (_, index) => ({
    sequence: String(1 << index),
    denominator: 16,
    waveform: index % 2 === 0 ? 'pulse-25' : 'sine',
    fadeIn: 0.125,
    gain: -12 - index,
    reverbWet: -12 - index,
  })),
  reverb: { enabled: true, decay: 0.1, preDelay: 0, wet: -16 },
};

test('source workers render more tracks than workers in order without a serial fallback', async () => {
  const results = await renderWavChannelsInPool(options, 5, 2);
  assert.equal(results.length, 5);
  for (let index = 0; index < results.length; index += 1) {
    assert.deepEqual(results[index], await renderWavChannels(options, index));
  }
});

test('streamed pool can stop early and another export can complete', async () => {
  const iterator = iterateWavChannelRenders(options, 5, 2);
  const first = await iterator.next();
  assert.equal(first.done, false);
  await iterator.return(undefined);
  const results = await renderWavChannelsInPool(options, 2, 2);
  assert.equal(results.length, 2);
});

test('workers exactly match serial tracks with limiter drive, custom waveshaping and drum sends', async () => {
  const driven: GenerateOptions = {
    ...options,
    tracks: options.tracks!.map((track, index) => ({
      ...track,
      limiterGain: index * 12,
      unisonVoices: 3,
      unisonDetune: 45,
      breathEnabled: true,
      waveshaper: normalizeWaveshaperSettings({
        enabled: true, curve: index % 2 ? 'custom' : 'sine-fold',
        expression: 'sin(amount*x)+bias', dcBlock: true, inputDriveDb: index, mix: 73,
        customParameters: [
          { name: 'amount', value: 3 + index, min: 1, max: 12, step: 0.1 },
          { name: 'bias', value: 0.1, min: -1, max: 1, step: 0.01 },
        ],
      }),
    })),
  };
  driven.tracks!.push({
    trackKind: 'rhythmic', sequence: '3 1', denominator: 16, limiterGain: 24,
    waveshaper: normalizeWaveshaperSettings({ enabled: true, curve: 'full-rectifier' }),
    drumLanes: [
      { voiceId: 'kick', xorGroup: 0, parameters: { echoSend: -9, reverbSend: -6 } },
      { voiceId: 'snare', xorGroup: 0, parameters: { echoSend: -3, reverbSend: -12 } },
    ],
    echoEnabled: true, echoDelay: 0.02, echoWet: -6, reverbWet: -12, fadeOut: 0.125,
  });
  const results = await renderWavChannelsInPool(driven, driven.tracks!.length, 2);
  assert.equal(results.length, driven.tracks!.length);
  for (let index = 0; index < results.length; index += 1) {
    assert.deepEqual(results[index], await renderWavChannels(driven, index));
    assert.ok(results[index].left.every(Number.isFinite));
    assert.ok(results[index].right.every(Number.isFinite));
  }
});