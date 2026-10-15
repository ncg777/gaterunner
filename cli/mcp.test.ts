import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Client, type CallToolResult } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { normalizePresetData, type PresetData } from '../src/presets.js';
import { generateDevelopedMidi, renderDevelopment } from '../src/audio/developmentRender.js';
import { createSampleAsset } from '../src/audio/sampleAssets.js';
import { loadProject } from './projectApi.js';
import { McpWorkspace } from './mcpWorkspace.js';

const currentProtocolVersion = '2026-07-28';

const sketch = () => ({ bpm: 300, forte: '7-35.11', reverb: { enabled: false }, tracks: [
  { id: 'lead', name: 'Lead', sequenceInput: '1 2 3 0', octave: 4, denominator: 4, repeats: 1, gain: -24, release: 0.01 },
] });

async function session(t: TestContext, legacy = false) {
  const temporary = await mkdtemp(join(tmpdir(), 'gaterunner-mcp-'));
  const workspace = join(temporary, 'workspace');
  await mkdir(workspace);
  const isSource = import.meta.url.endsWith('.ts');
  const entry = fileURLToPath(new URL(isSource ? './mcp.ts' : './mcp.js', import.meta.url));
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [...(isSource ? ['--import', import.meta.resolve('tsx')] : []), entry, '--workspace', workspace],
    cwd: dirname(entry), stderr: 'pipe' });
  let stderr = '';
  transport.stderr?.on('data', chunk => { stderr += chunk; });
  const client = new Client({ name: 'gaterunner-tests', version: '1.0.0' }, {
    versionNegotiation: { mode: legacy ? 'legacy' : { pin: currentProtocolVersion } },
  });
  t.after(async () => {
    await client.close();
    await transport.close();
    // This exact directory was allocated by mkdtemp for this test.
    await rm(temporary, { recursive: true, force: true });
  });
  try { await client.connect(transport); }
  catch (error) { throw new Error(`${error instanceof Error ? error.message : error}\n${stderr}`); }
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
  return { client, call, workspace, temporary, stderr: () => stderr };
}

function data(result: CallToolResult): Record<string, any> {
  assert.equal(result.isError, false, JSON.stringify(result.content));
  assert.ok(result.structuredContent && typeof result.structuredContent === 'object');
  return result.structuredContent as Record<string, any>;
}

test('MCP stdio negotiates the current protocol and discovers tools, resources and schemas', async t => {
  const { client, call, workspace, stderr } = await session(t);
  assert.equal(client.getNegotiatedProtocolVersion(), currentProtocolVersion);
  assert.equal(client.getServerVersion()?.name, 'gaterunner');
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.map(tool => tool.name).sort(), [
    'export_project', 'get_capabilities', 'inspect_project', 'read_artifact', 'render_preview', 'update_project', 'validate_project',
  ]);
  assert.equal(tools.find(tool => tool.name === 'inspect_project')?.annotations?.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === 'export_project')?.inputSchema.type, 'object');
  const capabilities = data(await call('get_capabilities'));
  assert.equal(capabilities.protocolVersion, currentProtocolVersion);
  assert.equal(capabilities.workspace.toLowerCase(), workspace.toLowerCase());
  assert.ok(capabilities.generators.includes('granular'));
  assert.equal(capabilities.parameters, undefined);
  assert.ok(data(await call('get_capabilities', { includeParameters: true })).parameters.track);
  assert.equal((await client.listResources()).resources.length, 3);
  const defaults = await client.readResource({ uri: 'gaterunner://defaults/project' });
  assert.ok('text' in defaults.contents[0]);
  assert.ok(JSON.parse(defaults.contents[0].text).tracks[0].sequenceInput);
  const guide = await client.readResource({ uri: 'gaterunner://guide' });
  assert.ok('text' in guide.contents[0] && guide.contents[0].text.includes('bitmasks'));
  assert.equal(stderr(), '');
});

test('MCP retains compatibility with clients using the legacy initialization handshake', async t => {
  const { client, call } = await session(t, true);
  assert.equal(client.getNegotiatedProtocolVersion(), '2025-11-25');
  assert.equal(data(await call('inspect_project', { source: { project: sketch() }, eventLimit: 1 })).tracks[0].events.length, 1);
});

