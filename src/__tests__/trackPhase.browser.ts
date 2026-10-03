import type App from '../App.vue';
import { DEFAULT_PRESET_DATA, normalizePresetData } from '../presets';

const check = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
const close = (actual: number, expected: number) => Math.abs(actual - expected) < 1e-9;

/** Exercise the real browser scheduler, exports, live loops and rendered track length. */
export async function runTrackPhaseChecks(app: InstanceType<typeof App>) {
  const saved = app.getDraftData();
  const results = [];
  try {
    for (const trackKind of ['melodic', 'rhythmic'] as const) {
      const project = normalizePresetData({ ...DEFAULT_PRESET_DATA, bpm: 240,
        reverb: { ...DEFAULT_PRESET_DATA.reverb, enabled: false },
        tracks: [{ trackKind, id: 'phase-check', sequenceInput: '1 2 4 8',
          numerator: 1, denominator: 5, delay: 1, paddingBefore: 0.25,
          paddingAfter: 0.5, repeats: 2, lengthFactor: 25, gain: -36, polyphony: 2 }],
      });
      app.applyDraftData(project);
      await app.$nextTick();
      const duration = app.loopDurationSeconds;
      const renderDuration = app.getRenderDurationSeconds();
      const plainWav = await app.renderMixWav();
      for (const phase of [0.25, 0.5, 0.99, 1]) {
        app.tracks[0].phase = phase;
        await app.$nextTick();
        const track = app.tracks[0];
        const notes = app.computeActualNotes(track);
        const events = app.buildTrackEvents(track, notes, app.loopDurationSeconds);
        check(close(app.loopDurationSeconds, duration), `${trackKind}: phase changed loop duration`);
        check(close(app.getRenderDurationSeconds(), renderDuration), 'Phase changed WAV render duration');
        check(events.length === 8, 'Phase dropped a note or repeat');
        check(events.every((event, i) => i === 0 || event.time >= events[i - 1].time), 'Wrapped events were not sorted');
        for (const [index, event] of events.entries()) {
          const repeatStart = 0.3125 + Math.floor(index / 4) * 0.3875;
          check(event.time >= repeatStart && event.time < repeatStart + 0.2, 'Phase moved an onset into delay or padding');
        }
        if (phase === 1) {
          check(events[0].step === 3 && close(events[0].time, 0.3125), 'Full-step phase did not wrap the last step');
        }
        const midi = await app.getMidi();
        check(midi.tracks[0].notes.length === events.reduce((sum, event) => sum + event.notes.length, 0), 'MIDI lost phased notes');
        const label = document.querySelector('.track-timeline-meta span')?.textContent?.trim();
        check(label === '4.1 beats · 4.1 bars', `Phase changed the displayed track length: ${label}`);
      }
      app.tracks[0].phase = 0.5;
      await app.$nextTick();
      const phasedWav = await app.renderMixWav();
      check(phasedWav.length === plainWav.length, 'Fractional phase changed browser WAV length');
      await app.startSequencer();
      check(app.isRunning && close(Number(app.trackLoops['phase-check']?.loopEnd), duration), 'Live loop length changed');
      app.stopSequencer();
      results.push({ trackKind, duration, wavBytes: phasedWav.length, phases: 4 });
    }

    app.applyDraftData(normalizePresetData({ ...DEFAULT_PRESET_DATA, bpm: 60,
      tracks: [{ sequenceInput: '1', denominator: 5, phase: 1 }],
    }));
    const single = app.allTrackActualNotes[0];
    const singleEvents = app.buildTrackEvents(single.track, single.notes, app.loopDurationSeconds);
    check(singleEvents.length === 1 && singleEvents[0].time === 0, 'Full phase dropped a one-step pattern');

    app.applyDraftData(normalizePresetData({ ...DEFAULT_PRESET_DATA, bpm: 60,
      bitmaskSequenceInput: '1 0', tracks: [{ sequenceInput: '1 2 4 8', denominator: 1, phase: 0.5 }],
    }));
    const gated = app.allTrackActualNotes[0];
    const gatedEvents = app.buildTrackEvents(gated.track, gated.notes, app.loopDurationSeconds);
    check(gatedEvents.length === 2 && gatedEvents[1].duration === 0.5, 'Phase moved an activation boundary');
    return { results, singleStepWrap: true, activationBoundaryPreserved: true };
  } finally {
    if (app.isRunning) app.stopSequencer();
    app.applyDraftData(saved);
    await app.$nextTick();
  }
}
