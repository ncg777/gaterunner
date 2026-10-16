import * as Tone from 'tone';
import { getMasterBus, setMasterGainDb, setMasterPulse, resetMasterPulse, disposeMasterBus } from '../audio/masterBus';
import { MasterPulseDSP, normalizeMasterPulse } from '../audio/masterPulse';
import { applyMasterClip } from '../audio/masterClip';
import { renderOfflineAudio } from '../audio/offlineRender';

/** Native AudioWorklet parity, stereo linking, restart phase and sample-rate coverage. */
export async function runMasterPulseChecks() {
  let cases = 0, maximumDifference = 0;
  for (const sampleRate of [44100, 48000]) for (const shape of ['sine', 'triangle', 'pulse'] as const) {
    for (const rateMode of ['hz', 'sync'] as const) {
      const settings = normalizeMasterPulse({ enabled: true, shape, rateMode, frequency: 7.83,
        division: '1/16T', depth: 1, width: 0.37, edgeMs: 2 });
      let contextRef: Tone.BaseContext | undefined;
      let source: ConstantSourceNode | undefined;
      try {
        const buffer = await renderOfflineAudio(async context => {
          contextRef = context;
          const bus = getMasterBus(context);
          setMasterGainDb(bus, 0);
          await setMasterPulse(bus, settings, 137);
          source = context.createConstantSource(); source.offset.value = 3;
          Tone.connect(source, bus.input); source.start(0);
          context.transport.start(0);
          resetMasterPulse(bus, 0.2); // A second playback start resets the shared phase.
        }, 0.4, 2, sampleRate);
        const dsp = new MasterPulseDSP(sampleRate, settings, 137);
        const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
        for (let i = 0; i < left.length; i++) {
          if (i === Math.round(0.2 * sampleRate)) dsp.reset();
          const expected = applyMasterClip(3) * dsp.nextGain();
          maximumDifference = Math.max(maximumDifference, Math.abs(left[i]! - expected));
          if (left[i] !== right[i]) throw new Error('Master Pulse stereo channels diverged');
          if (Math.abs(left[i]!) > 1) throw new Error('Master Pulse exceeded the master ceiling');
        }
        cases++;
      } finally { source?.disconnect(); if (contextRef) disposeMasterBus(contextRef); }
    }
  }
  if (maximumDifference > 2e-6) throw new Error(`Master Pulse browser/native envelope difference: ${maximumDifference}`);
  return { cases, maximumDifference, stereoLinked: true, phaseReset: true };
}
