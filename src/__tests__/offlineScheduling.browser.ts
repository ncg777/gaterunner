import * as Tone from 'tone';
import { renderOfflineAudio } from '../audio/offlineRender';
import { prepareOfflineClock } from '../audio/offlineClock';
import { PitchEnvelopeSynth } from '../audio/pitchEnvelopeSynth';
import { triggerPooledNote } from '../audio/pooledNote';
import { prewarmVoicePool, retainVoicePool } from '../audio/voicePool';
import { resolveTimeWarpFunction, warpNormalizedTime } from '../audio/timeWarp';

/** Same FM-warped notes and 200 Hz filter automation through both context paths. */
export async function runOfflineSchedulingChecks() {
  const results = [];
  for (const sampleRate of [44100, 48000]) {
    for (const curve of ['fm1', 'fm_saw2']) {
      const fn = resolveTimeWarpFunction(curve).fn;
      const events = Array.from({ length: 32 }, (_, i) => {
        const start = warpNormalizedTime(i / 32, fn, 1);
        const end = warpNormalizedTime(Math.min(1, (i + 1) / 32), fn, 1);
        return { time: start * 2, duration: Math.max(0.0005, Math.abs(end - start) * 2), note: 220 + i % 3 * 55 };
      }).sort((a, b) => a.time - b.time);
      const render = async (native: boolean) => {
        let synth: Tone.PolySynth<PitchEnvelopeSynth> | undefined;
        let context: Tone.OfflineContext | undefined;
        try {
          const schedule = (c: Tone.OfflineContext) => {
            context = c;
            prepareOfflineClock(c, 3.00001);
            synth = new Tone.PolySynth(PitchEnvelopeSynth, {
              oscillator: { type: 'sine' }, volume: -24,
              envelope: { attack: 0.002, decay: 0.01, sustain: 0.5, release: 0.03 },
              voiceFilter: { ...PitchEnvelopeSynth.getDefaults().voiceFilter,
                enabled: true, frequencyMidi: 85, amount: 12, lfoEnabled: true,
                lfoAmount: 9, lfoFrequencyHz: 2.7, lfoRetrigger: 'note' },
            }).toDestination();
            retainVoicePool(synth as unknown as Tone.PolySynth, 16);
            prewarmVoicePool(synth as unknown as Tone.PolySynth, 16);
            for (const event of events) c.transport.schedule(time => {
              triggerPooledNote(synth as unknown as Tone.PolySynth, [event.note], event.duration, time, 0.6);
            }, event.time);
            c.transport.start(0);
          };
          return await (native ? renderOfflineAudio : Tone.Offline)(schedule, 3.00001, 2, sampleRate);
        } finally {
          synth?.dispose();
          context?.dispose();
        }
      };
      const expected = await render(false), actual = await render(true);
      try {
        let maxDifference = 0, signalPeak = 0, tailPeak = 0;
        if (expected.length !== actual.length) throw new Error('Native render length changed');
        for (let channel = 0; channel < 2; channel++) {
          const a = expected.getChannelData(channel), b = actual.getChannelData(channel);
          for (let i = 0; i < a.length; i++) {
            maxDifference = Math.max(maxDifference, Math.abs(a[i] - b[i]));
            signalPeak = Math.max(signalPeak, Math.abs(b[i]));
            if (i > sampleRate * 2.9) tailPeak = Math.max(tailPeak, Math.abs(b[i]));
          }
        }
        if (maxDifference > 1e-6 || signalPeak < 0.001 || tailPeak > 1e-6) {
          throw new Error(`Offline FM scheduling changed: ${JSON.stringify({ sampleRate, curve, maxDifference, signalPeak, tailPeak })}`);
        }
        results.push({ sampleRate, curve, maxDifference, signalPeak, tailPeak });
      } finally {
        expected.dispose(); actual.dispose();
      }
    }
  }
  return results;
}
