import assert from 'node:assert/strict';
import test from 'node:test';
import { createWavEncoder, encodeWavFromChannelsSync } from '../audio/wav.js';

test('streamed PCM chunks preserve headers, interleaving and deterministic dither state', () => {
  for (const channelCount of [1, 2, 3]) {
    for (const dither of [true, false]) {
      const channels = Array.from({ length: channelCount }, (_, channel) => Float32Array.from(
        { length: 513 }, (_, sample) => Math.sin(sample * 0.31 + channel) * 1.7,
      ));
      for (const sampleRate of [44100, 48000, 96000]) {
        const encoder = createWavEncoder(channelCount, 513, sampleRate, { dither });
        for (let frame = 0; frame < 513; frame += 127) {
          const chunk = channels.map(channel => channel.slice(frame, frame + 127));
          encoder.encodeFrames(chunk, 0, chunk[0].length);
        }
        assert.deepEqual(encoder.bytes, encodeWavFromChannelsSync(channels, sampleRate, { dither }));
      }
    }
  }
});
