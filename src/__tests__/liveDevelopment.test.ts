import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePresetData } from '../presets';
import { canPlayDevelopmentLive, scheduleLiveDevelopmentSends } from '../audio/liveDevelopment';

const project = () => normalizePresetData({ bpm: 48, tracks: [{
  sequenceInput: Array(4224).fill('1').join(' '), denominator: 12,
  development: { enabled: true, steps: [{ step: 1, durationBeats: 3.9, velocity: 0.77 }],
    automation: [{ id: 'cutoff', target: 'filterFrequency', clock: 'song', interpolation: 'linear',
      points: [{ beat: 0, value: 40 }, { beat: 352, value: 80 }] },
    { id: 'send', target: 'reverbWet', clock: 'song', interpolation: 'smooth',
      points: [{ beat: 0, value: -24 }, { beat: 352, value: -12 }] }] } }] });

test('long developed presets with timing, velocity, cutoff and reverb play live', () => {
  const input = project();
  assert.equal(canPlayDevelopmentLive(input), true);
  input.tracks[0].polyphony = 8;
  input.tracks[0].development!.steps[0].locks = { attack: 0.012, decay: 2.8, release: 3.2 };
  assert.equal(canPlayDevelopmentLive(input), true);
  input.tracks[0].development!.automation[0].clock = 'note';
  assert.equal(canPlayDevelopmentLive(input), false);
});

test('unsupported developed sound controls keep the native render path', () => {
  for (const edit of [
    (d: NonNullable<ReturnType<typeof project>['tracks'][number]['development']>) => { d.steps[0].locks = { filterEnabled: false }; },
    (d: NonNullable<ReturnType<typeof project>['tracks'][number]['development']>) => { d.automation[0].target = 'modulation.pitch'; },
    (d: NonNullable<ReturnType<typeof project>['tracks'][number]['development']>) => { d.snapshotCues.push({ beat: 0, snapshot: 'sound' }); },
  ]) {
    const input = project(); edit(input.tracks[0].development!);
    assert.equal(canPlayDevelopmentLive(input), false);
  }
  const input = project(); input.studio = { version: 1, seed: 0, assets: [], returns: [{ id: 'send', name: 'Send', level: 0, chain: [], automation: [] }] };
  assert.equal(canPlayDevelopmentLive(input), false);
});

test('live send automation schedules a bounded window in song time and releases listeners', () => {
  const input = project(), calls: { value: number; time: number }[] = [];
  const handlers = new Map<string, (...args: number[]) => void>();
  let now = 10, cancelled = false;
  const context = { now: () => now,
    on: (event: string, cb: () => void) => handlers.set(event, cb),
    off: (event: string) => handlers.delete(event),
    transport: { on: (event: string, cb: (time: number) => void) => handlers.set(event, cb), off: (event: string) => handlers.delete(event) } };
  const send = { gain: { linearRampToValueAtTime: (value: number, time: number) => calls.push({ value, time }),
    cancelAndHoldAtTime: () => { cancelled = true; } } };
  const dispose = scheduleLiveDevelopmentSends(context as never, input, new Map([[input.tracks[0].id, send as never]]));
  handlers.get('start')!(10);
  assert.ok(calls.length > 0 && calls.length < 10);
  assert.equal(calls[0].time, 10);
  assert.equal(calls[0].value, 10 ** ((-24 + input.reverb.wet) / 20));
  now = 10.1; handlers.get('tick')!();
  assert.ok(calls.at(-1)!.time <= now + 0.01);
  assert.ok(calls.at(-1)!.value > calls[0].value);
  dispose(); assert.equal(handlers.size, 0); assert.equal(cancelled, true);
});

test('constant developed sends schedule once instead of adding a permanent control clock', () => {
  const input = project(), d = input.tracks[0].development!;
  d.automation = [{ id: 'send', target: 'reverbWet', clock: 'song', interpolation: 'smooth',
    points: [{ beat: 0, value: -12 }, { beat: 352, value: -12 }] }];
  const handlers = new Map<string, (...args: number[]) => void>(), values: number[] = [];
  const context = { now: () => 10, on: (event: string, cb: () => void) => handlers.set(event, cb), off: () => {},
    transport: { on: (event: string, cb: () => void) => handlers.set(event, cb), off: () => {} } };
  const send = { gain: { setValueAtTime: (value: number) => values.push(value), cancelAndHoldAtTime() {} } };
  const dispose = scheduleLiveDevelopmentSends(context as never, input, new Map([[input.tracks[0].id, send as never]]));
  handlers.get('start')!(10);
  assert.equal(handlers.has('tick'), false);
  assert.deepEqual(values, [10 ** ((-12 + input.reverb.wet) / 20)]);
  dispose();
});