test('MCP validates inline data and unwraps supported project documents without hiding errors', async t => {
  const { call, workspace } = await session(t);
  const invalid = sketch() as Record<string, unknown>;
  invalid.forte = 'not-a-forte-set';
  const badForte = data(await call('validate_project', { source: { project: invalid } }));
  assert.equal(badForte.valid, false);
  assert.ok(badForte.diagnostics.some((diagnostic: any) => diagnostic.path === 'forte'));
  assert.equal(data(await call('update_project', { source: { project: invalid }, changes: { forte: '7-35.11' } })).valid, true);
  const badDevelopment = { ...sketch(), studio: { version: 99 } };
  const documents = [
    { type: 'gaterunner-asset-package', version: 1, project: badDevelopment },
    { kind: 'single-preset', version: 2, preset: { data: badDevelopment } },
    { kind: 'preset-library', version: 2, selectedPresetId: 'bad', presets: [{ id: 'ok', data: sketch() }, { id: 'bad', data: badDevelopment }] },
  ];
  for (const [index, document] of documents.entries()) {
    const file = `document-${index}.json`;
    await writeFile(join(workspace, file), JSON.stringify(document));
    const checked = data(await call('validate_project', { source: { path: file } }));
    assert.equal(checked.valid, false);
    assert.ok(checked.diagnostics.some((diagnostic: any) => diagnostic.path === 'studio.version'));
  }
  await writeFile(join(workspace, 'future.json'), JSON.stringify({ type: 'gaterunner-asset-package', version: 2, project: sketch() }));
  assert.equal((await call('validate_project', { source: { path: 'future.json' } })).isError, true);
  assert.equal(data(await call('validate_project', { source: { project: sketch() }, includeProject: true })).project.bpm, 300);
});

test('MCP rejects malformed project structures and reports discarded settings', async t => {
  const { call, workspace } = await session(t);
  for (const project of [{ tracks: 'lead' }, { tracks: [] }, { tracks: [null] }, { reverb: false }, { studio: [] }]) {
    const result = data(await call('validate_project', { source: { project } }));
    assert.equal(result.valid, false, JSON.stringify(project));
    assert.equal((await call('update_project', { changes: project, output: 'invalid.json' })).isError, true);
  }
  await assert.rejects(readFile(join(workspace, 'invalid.json')), /ENOENT/);
  await writeFile(join(workspace, 'unrelated.json'), JSON.stringify({ name: 'not a project', version: 1 }));
  assert.equal((await call('validate_project', { source: { path: 'unrelated.json' } })).isError, true);
  const checked = data(await call('validate_project', { source: { project: { ...sketch(), tempo: 140,
    tracks: [{ ...sketch().tracks[0], generatorEngines: { fm: { indes: 4 } } }] } } }));
  assert.ok(checked.diagnostics.some((d: any) => d.path === 'tempo' && d.severity === 'warning'));
  assert.ok(checked.diagnostics.some((d: any) => d.path === 'tracks.0.generatorEngines.fm.indes'));
  assert.equal((await call('update_project', { changes: sketch(), outputs: 'typo.json' })).isError, true);
});

test('MCP creates, merges and saves portable projects with stable track edits', async t => {
  const { call, workspace, client } = await session(t);
  const created = data(await call('update_project', { changes: sketch(), output: 'songs/draft.grproject.json' }));
  const initial = created.project as PresetData;
  assert.equal(initial.tracks[0].id, 'lead');
  const changed = data(await call('update_project', { source: { path: 'songs/draft.grproject.json' },
    changes: { bpm: 180, reverb: { enabled: true } },
    trackUpdates: [{ id: 'lead', changes: { sequenceInput: '7 14', synthMode: 'fm', generatorEngines: { fm: { index: 3 } } } }],
    output: 'songs/variation.grproject.json' }));
  assert.equal(changed.project.bpm, 180);
  assert.equal(changed.project.reverb.enabled, true);
  assert.equal(changed.project.reverb.decay, initial.reverb.decay);
  assert.equal(changed.project.tracks[0].sequenceInput, '7 14');
  assert.equal(changed.project.tracks[0].generatorEngines.fm.index, 3);
  assert.equal((await loadProject(join(workspace, 'songs/draft.grproject.json'))).bpm, 300);
  assert.deepEqual(await loadProject(changed.artifact.path), changed.project);
  const resource = (await client.readResource({ uri: changed.artifact.uri })).contents[0];
  assert.ok('text' in resource);
  assert.deepEqual(JSON.parse(resource.text).project, changed.project);
  assert.equal((await call('update_project', { source: { project: sketch() }, trackUpdates: [{ id: 'missing', changes: { gain: -12 } }] })).isError, true);
  const legacy = data(await call('update_project', { source: { project: { bpm: 120, sequenceInput: '1 2 4' } },
    trackUpdates: [{ index: 0, changes: { sequenceInput: '3 5 7' } }] }));
  assert.equal(legacy.project.tracks[0].sequenceInput, '3 5 7');
  const unnamed = data(await call('update_project', { source: { project: { tracks: [{ sequenceInput: '1' }, { sequenceInput: '2' }] } },
    trackUpdates: [{ index: 1, changes: { sequenceInput: '4' } }] }));
  assert.deepEqual(unnamed.project.tracks.map((track: any) => track.sequenceInput), ['1', '4']);
});

