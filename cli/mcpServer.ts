import { open, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { McpServer, ResourceTemplate, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';
import { DEFAULT_PRESET_DATA, normalizePresetData, type PresetData } from '../src/presets.js';
import { limitPolyphony } from '../src/audio/glide.js';
import { pitchScale } from '../src/domain/developmentSchedule.js';
import { generateDevelopedMidi, rangeInSeconds, type RenderRange } from '../src/audio/developmentRender.js';
import { supportedFeatures, validateProject, resolveProjectEvents, renderProject, exportStems,
  exportProjectPackage, type ProjectRenderOptions } from './projectApi.js';
import { McpWorkspace } from './mcpWorkspace.js';

const jsonObject = z.record(z.string(), z.unknown());
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_INLINE_PROJECT_BYTES = 1024 * 1024;
const MAX_RESOURCE_FILE_BYTES = 4 * 1024 * 1024;
const MAX_ARTIFACT_CHUNK_BYTES = 256 * 1024;
// The SDK's LATEST_PROTOCOL_VERSION export refers to its legacy handshake line.
// serveStdio additionally serves this current, discovery-based protocol revision.
export const MCP_PROTOCOL_VERSION = '2026-07-28';
const sourceSchema = z.union([
  z.object({ path: z.string().min(1).describe('Project, preset, library or asset-package JSON file inside the workspace') }).strict(),
  z.object({ project: jsonObject.describe('Raw project settings; omitted settings use GateRunner defaults') }).strict(),
]);
const trackUpdateSchema = z.union([
  z.object({ id: z.string().min(1), changes: jsonObject }).strict(),
  z.object({ index: z.number().int().nonnegative(), changes: jsonObject }).strict(),
]);
const rangeSchema = z.object({
  start: z.number().nonnegative().describe('Zero-based range start'),
  end: z.number().positive().describe('Exclusive range end'),
  unit: z.enum(['bars', 'beats', 'seconds']),
  beatsPerBar: z.number().positive().optional(),
}).strict().refine(range => range.end > range.start, 'Range end must be greater than start');
type Source = z.infer<typeof sourceSchema>;
interface Artifact { uri: string; path: string; mimeType: string; name: string }
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const writesFiles = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const legacySettings = new Set(['b', 'numerator', 'denominator', 'waveform', 'sequenceInput', 'octave', 'lengthFactor', 'midiChannel', 'gain', 'delay', 'repeats']);
const projectSettings = new Set([...Object.keys(DEFAULT_PRESET_DATA), 'studio', ...legacySettings]);

const guide = `GateRunner MCP works with project files and inline project settings, not the open browser draft.
Start with get_capabilities and gaterunner://defaults/project for a complete editable example.
Sources are either {"path":"song.json"} or {"project":{"bpm":120,"forte":"7-35.11","tracks":[{"id":"lead","sequenceInput":"1 2 4 8 3 5 7 0"}]}}.
Integers are note bitmasks: 1 selects position 0 of the Forte pitch-class set, 2 selects position 1, 3 selects both; 0 is a rest.
Track octave offsets these positions by complete pitch-class sets. inspect_project resolves actual MIDI pitches and event timing.
Track numerator is beats per bar; denominator is steps per beat (not the denominator of a time signature).
bitmaskSequenceInput is song-level track activation B: each integer gates tracks over equal loop sections.
update_project recursively merges objects. Arrays replace whole arrays. trackUpdates selects a track by saved id or zero-based index.
Omitting update_project.source starts a new default project. Changes are validated before any file is saved.
render_preview defaults to the first eight seconds, and is limited to thirty seconds. Range units are zero-based, end-exclusive.
export_project supports portable JSON projects, MIDI, WAV and stems. Ranges apply to WAV and stems only.
All file paths are relative to the configured workspace unless absolute paths inside it are supplied.
Existing files require overwrite=true; stem exports always require a new directory.
Tool results include file paths and readable artifact resource links. Rendered audio is fetched separately, keeping audio buffers out of ordinary tool results.
Resources larger than 4 MiB must be read with read_artifact in base64 chunks, or opened from their file path.
Inline project results are limited to 1 MiB. For projects containing large samples, update_project with output and includeProject=false saves without echoing PCM data.
Import exported project JSON through GateRunner's project import. No server connection to the browser is needed.
Audio measurements are sample peak, RMS and clipping-sample count; they are not LUFS, true peak or listening assessments.
`;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Unwrap without normalizing first, so validation still sees malformed project data. */
function projectDocument(value: unknown): Record<string, unknown> {
  if (!object(value)) throw new Error('Project document must contain a JSON object');
  if (value.type === 'gaterunner-asset-package') {
    if (value.version !== 1) throw new Error('Unsupported asset package version');
    if (!object(value.project)) throw new Error('Asset package must contain a project');
    return value.project;
  }
  if (value.kind === 'single-preset' || value.kind === 'preset-library') {
    if (value.version !== 1 && value.version !== 2) throw new Error('Unsupported preset file version');
    const preset = value.kind === 'single-preset' ? value.preset
      : Array.isArray(value.presets) ? value.presets.find(p => object(p) && p.id === value.selectedPresetId) ?? value.presets[0] : undefined;
    if (!object(preset) || !object(preset.data)) throw new Error('Project document contains no preset data');
    return preset.data;
  }
  if ('type' in value || 'kind' in value) throw new Error('Unsupported project document type');
  if (Object.keys(value).length && !Object.keys(value).some(key => projectSettings.has(key))) {
    throw new Error('Document contains no recognized GateRunner project settings');
  }
  return value;
}

function mergeSettings(base: Record<string, unknown>, changes: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...base };
  for (const [key, value] of Object.entries(changes)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error(`Unsupported settings key: ${key}`);
    merged[key] = object(value) ? mergeSettings(object(base[key]) ? base[key] : {}, value) : structuredClone(value);
  }
  return merged;
}

async function validate(input: unknown) {
  const result = validateProject(input);
  const issue = (path: string, message: string, severity: 'error' | 'warning' = 'error') => {
    if (!result.diagnostics.some(d => d.path === path)) result.diagnostics.push({ path, message, severity });
  };
  // The browser importer intentionally repairs malformed/older data. MCP callers
  // need to know when their requested settings would be discarded or replaced.
  const compare = (before: unknown, after: unknown, path = '') => {
    if (Array.isArray(after)) {
      if (!Array.isArray(before)) { issue(path, 'Expected an array'); return; }
      before.forEach((value, index) => {
        if (object(after[index]) || Array.isArray(after[index])) compare(value, after[index], `${path}.${index}`);
      });
    } else if (object(after)) {
      if (!object(before)) { issue(path || 'project', 'Expected an object'); return; }
      for (const [key, value] of Object.entries(before)) {
        const field = path ? `${path}.${key}` : key;
        if (!path && legacySettings.has(key)) {
          if (key !== 'b' && 'tracks' in before) issue(field, 'Legacy track setting was ignored because tracks is present; use trackUpdates', 'warning');
          continue;
        }
        if (!Object.hasOwn(after, key)) issue(field, 'Unsupported setting was ignored', 'warning');
        else compare(value, after[key], field);
      }
    } else if (before !== undefined && before !== after) issue(path, `Normalized to ${JSON.stringify(after)}`, 'warning');
  };
  compare(input, result.project);
  if (object(input)) {
    if (Object.keys(input).length && !Object.keys(input).some(key => projectSettings.has(key))) issue('project', 'No recognized GateRunner project settings');
    if (Array.isArray(input.tracks) && !input.tracks.length) issue('tracks', 'Supply at least one track, or omit tracks to use defaults');
  }
  try { await pitchScale(result.project.forte); }
  catch (error) {
    result.valid = false;
    result.diagnostics.push({ path: 'forte', severity: 'error', message: error instanceof Error ? error.message : String(error) });
  }
  result.valid = !result.diagnostics.some(d => d.severity === 'error');
  return result;
}

function response(data: Record<string, unknown>, artifacts: Artifact[] = [], isError = false): CallToolResult {
  const result: CallToolResult = {
    isError,
    structuredContent: data,
    content: [
      { type: 'text', text: JSON.stringify(data) },
      ...artifacts.map(artifact => ({ type: 'resource_link' as const, uri: artifact.uri, name: artifact.name, mimeType: artifact.mimeType })),
    ],
  };
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_RESPONSE_BYTES) {
    throw new Error('Result exceeds the inline response limit; reduce eventLimit or use includeProject=false and read exported artifacts separately');
  }
  return result;
}

