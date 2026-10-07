import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePresetData } from '../src/presets.js';
import { normalizeDevelopment } from '../src/domain/development.js';
import { renderDevelopment } from '../src/audio/developmentRender.js';

function phrase(sequence: string, filtered: boolean, glide = 0) {
  return normalizePresetData({ bpm: 137, forte: '7-35.00', masterGain: 0,
    reverb: { enabled: false, dry: 0 }, tracks: [{
      id: 'mono', sequenceInput: sequence, denominator: 4, polyphony: 1,
      waveform: 'sine', partialGenerator: { type: 'waveform', harmonicCount: 1 },
      attack: 0.01, decay: 0.01, sustain: 1, release: 0.01,
      gain: -12, limiterGain: -24, velocityMultiplier: 1,
      monoLegato: true, glideTime: glide, glideMode: 'legato',
      filterEnabled: filtered, filterFrequency: 60, filterQ: 1, filterKeyFollow: 0,
      filterEnvelopeAmount: 0, filterLfoEnabled: false,
      reverbWet: -96, echoEnabled: false, fadeIn: 0, fadeOut: 0,
      development: normalizeDevelopment({ enabled: true, patterns: [{
        id: 'p', name: 'Phrase', sequence, steps: [
          { step: 0, durationBeats: 1, velocity: 0.7 },
          { step: 1, durationBeats: 0.75, velocity: 0.7 },
        ] }], sections: [{ id: 's', name: 'Section', pattern: 'p', length: 1, unit: 'beats' }] }),
    }] });
}

for (const filtered of [false, true]) {
  test('same-pitch mono legato is a continuous held voice ('+(filtered ? 'filtered' : 'bypass')+') at fractional frame joins', async () => {
    const held = await renderDevelopment(phrase('1 0 0 0', filtered));
    const joined = await renderDevelopment(phrase('1 1 0 0', filtered));
    const first = Math.round(0.05 * joined.sampleRate), last = Math.round(0.3 * joined.sampleRate);
    let error = 0;
    for (let channel = 0; channel < 2; channel++) {
      for (let i = first; i < last; i++) error = Math.max(error, Math.abs(held.channels[channel][i] - joined.channels[channel][i]));
    }
    assert.ok(error < 2e-6, 'Continuous voice differs by '+error);
  });
}
test('a filtered octave glide has no note-boundary impulse', async () => {
  const result = await renderDevelopment(phrase('1 128 0 0', true, 0.08));
  const join = Math.floor(60 / 137 / 4 * result.sampleRate), channel = result.channels[0];
  const delta = (i: number) => Math.abs(channel[i] - channel[i - 1]);
  let interior = 0, edge = 0;
  for (let i = join - 1200; i < join - 240; i++) interior = Math.max(interior, delta(i));
  for (let i = join - 3; i < join + 4; i++) edge = Math.max(edge, delta(i));
  assert.ok(edge < interior * 2.2, 'Glide edge '+edge+' exceeds periodic slope '+interior);
  assert.ok(channel.every(Number.isFinite));
});
