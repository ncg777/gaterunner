import assert from 'node:assert/strict';
import test from 'node:test';
import { configureRealtimeScheduling } from '../audio/realtimeScheduling';

test('realtime polling stays independent of Tone lookahead and avoids restarting the ticker on edits', () => {
  let lookAhead = 0.1;
  let interval = 0.05;
  let tickerUpdates = 0;
  const context = {
    isOffline: false,
    get lookAhead() { return lookAhead; },
    set lookAhead(value: number) { lookAhead = value; this.updateInterval = value / 2; },
    get updateInterval() { return interval; },
    set updateInterval(value: number) { interval = value; tickerUpdates++; },
  };
  configureRealtimeScheduling(context);
  assert.equal(context.lookAhead, 0.4);
  assert.equal(context.updateInterval, 0.01);
  const updates = tickerUpdates;
  configureRealtimeScheduling(context);
  assert.equal(tickerUpdates, updates);
  context.updateInterval = 0.2;
  configureRealtimeScheduling(context);
  assert.equal(context.updateInterval, 0.01);
});

test('offline clock timing is untouched', () => {
  const context = { isOffline: true, lookAhead: 0, updateInterval: 128 / 48000 };
  configureRealtimeScheduling(context);
  assert.deepEqual(context, { isOffline: true, lookAhead: 0, updateInterval: 128 / 48000 });
});
