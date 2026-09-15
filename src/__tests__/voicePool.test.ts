import assert from 'node:assert/strict';
import test from 'node:test';

import {
  claimVoices,
  getSynthVoiceCount,
  prewarmVoicePool,
  recycleReleasedVoices,
  retainVoicePool,
  type SoundingNote,
} from '../audio/voicePool.js';

test('allocates enough Tone voices for release tails between dense events', () => {
  assert.equal(getSynthVoiceCount(2, 5.28, 60 / (46 * 2)), 20);
  assert.equal(getSynthVoiceCount(2, 0.24, 60 / (46 * 4)), 4);
  assert.equal(getSynthVoiceCount(32), 32);
});

test('rebinds Tone garbage collection so pooled voices are retained', () => {
  let clearedTimer = -1;
  let scheduledCollector: (() => void) | null = null;
  let disposed = 0;
  const availableVoice = { dispose: () => { disposed += 1; } };
  const synth = {
    context: {
      clearInterval: (id: number) => { clearedTimer = id; },
      setInterval: (callback: () => void, _interval: number) => {
        scheduledCollector = callback;
        return 11;
      },
    },
    _voices: [availableVoice, { dispose() {} }],
    _availableVoices: [availableVoice],
    _averageActiveVoices: 0,
    activeVoices: 0,
    _gcTimeout: 7,
    _collectGarbage: () => { throw new Error('old collector should not run'); },
  };

  retainVoicePool(synth as never, 2);
  assert.equal(clearedTimer, 7);
  assert.equal(synth._gcTimeout, 11);
  assert.ok(scheduledCollector);
  (scheduledCollector as () => void)();
  assert.equal(disposed, 0);
  assert.equal(synth._voices.length, 2);
});

test('prewarms the requested pool without consuming already available voices', () => {
  const existingVoice = { dispose() {} };
  const voiceCount = getSynthVoiceCount(2, 5.28, 60 / (46 * 2));
  const synth = {
    _voices: [existingVoice],
    _availableVoices: [existingVoice],
    _getNextAvailableVoice() {
      const voice = { dispose() {} };
      this._voices.push(voice);
      return voice;
    },
  };

  prewarmVoicePool(synth as never, voiceCount);
  assert.equal(synth._voices.length, 20);
  assert.equal(synth._availableVoices.length, 20);
  assert.equal(new Set(synth._availableVoices).size, 20);
});

test('recycles released offline voices without duplicating available voices', () => {
  const availableVoice = { dispose() {} };
  const releasedVoice = { dispose() {} };
  const activeVoice = { dispose() {} };
  const synth = {
    _activeVoices: [
      { voice: releasedVoice, released: true },
      { voice: activeVoice, released: false },
      { voice: availableVoice, released: true },
    ],
    _availableVoices: [availableVoice],
  };

  assert.equal(recycleReleasedVoices(synth as never), 1);
  assert.deepEqual(synth._activeVoices, [{ voice: activeVoice, released: false }]);
  assert.deepEqual(synth._availableVoices, [availableVoice, releasedVoice]);
});

test('claims voices without stealing while the track stays inside its polyphony', () => {
  const sounding: SoundingNote[] = [];
  assert.deepEqual(claimVoices(sounding, [220, 330], 0, 1, 4), []);
  assert.deepEqual(claimVoices(sounding, [440], 0.5, 1.5, 4), []);
  assert.equal(sounding.length, 3);
});

test('retires notes that already ended instead of counting them as voices', () => {
  const sounding: SoundingNote[] = [];
  claimVoices(sounding, [220, 330], 0, 1, 2);
  assert.deepEqual(claimVoices(sounding, [440, 550], 1, 2, 2), []);
  assert.deepEqual(sounding.map((note) => note.frequency), [440, 550]);
});

test('steals the oldest sounding note instead of letting the new one be dropped', () => {
  const sounding: SoundingNote[] = [];
  claimVoices(sounding, [220, 330], 0, 4, 2);
  assert.deepEqual(claimVoices(sounding, [440], 1, 5, 2), [220]);
  assert.deepEqual(sounding.map((note) => note.frequency), [330, 440]);
});

test('leaves a restruck pitch for last so its queued release cannot cut the new voice', () => {
  const sounding: SoundingNote[] = [];
  claimVoices(sounding, [220, 330], 0, 4, 2);
  assert.deepEqual(claimVoices(sounding, [220], 1, 5, 2), [330]);
  assert.deepEqual(sounding.map((note) => note.frequency), [220, 220]);
});
