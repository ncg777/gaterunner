import * as Tone from 'tone';
import { renderOfflineAudio } from '../audio/offlineRender';
import { setTremoloSpread } from '../audio/tremolo';
import { DEFAULT_PRESET_TRACK_DATA } from '../presets';
import type App from '../App.vue';

export async function runOfflineRenderChecks() {
  const originalContext = Tone.getContext();
  const duration = 60;
  const render = async (optimized: boolean) => {
    let synth: Tone.Synth | undefined;
    let offlineContext: Tone.OfflineContext | undefined;
    const started = performance.now();
    try {
      const buffer = await (optimized ? renderOfflineAudio : Tone.Offline)((context) => {
        offlineContext = context;
        synth = new Tone.Synth({ oscillator: { type: 'sine', phase: 0 } }).toDestination();
        for (let second = 0; second < duration; second += 2) {
          context.transport.schedule((time) => synth!.triggerAttackRelease(220, 0.5, time), second);
        }
        context.transport.start(0);
      }, duration, 2, 48000);
      return { samples: buffer.getChannelData(0), milliseconds: performance.now() - started };
    } finally {
      synth?.dispose();
      offlineContext?.dispose();
    }
  };
  const reference = await render(false);
  const optimized = await render(true);
  if (reference.samples.length !== optimized.samples.length) {
    throw new Error('Offline render length changed.');
  }
  let peakDifference = 0;
  let peakSignal = 0;
  for (let index = 0; index < reference.samples.length; index += 1) {
    peakDifference = Math.max(peakDifference, Math.abs(reference.samples[index] - optimized.samples[index]));
    peakSignal = Math.max(peakSignal, Math.abs(optimized.samples[index]));
  }
  if (peakDifference !== 0 || peakSignal === 0) {
    throw new Error(`Offline PCM mismatch: difference=${peakDifference}, signal=${peakSignal}`);
  }
  const expectedFailure = new Error('Scheduling failed');
  try {
    await renderOfflineAudio(() => { throw expectedFailure; }, 1, 2, 48000);
    throw new Error('Scheduling failure was swallowed.');
  } catch (error) {
    if (error !== expectedFailure) {
      throw error;
    }
  }
  if (Tone.getContext() !== originalContext) {
    throw new Error('Live audio context was not restored.');
  }
  return {
    referenceMilliseconds: reference.milliseconds,
    optimizedMilliseconds: optimized.milliseconds,
    peakDifference,
    peakSignal,
    contextRestored: true,
  };
}

export async function runModulationChecks(app: InstanceType<typeof App>) {
  const track = {
    ...DEFAULT_PRESET_TRACK_DATA,
    vibratoFrequency: 3.7,
    vibratoDepth: 0.6,
    tremoloFrequency: 3.7,
    tremoloDepth: 0.6,
    tremoloSpread: 90,
  };
  type Chain = Parameters<typeof app.ensureTrackVibrato>[0];
  const assertSameAudio = (reference: Tone.ToneAudioBuffer, actual: Tone.ToneAudioBuffer, label: string) => {
    let peakDifference = 0;
    let peakSignal = 0;
    for (let channel = 0; channel < 2; channel += 1) {
      const expected = reference.getChannelData(channel);
      const samples = actual.getChannelData(channel);
      for (let index = 0; index < samples.length; index += 1) {
        peakDifference = Math.max(peakDifference, Math.abs(expected[index] - samples[index]));
        peakSignal = Math.max(peakSignal, Math.abs(expected[index]));
      }
    }
    if (peakDifference > 1e-6 || peakSignal < 0.01) {
      throw new Error(`${label}: difference=${peakDifference}, signal=${peakSignal}`);
    }
  };

  for (const kind of ['vibrato', 'tremolo'] as const) {
    const render = async (rewire: boolean) => {
      let effect: Tone.Vibrato | Tone.Tremolo | undefined;
      let oscillator: Tone.Oscillator | undefined;
      try {
        return await renderOfflineAudio((context) => {
          // These methods only need the effect slots, not the rest of the audio graph.
          const chain = { vibrato: null, tremolo: null, routingSignature: '' } as unknown as Chain;
          effect = kind === 'vibrato'
            ? app.ensureTrackVibrato(chain, track)
            : app.ensureTrackTremolo(chain, track);
          effect.toDestination();
          oscillator = new Tone.Oscillator(440).connect(effect).start(0).stop(0.45);
          if (rewire) {
            app.ensureTrackModulationRunning(chain);
            app.ensureTrackModulationRunning(chain);
            context.transport.schedule(() => app.ensureTrackModulationRunning(chain), 0.137);
            context.transport.start(0);
          }
        }, 0.5, 2, 48000);
      } finally {
        oscillator?.dispose();
        effect?.dispose();
      }
    };
    assertSameAudio(await render(false), await render(true), `${kind} startup/rewire phase`);
  }

  for (const spread of [0, 90, 180, 270, 360]) {
    for (const depth of [0, 0.6, 1]) {
      const render = async (update: boolean) => {
        let tremolo: Tone.Tremolo | undefined;
        let oscillator: Tone.Oscillator | undefined;
        try {
          return await renderOfflineAudio(() => {
            tremolo = new Tone.Tremolo({
              frequency: 3.7, depth, spread: update ? 180 : spread,
            }).toDestination().start(0);
            if (update) {
              setTremoloSpread(tremolo, spread);
              setTremoloSpread(tremolo, spread);
            }
            oscillator = new Tone.Oscillator(440).connect(tremolo).start(0).stop(0.15);
          }, 0.2, 2, 48000);
        } finally {
          oscillator?.dispose();
          tremolo?.dispose();
        }
      };
      assertSameAudio(await render(false), await render(true), `tremolo spread=${spread}, depth=${depth}`);
    }
  }
  return { phaseContinuity: true, tremoloSpreadAndDepthCases: 15 };
}