#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parsePresetImportPayload, type PresetData } from '../src/presets.js';
import { normalizeWaveshaperSettings, type WaveshaperSettings } from '../src/audio/waveshaper.js';
import { generateMidi, generateWav, type GenerateReverbOptions, type GenerateTrackOptions } from './generate.js';

const program = new Command();

export function presetDataToGeneratorInput(data: PresetData) {
  return {
    bpm: data.bpm,
    a4: data.a4,
    forte: data.forte,
    bitmaskSequenceInput: data.bitmaskSequenceInput,
    tracks: data.tracks.map((track) => ({
      name: track.name,
      trackKind: track.trackKind,
      drumLanes: track.drumLanes,
      drumVelocityBits: track.drumVelocityBits,
      numerator: track.numerator,
      denominator: track.denominator,
      waveform: track.waveform,
      breathEnabled: track.breathEnabled,
      breathLevel: track.breathLevel,
      breathHarmonic: track.breathHarmonic,
      sequence: track.sequenceInput,
      octave: track.octave,
      lengthFactor: track.lengthFactor,
      lengthOffset: track.lengthOffset,
      midiChannel: track.midiChannel,
      gain: track.gain,
      limiterGain: track.limiterGain,
      waveshaper: track.waveshaper,
      velocityMultiplier: track.velocityMultiplier,
      delay: track.delay,
      fadeIn: track.fadeIn,
      fadeOut: track.fadeOut,
      paddingBefore: track.paddingBefore,
      paddingAfter: track.paddingAfter,
      repeats: track.repeats,
      timeWarpEnabled: track.timeWarpEnabled,
      timeWarpCurve: track.timeWarpCurve,
      timeWarpExpression: track.timeWarpExpression,
      timeWarpRepeats: track.timeWarpRepeats,
      timeWarpAmount: track.timeWarpAmount,
      timeWarpQuantize: track.timeWarpQuantize,
      timeWarpNoteLengths: track.timeWarpNoteLengths,
      attack: track.attack,
      decay: track.decay,
      sustain: track.sustain,
      release: track.release,
      pitchEnvelopeAttack: track.pitchEnvelopeAttack,
      pitchEnvelopeDecay: track.pitchEnvelopeDecay,
      pitchEnvelopeSustain: track.pitchEnvelopeSustain,
      pitchEnvelopeRelease: track.pitchEnvelopeRelease,
      pitchEnvelopeAmount: track.pitchEnvelopeAmount,
      pitchEnvelopeShape: track.pitchEnvelopeShape,
      polyphony: track.polyphony,
      glideTime: track.glideTime,
      glideMode: track.glideMode,
      glideConstantRate: track.glideConstantRate,
      glideCurve: track.glideCurve,
      monoLegato: track.monoLegato,
      unisonVoices: track.unisonVoices,
      unisonDetune: track.unisonDetune,
      tonewheelDrawbars: track.tonewheelDrawbars,
      partialGenerator: track.partialGenerator,
      tonewheelWavetable: track.tonewheelWavetable,
      tremoloEnabled: track.tremoloEnabled,
      tremoloFrequency: track.tremoloFrequency,
      tremoloDepth: track.tremoloDepth,
      vibratoEnabled: track.vibratoEnabled,
      vibratoFrequency: track.vibratoFrequency,
      vibratoDepth: track.vibratoDepth,
      filterEnabled: track.filterEnabled,
      filterType: track.filterType,
      filterFrequency: track.filterFrequency,
      filterQ: track.filterQ,
      filterGain: track.filterGain,
      filterKeyFollow: track.filterKeyFollow,
      filterEnvelopeAttack: track.filterEnvelopeAttack,
      filterEnvelopeDecay: track.filterEnvelopeDecay,
      filterEnvelopeSustain: track.filterEnvelopeSustain,
      filterEnvelopeRelease: track.filterEnvelopeRelease,
      filterEnvelopeAmount: track.filterEnvelopeAmount,
      echoEnabled: track.echoEnabled,
      echoDelay: track.echoDelay,
      echoFeedback: track.echoFeedback,
      echoWet: track.echoWet,
      echoPingPong: track.echoPingPong,
      reverbWet: track.reverbWet,
    })),
    reverb: {
      enabled: data.reverb.enabled,
      decay: data.reverb.decay,
      preDelay: data.reverb.preDelay,
      wet: data.reverb.wet,
      lowCut: data.reverb.lowCut,
      highCut: data.reverb.highCut,
    },
  } satisfies {
    bpm: number;
    a4: number;
    forte: string;
    bitmaskSequenceInput: string;
    tracks: GenerateTrackOptions[];
    reverb: GenerateReverbOptions;
  };
}

