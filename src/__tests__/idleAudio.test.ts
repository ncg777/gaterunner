import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioIdleGate } from '../audio/idleAudio.js';

test('idle gate protects queued notes and restarts its silence window for delayed echoes', () => {
  const gate = new AudioIdleGate();
  assert.equal(gate.ready(0, 0, 2, 1), false);
  assert.equal(gate.ready(1, 0, 2, 1), false);
  assert.equal(gate.ready(2, 0, 2, 1), false);
  assert.equal(gate.ready(2.8, 0.1, 2, 1), false);
  assert.equal(gate.ready(3, 0, 2, 1), false);
  assert.equal(gate.ready(3.9, 0, 2, 1), false);
  assert.equal(gate.ready(4.1, 0, 2, 1), true);
});

test('non-finite output never counts as silence', () => {
  const gate = new AudioIdleGate();
  gate.ready(0, 0, 0, 1);
  assert.equal(gate.ready(2, NaN, 0, 1), false);
  assert.equal(gate.ready(3, 0, 0, 1), false);
  assert.equal(gate.ready(4.1, 0, 0, 1), true);
});
