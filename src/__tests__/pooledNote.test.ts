import assert from 'node:assert/strict';
import test from 'node:test';
import type * as Tone from 'tone';
import { triggerPooledNote } from '../audio/pooledNote';

function fixture() {
  let now = 0;
  let drop = false;
  const releases: Array<{ id: number; time: number }> = [];
  const timers: Array<{ time: number; callback: () => void }> = [];
  let id = 0;
  const pool = {
    disposed: false,
    now: () => now,
    context: { setTimeout(callback: () => void, delay: number) {
      timers.push({ time: now + delay, callback });
      return timers.length;
    } },
    _activeVoices: [] as Array<{ voice: { triggerRelease(time: number): void }; released: boolean }>,
    _triggerAttack(notes: number[]) {
      for (const _note of notes) {
        if (drop) continue;
        const voiceId = ++id;
        this._activeVoices.push({ released: false, voice: {
          triggerRelease(time) { releases.push({ id: voiceId, time }); },
        } });
      }
    },
  };
  return {
    pool, releases,
    play: (start: number, duration: number, notes = [440]) =>
      triggerPooledNote(pool as unknown as Tone.PolySynth, notes, duration, start, 0.7),
    drop: () => { drop = true; },
    advance(time: number) {
      while (true) {
        timers.sort((a, b) => a.time - b.time);
        if (!timers.length || timers[0].time > time) break;
        const timer = timers.shift()!;
        now = timer.time;
        timer.callback();
      }
      now = time;
    },
  };
}

test('warped equal-pitch notes release their own voices in reversed duration order', () => {
  const f = fixture();
  f.play(0, 4);
  f.play(1, 0.25);
  f.advance(1.25);
  assert.deepEqual(f.releases, [{ id: 2, time: 1.25 }]);
  f.advance(4);
  assert.deepEqual(f.releases, [{ id: 2, time: 1.25 }, { id: 1, time: 4 }]);
});

test('stolen, recycled and dropped notes cannot release a subsequent voice', () => {
  const f = fixture();
  f.play(0, 4, [440, 660]);
  f.pool._activeVoices[0].released = true;
  f.pool._activeVoices.splice(1, 1);
  f.play(0, 5);
  f.drop();
  f.play(0, 1);
  f.advance(4);
  assert.deepEqual(f.releases, []);
  f.advance(5);
  assert.deepEqual(f.releases, [{ id: 3, time: 5 }]);
});

test('simultaneous attacks and very short releases preserve allocation order', () => {
  const f = fixture();
  f.play(0.123, 0.0005, [440, 660]);
  f.play(0.123, 0.25);
  f.advance(1);
  assert.deepEqual(f.releases, [
    { id: 1, time: 0.1235 }, { id: 2, time: 0.1235 }, { id: 3, time: 0.373 },
  ]);
});

test('disposing before attack or release prevents queued work', () => {
  const f = fixture();
  f.play(1, 1);
  f.pool.disposed = true;
  f.advance(3);
  assert.equal(f.pool._activeVoices.length, 0);
  assert.deepEqual(f.releases, []);
});
