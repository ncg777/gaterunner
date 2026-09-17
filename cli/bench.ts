#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { generateWav, type GenerateOptions } from './generate.js';

interface BenchmarkFixture {
  name: string;
  options: GenerateOptions;
}

const fixtures: BenchmarkFixture[] = [
  {
    name: 'full-audio-chain',
    options: {
      bpm: 132,
      tracks: [{
        sequence: '3 5 9 17', denominator: 8, repeats: 2, phase: 0.25,
        partialGenerator: { type: 'waveform' }, waveform: 'sawtooth', unisonVoices: 3,
        filterEnabled: true, filterRolloff: -48, filterLfoEnabled: true,
        filterEnvelopeAmount: 12, filterFrequency: 80,
        vibratoEnabled: true, tremoloEnabled: true, chorusEnabled: true,
        flangerEnabled: true, phaserEnabled: true, echoEnabled: true,
        echoFeedback: 0.4, echoWet: -12, reverbWet: -18, gain: -12,
      }],
      reverb: { enabled: true, decay: 0.5, preDelay: 0.02 },
    },
  },
  {
    name: 'sine-polyphonic',
    options: {
      bpm: 132,
      forte: '5-35.05',
      tracks: [{
        sequence: '3 12 17 24 9 18 5 20',
        denominator: 8,
        repeats: 8,
        waveform: 'sine',
        polyphony: 8,
        unisonVoices: 2,
        release: 0.4,
      }],
      reverb: { enabled: false },
    },
  },
  {
    name: 'pulse-unison',
    options: {
      bpm: 140,
      forte: '5-35.05',
      tracks: [{
        sequence: '7 25 14 28 19 11 21 13',
        denominator: 8,
        repeats: 4,
        waveform: 'pulse-12',
        polyphony: 8,
        unisonVoices: 4,
        unisonDetune: 28,
        tonewheelDrawbars: [0, 0, 5, 8, 4, 0, 0, 0, 0],
      }],
      reverb: { enabled: false },
    },
  },
  {
    name: 'flute-breath-filter',
    options: {
      bpm: 105,
      forte: '5-35.05',
      tracks: [{
        sequence: '1 2 4 8 16 8 4 2',
        denominator: 8,
        repeats: 6,
        waveform: 'flute',
        breathEnabled: true,
        breathLevel: -24,
        filterEnabled: true,
        filterFrequency: 96,
        filterEnvelopeAmount: 14,
        filterEnvelopeAttack: 0.03,
        filterEnvelopeDecay: 0.2,
        filterEnvelopeSustain: 0.35,
      }],
      reverb: { enabled: false },
    },
  },
  {
    name: 'vector-wavetable',
    options: {
      bpm: 120,
      forte: '5-35.05',
      tracks: [{
        sequence: '3 5 9 17 6 10 18 12',
        denominator: 8,
        repeats: 5,
        waveform: 'sawtooth',
        tonewheelDrawbars: [0, 0, 8, 5, 0, 0, 0, 0, 0],
        tonewheelWavetable: {
          enabled: true,
          dimensions: [{ name: 'Brightness', value: 0.4 }],
          configurations: [
            { name: 'Dark', position: [0], drawbars: [0, 0, 8, 2, 0, 0, 0, 0, 0] },
            { name: 'Bright', position: [1], drawbars: [0, 0, 5, 8, 6, 4, 2, 0, 0] },
          ],
          lfos: [{
            name: 'Sweep', enabled: true, waveform: 'sine', sync: false, rateHz: 0.7,
            syncRate: '1/4', phase: 0, depth: 0.5, polarity: 'bipolar', retrigger: 'free',
            smoothing: 0.2, fmSource: -1, fmAmount: 0, routes: [1],
          }],
        },
      }],
      reverb: { enabled: false },
    },
  },
  {
    name: 'rhythmic-kit',
    options: {
      bpm: 128,
      tracks: [{
        trackKind: 'rhythmic',
        denominator: 4,
        repeats: 8,
        sequence: '7 1 9 1 6 1 9 1 7 1 9 1 6 1 13 1',
        drumVelocityBits: 1,
        drumLanes: [
          { voiceId: 'kick', xorGroup: 0, parameters: {} },
          { voiceId: 'snare', xorGroup: 0, parameters: {} },
          { voiceId: 'hat', xorGroup: 1, parameters: {} },
          { voiceId: 'hatOpen', xorGroup: 1, parameters: {} },
        ],
      }],
      reverb: { enabled: false },
    },
  },
];

