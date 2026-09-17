import * as Tone from 'tone';
import { PitchEnvelopeSynth } from '../audio/pitchEnvelopeSynth';
import { renderOfflineAudio } from '../audio/offlineRender';
import { preparePeriodicWaveContext } from '../audio/periodicWave';
import { nativeUnisonGain } from '../../cli/nativeEnvelope';

/** Compare the production voice with an independent bank of detuned single synths. */
export async function runUnisonSoundChecks() {
  const results = [];
  const sampleRate = 48000;
  for (const count of [2, 3, 8]) {
    for (const spread of [0, 40]) {
      const render = async (reference: boolean) => {
        const voices: Tone.Synth[] = [];
        const cache = Tone.Oscillator as unknown as { _periodicWaveCache: unknown[] };
        const previous = cache._periodicWaveCache;
        cache._periodicWaveCache = [];
        try {
          const buffer = await renderOfflineAudio(context => {
            preparePeriodicWaveContext(context);
            const envelope = { attack: 0.005, decay: 0.01, sustain: 1, release: 0.05,
              attackCurve: 'exponential' as const, decayCurve: 'exponential' as const,
              releaseCurve: 'exponential' as const };
            if (reference) {
              for (let voice = 0; voice < count; voice++) {
                const synth = new Tone.Synth({ context, envelope,
                  oscillator: { type: 'custom', partials: [1], phase: 0 },
                  detune: (voice / (count - 1) - 0.5) * spread,
                  volume: -18 + Tone.gainToDb(nativeUnisonGain(count)),
                }).toDestination();
                voices.push(synth);
              }
            } else {
              voices.push(new PitchEnvelopeSynth({ context, envelope, volume: -18,
                oscillator: { type: 'fatcustom', partials: [1], count, spread },
              }).toDestination());
            }
            for (const synth of voices) synth.triggerAttackRelease(440, 2, 0);
          }, 2.1, 1, sampleRate);
          const samples = buffer.getChannelData(0).slice();
          buffer.dispose();
          return samples;
        } finally {
          voices.forEach(voice => voice.dispose());
          cache._periodicWaveCache = previous;
        }
      };
      const expected = await render(true);
      const actual = await render(false);
      let maxError = 0, energy = 0;
      for (let frame = 0; frame < actual.length; frame++) {
        maxError = Math.max(maxError, Math.abs(actual[frame] - expected[frame]));
        energy += actual[frame] ** 2;
      }
      const rms = Math.sqrt(energy / actual.length);
      if (maxError > 2e-6 || rms < 0.02) {
        throw new Error(`Unison ${count}/${spread} does not match independent detuned voices: error=${maxError}, rms=${rms}`);
      }
      // A two-voice detuned sine must beat, while zero detune must stay strong.
      // Compare short RMS windows after the attack, independent of oscillator internals.
      if (count === 2) {
        const levels = [];
        for (let start = 2400; start < 90000; start += 480) {
          let sum = 0;
          for (let frame = start; frame < start + 480; frame++) sum += actual[frame] ** 2;
          levels.push(Math.sqrt(sum / 480));
        }
        const ratio = Math.min(...levels) / Math.max(...levels);
        if (spread === 0 ? ratio < 0.9 : ratio > 0.2) throw new Error(`Unison beating mismatch: ${spread}, ratio=${ratio}`);
      }
      results.push({ count, spread, maxError, rms });
    }
  }
  return results;
}

/** Native waveform construction while notes are actually running, including a full pool. */
export async function runActiveUnisonPerformanceChecks() {
  const results = [];
  for (const count of [3, 8]) {
    const context = new Tone.Context({ clockSource: 'offline' });
    preparePeriodicWaveContext(context);
    const voices: Tone.Synth[] = [];
    try {
      // Keep the measurement quiet but the oscillators running and connected.
      const legacy = Array.from({ length: 8 }, () => new Tone.Synth({ context, volume: -60,
        oscillator: { type: 'fatcustom', count, spread: 28, partials: [1] },
      }).toDestination());
      voices.push(...legacy);
      const optimized = Array.from({ length: 8 }, () => new PitchEnvelopeSynth({ context, volume: -60,
        oscillator: { type: 'fatcustom', count, spread: 28, partials: [1] },
      }).toDestination());
      voices.push(...optimized);
      await context.resume();
      const when = context.currentTime + 0.02;
      for (const voice of voices) voice.triggerAttack(220, when);
      await new Promise(resolve => setTimeout(resolve, 100));
      const create = context.createPeriodicWave;
      let waves = 0;
      context.createPeriodicWave = function (real, imag, constraints) {
        waves++;
        return create.call(this, real, imag, constraints);
      };
      const spectra = Array.from({ length: 90 }, (_, tick) => [1, 0.123 + tick / 137, -0.2, tick / 91]);
      let started = performance.now();
      for (const partials of spectra) {
        for (const voice of legacy) voice.set({ oscillator: { partials } });
      }
      const baselineMilliseconds = performance.now() - started;
      const baselineWaves = waves;
      waves = 0;
      started = performance.now();
      for (const partials of spectra) {
        for (const voice of optimized) voice.set({ oscillator: { partials } });
      }
      const optimizedMilliseconds = performance.now() - started;
      const optimizedWaves = waves;
      if (waves !== spectra.length || baselineWaves < spectra.length * count - count) {
        throw new Error(`Active Unison wave count regression: ${baselineWaves} -> ${waves}`);
      }
      // Change count, phase and spread through the actual production setter.
      optimized[0].set({ oscillator: { count: 2, phase: 37, spread: 60 } });
      const group = (optimized[0].oscillator as unknown as { _oscillator: {
        _oscillators: Array<{ phase: number; detune: { value: number } }>;
      } })._oscillator;
      if (group._oscillators.length !== 2 || group._oscillators.some(osc => Math.abs(osc.phase - 37) > 1e-9)
        || group._oscillators[0].detune.value !== -30 || group._oscillators[1].detune.value !== 30) {
        throw new Error('Live count/phase/detune edit broke Unison');
      }
      results.push({ count, updates: spectra.length, baselineWaves, optimizedWaves,
        baselineMilliseconds, optimizedMilliseconds, soundingNotesPerBank: optimized.length });
    } finally {
      voices.forEach(voice => voice.dispose());
      await context.close(); context.dispose();
    }
  }
  return results;
}