test('MCP inspect resolves actual pitches, timing and bounded event pages', async t => {
  const { call } = await session(t);
  const inspected = data(await call('inspect_project', { source: { project: sketch() }, eventLimit: 2 }));
  assert.equal(inspected.durationSeconds, 0.2);
  assert.deepEqual(inspected.tracks[0].events.map((event: any) => event.notes), [[48], [50]]);
  assert.deepEqual(inspected.tracks[0].events[0].noteNames, ['C3']);
  assert.equal(inspected.tracks[0].events[1].time, 0.05);
  assert.equal(inspected.tracks[0].hasMoreEvents, true);
  const next = data(await call('inspect_project', { source: { project: sketch() }, eventOffset: 2, eventLimit: 1 }));
  assert.deepEqual(next.tracks[0].events[0].notes, [48, 50]);
  assert.equal((await call('inspect_project', { source: { project: sketch() }, eventLimit: 129 })).isError, true);
});

test('MCP inspection applies playback polyphony and rejects ambiguous track selectors', async t => {
  const { call } = await session(t);
  const project = { ...sketch(), tracks: [{ ...sketch().tracks[0], sequenceInput: '7', polyphony: 1 }] };
  const inspected = data(await call('inspect_project', { source: { project } }));
  assert.deepEqual(inspected.tracks[0].events[0].notes, [52]);
  assert.deepEqual(inspected.tracks[0].events[0].noteNames, ['E3']);
  const duplicate = { ...sketch(), tracks: [sketch().tracks[0], sketch().tracks[0]] };
  assert.equal((await call('update_project', { source: { project: duplicate },
    trackUpdates: [{ id: 'lead', changes: { gain: -30 } }] })).isError, true);
  const repaired = data(await call('update_project', { source: { project: duplicate },
    trackUpdates: [{ index: 1, changes: { id: 'second' } }] }));
  assert.deepEqual(repaired.project.tracks.map((track: any) => track.id), ['lead', 'second']);
});

test('MCP previews real audio, forwards progress and serves generated WAV resources', async t => {
  const { call, client } = await session(t);
  const progress: number[] = [];
  const result = await client.callTool({ name: 'render_preview', arguments: {
    source: { project: sketch() }, range: { start: 0, end: 0.1, unit: 'seconds' },
  } }, { onprogress: value => { progress.push(value.progress); } });
  const preview = data(result);
  assert.equal(preview.measurements.duration, 0.1);
  assert.ok(preview.measurements.peak > 0);
  assert.ok(progress.length > 0);
  const bytes = await readFile(preview.artifact.path);
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  const audio = (await client.readResource({ uri: preview.artifact.uri })).contents[0];
  assert.ok('blob' in audio);
  assert.deepEqual(Buffer.from(audio.blob, 'base64'), bytes);
  assert.ok(result.content.some(content => content.type === 'resource_link'));
  assert.equal(result.content.some(content => content.type === 'audio'), false);
  const expected = await renderDevelopment(normalizePresetData(sketch()), { range: { start: 0, end: 0.1, unit: 'seconds' } });
  assert.deepEqual(preview.measurements, expected.measurements);
  const tooLong = await call('render_preview', { source: { project: { ...sketch(), bpm: 60,
    tracks: [{ ...sketch().tracks[0], repeats: 64 }] } }, range: { start: 0, end: 31, unit: 'seconds' } });
  assert.equal(tooLong.isError, true);
  assert.match(JSON.stringify(tooLong.content), /at most 30 seconds/);
});

