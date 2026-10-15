import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePresetData, normalizePresetTrackData } from '../presets.js';
import { buildLegacyTrackEvents } from '../domain/scheduling.js';
import { decodeTrack, pitchScale, resolveProjectEvents, resolveProjectEventsWithScale } from '../domain/developmentSchedule.js';
import { createDefaultDrumLane, type DrumVoiceId } from '../domain/rhythmTrack.js';
import { trackNotePreview } from '../domain/trackPreview.js';

const scale = Array.from({ length: 128 }, (_, i) => i);
const rectangles = (path: string) => [...path.matchAll(/M([\d.]+),([\d.]+)h([\d.]+)/g)]
  .map(match => ({ x: Number(match[1]), y: Number(match[2]), width: Number(match[3]) }));
const preview = (changes: Parameters<typeof normalizePresetTrackData>[0], duration = 1, masks: bigint[] = []) => {
  const track = normalizePresetTrackData({ sequenceInput: '1 0 2 0', denominator: 4, lengthFactor: 100, lengthOffset: 0, ...changes });
  const events = buildLegacyTrackEvents(decodeTrack(track, 60, scale, 12), 60, duration, 0, masks);
  return rectangles(trackNotePreview(track, events, duration));
};

test('preview gates follow note length, fixed offset, rests, and zero length', () => {
  assert.deepEqual(preview({}).map(n => [n.x, n.width]), [[0, 50], [50, 50]]);
  assert.deepEqual(preview({ lengthFactor: 50 }).map(n => n.width), [25, 25]);
  assert.deepEqual(preview({ lengthFactor: 50, lengthOffset: 0.5 }).map(n => n.width), [37.5, 37.5]);
  assert.deepEqual(preview({ lengthFactor: 0 }), []);
});

test('preview follows delay, padding, repeats, phase, warp, and activation', () => {
  assert.deepEqual(preview({ delay: 1, paddingBefore: 0.25, paddingAfter: 0.25, repeats: 2 }, 10)
    .map(n => n.x), [50, 55, 80, 85]);
  assert.deepEqual(preview({ phase: 1 }).map(n => n.x), [25, 75]);
  const warped = preview({ timeWarpEnabled: true, timeWarpCurve: 'custom', timeWarpExpression: 'T*T', timeWarpAmount: 100, timeWarpNoteLengths: true });
  assert.deepEqual(warped.map(n => [n.x, n.width]), [[0, 25], [25, 75]]);
  assert.deepEqual(preview({}, 1, [1n, 0n]).map(n => [n.x, n.width]), [[0, 50]]);
});

test('preview includes long sequences, negative melodic masks and high bits', () => {
  const long = preview({ sequenceInput: Array(128).fill('1').join(' ') }, 32);
  assert.equal(long.length, 128);
  assert.equal(long.at(-1)!.x, 99.2188);
  const negative = preview({ sequenceInput: '-3', octave: 4 }, 1);
  assert.equal(negative.length, 2);
  assert.ok(negative[1].y < negative[0].y);
  assert.equal(preview({ sequenceInput: String(2 ** 20) }).length, 1);
});

test('preview includes drum lanes beyond the original twelve-row limit', () => {
  const track = normalizePresetTrackData({ trackKind: 'rhythmic', drumVelocityBits: 3,
    drumLanes: ['kick', 'rimshot', 'snare', 'clap', 'tomLowFloor', 'hat', 'tomHighFloor', 'hatPedal', 'tom', 'hatOpen', 'tomLowMid', 'tomHighMid', 'crash', 'tomHigh', 'ride']
      .map(id => createDefaultDrumLane(id as DrumVoiceId)),
    sequenceInput: String(7n << 42n), denominator: 4, lengthFactor: 50, lengthOffset: 0 });
  const events = buildLegacyTrackEvents(decodeTrack(track, 60, [], 0), 60, 1, 0, []);
  const notes = rectangles(trackNotePreview(track, events, 1));
  assert.equal(notes.length, 1);
  assert.equal(notes[0].width, 12.5);
  assert.ok(notes[0].y < 6);
});

test('preview resolves phrase repetitions, articulation, choices and ties with playback', async () => {
  const project = normalizePresetData({ bpm: 60, forte: '12-1.00', tracks: [{ id: 'notes', denominator: 4,
    lengthFactor: 100, lengthOffset: 0, development: { enabled: true, patterns: [
      { id: 'a', name: 'A', sequence: '1 1', steps: [{ step: 0, tie: true }] },
      { id: 'b', name: 'B', sequence: '2 0', steps: [{ step: 0, durationBeats: 0.125 }] },
    ], sections: [
      { id: 's1', name: 'Tied', pattern: 'a', length: 1, unit: 'beats' },
      { id: 's2', name: 'Alternate', pattern: 'a', length: 1, unit: 'beats', choices: [{ pattern: 'b', condition: {} }] },
    ] } }] });
  const { scale: pitches, count } = await pitchScale(project.forte);
  const timeline = resolveProjectEventsWithScale(project, pitches, count);
  assert.deepEqual(timeline, await resolveProjectEvents(project));
  const notes = rectangles(trackNotePreview(project.tracks[0], timeline.tracks[0].events, timeline.duration));
  assert.deepEqual(notes.map(n => [n.x, n.width]), [[0, 25], [25, 25], [50, 6.25], [75, 6.25]]);
});

test('note tails cross clip boundaries and stop at the loop edge', () => {
  assert.deepEqual(preview({ sequenceInput: '1 2', repeats: 2, lengthFactor: 200 }).map(n => [n.x, n.width]),
    [[0, 50], [25, 50], [50, 50], [75, 25]]);
});
