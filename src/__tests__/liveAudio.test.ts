import assert from 'node:assert/strict';
import test from 'node:test';
import { beginLiveScheduling, readLiveScheduling, resetLiveScheduling, readLiveBuffering, stopLiveDiagnostics } from '../audio/liveAudio';

test('live counters distinguish early and late scheduling and reset per context', () => {
  const context = { isOffline: false, currentTime: 1 };
  beginLiveScheduling(context, 1.4)();
  beginLiveScheduling(context, 0.9)();
  const stats = readLiveScheduling(context);
  assert.equal(stats.callbacks, 2); assert.equal(stats.late, 1);
  assert.ok(Math.abs(stats.worstLateMs - 100) < 1e-8);
  stats.late = 99;
  assert.equal(readLiveScheduling(context).late, 1);
  resetLiveScheduling(context);
  assert.equal(readLiveScheduling(context).callbacks, 0);
  stopLiveDiagnostics(context);
});
test('offline export never contributes to live counters', () => {
  const context = { isOffline: true, currentTime: 10 };
  beginLiveScheduling(context, 1)();
  assert.equal(readLiveScheduling(context).callbacks, 0);
});
test('missing storage defaults safely to interactive buffering', () => {
  assert.equal(readLiveBuffering(), 'interactive');
});
