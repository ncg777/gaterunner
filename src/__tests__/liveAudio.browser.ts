import * as Tone from 'tone';
import type App from '../App.vue';
import { readLiveScheduling, readLiveBuffering } from '../audio/liveAudio';
import { renderOfflineAudio } from '../audio/offlineRender';
import { PitchEnvelopeSynth } from '../audio/pitchEnvelopeSynth';
const check = (ok: boolean, message: string) => { if (!ok) throw new Error(message); };
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function runLiveBufferingChecks(app: InstanceType<typeof App>) {
  const draft = JSON.stringify(app.draftData);
  const render = async () => {
    let synth: PitchEnvelopeSynth | undefined;
    const buffer = await renderOfflineAudio(() => {
      synth = new PitchEnvelopeSynth({ oscillator: { type: 'sine' } as Tone.SynthOptions['oscillator'] });
      synth.toDestination(); synth.triggerAttackRelease(220, 0.1, 0.05);
    }, 0.4, 2, 48000);
    const result = buffer.getChannelData(0).slice();
    synth?.dispose(); buffer.dispose(); return result;
  };
  const before = await render();
  const results = [];
  for (const mode of ['playback', 'interactive', 'playback'] as const) {
    const old = Tone.getContext();
    await app.applyLiveBuffering(mode);
    const current = Tone.getContext();
    check(current !== old, 'Context not replaced');
    check(old.state === 'closed', 'Old context not closed');
    check(current.lookAhead === 0.4 && current.updateInterval === 0.01, 'Scheduling changed');
    check(app.liveBuffering === mode && readLiveBuffering() === mode, 'Preference not saved');
    check(JSON.stringify(app.draftData) === draft, 'Preset/unsaved edits changed');
    await app.startSequencer();
    check(app.isRunning && current.state === 'running', 'Play failed after switch');
    await app.applyLiveBuffering(mode === 'playback' ? 'interactive' : 'playback');
    check(Tone.getContext() === current, 'Switch allowed during playback');
    await wait(700);
    const stats = readLiveScheduling(current);
    check(stats.callbacks > 0, 'No live callback diagnostics');
    app.stopSequencer();
    app.isExporting = true;
    await app.applyLiveBuffering(mode === 'playback' ? 'interactive' : 'playback');
    check(Tone.getContext() === current, 'Switch allowed during export');
    app.isExporting = false;
    results.push({ mode, sampleRate: current.sampleRate, baseLatency: (current.rawContext as AudioContext).baseLatency, stats });
  }
  const after = await render();
  check(before.length === after.length && before.every((value, i) => value === after[i]), 'Offline PCM changed with live preference');
  await app.audioSleep?.cancel(); app.audioSleep = null;
  return { results, offlinePcmIdentical: true, draftPreserved: true };
}
