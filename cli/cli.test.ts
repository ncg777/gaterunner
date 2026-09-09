import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ToneMidi from '@tonejs/midi';
import { generateMidi, generateWav, type GenerateOptions } from './generate.js';
import { presetDataToGeneratorInput } from './cli.js';
import { parsePresetImportPayload } from '../src/presets.js';
import { normalizeWaveshaperSettings } from '../src/audio/waveshaper.js';

const { Midi } = ToneMidi;

const customWaveshaper = normalizeWaveshaperSettings({
  enabled: true, curve: 'custom', expression: 'sin(amount*x)', dcBlock: false,
  customParameters: [{ name: 'amount', value: 7, min: 0, max: 12, step: 0.1 }],
});

test('legacy flags and tracks JSON forward limiter gain and custom waveshaper settings', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'gaterunner-cli-drive-'));
  try {
    for (const useTracks of [false, true]) {
      const outputPath = join(tempDir, `${useTracks}.wav`);
      const track = { sequence: '1', denominator: 16, limiterGain: 18, waveshaper: customWaveshaper };
      const args = useTracks
        ? ['--tracks', JSON.stringify([track])]
        : ['--sequence', '1', '--denominator', '16', '--limiter-gain', '18', '--waveshaper', JSON.stringify(customWaveshaper)];
      const result = spawnSync(process.execPath, ['--import', 'tsx', 'cli/cli.ts', '--output', outputPath,
        '--format', 'wav', '--bpm', '240', '--reverb', '{"enabled":false}', ...args], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      const expected = await generateWav({ bpm: 240, reverb: { enabled: false },
        ...(useTracks ? { tracks: [track] } : track) });
      assert.deepEqual(readFileSync(outputPath), Buffer.from(expected));
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('preset import forwards normalized limiter and waveshaper fields to the generator', () => {
  const imported = parsePresetImportPayload(JSON.stringify({
    version: 2, kind: 'single-preset', exportedAt: new Date(0).toISOString(),
    preset: { id: 'drive', name: 'Drive', createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
      folderId: null, data: { bpm: 240, a4: 440, forte: '5-35.05', tracks: [
        { id: 'drive-track', name: 'Drive', sequenceInput: '1', limiterGain: 27, waveshaper: customWaveshaper },
      ] } },
  }));
  assert.equal(imported.kind, 'single-preset');
  if (imported.kind !== 'single-preset') throw new Error('Expected single preset');
  const input = presetDataToGeneratorInput(imported.preset.data);
  assert.equal(input.tracks[0].limiterGain, 27);
  assert.deepEqual(input.tracks[0].waveshaper, customWaveshaper);
});

test('CLI rejects malformed waveshaper JSON', () => {
  for (const json of ['{', '[]', 'null']) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'cli/cli.ts', '--output', 'unused.wav',
      '--waveshaper', json], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid --waveshaper JSON/);
  }
});

