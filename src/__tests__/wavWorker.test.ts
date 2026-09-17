import assert from 'node:assert/strict';
import test from 'node:test';
import { createWavEncoder, encodeWavFromChannelsSync, type WavEncoder } from '../audio/wav.js';
import { encodeWavInWorker } from '../audio/wavWorker.js';
import { WAV_WORKER_CHUNK_FRAMES, type WavEncodeRequest } from '../audio/wavWorkerProtocol.js';

test('worker encoding bounds transfers, preserves input, falls back and cleans up', async suite => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  const instances: FakeWorker[] = [];
  let failChunk = false;
  class FakeWorker {
    onmessage?: (event: { data: unknown }) => void;
    onerror?: (event: { message: string; preventDefault(): void }) => void;
    onmessageerror?: () => void;
    terminated = false;
    chunks: number[] = [];
    frames = 0;
    encoder?: WavEncoder;
    constructor() { instances.push(this); }
    terminate() { this.terminated = true; }
    postMessage(message: WavEncodeRequest, transfers: ArrayBuffer[] = []) {
      const data = structuredClone(message, { transfer: transfers });
      queueMicrotask(() => {
        if (this.terminated) return;
        if (data.type === 'init') {
          this.encoder = createWavEncoder(data.channels, data.frames, data.sampleRate, { dither: data.dither });
        } else {
          if (failChunk) {
            this.onerror?.({ message: 'Simulated worker failure', preventDefault() {} });
            return;
          }
          const size = data.channels[0].length;
          this.chunks.push(size);
          this.encoder!.encodeFrames(data.channels, 0, size);
          this.frames += size;
        }
        this.onmessage?.({ data: this.frames === this.encoder!.frameCount
          ? { type: 'complete', bytes: this.encoder!.bytes }
          : { type: 'ready', frames: this.frames } });
      });
    }
  }
  Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: FakeWorker });
  const channels = [Float32Array.from({ length: WAV_WORKER_CHUNK_FRAMES + 17 }, (_, index) => Math.sin(index))];
  const expected = encodeWavFromChannelsSync(channels, 48000);
  try {
    await suite.test('only one bounded chunk is transferred per acknowledgement', async () => {
      const progress: number[] = [];
      assert.deepEqual(await encodeWavInWorker(channels, 48000, { onProgress: value => progress.push(value) }), expected);
      assert.deepEqual(instances.at(-1)!.chunks, [WAV_WORKER_CHUNK_FRAMES, 17]);
      assert.equal(progress[0], 0);
      assert.equal(progress.at(-1), 1);
      assert.ok(instances.at(-1)!.terminated);
      assert.equal(channels[0][1], Math.fround(Math.sin(1)));
    });
    await suite.test('worker failure after transfer falls back using undetached source PCM', async () => {
      failChunk = true;
      assert.deepEqual(await encodeWavInWorker(channels, 48000), expected);
      assert.ok(instances.at(-1)!.terminated);
      failChunk = false;
    });
    await suite.test('caller progress errors are propagated without retrying encoding', async () => {
      const error = new Error('Progress callback');
      let calls = 0;
      await assert.rejects(encodeWavInWorker(channels, 48000, {
        onProgress: () => { calls += 1; throw error; },
      }), caught => caught === error);
      assert.equal(calls, 1);
      assert.ok(instances.at(-1)!.terminated);
    });
    await suite.test('unavailable workers use the existing asynchronous encoder', async () => {
      Object.defineProperty(globalThis, 'Worker', { configurable: true, value: undefined });
      assert.deepEqual(await encodeWavInWorker(channels, 48000), expected);
    });
    await suite.test('cancellation terminates a worker without starting fallback encoding', async () => {
      Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeWorker });
      const controller = new AbortController();
      let calls = 0;
      await assert.rejects(encodeWavInWorker(channels, 48000, {
        signal: controller.signal,
        onProgress: () => { calls += 1; controller.abort(); },
      }), { name: 'AbortError' });
      assert.equal(calls, 1);
      assert.deepEqual(instances.at(-1)!.chunks, []);
      assert.ok(instances.at(-1)!.terminated);
      assert.deepEqual(await encodeWavInWorker(channels, 48000), expected);
    });
    await suite.test('pre-cancelled exports do not create workers', async () => {
      const count = instances.length;
      await assert.rejects(encodeWavInWorker(channels, 48000, {
        signal: AbortSignal.abort(),
      }), { name: 'AbortError' });
      assert.equal(instances.length, count);
    });
    await suite.test('fallback encoding stops at the next chunk after cancellation', async () => {
      Object.defineProperty(globalThis, 'Worker', { configurable: true, value: undefined });
      const controller = new AbortController();
      let calls = 0;
      await assert.rejects(encodeWavInWorker([new Float32Array(262145)], 48000, {
        signal: controller.signal,
        onProgress: () => { calls += 1; controller.abort(); },
      }), { name: 'AbortError' });
      assert.equal(calls, 1);
    });
  } finally {
    if (original) Object.defineProperty(globalThis, 'Worker', original);
    else Reflect.deleteProperty(globalThis, 'Worker');
  }
});