function parsePresetFile(value: string): {
  bpm: number;
  a4: number;
  forte: string;
  bitmaskSequenceInput: string;
  tracks: GenerateTrackOptions[];
  reverb: GenerateReverbOptions;
} {
  const text = readFileSync(value, 'utf8');
  const payload = parsePresetImportPayload(text);

  const sourcePreset = payload.kind === 'single-preset'
    ? payload.preset
    : payload.presets.find((preset) => preset.id === payload.selectedPresetId) ?? payload.presets[0];

  if (!sourcePreset) {
    throw new Error('Preset file does not contain any presets.');
  }

  return presetDataToGeneratorInput(sourcePreset.data);
}

function parseBooleanOption(value: unknown): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  throw new Error(`Invalid boolean value: ${value}`);
}

function parseTracksJson(value: string): GenerateTrackOptions[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('tracks must be a JSON array');
    }

    return parsed as GenerateTrackOptions[];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid --tracks JSON: ${message}`);
  }
}

function parseReverbJson(value: string): GenerateReverbOptions {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('reverb must be a JSON object');
    }
    return parsed as GenerateReverbOptions;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid --reverb JSON: ${message}`);
  }
}

function parseWaveshaperJson(value: string): WaveshaperSettings {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('waveshaper must be a JSON object');
    }
    return normalizeWaveshaperSettings(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid --waveshaper JSON: ${message}`);
  }
}

program
  .name('gaterunner')
  .description('Generate a MIDI/WAV file from a GateRunner sequence')
  .version('2026.9.12')
  .requiredOption('-o, --output <file>', 'Output file path')
  .option('-f, --format <type>', 'Output format: midi or wav', 'midi')
  .option('--bpm <number>', 'Shared tempo in beats per minute (1-499)', '90')
  .option('--a4 <number>', 'Concert pitch A4 frequency in Hz (380-500)', '440')
  .option('--numerator <number>', 'Legacy single-track numerator (1-16)', '4')
  .option('--denominator <number>', 'Legacy single-track denominator (1-16)', '5')
  .option('--forte <string>', 'Forte number (pitch-class set identifier)', '5-35.05')
  .option('--sequence <string>', 'Legacy single-track sequence', '1 2 4 8 16')
  .option('--octave <number>', 'Legacy single-track octave (0-10)', '6')
  .option('--length-factor <number>', 'Legacy single-track note length percent (0-400)', '100')
  .option('--length-offset <number>', 'Legacy single-track fixed note length in steps (0-64)', '0')
  .option('--midi-channel <number>', 'Legacy single-track MIDI channel (1-16)', '1')
  .option('--gain <number>', 'Legacy single-track audio gain in dB (-96 to +24)', '0')
  .option('--limiter-gain <number>', 'Legacy single-track tanh input gain in dB (-48 to +72)', '0')
  .option('--waveshaper <json>', 'Legacy single-track waveshaper settings JSON object', parseWaveshaperJson)
  .option('--waveform <string>', 'Legacy single-track waveform selection (noise selects waveform source; other missing sources default to tonewheel)', 'sine')
  .option('--delay <number>', 'Legacy single-track delay in bars (0-64)', '0')
  .option('--fade-in <number>', 'Legacy single-track fade-in duration in bars (0-64)', '0')
  .option('--fade-out <number>', 'Legacy single-track fade-out duration in bars (0-64)', '0')
  .option('--padding-before <number>', 'Legacy single-track silence before every repeated sequence in bars (0-64)', '0')
  .option('--padding-after <number>', 'Legacy single-track silence after every repeated sequence in bars (0-64)', '0')
  .option('--repeats <number>', 'Legacy single-track number of pattern repetitions (1-64)', '1')
  .option('--time-warp-enabled <boolean>', 'Legacy single-track time warp enabled (true/false)')
  .option('--time-warp-curve <string>', 'Legacy single-track time warp curve name')
  .option('--time-warp-expression <string>', 'Legacy single-track custom time warp expression')
  .option('--time-warp-repeats <number>', 'Legacy single-track number of warp chunks the pattern is split into (1-64)')
  .option('--time-warp-amount <number>', 'Legacy single-track warp amount percent (0-100)')
  .option('--time-warp-quantize <number>', 'Legacy single-track warp quantize subdivisions per step (0,1,2,4,8)')
  .option('--time-warp-note-lengths <boolean>', 'Legacy single-track warped note lengths (true/false)')
  .option('--b <string>', 'Optional song-level track activation masks (space-separated nonnegative decimals; blank disables)')
  .option('-p, --preset <file>', 'JSON preset file to load instead of individual generation parameters')
  .option('--tracks <json>', 'JSON array of tracks with per-track sequence, instrument, filter, echoDelay notation (1/1..1/16T), and reverb send controls', parseTracksJson)
  .option('--reverb <json>', 'JSON object with global reverb enabled, decay, preDelay, wet, lowCut, highCut', parseReverbJson)
  .option('--threads <number>', 'WAV render threads (default: available CPU cores)')
  .option('--verbose', 'Print WAV render and encoding timings')
  .action(async (options) => {
    try {
      const generatorInput = options.preset
        ? parsePresetFile(options.preset)
        : {
            bpm: parseInt(options.bpm),
            a4: parseFloat(options.a4),
            numerator: parseInt(options.numerator),
            denominator: parseInt(options.denominator),
            forte: options.forte,
            bitmaskSequenceInput: options.b,
            sequence: options.sequence,
            octave: parseInt(options.octave),
            lengthFactor: parseInt(options.lengthFactor),
            lengthOffset: parseFloat(options.lengthOffset),
            midiChannel: parseInt(options.midiChannel),
            gain: parseFloat(options.gain),
            limiterGain: parseFloat(options.limiterGain),
            waveshaper: options.waveshaper,
            waveform: options.waveform,
            delay: parseInt(options.delay),
            fadeIn: parseFloat(options.fadeIn),
            fadeOut: parseFloat(options.fadeOut),
            paddingBefore: parseFloat(options.paddingBefore),
            paddingAfter: parseFloat(options.paddingAfter),
            repeats: parseInt(options.repeats),
            timeWarpEnabled: parseBooleanOption(options.timeWarpEnabled),
            timeWarpCurve: options.timeWarpCurve,
            timeWarpExpression: options.timeWarpExpression,
            timeWarpRepeats: options.timeWarpRepeats !== undefined ? parseInt(options.timeWarpRepeats) : undefined,
            timeWarpAmount: options.timeWarpAmount !== undefined ? parseFloat(options.timeWarpAmount) : undefined,
            timeWarpQuantize: options.timeWarpQuantize !== undefined ? parseInt(options.timeWarpQuantize) : undefined,
            timeWarpNoteLengths: parseBooleanOption(options.timeWarpNoteLengths),
            tracks: options.tracks,
            reverb: options.reverb,
          };

      const normalizedFormat = String(options.format ?? 'midi').toLowerCase();
      const isWav = normalizedFormat === 'wav';
      if (!isWav && normalizedFormat !== 'midi') {
        throw new Error(`Unsupported format: ${options.format}. Use midi or wav.`);
      }

      const data = isWav
        ? await generateWav(generatorInput, {
            threads: options.threads === undefined ? undefined : Number.parseInt(options.threads, 10),
            onTiming: options.verbose
              ? ({ stage, milliseconds }) => console.error(`${stage}: ${milliseconds.toFixed(1)} ms`)
              : undefined,
          })
        : await generateMidi(generatorInput);

      writeFileSync(options.output, data);
      console.log(`${isWav ? 'WAV' : 'MIDI'} file written to: ${options.output}`);
    } catch (err) {
      console.error('Error generating output:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  program.parse();
}
