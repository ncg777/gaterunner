import assert from 'node:assert/strict';
import test from 'node:test';
import { getLfoFrequencyHz, getLfoSyncRateHz, getLfoSyncRateSeconds } from '../audio/lfo.js';
import { MasterPulseDSP, masterPulseFrequency, normalizeMasterPulse } from '../audio/masterPulse.js';
import { arePresetDataEqual, buildDraftFromUrl, clonePresetData, normalizePresetData } from '../presets.js';
import { presetDataToGeneratorInput } from '../../cli/cli.js';
import { renderWavChannels } from '../../cli/generate.js';

const divisions = [
  { division: '1/64', beats: 1 / 16 },
  { division: '1/64D', beats: 3 / 32 },
  { division: '1/64T', beats: 1 / 24 },
] as const;

for (const { division, beats } of divisions) {
  test(`${division} follows BPM in shared LFO timing and the Master Pulse envelope`, () => {
    const settings = normalizeMasterPulse({ enabled: true, rateMode: 'sync', division, depth: 1, shape: 'sine' });
    assert.equal(settings.division, division);
    for (const bpm of [60, 120, 300]) {
      const seconds = 60 / bpm * beats;
      const hz = 1 / seconds;
      assert.ok(Math.abs(getLfoSyncRateSeconds(division, bpm) - seconds) < 1e-12);
      assert.ok(Math.abs(getLfoSyncRateHz(division, bpm) - hz) < 1e-10);
      assert.ok(Math.abs(getLfoFrequencyHz({ sync: true, syncRate: division, rateHz: 1, bpm }) - hz) < 1e-10);
      assert.ok(Math.abs(masterPulseFrequency(settings, bpm) - hz) < 1e-10);
      const sampleRate = 48000;
      const dsp = new MasterPulseDSP(sampleRate, settings, bpm);
      for (let frame = 0; frame < 4800; frame++) {
        const expected = 0.5 + 0.5 * Math.cos(2 * Math.PI * frame / sampleRate / seconds);
        assert.ok(Math.abs(dsp.nextGain() - expected) < 1e-10, `${division} at ${bpm} BPM, frame ${frame}`);
      }
    }
  });

  test(`${division} survives preset normalization, cloning, JSON, URLs and renderer conversion for every control`, () => {
    const original = normalizePresetData({
      masterPulse: { enabled: true, rateMode: 'sync', division },
      tracks: [{
        id: 'tempo-test', echoDelay: division, filterLfoRate: division,
        chorusRate: division, flangerRate: division, phaserRate: division,
        modulation: { sources: [{ id: 'fast', type: 'lfo', sync: true, syncRate: division }] },
        tonewheelWavetable: {
          enabled: true, dimensions: [{ name: 'Morph', value: 0.5 }],
          configurations: [{ name: 'A', position: [0], drawbars: Array(9).fill(0) }],
          lfos: [{ sync: true, syncRate: division }],
        },
      }],
    });
    const roundTrips = [original, clonePresetData(original), normalizePresetData(JSON.parse(JSON.stringify(original))),
      buildDraftFromUrl(`?project=${encodeURIComponent(JSON.stringify(original))}`, normalizePresetData({}))];
    for (const project of roundTrips) {
      assert.ok(arePresetDataEqual(project, original));
      assert.equal(project.masterPulse!.division, division);
      const track = project.tracks[0];
      for (const field of ['echoDelay', 'filterLfoRate', 'chorusRate', 'flangerRate', 'phaserRate'] as const) {
        assert.equal(track[field], division, field);
      }
      const source = track.modulation!.sources[0];
      assert.equal(source.type, 'lfo');
      if (source.type === 'lfo') assert.equal(source.syncRate, division);
      assert.equal(track.tonewheelWavetable.lfos[0].syncRate, division);
      const input = presetDataToGeneratorInput(project);
      assert.deepEqual(input.masterPulse, project.masterPulse);
      for (const field of ['echoDelay', 'filterLfoRate', 'chorusRate', 'flangerRate', 'phaserRate', 'modulation', 'tonewheelWavetable'] as const) {
        assert.deepEqual(input.tracks![0][field], track[field], field);
      }
    }
  });

  test(`${division} renders echo at its exact duration instead of falling back to a quarter note`, async () => {
    const options = { bpm: 120, sequence: '1', denominator: 64, gain: -18, release: 0.001,
      reverb: { enabled: false }, echoEnabled: true, echoFeedback: 0, echoWet: 0, echoPingPong: false };
    const symbolic = await renderWavChannels({ ...options, echoDelay: division });
    const numeric = await renderWavChannels({ ...options, echoDelay: 60 / options.bpm * beats });
    assert.ok(symbolic.left.some(value => value !== 0));
    assert.deepEqual(symbolic.left, numeric.left);
    assert.deepEqual(symbolic.right, numeric.right);
  });
}
