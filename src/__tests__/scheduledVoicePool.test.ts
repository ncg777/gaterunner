import assert from 'node:assert/strict';
import test from 'node:test';
import { getScheduledVoiceCount } from '../audio/voicePool';

test('sparse developed scores do not reserve voices for thousands of silent steps', () => {
  const events = Array.from({ length: 60 }, (_, i) => ({ time: i * 8, duration: 4, notes: [60, 64, 67] }));
  assert.equal(getScheduledVoiceCount(events, 3, 2, 0.4), 3);
});

test('score pools include overlapping releases, per-note locks and scheduling headroom', () => {
  const events = [0, 1, 2].map(time => ({ time, duration: 0.2, notes: [60, 64], locks: { release: 2 } }));
  assert.equal(getScheduledVoiceCount(events, 2, 0, 0.4), 6);
  assert.equal(getScheduledVoiceCount(events, 2, 0, 0, 4), 4);
  assert.equal(getScheduledVoiceCount([], 16, 0, 0.4), 16);
});