const longFixtures: BenchmarkFixture[] = [
  {
    name: 'long-static-filter',
    options: {
      bpm: 90,
      tracks: [{
        sequence: '7 11 13 19',
        repeats: 64,
        unisonVoices: 4,
        filterEnabled: true,
        filterType: 'peaking',
        filterGain: 6,
        filterFrequency: 86,
        filterKeyFollow: 60,
      }],
      reverb: { enabled: false },
    },
  },
  {
    name: 'long-multi-track',
    options: {
      bpm: 120,
      tracks: Array.from({ length: 12 }, (_, index) => ({
        sequence: '1 2 4 8',
        repeats: 64,
        denominator: 1,
        delay: index % 3,
        unisonVoices: 2,
        waveform: 'sine',
        gain: -18,
      })),
      reverb: { enabled: true, decay: 2 },
    },
  },
];

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

function readInt24(bytes: Uint8Array, offset: number): number {
  const unsigned = bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
  return unsigned & 0x800000 ? unsigned - 0x1000000 : unsigned;
}

function comparePcm(reference: Uint8Array, actual: Uint8Array): { peak: number; rms: number } {
  if (reference.length !== actual.length) {
    return { peak: Number.POSITIVE_INFINITY, rms: Number.POSITIVE_INFINITY };
  }

  let peak = 0;
  let sumSquares = 0;
  let samples = 0;
  for (let offset = 44; offset + 2 < actual.length; offset += 3) {
    const difference = (readInt24(actual, offset) - readInt24(reference, offset)) / 0x800000;
    peak = Math.max(peak, Math.abs(difference));
    sumSquares += difference * difference;
    samples += 1;
  }
  return { peak, rms: Math.sqrt(sumSquares / Math.max(1, samples)) };
}

function argumentValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

async function main(): Promise<void> {
  const writeReferenceDirectory = argumentValue('--write-reference');
  const referenceDirectory = argumentValue('--reference') ?? writeReferenceDirectory;
  const threadArgument = argumentValue('--threads');
  const threads = threadArgument === null ? undefined : Number(threadArgument);
  if (writeReferenceDirectory) {
    mkdirSync(resolve(writeReferenceDirectory), { recursive: true });
  }

  let failed = false;
  const selectedFixtures = process.argv.includes('--long') ? [...fixtures, ...longFixtures] : fixtures;
  for (const fixture of selectedFixtures) {
    const start = performance.now();
    const bytes = await generateWav(fixture.options, { threads });
    const elapsed = performance.now() - start;
    const referencePath = referenceDirectory
      ? resolve(referenceDirectory, `${fixture.name}.wav`)
      : null;
    let comparison = '';

    if (referencePath && writeReferenceDirectory) {
      writeFileSync(referencePath, bytes);
      comparison = ' reference-written';
    } else if (referencePath && existsSync(referencePath)) {
      const reference = new Uint8Array(readFileSync(referencePath));
      const difference = comparePcm(reference, bytes);
      comparison = ` peak=${difference.peak.toExponential(3)} rms=${difference.rms.toExponential(3)}`;
      failed ||= difference.peak > 1e-5;
    } else if (referencePath) {
      comparison = ' reference-missing';
      failed = true;
    }

    console.log(`${fixture.name.padEnd(22)} ${elapsed.toFixed(1).padStart(9)} ms  ${hash(bytes)}${comparison}`);
  }

  if (failed) {
    process.exitCode = 1;
  }
}

await main();
