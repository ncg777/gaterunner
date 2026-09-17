import assert from 'node:assert/strict';
import test from 'node:test';
import { setSharedUnisonPartials } from '../audio/unisonPartials';
import { normalizePresetTrackData } from '../presets';

test('new tracks start with audible detune while explicit zero detune survives normalization', () => {
  assert.equal(normalizePresetTrackData({ unisonVoices: 3 }).unisonDetune, 12);
  assert.equal(normalizePresetTrackData({ unisonVoices: 3, unisonDetune: 0 }).unisonDetune, 0);
});

function fixture(offline = false) {
  const waves: unknown[] = [];
  const context = {
    currentTime: 10, isOffline: offline,
    createPeriodicWave(real: Float32Array, imag: Float32Array) {
      const wave = { real, imag };
      waves.push(wave);
      return wave as unknown as PeriodicWave;
    },
  };
  const child = (phase: number, stopTime: number | null) => ({
    context, _type: 'custom', _phase: phase, _partials: [1], _partialCount: 1,
    _wave: {} as PeriodicWave | undefined,
    _oscillator: stopTime === null ? null : {
      _startTime: 9, _stopTime: stopTime,
      updates: [] as PeriodicWave[],
      setPeriodicWave(wave: PeriodicWave) { this.updates.push(wave); },
    },
    startedWith: undefined as PeriodicWave | undefined,
    _start(_time: number) { this.startedWith = this._wave; },
    _getRealImaginary(_type: string, phase: number): [Float32Array, Float32Array] {
      return [new Float32Array([0, phase]), new Float32Array([0, ...this._partials])];
    },
  });
  const omni = (children: ReturnType<typeof child>[]) => ({
    _sourceType: 'fat', _oscillator: { _phase: 0, _partials: [1], _partialCount: 1, _oscillators: children },
  });
  const update = (source: ReturnType<typeof omni>, partials: number[]) =>
    setSharedUnisonPartials(source as unknown as Parameters<typeof setSharedUnisonPartials>[0], partials);
  return { context, waves, child, omni, update };
}

test('unison shares one coherent wave across active voices and isolates contexts', () => {
  const f = fixture();
  const a = [f.child(0, -1), f.child(2, 12)];
  const b = [f.child(0, 12), f.child(2, -1)];
  const partials = [1, -0.2, 0.1];
  assert.ok(f.update(f.omni(a), partials));
  assert.ok(f.update(f.omni(b), partials));
  assert.equal(f.waves.length, 1);
  assert.equal((f.waves[0] as { real: Float32Array }).real.length, partials.length + 1);
  assert.equal(a[0]._wave, b[0]._wave);
  assert.equal(a[1]._wave, b[1]._wave);
  assert.equal(a[0]._wave, a[1]._wave);
  assert.deepEqual([...a, ...b].map(child => child._phase), [0, 0, 0, 0]);
  const other = fixture();
  const c = other.child(0, -1);
  other.update(other.omni([c]), partials);
  assert.notEqual(a[0]._wave, c._wave);
});

test('idle and stopped voices defer preparation and start with the latest spectrum', () => {
  const f = fixture();
  const idle = f.child(0, null);
  const stopped = f.child(2, 9);
  const source = f.omni([idle, stopped]);
  const first = [1, 0.2];
  const latest = [0.5, -0.8];
  f.update(source, first);
  f.update(source, latest);
  assert.equal(f.waves.length, 0);
  assert.equal(stopped._oscillator!.updates.length, 0);
  assert.equal(idle._wave, undefined);
  assert.equal(source._oscillator._partials, latest);
  assert.equal(source._oscillator._partialCount, latest.length);
  idle._start(11);
  stopped._start(11);
  assert.equal(f.waves.length, 1);
  assert.equal(idle.startedWith, idle._wave);
  assert.deepEqual(Array.from((f.waves[0] as { imag: Float32Array }).imag),
    Array.from(new Float32Array([0, ...latest])));
  // A phase/type edit that has already supplied a wave must not be overwritten at start.
  const edited = {} as PeriodicWave;
  idle._wave = edited;
  idle._start(12);
  assert.equal(idle.startedWith, edited);
});

test('release tails, future notes and offline nodes receive eager updates', () => {
  for (const offline of [false, true]) {
    const f = fixture(offline);
    const nodes = [f.child(0, 10), f.child(1, 10.2), f.child(2, -1), f.child(3, 9)];
    nodes[2]._oscillator!._startTime = 11;
    f.update(f.omni(nodes), [0.5, 0.2]);
    assert.deepEqual(nodes.map(node => node._oscillator!.updates.length),
      offline ? [1, 1, 1, 1] : [1, 1, 1, 0]);
  }
});

test('mutated spectra invalidate shared waves and unsupported internals fall back without mutations', () => {
  const f = fixture();
  const oscillator = f.child(0, -1);
  const source = f.omni([oscillator]);
  const partials = [1];
  f.update(source, partials);
  const first = oscillator._wave;
  partials[0] = 0.3;
  f.update(source, partials);
  assert.notEqual(oscillator._wave, first);
  const start = oscillator._start;
  oscillator._type = 'sine';
  assert.equal(f.update(source, [1, 2]), false);
  assert.equal(oscillator._start, start);
  assert.equal(oscillator._partials, partials);
  for (const invalid of [[], [NaN], [Infinity], new Array(2048).fill(1)]) {
    assert.equal(f.update(source, invalid), false);
  }
});
