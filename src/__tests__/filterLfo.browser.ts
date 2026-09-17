import * as Tone from 'tone';
import { createSkewLfoState, getLfoFrequencyHz, sampleLfoAtTime } from '../audio/lfo';
import { PitchEnvelopeSynth } from '../audio/pitchEnvelopeSynth';
import { renderOfflineAudio } from '../audio/offlineRender';
import { disposeReverbAudioChain } from '../audio/reverb';
import { normalizePresetTrackData, SKEW_LFO_WAVEFORM_OPTIONS } from '../presets';
import type App from '../App.vue';

export async function runFilterLfoChecks(app: InstanceType<typeof App>) {
  const results: string[] = [];
  const check = (condition: boolean, label: string) => {
    if (!condition) throw new Error(label);
    results.push(label);
  };
  const savedReverb = app.reverbChain;
  try {
    for (const { value: waveform } of SKEW_LFO_WAVEFORM_OPTIONS) {
      let voice: PitchEnvelopeSynth | undefined;
      let chain: ReturnType<typeof app.createTrackAudioChain> | undefined;
      let reverb: ReturnType<typeof app.getOrCreateReverbChain> | undefined;
      const track = normalizePresetTrackData({ trackKind: 'rhythmic', filterEnabled: true,
        filterFrequency: 69, filterEnvelopeAmount: 12, filterEnvelopeSustain: 0.25,
        filterEnvelopeAttack: 0.05, filterEnvelopeDecay: 0.1, filterEnvelopeRelease: 0.2,
        filterLfoEnabled: true, filterLfoSync: true, filterLfoRate: '1/4',
        filterLfoAmount: 12, filterLfoWaveform: waveform, filterLfoInitPhase: 0.13,
      });
      const frequencyHz = getLfoFrequencyHz({ sync: true, rateHz: 1, syncRate: '1/4', bpm: app.bpm });
      app.reverbChain = null;
      try {
        const buffer = await renderOfflineAudio(context => {
          reverb = app.getOrCreateReverbChain();
          chain = app.createTrackAudioChain();
          app.updateTrackChainSettings(track, chain);
          app.scheduleFilterEnvelope(track, [69], 0, 0.6, chain);
          voice = new PitchEnvelopeSynth({
            oscillator: { type: 'sawtooth' } as Tone.SynthOptions['oscillator'],
            voiceFilter: { ...PitchEnvelopeSynth.getDefaults().voiceFilter,
              enabled: true, frequencyMidi: 69, amount: 12, attack: 0.05, decay: 0.1,
              sustain: 0.25, release: 0.2, lfoEnabled: true, lfoAmount: 12,
              lfoFrequencyHz: frequencyHz, lfoWaveform: waveform, lfoInitPhase: 0.13,
            },
          }).toDestination();
          voice.triggerAttackRelease(220, 0.6, 0);
          // A second note must retain the absolute LFO phase.
          context.transport.schedule(time => {
            voice!.triggerAttackRelease(440, 0.15, time);
            app.scheduleFilterEnvelope(track, [81], time, 0.15, chain!);
          }, 0.85);
          context.transport.start(0);
        }, 1.2, 1, 48000);
        for (const time of [0.1, 0.35, 0.65, 0.75, 0.9, 1.05]) {
          const expected = sampleLfoAtTime(createSkewLfoState(), time, frequencyHz, waveform, 0.13) * 1200;
          check(Math.abs(voice!.filter.detune.getValueAtTime(time) - expected) < 1e-5,
            `${waveform}: voice follows LFO at ${time}s`);
          check(Math.abs(chain!.filter!.detune.getValueAtTime(time) - expected) < 1e-5,
            `${waveform}: rhythmic filter follows LFO at ${time}s`);
        }
        const samples = buffer.getChannelData(0);
        check(samples.every(Number.isFinite) && samples.some(sample => Math.abs(sample) > 0.001),
          `${waveform}: modulated audio is finite and audible`);
        buffer.dispose();
      } finally {
        voice?.dispose();
        if (chain) app.disposeTrackChain(chain);
        if (reverb) disposeReverbAudioChain(reverb);
      }
    }
    let voice: PitchEnvelopeSynth | undefined;
    try {
      const buffer = await renderOfflineAudio(context => {
        const voiceFilter = { ...PitchEnvelopeSynth.getDefaults().voiceFilter,
          enabled: true, frequencyMidi: 69, amount: 0, lfoEnabled: true,
          lfoFrequencyHz: 2, lfoAmount: 12,
        };
        voice = new PitchEnvelopeSynth({ voiceFilter,
          envelope: { attack: 0.001, decay: 0.001, sustain: 1, release: 0.3 } as Tone.SynthOptions['envelope'],
        }).toDestination();
        voice.triggerAttackRelease(1000, 0.6, 0);
        context.transport.schedule(() => {
          voice!.set({ voiceFilter: { ...voiceFilter, lfoEnabled: false } });
        }, 0.8);
        context.transport.start(0);
      }, 0.95, 1, 48000);
      const samples = buffer.getChannelData(0);
      const rms = (time: number) => {
        const window = samples.subarray(Math.floor((time - 0.01) * 48000), Math.floor((time + 0.01) * 48000));
        return Math.sqrt(window.reduce((sum, sample) => sum + sample * sample, 0) / window.length);
      };
      check(rms(0.125) > rms(0.375) * 4, 'LFO changes audible cutoff within one sustained note without a filter envelope');
      check(Math.abs(voice!.filter.detune.getValueAtTime(0.825)) < 1e-6, 'Disabling LFO clears modulation during release');
      buffer.dispose();
    } finally {
      voice?.dispose();
    }
  } finally {
    app.reverbChain = savedReverb;
  }
  return results;
}
