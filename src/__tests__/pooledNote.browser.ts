import * as Tone from 'tone';
import { renderOfflineAudio } from '../audio/offlineRender';
import { triggerPooledNote } from '../audio/pooledNote';
import { prewarmVoicePool, retainVoicePool } from '../audio/voicePool';

/** Compare overlapping warped notes with independently released reference voices. */
export async function runWarpedNoteChecks() {
  const events = [
    { time: 0, duration: 0.5, velocity: 0.25 },
    { time: 0.1, duration: 0.05, velocity: 0.8 },
    { time: 0.12, duration: 0.0005, velocity: 0.6 },
    { time: 0.12, duration: 0.1, velocity: 0.4 },
  ];
  const render = async (mode: 'reference' | 'pooled' | 'legacy', sampleRate: number) => {
    const owned: Array<{ dispose(): unknown }> = [];
    try {
      return await renderOfflineAudio(context => {
        const options = {
          oscillator: { type: 'sine' as const }, volume: -18,
          envelope: { attack: 0.001, decay: 0.01, sustain: 0.7, release: 0.03 },
        };
        const pool = new Tone.PolySynth(Tone.Synth, options).toDestination();
        owned.push(pool);
        // Match App's preallocated pool. Allocating a new Tone voice after its
        // scheduled start introduces constructor automation into that note.
        retainVoicePool(pool, events.length);
        prewarmVoicePool(pool, events.length);
        for (const event of events) {
          // One independent pool per event keeps Tone's dispatch timing (and
          // source-start clamping) identical, without any pitch-release ambiguity.
          const voice = mode === 'reference' ? new Tone.PolySynth(Tone.Synth, options).toDestination() : undefined;
          if (voice) {
            owned.push(voice);
            retainVoicePool(voice, 1);
            prewarmVoicePool(voice, 1);
          }
          context.transport.schedule(time => {
            if (voice) voice.triggerAttackRelease(220, event.duration, time, event.velocity);
            else if (mode === 'pooled') triggerPooledNote(pool, [220], event.duration, time, event.velocity);
            else pool.triggerAttackRelease([220], event.duration, time, event.velocity);
          }, event.time);
        }
        context.transport.start(0);
      }, 0.8, 1, sampleRate);
    } finally {
      owned.forEach(node => node.dispose());
    }
  };
  const results = [];
  for (const sampleRate of [44100, 48000]) {
    const reference = await render('reference', sampleRate);
    const pooled = await render('pooled', sampleRate);
    const legacy = await render('legacy', sampleRate);
    try {
      let maxDifference = 0, legacyDifference = 0, tailPeak = 0;
      const expected = reference.getChannelData(0), actual = pooled.getChannelData(0), old = legacy.getChannelData(0);
      for (let i = 0; i < expected.length; i++) {
        maxDifference = Math.max(maxDifference, Math.abs(expected[i] - actual[i]));
        legacyDifference = Math.max(legacyDifference, Math.abs(expected[i] - old[i]));
        if (i > sampleRate * 0.6) tailPeak = Math.max(tailPeak, Math.abs(actual[i]));
      }
      if (maxDifference > 1e-7 || legacyDifference < 0.001 || tailPeak > 1e-7) {
        throw new Error(`Warped release regression: ${JSON.stringify({ sampleRate, maxDifference, legacyDifference, tailPeak })}`);
      }
      results.push({ sampleRate, maxDifference, legacyDifference, tailPeak });
    } finally {
      reference.dispose(); pooled.dispose(); legacy.dispose();
    }
  }
  return results;
}
