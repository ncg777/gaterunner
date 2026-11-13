import * as Tone from 'tone';
import type App from '../App.vue';
import { normalizePresetData } from '../presets';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const check = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
const close = (a: number, b: number) => Math.abs(a - b) < 0.0002;

/** Exercise the actual tempo input, transport and audio/MIDI scheduling path. */
export async function runLiveTempoChecks(app: InstanceType<typeof App>) {
  const originalProject = app.getDraftData();
  const play = app.playTrackStep;
  const midi = app.useMidiOutput;
  const midiOutput = app.midiOutput;
  const tempo = document.querySelector<HTMLInputElement>('[aria-label="Tempo in BPM"]')!;
  const setTempo = (bpm: number) => {
    tempo.value = String(bpm);
    tempo.dispatchEvent(new Event('change', { bubbles: true }));
    check(app.bpm === bpm && app.getDraftData().bpm === bpm, 'Tempo edit did not update the draft');
  };
  const results = [];
  try {
    for (const mode of ['audio', 'midi', 'development'] as const) {
      app.useMidiOutput = mode === 'midi';
      const midiMessages: { status: number; time: number }[] = [];
      app.midiOutput = mode === 'midi' ? {
        send: ([status]: number[], time: number) => midiMessages.push({ status, time }),
      } as unknown as MIDIOutput : null;
      app.applyDraftData(normalizePresetData({
        bpm: 120, reverb: { enabled: false }, masterPulse: { enabled: true, rateMode: 'sync' },
        tracks: [{ id: 'tempo-test', sequenceInput: Array(15).fill('1 2 4 8').join(' '),
          denominator: 5, lengthFactor: 50, gain: -36, release: 0.02, fadeIn: 0.5, fadeOut: 0.25,
          echoEnabled: true, echoDelay: '1/8', echoWet: -24,
          development: mode === 'development' ? { enabled: true } : undefined }],
      }));
      const events: { step: number; time: number; duration: number; tick: number }[] = [];
      const context = Tone.getContext();
      const { transport } = context;
      app.playTrackStep = (track, event, time) => {
        events.push({ step: event.step, time, duration: event.duration, tick: transport.getTicksAtTime(time) });
        play(track, event, time);
      };
      await app.startSequencer();
      await wait(750);
      check(app.isRunning && !tempo.disabled && events.length > 4, mode + ' playback did not start');
      const part = app.trackLoops['tempo-test'];
      const fade = app.trackFadeLoops['tempo-test'];
      const chain = app.trackSynths['tempo-test'];
      const echo = chain?.echo;
      const generation = app.playbackGeneration;
      const progress = app.playheadProgress;
      setTempo(150);
      setTempo(240);
      check(close(app.playheadProgress, progress), mode + ' playhead jumped when the draft BPM changed');
      await wait(650);
      const fast = events.at(-1)!;
      check(close(fast.duration, 0.025), mode + ' note duration did not follow 240 BPM');
      setTempo(60);
      await wait(850);
      const slow = events.at(-1)!;
      check(close(slow.duration, 0.1), mode + ' note duration did not follow 60 BPM');
      check(app.isRunning && app.playbackGeneration === generation && app.trackLoops['tempo-test'] === part
        && app.trackFadeLoops['tempo-test'] === fade && chain?.echo === echo, mode + ' tempo edit replaced playback objects');
      check(app.playheadProgress > progress, mode + ' playhead did not advance');
      check(events[0]?.step === 0 && events.every((event, i) => i === 0
        || (event.step === (events[i - 1].step + 1) % 60 && event.time > events[i - 1].time
          && Math.abs(event.tick - Math.round(i * transport.PPQ / 5)) < 0.01)), mode + ' tempo edit skipped, repeated, or moved a note');
      if (mode === 'midi') {
        const on = midiMessages.at(-2)!;
        const off = midiMessages.at(-1)!;
        check(on?.status === 0x90 && off?.status === 0x80 && close((off.time - on.time) / 1000, slow.duration),
          'MIDI note-off did not follow the new tempo');
      }
      results.push({ mode, events: events.length });
      app.stopSequencer();
    }
    return results;
  } finally {
    if (app.isRunning) app.stopSequencer();
    app.playTrackStep = play;
    app.useMidiOutput = midi;
    app.midiOutput = midiOutput;
    app.applyDraftData(originalProject);
  }
}
