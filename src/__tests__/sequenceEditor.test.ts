import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editableSequence, toggleSequenceCell } from '../domain/sequenceEditor.js';

test('visual editing preserves unsupported melodic input for the original editor', () => {
  for (const input of ['-3 1', '1.5 2', '1 x', '9007199254740992']) assert.equal(editableSequence(input, false), null);
  assert.deepEqual(editableSequence('', false), []);
  assert.deepEqual(editableSequence(' 1  3\n0 ', false), [1n, 3n, 0n]);
});

test('toggling a melodic chord preserves other pitches and steps', () => {
  assert.equal(toggleSequenceCell([5n, 8n], 0, 1), '7 8');
  assert.equal(toggleSequenceCell([7n, 8n], 0, 1), '5 8');
  assert.equal(toggleSequenceCell([0n], 0, 52), '4503599627370496');
});

test('drum editing preserves velocity groups and masks larger than JS integers', () => {
  // The drum decoder rejects leading zeroes; the grid must not silently rewrite them.
  assert.equal(editableSequence('01 2', true), null);
  const mask = (2n << 60n) | 5n;
  const values = editableSequence(`${mask} 0`, true)!;
  assert.equal(toggleSequenceCell(values, 0, 1, 3), `${mask | 56n} 0`);
  assert.equal(toggleSequenceCell(values, 0, 0, 3), `${2n << 60n} 0`);
  assert.equal(toggleSequenceCell(values, 1, 20, 3), `${mask} ${7n << 60n}`);
});
