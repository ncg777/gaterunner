import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyMasterClip,
  MASTER_CLIP_CURVE,
  MASTER_CLIP_DOMAIN,
  MASTER_CLIP_THRESHOLD,
} from '../audio/masterClip.js';

test('master clip leaves levels below the threshold untouched', () => {
  for (const sample of [-0.7, -0.25, 0, 0.1, 0.5, MASTER_CLIP_THRESHOLD]) {
    assert.ok(Math.abs(applyMasterClip(sample) - sample) < 1e-4, `sample ${sample} was altered`);
  }
});

test('master clip keeps hot mixes inside full scale', () => {
  for (const sample of [1, 1.5, 2.5, MASTER_CLIP_DOMAIN, MASTER_CLIP_DOMAIN * 4]) {
    assert.ok(applyMasterClip(sample) <= 1, `sample ${sample} exceeded full scale`);
    assert.ok(applyMasterClip(-sample) >= -1, `sample ${-sample} exceeded full scale`);
    assert.ok(applyMasterClip(sample) > MASTER_CLIP_THRESHOLD);
  }
});

test('master clip is monotonic and odd-symmetric', () => {
  let previous = applyMasterClip(-MASTER_CLIP_DOMAIN);
  for (let step = 1; step <= 400; step += 1) {
    const sample = -MASTER_CLIP_DOMAIN + (step / 400) * 2 * MASTER_CLIP_DOMAIN;
    const value = applyMasterClip(sample);
    assert.ok(value >= previous - 1e-6, `curve dipped at ${sample}`);
    assert.ok(Math.abs(value + applyMasterClip(-sample)) < 1e-4, `curve is asymmetric at ${sample}`);
    previous = value;
  }
});

test('master clip curve has an odd length so zero is sampled exactly', () => {
  assert.equal(MASTER_CLIP_CURVE.length % 2, 1);
  assert.equal(MASTER_CLIP_CURVE[(MASTER_CLIP_CURVE.length - 1) / 2], 0);
});
