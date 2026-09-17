import assert from 'node:assert/strict';
import test from 'node:test';
import { preparePeriodicWaveContext } from '../audio/periodicWave';

test('periodic wave preparation preserves coefficients, options, inputs and native validation', () => {
  const calls: unknown[][] = [];
  const wave = {} as PeriodicWave;
  const context = {
    createPeriodicWave(real: number[] | Float32Array, imag: number[] | Float32Array,
      constraints?: PeriodicWaveConstraints) {
      assert.equal(this, context);
      calls.push([real, imag, constraints]);
      if (real.length !== imag.length) throw new Error('native validation');
      return wave;
    },
  };
  preparePeriodicWaveContext(context);
  const wrapper = context.createPeriodicWave;
  preparePeriodicWaveContext(context);
  assert.equal(context.createPeriodicWave, wrapper);
  const real = new Float32Array([0.5, 0, 0, 0]);
  const imag = new Float32Array([0, 1, -0.25, 0]);
  const constraints = { disableNormalization: true };
  assert.equal(context.createPeriodicWave(real, imag, constraints), wave);
  assert.deepEqual(Array.from(calls[0][0] as Float32Array), [0.5, 0, 0]);
  assert.deepEqual(Array.from(calls[0][1] as Float32Array), [0, 1, -0.25]);
  assert.equal(calls[0][2], constraints);
  assert.equal(real.length, 4);
  assert.equal(imag.length, 4);
  context.createPeriodicWave([0, 0, 0], [0, 0, 0]);
  assert.deepEqual(calls[1], [[0, 0], [0, 0], undefined]);
  const tiny = [0, 1, Number.MIN_VALUE];
  context.createPeriodicWave(tiny, [0, 0, 0]);
  assert.equal(calls[2][0], tiny);
  assert.throws(() => context.createPeriodicWave([0, 0, 0], [0, 0]), /native validation/);
  // Leave inputs outside Tone's supported grid to native length validation.
  const oversized = new Float32Array(65536);
  context.createPeriodicWave(oversized, oversized);
  assert.equal(calls.at(-1)![0], oversized);
});
