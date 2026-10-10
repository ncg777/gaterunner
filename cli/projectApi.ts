import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { normalizePresetData, parsePresetImportPayload, type PresetData } from '../src/presets.js';
import { validateProject, requireValidProject } from '../src/domain/projectValidation.js';
import { TRACK_PARAMETERS, RETURN_PARAMETERS, parameterDefinitions } from '../src/domain/development.js';
import { DRUM_VOICE_IDS, getDrumParameterDefinitions } from '../src/domain/rhythmTrack.js';
import { resolveProjectEvents } from '../src/domain/developmentSchedule.js';
import { renderDevelopment, measureChannels, type DevelopmentRenderOptions } from '../src/audio/developmentRender.js';
import { createSampleAsset, importWavAsset } from '../src/audio/sampleAssets.js';
import { encodeWavFromChannelsSync } from '../src/audio/wav.js';
import { RENDERER_VERSION } from '../src/audio/renderCache.js';
import { DiskRenderCache } from './diskRenderCache.js';

export { validateProject, normalizePresetData as normalizeProject, resolveProjectEvents, parameterDefinitions, importWavAsset };
export function supportedFeatures() {
  return { version: '2026.10.9', renderer: RENDERER_VERSION, patterns: true, arrangements: true,
    generators: ['additive', 'partial-bank', 'resonant-noise', 'choir', 'modal', 'pulse', 'fm', 'pluck', 'granular'],
    conditions: ['every', 'first', 'fill', 'probability'], articulation: ['velocity', 'gate', 'durationBeats', 'tie', 'legato', 'slide', 'offsetBeats', 'timingVariation', 'velocityVariation'],
    automation: ['song', 'note', 'linear', 'smooth', 'step', 'snapshots'], returns: ['delay', 'filter', 'saturation', 'gain'],
    samples: ['WAV PCM 8/16/24/32', 'WAV float 32/64', 'mono', 'stereo', 'velocity-layers', 'round-robin', 'seeded-random'],
    render: { sampleRate: 48000, wavBitDepth: 24, stemWavFormat: 'float32', ranges: ['bars', 'beats', 'seconds'], stems: ['tracks', 'pre-insert-drum-lanes', 'returns'],
      cache: 'validated completed tracks and returns, including completed warm-up prefixes', blockProcessing: 'auxiliary returns', excerptState: 'full warm-up from song origin' },
    parameters: { track: TRACK_PARAMETERS, returns: RETURN_PARAMETERS, drums: Object.fromEntries(DRUM_VOICE_IDS.map(id => [id, getDrumParameterDefinitions(id)])) } };
}
export async function loadProject(path: string): Promise<PresetData> {
  const text = await readFile(path, 'utf8'), raw = JSON.parse(text);
  if (raw.type === 'gaterunner-asset-package') {if(raw.version!==1)throw new Error('Unsupported asset package version');return requireValidProject(raw.project);}
  if (raw.tracks || raw.sequenceInput) return requireValidProject(raw);
  const payload = parsePresetImportPayload(text);
  const preset = payload.kind === 'single-preset' ? payload.preset : payload.presets.find(p=>p.id===payload.selectedPresetId) ?? payload.presets[0]; if (!preset) throw new Error('Project contains no presets');
  return requireValidProject(preset.data);
}
export interface ProjectRenderOptions extends DevelopmentRenderOptions { output?: string; cacheDirectory?: string }
export async function renderProject(project: PresetData, options: ProjectRenderOptions = {}) {
  const before = process.resourceUsage().maxRSS;
  const renderOptions={...options,cache:options.cache ?? (options.cacheDirectory ? new DiskRenderCache(resolve(options.cacheDirectory)) : undefined)};
  const rendered=options.signal&&!options.cache
    ? await (await import('./developmentRenderPool.js')).renderOffThread(project,{...options,cacheDirectory:options.cacheDirectory?resolve(options.cacheDirectory):undefined})
    : await renderDevelopment(project,renderOptions);
  let file: string | undefined;
  if (options.output) { file = resolve(options.output); await writeFile(file, encodeWavFromChannelsSync(rendered.channels, rendered.sampleRate)); }
  return { ...rendered, file, performance: { elapsedMilliseconds: rendered.stats.milliseconds,
    processPeakMemoryBytes: process.resourceUsage().maxRSS * 1024, previousProcessPeakBytes: before * 1024 } };
}
const safeName = (value: string) => value.replace(/[^\w-]+/g, '-').slice(0, 100) || 'stem';
export async function exportStems(project: PresetData, directory: string, options: ProjectRenderOptions & {stemStage?:'all'|'pre'|'post'} = {}) {
  if(options.stemStage&&!['all','pre','post'].includes(options.stemStage))throw new Error('stemStage must be all, pre or post');
  const rendered = await renderProject(project, { ...options, laneStems: options.laneStems ?? true, preInsertStems: options.preInsertStems ?? true, output: undefined });
  const destination = resolve(directory); await mkdir(destination, { recursive: true });
  const files = [];
  const selected=rendered.stems.filter(s=>!options.stemStage||options.stemStage==='all'||(options.stemStage==='pre'?s.stage==='pre-insert':s.stage!=='pre-insert'));
  for (const [i, stem] of selected.entries()) {
    options.signal?.throwIfAborted(); const file = join(destination, `${String(i + 1).padStart(2, '0')}-${safeName(stem.id)}.wav`);
    await writeFile(file, encodeWavFromChannelsSync(stem.channels, rendered.sampleRate, { format: 'float32' }));
    files.push({ id: stem.id, name: stem.name, kind: stem.kind, stage: stem.stage, recombine: stem.recombine, file,
      measurements: measureChannels(stem.channels, rendered.sampleRate) });
  }
  const manifest = { renderer: RENDERER_VERSION, range: rendered.range, sampleRate: rendered.sampleRate, format: 'float32',
    masterGain: project.masterGain, stemStage:options.stemStage ?? 'all',
    instructions: options.stemStage==='pre'?'Dry editing sources; they do not recombine into the wet pre-master mix.':'Sum recombine=true stems for the pre-master mix. Apply master gain and GateRunner soft clip once. Lane/pre-insert files are alternative editing sources.', files };
  const manifestFile = join(destination, 'stems.json'); await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  return { manifestFile, ...manifest, performance: rendered.performance, stats: rendered.stats };
}
export async function bounceSample(project: PresetData, name: string, source: 'mix' | string, options: ProjectRenderOptions = {}) {
  const rendered = await renderProject(project, options), selected = source === 'mix' ? rendered.channels
    : rendered.stems.find(s => s.id === source)?.channels;
  if (!selected) throw new Error(`Unknown bounce source ${source}`);
  return createSampleAsset(selected, rendered.sampleRate, name, { project: normalizePresetData(project),
    range: rendered.range, renderer: RENDERER_VERSION, sampleRate: rendered.sampleRate, source });
}
export async function exportProjectPackage(project: PresetData, output: string) {
  const validated = requireValidProject(project), file = resolve(output);
  await writeFile(file, JSON.stringify({ type: 'gaterunner-asset-package', version: 1, project: validated }) + '\n');
  return { file, assetCount: validated.studio?.assets.length ?? 0 };
}