test('cli accepts a preset JSON file and writes output', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'gaterunner-cli-'));
  const presetPath = join(tempDir, 'preset.json');
  const outputPath = join(tempDir, 'output.mid');

  const presetPayload = {
    version: 2,
    kind: 'single-preset',
    exportedAt: new Date(0).toISOString(),
    preset: {
      id: 'preset-1',
      name: 'Test preset',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      folderId: null,
      data: {
        bpm: 120,
        a4: 440,
        forte: '5-35.05',
        tracks: [
          {
            id: 'track-1',
            name: 'Track 1',
            numerator: 4,
            denominator: 4,
            phase: 0,
            waveform: 'sine',
            sequenceInput: '1 2 4 8',
            octave: 4,
            lengthFactor: 100,
            lengthOffset: 0,
            midiChannel: 1,
            gain: -6,
            velocityMultiplier: 1,
            delay: 0,
            repeats: 1,
            timeWarpEnabled: false,
            timeWarpCurve: 'linear',
            timeWarpExpression: '',
            timeWarpRepeats: 1,
            timeWarpAmount: 100,
            timeWarpQuantize: 0,
            timeWarpNoteLengths: true,
            attack: 0.01,
            decay: 0,
            sustain: 1,
            release: 0.12,
          },
        ],
        reverb: {
          enabled: true,
          decay: 8,
          preDelay: 0.04,
          dry: 0,
          wet: -2,
          lowCut: 39,
          highCut: 112,
        },
      },
    },
  };

  writeFileSync(presetPath, JSON.stringify(presetPayload, null, 2), 'utf8');

  try {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'cli/cli.ts', '--output', outputPath, '--preset', presetPath],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    );

    assert.equal(result.status, 0, `Expected CLI to succeed, got status ${result.status}.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
    assert.ok(existsSync(outputPath), 'Expected output MIDI file to be written');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('cli honors song-level bitmask sequence B with note clipping', async () => {
  // Two tracks, one step each, 1s step at 60 BPM / denominator 1.
  // Loop = 2s (two repeats). B = "1 2" activates track 0 then track 1 for 1s each.
  // Track 0 starts a long note in chunk 0 and must clip at the chunk boundary.
  const midiBytes = await generateMidi({
    bpm: 60,
    a4: 440,
    forte: '5-35.05',
    bitmaskSequenceInput: '1 2',
    tracks: [
      {
        name: 'Track A',
        numerator: 4,
        denominator: 1,
        sequence: '1',
        octave: 4,
        lengthFactor: 400,
        lengthOffset: 0,
        midiChannel: 1,
        delay: 0,
        repeats: 2,
        timeWarpEnabled: false,
      },
      {
        name: 'Track B',
        numerator: 4,
        denominator: 1,
        sequence: '1',
        octave: 5,
        lengthFactor: 100,
        lengthOffset: 0,
        midiChannel: 2,
        delay: 0,
        repeats: 2,
        timeWarpEnabled: false,
      },
    ],
  });

  const midi = new Midi(midiBytes);
  assert.equal(midi.tracks.length, 2);

  const trackANotes = midi.tracks[0].notes;
  const trackBNotes = midi.tracks[1].notes;

  // Track A active only in chunk 0 (first second). One onset at t=0, clipped to 1s.
  assert.equal(trackANotes.length, 1);
  assert.ok(Math.abs(trackANotes[0].time - 0) < 1e-6);
  assert.ok(Math.abs(trackANotes[0].duration - 1) < 1e-6);

  // Track B active only in chunk 1. One onset at t=1 (second repeat).
  assert.equal(trackBNotes.length, 1);
  assert.ok(Math.abs(trackBNotes[0].time - 1) < 1e-6);
  assert.ok(trackBNotes[0].duration > 0);
});

test('cli --preset JSON carries bitmaskSequenceInput into MIDI output', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'gaterunner-cli-b-'));
  const presetPath = join(tempDir, 'preset.json');
  const outputPath = join(tempDir, 'output.mid');

  const presetPayload = {
    version: 2,
    kind: 'single-preset',
    exportedAt: new Date(0).toISOString(),
    preset: {
      id: 'preset-b',
      name: 'Bitmask preset',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      folderId: null,
      data: {
        bpm: 60,
        a4: 440,
        forte: '5-35.05',
        bitmaskSequenceInput: '1 0',
        tracks: [
          {
            id: 'track-1',
            name: 'Track 1',
            numerator: 4,
            denominator: 1,
            phase: 0,
            waveform: 'sine',
            sequenceInput: '1',
            octave: 4,
            lengthFactor: 100,
            lengthOffset: 0,
            midiChannel: 1,
            gain: -6,
            velocityMultiplier: 1,
            delay: 0,
            repeats: 2,
            timeWarpEnabled: false,
            timeWarpCurve: 'linear',
            timeWarpExpression: '',
            timeWarpRepeats: 1,
            timeWarpAmount: 100,
            timeWarpQuantize: 0,
            timeWarpNoteLengths: true,
            attack: 0.01,
            decay: 0,
            sustain: 1,
            release: 0.12,
          },
        ],
        reverb: {
          enabled: false,
          decay: 8,
          preDelay: 0.04,
          dry: 0,
          wet: -2,
          lowCut: 39,
          highCut: 112,
        },
      },
    },
  };

  writeFileSync(presetPath, JSON.stringify(presetPayload, null, 2), 'utf8');

  try {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'cli/cli.ts', '--output', outputPath, '--preset', presetPath],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    );

    assert.equal(result.status, 0, `Expected CLI to succeed, got status ${result.status}.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
    assert.ok(existsSync(outputPath), 'Expected output MIDI file to be written');

    const midi = new Midi(readFileSync(outputPath));
    assert.equal(midi.tracks.length, 1);
    // Only the first of two repeats is active under B="1 0".
    assert.equal(midi.tracks[0].notes.length, 1);
    assert.ok(Math.abs(midi.tracks[0].notes[0].time - 0) < 1e-6);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('rhythmic tracks export GM notes with BigInt-safe per-lane velocities', async () => {
  const midiBytes = await generateMidi({
    bpm: 60,
    forte: '5-35.05',
    tracks: [{
      name: 'GM Kit',
      trackKind: 'rhythmic',
      drumLanes: [
        { voiceId: 'kick', parameters: {}, xorGroup: 0 },
        { voiceId: 'snare', parameters: {}, xorGroup: 0 },
        { voiceId: 'hat', parameters: {}, xorGroup: 0 },
      ],
      drumVelocityBits: 2,
      numerator: 1,
      denominator: 1,
      sequence: '1 4 16 5 18446744073709551617',
      lengthFactor: 100,
      lengthOffset: 0,
      midiChannel: 10,
      repeats: 1,
      delay: 0,
      timeWarpEnabled: false,
    }],
  });

  const midi = new Midi(midiBytes);
  assert.equal(midi.tracks.length, 1);
  assert.equal(midi.tracks[0].channel, 9);
  assert.deepEqual(midi.tracks[0].notes.map((note) => note.midi), [36, 38, 42, 36, 38, 36]);
  assert.deepEqual(midi.tracks[0].notes.slice(0, 3).map((note) => Number(note.velocity.toFixed(6))), [42 / 127, 42 / 127, 42 / 127].map((velocity) => Number(velocity.toFixed(6))));
});

test('track padding silences repeat with each sequence after the one-time delay', async () => {
  const midiBytes = await generateMidi({
    bpm: 60,
    tracks: [{
      numerator: 1,
      denominator: 1,
      sequence: '1 2',
      octave: 5,
      delay: 1,
      paddingBefore: 0.5,
      paddingAfter: 0.25,
      repeats: 2,
    }],
  });

  const midi = new Midi(midiBytes);
  assert.deepEqual(
    midi.tracks[0].notes.map((note) => Number(note.time.toFixed(6))),
    [1.5, 2.5, 4.25, 5.25],
  );
});

test('rhythmic tracks render synthesized audio in CLI WAV output', async () => {
  const wavBytes = await generateWav({
    bpm: 60,
    tracks: [{
      name: 'WAV Kit',
      trackKind: 'rhythmic',
      drumLanes: [{ voiceId: 'kick', parameters: { tune: 55, decay: 0.25 }, xorGroup: 0 }],
      drumVelocityBits: 1,
      numerator: 1,
      denominator: 1,
      sequence: '1',
      lengthFactor: 100,
      lengthOffset: 0,
      midiChannel: 10,
      repeats: 1,
      delay: 0,
      timeWarpEnabled: false,
    }],
    reverb: { enabled: false },
  });

  assert.equal(Buffer.from(wavBytes.subarray(0, 4)).toString('ascii'), 'RIFF');
  assert.ok(wavBytes.length > 44);
  assert.ok(wavBytes.subarray(44).some((value) => value !== 0));
});

test('WAV worker threads preserve deterministic multi-track output', async () => {
  const options: GenerateOptions = {
    bpm: 120,
    forte: '5-35.05',
    tracks: [
      {
        name: 'Pulse',
        denominator: 8,
        sequence: '3 5 9 17',
        repeats: 1,
        waveform: 'pulse-25',
        fadeIn: 0.125,
        reverbWet: -18,
      },
      {
        name: 'Sine',
        denominator: 8,
        sequence: '7 11 13 19',
        repeats: 1,
        waveform: 'sine',
        fadeOut: 0.125,
        reverbWet: -12,
      },
    ],
    reverb: { enabled: true, decay: 0.2, preDelay: 0, wet: -16 },
  };

  const inline = await generateWav(options, { threads: 1 });
  const parallel = await generateWav(options, { threads: 2 });

  assert.deepEqual(parallel, inline);
});

test('rhythmic WAV export remains valid across time-warp curves', async () => {
  const curves = ['invlin', 'dip', 'step16', 'bounceout', 'sin8', 'f5', 'fm_strong3'];
  for (const curve of curves) {
    const wavBytes = await generateWav({
      bpm: 120,
      tracks: [{
        name: `Warped ${curve}`,
        trackKind: 'rhythmic',
        drumLanes: [
          { voiceId: 'kick', parameters: {}, xorGroup: 0 },
          { voiceId: 'snare', parameters: {}, xorGroup: 0 },
          { voiceId: 'clap', parameters: {}, xorGroup: 0 },
          { voiceId: 'shaker', parameters: {}, xorGroup: 0 },
        ],
        drumVelocityBits: 2,
        numerator: 1,
        denominator: 8,
        sequence: '1 2 4 8',
        lengthFactor: 100,
        lengthOffset: 0,
        midiChannel: 10,
        repeats: 1,
        delay: 0,
        timeWarpEnabled: true,
        timeWarpCurve: curve,
        timeWarpRepeats: 2,
        timeWarpAmount: 100,
        timeWarpNoteLengths: true,
      }],
      reverb: { enabled: false },
    });

    assert.equal(Buffer.from(wavBytes.subarray(0, 4)).toString('ascii'), 'RIFF', curve);
    assert.ok(wavBytes.length > 44, `${curve} should produce WAV payload`);
    assert.ok(wavBytes.subarray(44).some((value) => value !== 0), `${curve} should produce audio`);
  }

  const customWav = await generateWav({
    bpm: 120,
    tracks: [{
      trackKind: 'rhythmic',
      drumLanes: [{ voiceId: 'clap', parameters: {}, xorGroup: 0 }],
      sequence: '1 1 1 1',
      denominator: 8,
      timeWarpEnabled: true,
      timeWarpCurve: 'custom',
      timeWarpExpression: '1 / (T - T)',
      timeWarpAmount: 100,
    }],
    reverb: { enabled: false },
  });
  assert.equal(Buffer.from(customWav.subarray(0, 4)).toString('ascii'), 'RIFF');
  assert.ok(customWav.subarray(44).some((value) => value !== 0));
});

test('CLI WAV output applies per-track fade in and fade out in bars', async () => {
  const wavBytes = await generateWav({
    bpm: 60,
    tracks: [{
      numerator: 1,
      denominator: 1,
      sequence: '1 1',
      octave: 5,
      lengthFactor: 100,
      repeats: 1,
      fadeIn: 0.5,
      fadeOut: 0.5,
    }],
    reverb: { enabled: false },
  });

  const pcm = new DataView(wavBytes.buffer, wavBytes.byteOffset + 44, wavBytes.byteLength - 44);
  const averageAmplitude = (startSeconds: number, endSeconds: number): number => {
    const startOffset = Math.floor(startSeconds * 48000) * 6;
    const endOffset = Math.min(pcm.byteLength, Math.floor(endSeconds * 48000) * 6);
    let total = 0;
    let samples = 0;
    for (let offset = startOffset; offset + 2 < endOffset; offset += 6) {
      const raw = pcm.getUint8(offset) | (pcm.getUint8(offset + 1) << 8) | (pcm.getUint8(offset + 2) << 16);
      total += Math.abs((raw & 0x800000) !== 0 ? raw - 0x1000000 : raw);
      samples += 1;
    }
    return total / samples;
  };

  const fadeInAmplitude = averageAmplitude(0.05, 0.15);
  const middleAmplitude = averageAmplitude(0.8, 1.2);
  const fadeOutAmplitude = averageAmplitude(1.85, 1.95);
  assert.ok(middleAmplitude > fadeInAmplitude * 3, `${middleAmplitude} should exceed fade-in amplitude ${fadeInAmplitude}`);
  assert.ok(middleAmplitude > fadeOutAmplitude * 3, `${middleAmplitude} should exceed fade-out amplitude ${fadeOutAmplitude}`);
});

test('legacy FM and virtual-analog settings are silently normalized to tonewheel rendering', async () => {
  const track = {
    name: 'Legacy Synth',
    trackKind: 'melodic' as const,
    waveform: 'triangle',
    numerator: 1,
    denominator: 4,
    sequence: '1',
    octave: 5,
    lengthFactor: 100,
    lengthOffset: 0,
    midiChannel: 1,
    repeats: 1,
    delay: 0,
    timeWarpEnabled: false,
  };
  const tonewheel = await generateWav({
    bpm: 120,
    tracks: [track],
    reverb: { enabled: false },
  });
  const legacyFm = await generateWav({
    bpm: 120,
    tracks: [{
      ...track,
      generatorType: 'fm',
      fmSynth: { algorithm: 8, modulationIndex: 32 },
    }],
    reverb: { enabled: false },
  });
  const legacyVirtualAnalog = await generateWav({
    bpm: 120,
    tracks: [{
      ...track,
      generatorType: 'virtual-analog',
      virtualAnalogSynth: { drift: 25, ringMod: 1 },
    }],
    reverb: { enabled: false },
  });

  assert.deepEqual(legacyFm, tonewheel);
  assert.deepEqual(legacyVirtualAnalog, tonewheel);
});

test('flute with breath noise renders audible deterministic CLI audio', async () => {
  const options = {
    bpm: 120,
    tracks: [{
      name: 'Breathy Flute',
      trackKind: 'melodic' as const,
      waveform: 'flute',
      breathEnabled: true,
      breathLevel: -18,
      breathHarmonic: 5,
      numerator: 1,
      denominator: 4,
      sequence: '1',
      octave: 5,
      lengthFactor: 100,
      lengthOffset: 0,
      midiChannel: 1,
      repeats: 1,
      delay: 0,
      timeWarpEnabled: false,
    }],
    reverb: { enabled: false },
  };
  const first = await generateWav(options);
  const second = await generateWav(options);

  assert.equal(Buffer.from(first.subarray(0, 4)).toString('ascii'), 'RIFF');
  assert.deepEqual(first, second, 'breath-noise rendering must be reproducible');
  const pcm = new DataView(first.buffer, first.byteOffset + 44, first.byteLength - 44);
  let peak = 0;
  for (let offset = 0; offset + 1 < pcm.byteLength; offset += 2) {
    peak = Math.max(peak, Math.abs(pcm.getInt16(offset, true)));
  }
  assert.ok(peak > 100, `expected audible flute output, got PCM peak ${peak}`);
});

test('reed waveforms render audible, deterministic and distinct CLI audio', async () => {
  const renders: Uint8Array[] = [];
  for (const waveform of ['sine', 'oboe', 'clarinet', 'saxophone']) {
    const options = {
      bpm: 120,
      tracks: [{
        waveform,
        sequence: '1',
        numerator: 1,
        denominator: 4,
        octave: 4,
        tonewheelDrawbars: [0, 0, 8, 0, 0, 0, 0, 0, 0],
      }],
      reverb: { enabled: false },
    };
    const wav = await generateWav(options);
    assert.deepEqual(wav, await generateWav(options), `${waveform} must render reproducibly`);
    const pcm = new DataView(wav.buffer, wav.byteOffset + 44, wav.byteLength - 44);
    let peak = 0;
    for (let offset = 0; offset + 1 < pcm.byteLength; offset += 2) {
      peak = Math.max(peak, Math.abs(pcm.getInt16(offset, true)));
    }
    assert.ok(peak > 100, `expected audible ${waveform} output, got PCM peak ${peak}`);
    for (const previous of renders) {
      assert.notDeepEqual(wav, previous, `${waveform} must have a distinct timbre`);
    }
    renders.push(wav);
  }
});

test('unknown generator values fall back to tonewheel rendering', async () => {
  const wav = await generateWav({
    tracks: [{
      generatorType: 'unsupported' as never,
      sequence: '1',
      repeats: 1,
    }],
    reverb: { enabled: false },
  });

  assert.equal(Buffer.from(wav.subarray(0, 4)).toString('ascii'), 'RIFF');
  assert.ok(wav.byteLength > 44);
});
