import assert from 'node:assert/strict';
import test from 'node:test';
import { hasVoiceActivity, type VoiceEvent } from '../audio/voiceActivity.js';

test('voice activity includes future reservations, sustained notes, releases and filter history', () => {
  const events: VoiceEvent[] = [];
  assert.equal(hasVoiceActivity(events, 0, 0.2), false);
  events.push({ type: 'attack', time: 1, mono: false });
  assert.equal(hasVoiceActivity(events, 0, 0.2), true);
  assert.equal(hasVoiceActivity(events, 10, 0.2), true);
  events.push({ type: 'release', time: 2, ampRelease: 0.3 });
  assert.equal(hasVoiceActivity(events, 2.25, 0.2), true);
  assert.equal(hasVoiceActivity(events, 2.4, 0.2), false);
  assert.equal(hasVoiceActivity(events, 2.4, 0.2, 0.2), true);
  events.push({ type: 'attack', time: 3, mono: false, stopTime: 3.1 });
  assert.equal(hasVoiceActivity(events, 2.8, 0.2), true);
  assert.equal(hasVoiceActivity(events, 3.2, 0.2), false);
});

test('retriggered and monophonic notes do not keep earlier attacks alive forever', () => {
  const events: VoiceEvent[] = [
    { type: 'attack', time: 0, mono: true },
    { type: 'attack', time: 0.2, mono: true },
    { type: 'release', time: 0.4 },
  ];
  assert.equal(hasVoiceActivity(events, 0.5, 0.2), true);
  assert.equal(hasVoiceActivity(events, 0.7, 0.2), false);
  assert.equal(hasVoiceActivity([], 0.7, 0.2), false, 'reset clears activity');
});
