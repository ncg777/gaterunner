import assert from 'node:assert/strict';
import test from 'node:test';
import ToneMidi from '@tonejs/midi';
import { generateMidi, renderWavChannels, type GenerateTrackOptions } from './generate.js';

test('fractional track phase preserves WAV length with repeats, delay and padding', async () => {
  for (const trackKind of ['melodic', 'rhythmic'] as const) {
    const track: GenerateTrackOptions = { trackKind, sequence: '1 2 4 8', numerator: 1,
      denominator: 5, delay: 1, paddingBefore: 0.25, paddingAfter: 0.5, repeats: 2,
      gain: -24, reverbWet: -96 };
    const options = { bpm: 240, tracks: [track], reverb: { enabled: false } };
    const plain = await renderWavChannels(options);
    for (const phase of [0.25, 0.5, 0.99, 1]) {
      const shifted = await renderWavChannels({ ...options, tracks: [{ ...track, phase }] });
      assert.equal(shifted.left.length, plain.left.length, `${trackKind}, phase ${phase}`);
      assert.equal(shifted.right.length, plain.right.length);
    }
  }
});

test('a full-step phase wraps the final note within every padded repeat', async () => {
  for (const trackKind of ['melodic', 'rhythmic'] as const) {
    for (const denominator of [3, 5]) {
      const track: GenerateTrackOptions = { trackKind, sequence: '1 2 4 8', numerator: 1,
        denominator, delay: 1, paddingBefore: 0.25, paddingAfter: 0.5, repeats: 2,
        lengthFactor: 25 };
      const options = { bpm: 60, tracks: [track] };
      const plain = new ToneMidi.Midi(await generateMidi(options)).tracks[0].notes;
      const shifted = new ToneMidi.Midi(await generateMidi({ ...options, tracks: [{ ...track, phase: 1 }] })).tracks[0].notes;
      assert.equal(shifted.length, plain.length);
      for (let repeat = 0; repeat < 2; repeat++) {
        const offset = repeat * 4;
        assert.deepEqual(shifted.slice(offset, offset + 4).map(note => note.midi),
          [plain[offset + 3].midi, ...plain.slice(offset, offset + 3).map(note => note.midi)]);
        for (let step = 0; step < 4; step++) {
          assert.ok(Math.abs(shifted[offset + step].time - plain[offset + step].time) < 1 / 480);
          assert.equal(shifted[offset + step].durationTicks, plain[offset + step].durationTicks);
        }
      }
    }
  }
});

test('phase wraps warped endpoint notes into the sequence without losing events', async () => {
  const midi = new ToneMidi.Midi(await generateMidi({ bpm: 60, tracks: [{
    sequence: '1 2 4 8', denominator: 4, numerator: 1, phase: 0.5,
    delay: 1, paddingBefore: 0.25, paddingAfter: 0.5, repeats: 2,
    timeWarpEnabled: true, timeWarpCurve: 'custom', timeWarpExpression: 'Y=1',
    timeWarpNoteLengths: false, lengthFactor: 25,
  }] }));
  assert.deepEqual(midi.tracks[0].notes.map(note => note.time),
    [1.375, 1.375, 1.375, 1.375, 3.125, 3.125, 3.125, 3.125]);
});

test('fractional phase does not move song activation boundaries', async () => {
  const midi = new ToneMidi.Midi(await generateMidi({ bpm: 60,
    bitmaskSequenceInput: '1 0', tracks: [{
      sequence: '1 2 4 8', denominator: 1, phase: 0.5, lengthFactor: 100,
    }],
  }));
  assert.deepEqual(midi.tracks[0].notes.map(note => note.time), [0.5, 1.5]);
  assert.deepEqual(midi.tracks[0].notes.map(note => note.duration), [1, 0.5]);
});
