import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import type * as Tone from 'tone';

test('budgeted offline clock preserves every tick and restores context across yields and errors', async () => {
  const live = {};
  let current: unknown = live;
  const toneMock = mock.module('tone', { namedExports: {
    getContext: () => current,
    setContext: (value: unknown) => { current = value; },
  } });
  let wallTime = 0;
  const now = mock.method(performance, 'now', () => wallTime);
  try {
    const { prepareOfflineClock } = await import('../audio/offlineClock');
    const ticks: number[] = [];
    const clock = {
      _duration: 0.031, _currentTime: 0, sampleRate: 48000,
      async _renderClock(_asynchronous: boolean) {},
      emit(event: string) {
        assert.equal(event, 'tick');
        assert.equal(current, clock);
        ticks.push(this._currentTime);
        wallTime += 9;
      },
    };
    prepareOfflineClock(clock as unknown as Tone.OfflineContext);
    const rendering = clock._renderClock(true);
    // The first expensive tick has yielded without leaving the offline context global.
    assert.equal(current, live);
    assert.equal(ticks.length, 1);
    await rendering;
    const expected: number[] = [];
    let time = 0;
    while (clock._duration - time >= 0) { expected.push(time); time += 128 / clock.sampleRate; }
    assert.deepEqual(ticks, expected);
    assert.equal(clock._currentTime, time);
    assert.equal(current, live);

    clock._currentTime = 0;
    clock.emit = () => { throw new Error('tick cancelled'); };
    await assert.rejects(clock._renderClock(true), /tick cancelled/);
    assert.equal(current, live);

    const incompatible = { _renderClock: async () => {} };
    const original = incompatible._renderClock;
    prepareOfflineClock(incompatible as unknown as Tone.OfflineContext);
    assert.equal(incompatible._renderClock, original);
  } finally {
    now.mock.restore();
    toneMock.restore();
  }
});
