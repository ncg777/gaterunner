import assert from 'node:assert/strict';
import test from 'node:test';
import type * as Tone from 'tone';
import { FilterLfo } from '../audio/filterLfo.js';
import { createSkewLfoState, sampleLfoAtTime, LFO_WAVEFORM_OPTIONS } from '../audio/lfo.js';
import { normalizePresetTrackData, clonePresetTrackData, arePresetDataEqual, normalizePresetData } from '../presets.js';

function fixture() {
  let now = 0;
  let songStart = 0;
  const ticks = new Set<() => void>();
  const starts = new Set<(time: number) => void>();
  const events: { time: number; value: number; ramp: boolean }[] = [];
  const detune = {
    setValueAtTime(value: number, time: number) { events.push({ value, time, ramp: false }); },
    linearRampToValueAtTime(value: number, time: number) { events.push({ value, time, ramp: true }); },
    cancelScheduledValues(time: number) {
      for (let i = events.length - 1; i >= 0; i--) if (events[i]!.time >= time) events.splice(i, 1);
    },
    cancelAndHoldAtTime(time: number) {
      const value = this.getValueAtTime(time);
      this.cancelScheduledValues(time);
      this.setValueAtTime(value, time);
    },
    getValueAtTime(time: number): number {
      let previous = { time: 0, value: 0, ramp: false };
      for (const event of events.slice().sort((a, b) => a.time - b.time)) {
        if (event.time > time + 1e-9) {
          return event.ramp ? previous.value + (event.value - previous.value)
            * (time - previous.time) / (event.time - previous.time) : previous.value;
        }
        previous = event;
      }
      return previous.value;
    },
  };
  const transport = {
    state: 'stopped',
    getSecondsAtTime: (time: number) => time - songStart,
    on: (_event: string, callback: (time: number) => void) => starts.add(callback),
    off: (_event: string, callback: (time: number) => void) => starts.delete(callback),
  };
  const context = {
    now: () => now,
    get currentTime() { return now; },
    transport,
    on: (_event: string, callback: () => void) => ticks.add(callback),
    off: (_event: string, callback: () => void) => ticks.delete(callback),
  };
  return {
    filter: { context, detune, frequency: { getValueAtTime: () => 440 } } as unknown as Tone.Filter,
    advance(time: number) {
      while (now < time - 1e-9) { now = Math.min(time, now + 0.005); ticks.forEach(tick => tick()); }
    },
    start(time: number) {
      songStart = time;
      transport.state = 'started';
      starts.forEach(start => start(time));
    },
    ticks, starts, events,
  };
}

test('filter phase defaults to song and preserves explicit modes through cloning and comparison', () => {
  assert.equal(normalizePresetTrackData({}).filterLfoRetrigger, 'song');
  assert.equal(normalizePresetTrackData({ filterLfoRetrigger: 'invalid' }).filterLfoRetrigger, 'song');
  for (const mode of ['free', 'note', 'song'] as const) {
    const track = normalizePresetTrackData({ filterLfoRetrigger: mode });
    assert.equal(clonePresetTrackData(track).filterLfoRetrigger, mode);
    assert.equal(normalizePresetTrackData(JSON.parse(JSON.stringify(track))).filterLfoRetrigger, mode);
  }
  const song = normalizePresetData({ tracks: [{}] });
  const note = { ...song, tracks: song.tracks.map(track => ({ ...track, filterLfoRetrigger: 'note' as const })) };
  assert.equal(arePresetDataEqual(song, note), false);
});

test('queued note resets preserve earlier modulation and reset every waveform at exact event times', () => {
  for (const { value: waveform } of LFO_WAVEFORM_OPTIONS) {
    const f = fixture();
    const lfo = new FilterLfo(f.filter);
    lfo.set({ enabled: true, frequencyHz: 2, amount: 12, waveform, initPhase: 0.13, retrigger: 'note' });
    lfo.triggerNote(0.243);
    lfo.triggerNote(0.637);
    f.advance(0.8);
    for (const time of [0.1, 0.243, 0.637]) {
      const local = time === 0.1 ? time : 0;
      const expected = sampleLfoAtTime(createSkewLfoState(), local, 2, waveform, 0.13) * 1200;
      assert.ok(Math.abs(f.filter.detune.getValueAtTime(time) - expected) < 1e-6, `${waveform} at ${time}`);
    }
    lfo.dispose();
    assert.equal(f.ticks.size, 0);
    assert.equal(f.starts.size, 0);
  }
});

test('song resets follow playback starts, ignore notes, and align voices allocated during playback', () => {
  const f = fixture();
  const options = { enabled: true, frequencyHz: 1, amount: 12, waveform: 'sine' as const, initPhase: 0.25 };
  const lfo = new FilterLfo(f.filter);
  lfo.set(options);
  f.start(0.2);
  lfo.triggerNote(0.3);
  f.advance(0.45);
  assert.ok(Math.abs(f.filter.detune.getValueAtTime(0.45)) < 1e-6);
  const lateVoice = new FilterLfo(f.filter);
  lateVoice.set(options);
  assert.ok(Math.abs(f.filter.detune.getValueAtTime(0.45)) < 1e-6);
  f.start(0.603);
  f.advance(0.7);
  assert.ok(Math.abs(f.filter.detune.getValueAtTime(0.603) - 1200) < 1e-6);
  lfo.dispose();
  lateVoice.dispose();
  assert.equal(f.starts.size, 0);
});
