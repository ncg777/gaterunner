/** Run only against the pre-development engine to establish golden fixtures. */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import type { GenerateOptions } from './generate.js';

// An immutable archive is required so this command cannot bless a changed engine.
if(!process.argv[2]||!/^[a-f0-9]{40}$/.test(process.argv[3] ?? ''))throw new Error('Pass the root of a clean pre-change Git archive and its original 40-character commit SHA');
const {generateMidi,generateWav,renderWavChannels}=await import(pathToFileURL(resolve(process.argv[2],'cli/generate.ts')).href);

const base = { sequence: '1 0 3 2', denominator: 8, gain: -18, release: 0.025 };
const cases: Record<string, GenerateOptions> = {
  timing: { bpm: 300, forte: '5-35.05', bitmaskSequenceInput: '1 0 3 2', tracks: [
    { ...base, lengthFactor: 170, lengthOffset: 0.2, paddingBefore: 0.05, paddingAfter: 0.05,
      repeats: 2, phase: 0.3, fadeIn: 0.1, fadeOut: 0.1, timeWarpEnabled: true,
      timeWarpCurve: 'ease-in', timeWarpAmount: 70, timeWarpRepeats: 2, timeWarpQuantize: 4,
      timeWarpNoteLengths: true }, { ...base, delay: 0.05, polyphony: 2 } ] },
  mono: { bpm: 300, tracks: [{ ...base, sequence: '1 2 4 8', lengthFactor: 160,
    polyphony: 1, monoLegato: true, glideTime: 0.04, glideMode: 'always', glideCurve: 'exponential' }] },
  drums: { bpm: 300, tracks: [{ ...base, trackKind: 'rhythmic', sequence: '33 1024 33 1024',
    drumVelocityBits: 0, echoEnabled: true, echoDelay: '1/16', echoFeedback: 0.15, echoWet: -20,
    reverbWet: -18 }], reverb: { enabled: true, decay: 0.1, preDelay: 0, wet: -24 } },
  effects: { bpm: 300, tracks: [{ ...base, echoEnabled: true, echoDelay: '1/16', echoPingPong: true,
    echoFeedback: 0.2, echoWet: -18, chorusEnabled: true, flangerEnabled: true,
    phaserEnabled: true, filterEnabled: true, filterFrequency: 80, filterLfoEnabled: true,
    waveshaper: { enabled: true, mode: 'tanh', drive: 3 } as any,
    tremoloEnabled: true, vibratoEnabled: true, reverbWet: -18 }],
    reverb: { enabled: true, decay: 0.1, wet: -24 } },
  generators: { bpm: 300, tracks: ['tonewheel', 'waveform', 'noise', 'choir', 'partial-bank'].map((type) => ({
    ...base, sequence: '1 2', synthMode: (['noise', 'choir', 'partial-bank'].includes(type) ? type : 'additive') as any,
    waveform: 'sawtooth', partialGenerator: { type: type === 'waveform' ? 'waveform' : 'tonewheel' },
    modulation: { sources: [{ id: 'l', name: 'Slow', type: 'lfo', enabled: true, waveform: 'sine',
      rateHz: 2, sync: false, syncRate: '1/4', phase: 0, retrigger: 'song', unipolar: false }],
      routes: [{ id: 'r', enabled: true, source: 'l', target: 'pitch', amount: 0.2 }] },
  })) },
  engines: {bpm:300,tracks:['additive','resonant-noise','choir','partial-bank'].map(synthMode=>({
    ...base,sequence:'1 2',synthMode:synthMode as any,partialGenerator:{type:'waveform'},waveform:'sawtooth',
    modulation:{sources:[{id:'env',name:'Motion',type:'envelope',enabled:true,attack:0.01,decay:0.05,sustain:0.3,release:0.05,curve:0}],
      routes:[{id:'pitch',enabled:true,source:'env',target:'pitch',amount:0.7}]} as any,
  }))},
};
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const fixtures = [];
for (const [name, input] of Object.entries(cases)) {
  const channels = await renderWavChannels(input);
  fixtures.push({ name, input, midi: digest(await generateMidi(input)),
    wav: digest(await generateWav(input, { threads: 1 })),
    left: digest(new Uint8Array(channels.left.buffer)), right: digest(new Uint8Array(channels.right.buffer)) });
}
writeFileSync('cli/fixtures/legacy-2026.10.3.json', JSON.stringify({ baselineCommit:process.argv[3],environment: { node: process.version,
  platform: process.platform, sampleRate: 48000 }, fixtures }, null, 2) + '\n');