test('MCP large audio artifacts remain accessible without overflowing the default stdio client', async t => {
  const { call, client } = await session(t);
  const project = { ...sketch(), bpm: 60, tracks: [{ ...sketch().tracks[0], sequenceInput: '0', denominator: 1, repeats: 40 }] };
  const preview = data(await call('render_preview', { source: { project }, range: { start: 0, end: 30, unit: 'seconds' } }));
  const bytes = await readFile(preview.artifact.path);
  assert.ok(bytes.length > 8 * 1024 * 1024);
  await assert.rejects(client.readResource({ uri: preview.artifact.uri }), /read_artifact/);
  let offset = 0;
  const chunks: Buffer[] = [];
  do {
    const chunk = data(await call('read_artifact', { uri: preview.artifact.uri, offset }));
    assert.equal(chunk.totalBytes, bytes.length);
    assert.equal(chunk.offset, offset);
    const decoded = Buffer.from(chunk.data, 'base64');
    assert.ok(decoded.length > 0 && decoded.length <= 256 * 1024);
    chunks.push(decoded);
    offset = chunk.nextOffset;
    assert.equal(chunk.eof, offset === bytes.length);
  } while (offset < bytes.length);
  assert.deepEqual(Buffer.concat(chunks), bytes);
  const end = data(await call('read_artifact', { uri: preview.artifact.uri, offset }));
  assert.equal(end.data, '');
  assert.equal(end.eof, true);
  assert.equal((await call('read_artifact', { uri: preview.artifact.uri, offset: offset + 1 })).isError, true);
  assert.equal((await call('read_artifact', { uri: preview.artifact.uri, length: 256 * 1024 + 1 })).isError, true);
  assert.equal((await call('read_artifact', { uri: 'file:///etc/passwd' })).isError, true);
  assert.ok(data(await call('get_capabilities')).generators.length > 0);
});

test('MCP sample-heavy projects can be edited without echoing PCM data over stdio', async t => {
  const { call, workspace } = await session(t);
  const project = normalizePresetData(sketch());
  const asset = await createSampleAsset([new Float32Array(600_000)], 8000, 'Large sample');
  project.studio = { version: 1, seed: 1, assets: [asset], returns: [] };
  await writeFile(join(workspace, 'large.json'), JSON.stringify(project));
  const source = { path: 'large.json' };
  const tooLarge = await call('update_project', { source, changes: { bpm: 180 }, output: 'large-edit.json' });
  assert.equal(tooLarge.isError, true);
  assert.match(JSON.stringify(tooLarge.content), /includeProject=false/);
  await assert.rejects(readFile(join(workspace, 'large-edit.json')), /ENOENT/);
  const saved = data(await call('update_project', { source, changes: { bpm: 180 }, output: 'large-edit.json', includeProject: false }));
  assert.equal(saved.project, undefined);
  const loaded = await loadProject(saved.artifact.path);
  assert.equal(loaded.bpm, 180);
  assert.deepEqual(loaded.studio?.assets, [asset]);
  assert.equal((await call('inspect_project', { source, includeProject: true })).isError, true);
  assert.equal(data(await call('validate_project', { source })).valid, true);
});

test('MCP exports MIDI, full WAV, portable samples and separate stems', async t => {
  const { call, workspace } = await session(t);
  const source = { project: sketch() };
  const midi = data(await call('export_project', { source, format: 'midi', output: 'exports/sketch.mid' }));
  assert.deepEqual(await readFile(midi.artifact.path), Buffer.from(await generateDevelopedMidi(normalizePresetData(sketch()))));
  const wav = data(await call('export_project', { source, format: 'wav', output: 'exports/sketch.wav' }));
  assert.deepEqual(wav.measurements, (await renderDevelopment(normalizePresetData(sketch()))).measurements);
  const stems = data(await call('export_project', { source, format: 'stems', output: 'exports/stems',
    range: { start: 0, end: 0.1, unit: 'seconds' }, stemStage: 'post' }));
  assert.ok(stems.manifest.files.length > 0);
  assert.equal(stems.manifest.format, 'float32');
  assert.ok((await readdir(join(workspace, 'exports/stems'))).includes('stems.json'));
  assert.equal((await call('export_project', { source, format: 'stems', output: 'exports/stems' })).isError, true);
  const project = normalizePresetData(sketch());
  const asset = await createSampleAsset([[0, 0.2, -0.2, 0]], 8000, 'Embedded sample');
  project.studio = { version: 1, seed: 1, assets: [asset], returns: [] };
  const packed = data(await call('export_project', { source: { project }, format: 'project' }));
  assert.deepEqual((await loadProject(packed.artifact.path)).studio?.assets, [asset]);
  assert.equal((await call('export_project', { source, format: 'midi', range: { start: 0, end: 1, unit: 'bars' } })).isError, true);
});

test('MCP failed stem exports remove their output so a corrected request can retry', async t => {
  const { call, workspace } = await session(t);
  const args = { source: { project: sketch() }, format: 'stems', output: 'exports/retry-stems' };
  assert.equal((await call('export_project', { ...args, range: { start: 999, end: 1000, unit: 'seconds' } })).isError, true);
  await assert.rejects(readdir(join(workspace, args.output)), /ENOENT/);
  data(await call('export_project', { ...args, range: { start: 0, end: 0.1, unit: 'seconds' } }));
  const before = await readFile(join(workspace, args.output, 'stems.json'));
  assert.equal((await call('export_project', args)).isError, true);
  assert.deepEqual(await readFile(join(workspace, args.output, 'stems.json')), before);
});

