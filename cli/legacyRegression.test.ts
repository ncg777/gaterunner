import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { generateWav, generateMidi, renderWavChannels } from './generate.js';
const baseline = JSON.parse(readFileSync(new URL('./fixtures/legacy-2026.10.3.json', import.meta.url), 'utf8'));
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
for (const fixture of baseline.fixtures) test(`pre-change legacy fingerprint: ${fixture.name}`, async () => {
  assert.equal(digest(await generateMidi(fixture.input)), fixture.midi);
  const channels = await renderWavChannels(fixture.input);
  assert.equal(digest(new Uint8Array(channels.left.buffer)), fixture.left);
  assert.equal(digest(new Uint8Array(channels.right.buffer)), fixture.right);
  assert.equal(digest(await generateWav(fixture.input, { threads: 1 })), fixture.wav);
  assert.equal(digest(await generateWav(fixture.input, { threads: 3 })), fixture.wav);
});
