#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { writeFileSync } from 'fs';
import { generateMidi } from './generate.js';

const server = new Server(
  {
    name: 'gaterunner',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'generate_midi',
        description:
          'Generate a MIDI file using GateRunner. ' +
          'Converts a sequence of integers to MIDI notes using a Forte number (pitch-class set). ' +
          'Each integer is binary-encoded: each set bit maps to a pitch from the chosen scale.',
        inputSchema: {
          type: 'object',
          properties: {
            output: {
              type: 'string',
              description: 'Absolute or relative path where the MIDI file will be saved.',
            },
            bpm: {
              type: 'number',
              description: 'Shared tempo in beats per minute (1-499). Default: 90.',
            },
            a4: {
              type: 'number',
              description: 'Concert pitch A4 frequency in Hz (380-500). Default: 440.',
            },
            numerator: {
              type: 'number',
              description: 'Legacy single-track numerator (1-16). Used when tracks is omitted. Default: 4.',
            },
            denominator: {
              type: 'number',
              description: 'Legacy single-track denominator (1-16). Used when tracks is omitted. Default: 5.',
            },
            forte: {
              type: 'string',
              description:
                'Forte number identifying the pitch-class set (e.g. "5-35.05" for pentatonic). Default: "5-35.05".',
            },
            sequence: {
              type: 'string',
              description:
                'Space-separated integers to encode as notes (e.g. "1 2 4 8 16"). Each number is binary-encoded: bit N selects the Nth pitch of the scale. Default: "1 2 4 8 16".',
            },
            octave: {
              type: 'number',
              description: 'Octave shift (0-10). Default: 6.',
            },
            lengthFactor: {
              type: 'number',
              description:
                'Note length as a percentage of the quantization step (0-400). Default: 100.',
            },
            lengthOffset: {
              type: 'number',
              description:
                'Fixed duration added to every note, measured in quantization steps (0-64). Default: 0.',
            },
            midiChannel: {
              type: 'number',
              description: 'Legacy single-track MIDI channel (1-16). Used when tracks is omitted. Default: 1.',
            },
            gain: {
              type: 'number',
              description: 'Legacy single-track gain multiplier (0-4). Used when tracks is omitted. Default: 1.',
            },
            waveform: {
              type: 'string',
              description: 'Legacy single-track waveform metadata. Used when tracks is omitted. Default: "sine".',
            },
            delay: {
              type: 'number',
              description: 'Legacy single-track delay in bars before the track starts (0-64). Used when tracks is omitted. Default: 0.',
            },
            fadeIn: {
              type: 'number',
              description: 'Legacy single-track fade-in duration in bars (0-64). 0 disables it. Used when tracks is omitted.',
            },
            fadeOut: {
              type: 'number',
              description: 'Legacy single-track fade-out duration in bars (0-64). 0 disables it. Used when tracks is omitted.',
            },
            paddingBefore: {
              type: 'number',
              description: 'Legacy single-track silence before every repeated sequence in bars (0-64). Used when tracks is omitted.',
            },
            paddingAfter: {
              type: 'number',
              description: 'Legacy single-track silence after every repeated sequence in bars (0-64). Used when tracks is omitted.',
            },
            repeats: {
              type: 'number',
              description: 'Legacy single-track number of pattern repetitions (1-64). Used when tracks is omitted. Default: 1.',
            },
            timeWarpEnabled: {
              type: 'boolean',
              description: 'Legacy single-track time warp enabled. Used when tracks is omitted. Default: false.',
            },
            timeWarpCurve: {
              type: 'string',
              description: 'Legacy single-track time warp curve name. Used when tracks is omitted. Default: lin.',
            },
            timeWarpExpression: {
              type: 'string',
              description: 'Legacy single-track custom time warp expression when timeWarpCurve is custom.',
            },
            timeWarpAmount: {
              type: 'number',
              description: 'Legacy single-track warp amount percent (0-100). Used when tracks is omitted. Default: 100.',
            },
            timeWarpRepeats: {
              type: 'number',
              description: 'Legacy single-track number of warp chunks the pattern is split into, with the warp curve applied within each chunk (1-64). Used when tracks is omitted. Default: 1.',
            },
            timeWarpQuantize: {
              type: 'number',
              description: 'Legacy single-track warp quantize subdivisions per step (0,1,2,4,8). Used when tracks is omitted. Default: 0.',
            },
            timeWarpNoteLengths: {
              type: 'boolean',
              description: 'Legacy single-track note length warping enabled. Used when tracks is omitted. Default: true.',
            },
            tracks: {
              type: 'array',
              description:
                'Optional multi-track configuration. Rhythmic tracks use ordered GM drumLanes and BigInt-safe decimal velocity masks; omitted trackKind remains melodic.',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  trackKind: { type: 'string', enum: ['melodic', 'rhythmic'] },
                  drumVelocityBits: { type: 'number', description: '1-7 velocity bits per rhythmic lane.' },
                  drumLanes: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        voiceId: { type: 'string', description: 'GM voice ID, for example kick, snare, hat, or crash.' },
                        xorGroup: { type: 'number', description: 'Exclusive XOR group 1-8. 0 or omitted means no group; only one member of a group can sound at once.' },
                        parameters: { type: 'object', additionalProperties: true },
                      },
                    },
                  },
                  numerator: { type: 'number' },
                  denominator: { type: 'number' },
                  waveform: {
                    type: 'string',
                    description: 'Tonewheel source shape, including flute, oboe, clarinet, saxophone, pulse-25, and pulse-12.',
                  },
                  breathEnabled: { type: 'boolean', description: 'Adds one filtered pink-noise breath layer per melodic event.' },
                  breathLevel: { type: 'number', minimum: -60, maximum: 0, description: 'Breath layer level in dB.' },
                  breathHarmonic: { type: 'number', minimum: 0.5, maximum: 8, description: 'Breath filter center as a multiple of mean event frequency.' },
                  sequence: { type: 'string' },
                  octave: { type: 'number' },
                  lengthFactor: { type: 'number' },
                  lengthOffset: { type: 'number' },
                  midiChannel: { type: 'number' },
                  gain: { type: 'number' },
                  fadeIn: { type: 'number', minimum: 0, maximum: 64 },
                  fadeOut: { type: 'number', minimum: 0, maximum: 64 },
                  paddingBefore: { type: 'number', minimum: 0, maximum: 64, description: 'Silence before the sequence in every repeat, measured in bars.' },
                  paddingAfter: { type: 'number', minimum: 0, maximum: 64, description: 'Silence after the sequence in every repeat, measured in bars.' },
                  polyphony: { type: 'number', description: 'Melodic tracks only. Maximum simultaneous voices (1-16). 1 makes the track monophonic with glide.' },
                  glideTime: { type: 'number', description: 'Melodic tracks only. Glide time in seconds (0-5), or seconds per octave when glideConstantRate is true. 0 disables glide.' },
                  glideMode: { type: 'string', enum: ['legato', 'always'], description: 'Melodic tracks only. legato glides only between overlapping notes; always glides between every note.' },
                  glideConstantRate: { type: 'boolean', description: 'Melodic tracks only. Measure glideTime per octave so wide leaps take longer.' },
                  glideCurve: { type: 'string', enum: ['exponential', 'linear'], description: 'Melodic tracks only.' },
                  monoLegato: { type: 'boolean', description: 'Melodic tracks only. Overlapping monophonic notes keep the running envelopes instead of retriggering.' },
                  delay: { type: 'number' },
                  repeats: { type: 'number' },
                  timeWarpEnabled: { type: 'boolean' },
                  timeWarpCurve: { type: 'string' },
                  timeWarpExpression: { type: 'string' },
                  timeWarpRepeats: { type: 'number' },
                  timeWarpAmount: { type: 'number' },
                  timeWarpQuantize: { type: 'number' },
                  timeWarpNoteLengths: { type: 'boolean' },
                },
              },
            },
          },
          required: ['output'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'generate_midi') {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const args = request.params.arguments as Record<string, unknown>;
  const output = args['output'] as string;

  if (!output) {
    return {
      content: [{ type: 'text', text: 'Error: output path is required' }],
      isError: true,
    };
  }

  const optNum = (key: string) =>
    args[key] !== undefined ? Number(args[key]) : undefined;
  const optStr = (key: string) =>
    args[key] !== undefined ? String(args[key]) : undefined;
  const optBool = (key: string) => {
    if (args[key] === undefined) {
      return undefined;
    }
    if (typeof args[key] === 'boolean') {
      return args[key] as boolean;
    }
    const normalized = String(args[key]).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
      return false;
    }
    throw new Error(`Invalid boolean value for ${key}: ${args[key]}`);
  };

  try {
    const data = await generateMidi({
      bpm: optNum('bpm'),
      a4: optNum('a4'),
      numerator: optNum('numerator'),
      denominator: optNum('denominator'),
      forte: optStr('forte'),
      sequence: optStr('sequence'),
      octave: optNum('octave'),
      lengthFactor: optNum('lengthFactor'),
      lengthOffset: optNum('lengthOffset'),
      midiChannel: optNum('midiChannel'),
      gain: optNum('gain'),
      waveform: optStr('waveform'),
      delay: optNum('delay'),
      fadeIn: optNum('fadeIn'),
      fadeOut: optNum('fadeOut'),
      paddingBefore: optNum('paddingBefore'),
      paddingAfter: optNum('paddingAfter'),
      repeats: optNum('repeats'),
      timeWarpEnabled: optBool('timeWarpEnabled'),
      timeWarpCurve: optStr('timeWarpCurve'),
      timeWarpExpression: optStr('timeWarpExpression'),
      timeWarpRepeats: optNum('timeWarpRepeats'),
      timeWarpAmount: optNum('timeWarpAmount'),
      timeWarpQuantize: optNum('timeWarpQuantize'),
      timeWarpNoteLengths: optBool('timeWarpNoteLengths'),
      tracks: Array.isArray(args['tracks']) ? (args['tracks'] as Record<string, unknown>[]) : undefined,
    });

    writeFileSync(output, data);

    return {
      content: [
        {
          type: 'text',
          text: `MIDI file successfully written to: ${output}`,
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: 'text',
          text: `Error generating MIDI: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
