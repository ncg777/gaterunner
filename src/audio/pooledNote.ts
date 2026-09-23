import type * as Tone from 'tone';

interface ActiveVoice {
  voice: { triggerRelease(time: number): unknown };
  released: boolean;
}

interface PooledSynth {
  disposed: boolean;
  now(): number;
  context: { setTimeout(callback: () => void, delay: number): number };
  _activeVoices: ActiveVoice[];
  _triggerAttack(notes: number[], time: number, velocity: number): void;
}

/** Release the voices allocated to this event, even when equal pitches overlap. */
export function triggerPooledNote(
  synth: Tone.PolySynth,
  notes: number[],
  duration: number,
  time: number,
  velocity: number,
): void {
  const pool = synth as unknown as PooledSynth;
  // Tone 15 adapter: retain the public path if its voice bookkeeping changes.
  if (!Array.isArray(pool._activeVoices) || typeof pool._triggerAttack !== 'function') {
    synth.triggerAttackRelease(notes, duration, time, velocity);
    return;
  }
  if (!(duration > 0)) throw new Error('The duration must be greater than 0');
  let voices: ActiveVoice[] = [];
  const schedule = (when: number, callback: () => void) => {
    if (pool.disposed) return;
    if (when <= pool.now()) callback();
    else pool.context.setTimeout(() => schedule(when, callback), when - pool.now());
  };
  schedule(time, () => {
    const first = pool._activeVoices.length;
    pool._triggerAttack(notes, time, velocity);
    voices = pool._activeVoices.slice(first);
  });
  schedule(time + duration, () => {
    for (const entry of voices) {
      // Stolen, dropped and recycled notes must not release a later restrike.
      if (entry.released || !pool._activeVoices.includes(entry)) continue;
      entry.voice.triggerRelease(time + duration);
      entry.released = true;
    }
    voices = [];
  });
}