test('MCP directory exports remove partial files when writing fails', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'gaterunner-mcp-partial-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const workspace = await McpWorkspace.open(temporary);
  await assert.rejects(workspace.writeDirectory('partial', async directory => {
    await writeFile(join(directory, 'first.wav'), 'partial audio');
    throw new Error('Simulated disk failure during the next stem');
  }), /Simulated disk failure/);
  assert.deepEqual(await readdir(temporary), []);
});

test('MCP rejects paths outside its workspace and preserves existing files unless replacement is explicit', async t => {
  const { call, workspace, temporary } = await session(t);
  const outside = join(temporary, 'outside');
  await mkdir(outside);
  await writeFile(join(outside, 'project.json'), JSON.stringify(sketch()));
  for (const path of ['../outside/project.json', join(outside, 'project.json')]) {
    assert.equal((await call('inspect_project', { source: { path } })).isError, true);
  }
  for (const output of ['../outside/new.json']) {
    assert.equal((await call('update_project', { changes: sketch(), output })).isError, true);
  }
  assert.deepEqual(await readdir(outside), ['project.json']);
  await t.test('symbolic links and directory junctions cannot bypass the workspace', async child => {
    try { await symlink(outside, join(workspace, 'external'), process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        child.skip('The operating system does not permit this test process to create a symbolic link or junction');
        return;
      }
      throw error;
    }
    assert.equal((await call('inspect_project', { source: { path: 'external/project.json' } })).isError, true);
    for (const output of ['external/new.json', 'external/nested/new.json']) {
      assert.equal((await call('update_project', { changes: sketch(), output })).isError, true);
    }
    assert.deepEqual(await readdir(outside), ['project.json']);
  });
  await writeFile(join(workspace, 'existing.json'), 'keep this');
  assert.equal((await call('update_project', { changes: sketch(), output: 'existing.json' })).isError, true);
  assert.equal(await readFile(join(workspace, 'existing.json'), 'utf8'), 'keep this');
  data(await call('update_project', { changes: sketch(), output: 'existing.json', overwrite: true }));
  assert.equal((await loadProject(join(workspace, 'existing.json'))).bpm, 300);
  const invalid = await call('update_project', { changes: { forte: 'bad' }, output: 'existing.json', overwrite: true });
  assert.equal(invalid.isError, true);
  assert.equal((await loadProject(join(workspace, 'existing.json'))).bpm, 300);
  const dangerous = JSON.parse('{"__proto__":{"polluted":true}}');
  // The SDK may strip this key before our merge guard sees it; either path must be safe.
  await call('update_project', { changes: dangerous });
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal((await readdir(workspace)).some(file => file.endsWith('.tmp')), false);
});

test('MCP cancellation aborts an active render and leaves the server usable', async t => {
  const { client, call, workspace } = await session(t);
  const controller = new AbortController();
  const project = sketch();
  project.tracks = [project.tracks[0], { ...project.tracks[0], id: 'second' }];
  const pending = client.callTool({ name: 'export_project', arguments: { source: { project }, format: 'wav', output: 'cancelled.wav' } }, {
    signal: controller.signal,
    onprogress: () => controller.abort(new Error('Cancelled by MCP test')),
  });
  await assert.rejects(pending, /cancel/i);
  assert.ok(data(await call('get_capabilities')).generators.length > 0);
  await assert.rejects(readFile(join(workspace, 'cancelled.wav')), /ENOENT/);
});

test('MCP cancelled stems finish cleanup before the output is reused', async t => {
  const { client, call, workspace } = await session(t);
  const controller = new AbortController();
  const project = { ...sketch(), bpm: 60, tracks: [
    { ...sketch().tracks[0], repeats: 8 }, { ...sketch().tracks[0], repeats: 8, id: 'second' },
  ] };
  const args = { source: { project }, format: 'stems', output: 'cancelled-stems' };
  const pending = client.callTool({ name: 'export_project', arguments: args }, {
    signal: controller.signal,
    onprogress: () => controller.abort(new Error('Cancelled by MCP test')),
  });
  await assert.rejects(pending, /cancel/i);
  // Client cancellation resolves before the server has unwound the request.
  const deadline = Date.now() + 10_000;
  for (;;) {
    try { await readdir(join(workspace, args.output)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') break; throw error; }
    assert.ok(Date.now() < deadline, 'Cancelled export must remove its directory');
    await delay(20);
  }
  data(await call('export_project', { ...args, range: { start: 0, end: 0.1, unit: 'seconds' } }));
});
