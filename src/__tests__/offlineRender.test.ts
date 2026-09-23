import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

test('offline cancellation stops scheduling/native rendering and restores the live context', async suite => {
  const liveContext = {};
  let currentContext: unknown = liveContext;
  const contexts: OfflineContext[] = [];
  const constructorArgs: unknown[][] = [];
  class OfflineContext {
    currentTime = 0;
    disposed = false;
    nativeStarted = false;
    ticks: Array<() => void> = [];
    rawContext = {
      currentTime: 0,
      suspendTimes: [] as number[],
      suspend: async (when: number) => { this.rawContext.suspendTimes.push(when); },
      startRendering: () => {
        this.nativeStarted = true;
        return new Promise<never>(() => {});
      },
    };
    constructor(_channels: number, public duration: number) {
      constructorArgs.push([...arguments]);
      contexts.push(this);
    }
    on(_event: string, callback: () => void) { this.ticks.push(callback); }
    dispose() { this.disposed = true; this.ticks = []; }
    async render() {
      while (this.currentTime <= this.duration) {
        const previous = currentContext;
        currentContext = this;
        for (const callback of this.ticks) callback();
        currentContext = previous;
        this.currentTime += 1;
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      return this.rawContext.startRendering();
    }
  }
  const toneMock = mock.module('tone', {
    namedExports: {
      OfflineContext,
      getContext: () => currentContext,
      setContext: (context: unknown) => { currentContext = context; },
    },
  });
  try {
    const { renderOfflineAudio } = await import('../audio/offlineRender.js');
    await suite.test('pre-cancelled render does not allocate a context', async () => {
      await assert.rejects(renderOfflineAudio(() => {}, 2, 2, 48000, AbortSignal.abort()), { name: 'AbortError' });
      assert.equal(contexts.length, 0);
    });
    await suite.test('uses native automation only when cancel-and-hold is supported', async () => {
      const previousContext = Object.getOwnPropertyDescriptor(globalThis, 'OfflineAudioContext');
      const previousParam = Object.getOwnPropertyDescriptor(globalThis, 'AudioParam');
      class NativeContext {
        constructor(public channels: number, public length: number, public sampleRate: number) {}
      }
      class NativeParam { cancelAndHoldAtTime() {} }
      Object.defineProperty(globalThis, 'OfflineAudioContext', { configurable: true, value: NativeContext });
      Object.defineProperty(globalThis, 'AudioParam', { configurable: true, value: NativeParam });
      const failure = new Error('stop after setup');
      try {
        await assert.rejects(renderOfflineAudio(() => { throw failure; }, 0.123, 2, 48000), error => error === failure);
        assert.deepEqual(constructorArgs.at(-1), [new NativeContext(2, 0.123 * 48000, 48000)]);
        Object.defineProperty(globalThis, 'AudioParam', { configurable: true, value: class {} });
        await assert.rejects(renderOfflineAudio(() => { throw failure; }, 0.123, 2, 48000), error => error === failure);
        assert.deepEqual(constructorArgs.at(-1), [2, 0.123, 48000]);
        assert.equal(currentContext, liveContext);
      } finally {
        if (previousContext) Object.defineProperty(globalThis, 'OfflineAudioContext', previousContext);
        else Reflect.deleteProperty(globalThis, 'OfflineAudioContext');
        if (previousParam) Object.defineProperty(globalThis, 'AudioParam', previousParam);
        else Reflect.deleteProperty(globalThis, 'AudioParam');
      }
    });
    await suite.test('clock cancellation prevents the native render from starting', async () => {
      const controller = new AbortController();
      await assert.rejects(renderOfflineAudio(context => {
        context.on('tick', () => controller.abort());
      }, 2, 2, 48000, controller.signal), { name: 'AbortError' });
      assert.equal(contexts.at(-1)!.nativeStarted, false);
      assert.equal(contexts.at(-1)!.disposed, true);
      assert.equal(currentContext, liveContext);
    });
    await suite.test('native cancellation rejects promptly, suspends and disposes', async () => {
      const controller = new AbortController();
      const render = renderOfflineAudio(() => {}, 2, 2, 48000, controller.signal);
      const rejected = assert.rejects(render, { name: 'AbortError' });
      while (!contexts.at(-1)!.nativeStarted) await new Promise(resolve => setTimeout(resolve, 0));
      controller.abort();
      await rejected;
      assert.equal(contexts.at(-1)!.rawContext.suspendTimes.length, 1);
      assert.equal(contexts.at(-1)!.disposed, true);
      assert.equal(currentContext, liveContext);
    });
    await suite.test('cancellation during the final clock yield prevents native rendering', async () => {
      const controller = new AbortController();
      await assert.rejects(renderOfflineAudio(context => {
        context.on('tick', () => {
          if (context.currentTime === 2) setTimeout(() => controller.abort(), 0);
        });
      }, 2, 2, 48000, controller.signal), { name: 'AbortError' });
      assert.equal(contexts.at(-1)!.nativeStarted, false);
      assert.equal(contexts.at(-1)!.disposed, true);
      assert.equal(currentContext, liveContext);
    });
    await suite.test('cancellation while scheduling restores the live context', async () => {
      const controller = new AbortController();
      await assert.rejects(renderOfflineAudio(() => { controller.abort(); }, 2, 2, 48000, controller.signal), { name: 'AbortError' });
      assert.equal(contexts.at(-1)!.disposed, true);
      assert.equal(currentContext, liveContext);
    });
  } finally {
    toneMock.restore();
  }
});