function projectFields(project: PresetData, includeProject: boolean) {
  if (!includeProject) return {};
  if (Buffer.byteLength(JSON.stringify(project)) > MAX_INLINE_PROJECT_BYTES) {
    throw new Error('Project exceeds the 1 MiB inline limit; use includeProject=false. To save edits, also provide output, then use its artifact or file path.');
  }
  return { project };
}

async function safely(run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try { return await run(); }
  catch (error) { return response({ error: error instanceof Error ? error.message : String(error) }, [], true); }
}

export async function createGaterunnerMcpServer(options: { workspace?: string } = {}) {
  const workspace = await McpWorkspace.open(options.workspace ?? process.cwd());
  const server = new McpServer({ name: 'gaterunner', version: '1.0.0' }, { instructions: guide });
  const artifacts = new Map<string, Artifact>();
  function artifact(path: string, mimeType: string) {
    const id = randomUUID();
    const entry = { uri: `gaterunner://artifacts/${id}`, path, mimeType, name: basename(path) };
    artifacts.set(id, entry);
    return entry;
  }
  function findArtifact(uri: string) {
    const entry = artifacts.get(uri.slice('gaterunner://artifacts/'.length));
    if (!entry || entry.uri !== uri) throw new Error('Unknown artifact; generate the file again after restarting the server');
    return entry;
  }
  async function load(source: Source) {
    return 'path' in source ? projectDocument(JSON.parse(await readFile(await workspace.read(source.path), 'utf8'))) : source.project;
  }
  async function validProject(source: Source): Promise<PresetData> {
    const result = await validate(await load(source));
    if (!result.valid) throw new Error(result.diagnostics.filter(d => d.severity === 'error').map(d => `${d.path}: ${d.message}`).join('\n'));
    return result.project;
  }
  function addJsonResource(name: string, uri: string, description: string, value: () => unknown) {
    server.registerResource(name, uri, { description, mimeType: 'application/json' }, async url => ({
      contents: [{ uri: url.href, mimeType: 'application/json', text: JSON.stringify(value()) }],
    }));
  }
  addJsonResource('capabilities', 'gaterunner://capabilities', 'Supported engines, rendering features and parameter definitions', supportedFeatures);
  addJsonResource('default-project', 'gaterunner://defaults/project', 'Complete default project, including all track settings', () => normalizePresetData({}));
  server.registerResource('guide', 'gaterunner://guide', { description: 'Composition, bitmask encoding and MCP tool usage', mimeType: 'text/plain' }, async uri => ({
    contents: [{ uri: uri.href, mimeType: 'text/plain', text: guide }],
  }));
  server.registerResource('artifact', new ResourceTemplate('gaterunner://artifacts/{id}', { list: undefined }),
    { description: 'Generated files up to 4 MiB; use read_artifact for larger files' }, async uri => {
      const entry = findArtifact(uri.href), file = await open(await workspace.read(entry.path), 'r');
      try {
        if ((await file.stat()).size > MAX_RESOURCE_FILE_BYTES) throw new Error('Artifact exceeds the 4 MiB resource limit; use read_artifact in chunks or open its file path');
        const bytes = await file.readFile();
        const result = { contents: [entry.mimeType === 'application/json'
          ? { uri: uri.href, mimeType: entry.mimeType, text: bytes.toString('utf8') }
          : { uri: uri.href, mimeType: entry.mimeType, blob: bytes.toString('base64') }] };
        if (Buffer.byteLength(JSON.stringify(result)) > MAX_RESPONSE_BYTES) throw new Error('Encoded artifact exceeds the response limit; use read_artifact');
        return result;
      } finally { await file.close(); }
    });

  server.registerTool('read_artifact', {
    description: 'Read a generated artifact as a bounded base64 chunk. Use for files too large for resources/read. Decode each chunk and concatenate bytes in offset order; continue with nextOffset until eof=true.',
    inputSchema: z.object({ uri: z.string(), offset: z.number().int().nonnegative().default(0),
      length: z.number().int().min(1).max(MAX_ARTIFACT_CHUNK_BYTES).default(MAX_ARTIFACT_CHUNK_BYTES) }).strict(), annotations: readOnly,
  }, async ({ uri, offset, length }) => safely(async () => {
    const entry = findArtifact(uri), file = await open(await workspace.read(entry.path), 'r');
    try {
      const totalBytes = (await file.stat()).size;
      if (offset > totalBytes) throw new Error('Offset lies beyond the end of the artifact');
      const buffer = Buffer.alloc(Math.min(length, totalBytes - offset));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
      if (!bytesRead && offset < totalBytes) throw new Error('Artifact changed while being read; restart from offset zero');
      return response({ uri, mimeType: entry.mimeType, encoding: 'base64', offset, totalBytes,
        nextOffset: offset + bytesRead, eof: offset + bytesRead === totalBytes, data: buffer.subarray(0, bytesRead).toString('base64') });
    } finally { await file.close(); }
  }));

  server.registerTool('get_capabilities', {
    description: 'Discover GateRunner engines, project format, workspace and tool conventions. Fetch full parameter definitions only when needed.',
    inputSchema: z.object({ includeParameters: z.boolean().default(false) }).strict(), annotations: readOnly,
  }, async ({ includeParameters }) => {
    const { parameters, ...features } = supportedFeatures();
    return response({ ...features, ...(includeParameters ? { parameters } : {}), protocolVersion: MCP_PROTOCOL_VERSION, workspace: workspace.root,
      limits: { inlineProjectBytes: MAX_INLINE_PROJECT_BYTES, resourceFileBytes: MAX_RESOURCE_FILE_BYTES, artifactChunkBytes: MAX_ARTIFACT_CHUNK_BYTES },
      resources: ['gaterunner://guide', 'gaterunner://capabilities', 'gaterunner://defaults/project'],
      sourceExamples: [{ path: 'song.grproject.json' }, { project: { bpm: 120, forte: '7-35.11', tracks: [{ id: 'lead', sequenceInput: '1 2 4 8 3 5 7 0' }] } }] });
  });

  server.registerTool('validate_project', {
    description: 'Validate a raw project, preset, library or portable package. Return diagnostics and optionally normalized settings without writing files.',
    inputSchema: z.object({ source: sourceSchema, includeProject: z.boolean().default(false) }).strict(), annotations: readOnly,
  }, async ({ source, includeProject }) => safely(async () => {
    const result = await validate(await load(source));
    return response({ valid: result.valid, diagnostics: result.diagnostics, ...projectFields(result.project, includeProject) });
  }));

  server.registerTool('inspect_project', {
    description: 'Explain a project using the actual playback scheduler: decoded MIDI pitches, note names, timing, track summaries and event counts. No audio rendering.',
    inputSchema: z.object({ source: sourceSchema, eventOffset: z.number().int().nonnegative().default(0),
      eventLimit: z.number().int().min(0).max(128).default(16), includeProject: z.boolean().default(false) }).strict(), annotations: readOnly,
  }, async ({ source, eventOffset, eventLimit, includeProject }) => safely(async () => {
    const project = await validProject(source), resolved = await resolveProjectEvents(project);
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    return response({ bpm: project.bpm, forte: project.forte, durationSeconds: resolved.duration, beats: resolved.beats,
      trackActivation: project.bitmaskSequenceInput,
      tracks: resolved.tracks.map(({ track, events }, index) => ({ index, id: track.id, name: track.name, kind: track.trackKind,
        synthMode: track.synthMode, sequenceInput: track.sequenceInput, gain: track.gain, polyphony: track.polyphony,
        eventCount: events.length, eventOffset, hasMoreEvents: eventOffset + eventLimit < events.length,
        events: events.slice(eventOffset, eventOffset + eventLimit).map(event => {
          const notes = track.trackKind === 'rhythmic' ? event.notes : limitPolyphony(event.notes, track.polyphony);
          return { time: event.time, duration: event.duration,
            notes, noteNames: notes.map(note => `${noteNames[note % 12]}${Math.floor(note / 12) - 1}`), velocity: event.velocity,
            ...(event.noteVelocities ? { noteVelocities: notes.map(note => event.noteVelocities![event.notes.indexOf(note)]) } : {}),
            sectionId: event.sectionId, patternId: event.patternId };
        }) })),
      ...projectFields(project, includeProject) });
  }));

  server.registerTool('update_project', {
    description: 'Create or edit a project. Omit source to start from defaults. Recursively merge changes; arrays replace whole arrays. trackUpdates selects by saved track id or zero-based index. Validate before optionally saving an importable portable package.',
    inputSchema: z.object({ source: sourceSchema.optional(), changes: jsonObject.default({}),
      trackUpdates: z.array(trackUpdateSchema).default([]),
      output: z.string().min(1).optional(), overwrite: z.boolean().default(false), includeProject: z.boolean().default(true) }).strict(),
    annotations: { ...writesFiles, destructiveHint: true },
  }, async ({ source, changes, trackUpdates, output, overwrite, includeProject }) => safely(async () => {
    const initial = source ? await load(source) : normalizePresetData({});
    const updated = mergeSettings(initial as unknown as Record<string, unknown>, changes);
    if (trackUpdates.length) {
      if (updated.tracks === undefined) updated.tracks = normalizePresetData(updated).tracks;
      if (!Array.isArray(updated.tracks)) throw new Error('Track updates require a tracks array');
      const tracks = updated.tracks;
      for (const update of trackUpdates) {
        if ('id' in update && tracks.filter(track => object(track) && track.id === update.id).length > 1) {
          throw new Error(`Ambiguous track ID: ${update.id}; use an index to select and repair the duplicate ID`);
        }
        const index = 'id' in update ? tracks.findIndex(track => object(track) && track.id === update.id) : update.index;
        if (index < 0 || index >= tracks.length) throw new Error(`Unknown track: ${'id' in update ? update.id : update.index}`);
        if (!object(tracks[index])) throw new Error(`Track ${index} must contain an object`);
        tracks[index] = mergeSettings(tracks[index], update.changes);
      }
    }
    const result = await validate(updated);
    if (!result.valid) return response({ valid: false, diagnostics: result.diagnostics }, [], true);
    const fields = projectFields(result.project, includeProject);
    // Check the result size before creating a file, so a failed reply never hides a save.
    response({ valid: true, diagnostics: result.diagnostics, ...fields });
    const saved = output ? artifact(await workspace.write(output, temporary => exportProjectPackage(result.project, temporary), overwrite), 'application/json') : undefined;
    return response({ valid: true, diagnostics: result.diagnostics, ...fields, ...(saved ? { artifact: saved } : {}) }, saved ? [saved] : []);
  }));

  server.registerTool('render_preview', {
    description: 'Render a short playable WAV preview with sample-peak/RMS measurements. Defaults to the first 8 seconds; previews are limited to 30 seconds. Return a readable audio resource and file path.',
    inputSchema: z.object({ source: sourceSchema, range: rangeSchema.optional(), output: z.string().min(1).optional(), overwrite: z.boolean().default(false) }).strict(),
    annotations: { ...writesFiles, destructiveHint: true },
  }, async ({ source, range, output, overwrite }, extra) => safely(async () => {
    const project = await validProject(source), resolved = await resolveProjectEvents(project);
    const previewRange: RenderRange = range ?? { start: 0, end: Math.min(8, resolved.duration), unit: 'seconds' };
    const seconds = rangeInSeconds(previewRange, project, resolved.duration);
    if (seconds.end - seconds.start > 30) throw new Error('Preview must be at most 30 seconds; use export_project for longer renders');
    const progressToken = extra.mcpReq._meta?.progressToken;
    const renderOptions: ProjectRenderOptions = { range: previewRange, signal: extra.mcpReq.signal,
      onProgress: progressToken === undefined ? undefined : progress => {
        void extra.mcpReq.notify({ method: 'notifications/progress', params: { progressToken,
          progress: progress.completed, total: progress.total, message: progress.stage } }).catch(() => {});
      } };
    let report: Record<string, unknown> = {};
    const file = await workspace.write(output ?? workspace.generatedPath('.wav'), async temporary => {
      const rendered = await renderProject(project, { ...renderOptions, output: temporary });
      extra.mcpReq.signal.throwIfAborted();
      report = { range: rendered.range, measurements: rendered.measurements, performance: rendered.performance };
    }, overwrite);
    const saved = artifact(file, 'audio/wav');
    return response({ ...report, artifact: saved }, [saved]);
  }));

  server.registerTool('export_project', {
    description: 'Export an importable portable project, MIDI, full WAV or separate stems. WAV/stems accept an optional range. Files stay inside the workspace. Stems require a new directory; file replacement requires overwrite=true.',
    inputSchema: z.object({ source: sourceSchema, format: z.enum(['project', 'midi', 'wav', 'stems']),
      output: z.string().min(1).optional(), range: rangeSchema.optional(), overwrite: z.boolean().default(false),
      stemStage: z.enum(['all', 'pre', 'post']).default('all') }).strict(), annotations: { ...writesFiles, destructiveHint: true },
  }, async ({ source, format, output, range, overwrite, stemStage }, extra) => safely(async () => {
    if (range && (format === 'project' || format === 'midi')) throw new Error('Ranges apply only to WAV and stem exports');
    const project = await validProject(source), progressToken = extra.mcpReq._meta?.progressToken;
    const renderOptions: ProjectRenderOptions = { range, signal: extra.mcpReq.signal,
      onProgress: progressToken === undefined ? undefined : progress => {
        void extra.mcpReq.notify({ method: 'notifications/progress', params: { progressToken,
          progress: progress.completed, total: progress.total, message: progress.stage } }).catch(() => {});
      } };
    if (format === 'stems') {
      const { directory, result: manifest } = await workspace.writeDirectory(output ?? workspace.generatedPath('-stems'), async directory => {
        const manifest = await exportStems(project, directory, { ...renderOptions, stemStage });
        extra.mcpReq.signal.throwIfAborted();
        return manifest;
      });
      const files = manifest.files.map(file => artifact(file.file, 'audio/wav'));
      const savedManifest = artifact(join(directory, 'stems.json'), 'application/json');
      return response({ directory, manifest, artifacts: [savedManifest, ...files] }, [savedManifest, ...files]);
    }
    const extension = { project: '.grproject.json', midi: '.mid', wav: '.wav' }[format];
    let report: Record<string, unknown> = {};
    const file = await workspace.write(output ?? workspace.generatedPath(extension), async temporary => {
      extra.mcpReq.signal.throwIfAborted();
      if (format === 'project') await exportProjectPackage(project, temporary);
      else if (format === 'midi') await writeFile(temporary, await generateDevelopedMidi(project));
      else {
        const rendered = await renderProject(project, { ...renderOptions, output: temporary });
        report = { range: rendered.range, measurements: rendered.measurements, performance: rendered.performance };
      }
      extra.mcpReq.signal.throwIfAborted();
    }, overwrite);
    const saved = artifact(file, format === 'project' ? 'application/json' : format === 'midi' ? 'audio/midi' : 'audio/wav');
    return response({ format, ...report, artifact: saved }, [saved]);
  }));
  return server;
}
