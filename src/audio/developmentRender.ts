import { Midi } from './midi.js';
import { normalizePresetData, type PresetData } from '../presets.js';
import { requireValidProject } from '../domain/projectValidation.js';
import { resolveProjectEvents, type ResolvedProject } from '../domain/developmentSchedule.js';
import { createScheduledRenderSession, applyReverbSend, generateMidi, type GenerateOptions, type WavChannelRenderResult } from './nativeRenderer.js';
import { usesDevelopment } from '../domain/development.js';
import { createReturnProcessor } from './auxiliaryReturns.js';
import { applyMasterClip } from './masterClip.js';
import { limitPolyphony } from './glide.js';
import { renderKey, resultBytes, type RenderCache } from './renderCache.js';
import { sampleContentHash } from './sampleAssets.js';

export type StereoChannels = [Float32Array, Float32Array];
export interface RenderRange { start: number; end: number; unit: 'seconds' | 'beats' | 'bars'; beatsPerBar?: number }
export interface RenderMeasurements { duration: number; sampleRate: number; peak: number; rms: number; clippingSamples: number }
export interface RenderStem { id: string; name: string; kind: 'track' | 'lane' | 'return'; trackIndex?: number;
  channels: StereoChannels; recombine: boolean; stage: 'pre-insert' | 'post-insert' | 'wet' }
export interface DevelopmentRenderOptions { range?: RenderRange; cache?: RenderCache; signal?: AbortSignal;
  laneStems?: boolean; preInsertStems?: boolean; blockFrames?: number;
  onProgress?: (progress: { completed: number; total: number; stage: string; cacheHit?: boolean }) => void }
export interface DevelopmentRenderResult { channels: StereoChannels; preMaster: StereoChannels; stems: RenderStem[];
  sampleRate: number; songDuration: number; range: { start: number; end: number }; measurements: RenderMeasurements;
  stats: { milliseconds: number; cacheHits: number; returnCacheHits:number; renderedTracks: number; workingBufferBytes: number }; resolved: ResolvedProject }
const yieldThread = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const gain = (db: number) => 10 ** (db / 20);
export function generatorProject(options: GenerateOptions): PresetData {
  return normalizePresetData({ ...options, tracks: options.tracks?.map((track, i) => ({ ...track,
    id: track.id ?? `track-${i + 1}`, sequenceInput: track.sequence ?? '1 2 4 8 16' })) });
}
export function measureChannels(channels: readonly Float32Array[], sampleRate: number): RenderMeasurements {
  let peak = 0, squares = 0, clippingSamples = 0, samples = 0;
  for (const channel of channels) for (const sample of channel) {
    if (!Number.isFinite(sample)) throw new Error('Non-finite rendered audio');
    peak = Math.max(peak, Math.abs(sample)); squares += sample * sample; samples++;
    if (Math.abs(sample) >= 1) clippingSamples++;
  }
  return { duration: (channels[0]?.length ?? 0) / sampleRate, sampleRate, peak, rms: Math.sqrt(squares / Math.max(1, samples)), clippingSamples };
}
export function rangeInSeconds(range: RenderRange | undefined, project: PresetData, fullDuration: number) {
  if (!range) return { start: 0, end: fullDuration };
  const factor = range.unit === 'seconds' ? 1 : 60 / project.bpm * (range.unit === 'bars' ? range.beatsPerBar ?? project.tracks[0].numerator : 1);
  const start = range.start * factor, end = range.end * factor;
  if (![start, end].every(Number.isFinite) || start < 0 || end <= start || end > fullDuration + 1e-8) throw new Error(`Range must lie inside 0…${fullDuration.toFixed(6)} seconds`);
  return { start, end };
}
export async function generateDevelopedMidi(project: PresetData): Promise<Uint8Array> {
  if (!usesDevelopment(project)) return generateMidi({ ...project, tracks: project.tracks.map(({sequenceInput,...track})=>({...track,sequence:sequenceInput})) });
  const validated = requireValidProject(project), resolved = await resolveProjectEvents(validated), midi = new Midi();
  midi.header.setTempo(project.bpm);
  for (const { track, events } of resolved.tracks) {
    if (!events.length) continue;
    const output = midi.addTrack(); output.name = track.name; output.channel = track.midiChannel - 1;
    if (track.trackKind !== 'rhythmic' && track.polyphony === 1 && track.glideTime > 0) {
      output.addCC({ number: 65, value: 1, time: 0 }); output.addCC({ number: 5, value: Math.min(1, track.glideTime / 5), time: 0 });
    }
    for (const event of events) {
      if (event.locks?.glideTime !== undefined) {
        const slide = Number(event.locks.glideTime);
        output.addCC({ number: 65, value: slide > 0 ? 1 : 0, time: event.time }); output.addCC({ number: 5, value: Math.min(1, slide / 5), time: event.time });
      } else if (track.polyphony === 1) { // Locks reset at the next unmodified event.
        const slide=Number(event.settings?.glideTime ?? track.glideTime);
        output.addCC({ number: 65, value: slide > 0 ? 1 : 0, time: event.time });
        output.addCC({ number: 5, value: Math.min(1, slide / 5), time: event.time });
      }
      const notes = track.trackKind === 'rhythmic' ? event.notes : limitPolyphony(event.notes, track.polyphony);
      notes.forEach((note, i) => output.addNote({ midi: note, time: event.time, duration: event.duration,
        velocity: event.noteVelocities?.[i] ?? event.velocity }));
    }
  }
  return midi.toArray();
}
export async function renderDevelopment(input: PresetData, options: DevelopmentRenderOptions = {}): Promise<DevelopmentRenderResult> {
  const started = performance.now(), project = requireValidProject(input), signal = options.signal, legacy = !usesDevelopment(project);
  signal?.throwIfAborted();
  for (const asset of project.studio?.assets ?? []) {
    if (await sampleContentHash(asset.channels, asset.sampleRate) !== asset.hash) throw new Error(`Sample content hash mismatch: ${asset.name}`);
    signal?.throwIfAborted();
  }
  const resolved = await resolveProjectEvents(project), session = await createScheduledRenderSession(project, resolved), sampleRate = 48000;
  const fullFrames = Math.ceil(session.duration * sampleRate);
  const range = rangeInSeconds(options.range, project, fullFrames / sampleRate);
  const frames=options.range?Math.min(fullFrames,Math.ceil(range.end*sampleRate)):fullFrames;
  if (frames > 100_000_000) throw new Error('Render exceeds supported buffer size; shorten the arrangement or feedback tail');
  const empty = (): StereoChannels => [new Float32Array(frames), new Float32Array(frames)];
  const preMaster = empty(), reverbSend = empty(), auxInputs = new Map((project.studio?.returns ?? []).map(a => [a.id, empty()]));
  const stems: RenderStem[] = [],trackKeys:string[]=[]; let cacheHits = 0,returnCacheHits=0, renderedTracks = 0, workingBufferBytes = frames * 16 * (2 + auxInputs.size);
  const add = (target: StereoChannels, source: readonly ArrayLike<number>[], multiplier = 1) => {
    for (let i = 0; i < frames; i++) { target[0][i] += (source[0][i] ?? 0) * multiplier; target[1][i] += (source[1][i] ?? 0) * multiplier; }
  };
  const dryGain = gain(project.reverb.dry);
  let reverbSettings: WavChannelRenderResult['reverb'] | undefined;
  const total = project.tracks.length + (project.studio?.returns.length ?? 0) + 1;
  for (let index = 0; index < project.tracks.length; index++) {
    signal?.throwIfAborted();
    const track = project.tracks[index];
    const key = await renderKey({ track, events: resolved.tracks[index].events, index, duration: session.duration,
      bpm: project.bpm, a4: project.a4, reverb: project.reverb, studio: { ...project.studio, assets: project.studio?.assets.map(a => a.hash) } });
    trackKeys.push(key);
    const prefixKey=frames===fullFrames?key:await renderKey({track:key,completedPrefixFrames:frames});
    let raw = await options.cache?.get(key);
    if(raw&&raw.left.length!==fullFrames)raw=undefined;
    raw ??= await options.cache?.get(prefixKey);
    if (raw && raw.left.length < frames) raw = undefined;
    const trackCacheHit = !!raw;
    if (raw) cacheHits++; else {
      await yieldThread(); signal?.throwIfAborted(); const source = session.renderTrack(index,undefined,false,frames/sampleRate); renderedTracks++;
      raw=legacy?source:{...source,left:new Float32Array(source.left),right:new Float32Array(source.right),
        reverbLeft:source.reverbLeft?new Float32Array(source.reverbLeft):null,reverbRight:source.reverbRight?new Float32Array(source.reverbRight):null};
      signal?.throwIfAborted(); await options.cache?.put(prefixKey, raw);
    }
    reverbSettings = raw.reverb;
    workingBufferBytes = Math.max(workingBufferBytes, resultBytes(raw) + frames * 16 * (2 + auxInputs.size + stems.length));
    const channels: StereoChannels = [Float32Array.from(raw.left.subarray(0,frames), v => v * dryGain), Float32Array.from(raw.right.subarray(0,frames), v => v * dryGain)];
    stems.push({ id: track.id, name: track.name, kind: 'track', trackIndex: index, channels, recombine: true, stage: 'post-insert' });
    // Legacy summation rounds once after adding each original double-precision
    // track, and applies the dry trim after summation. Preserve that arithmetic.
    add(preMaster, legacy ? [raw.left,raw.right] : channels);
    if (raw.reverbLeft && raw.reverbRight) add(reverbSend, [raw.reverbLeft, raw.reverbRight]);
    for (const [id, pair] of Object.entries(raw.auxSends ?? {})) if (auxInputs.has(id)) add(auxInputs.get(id)!, pair);
    if (options.preInsertStems) {
      const pre = session.renderTrack(index, undefined, true,frames/sampleRate);
      stems.push({ id: `${track.id}-pre`, name: `${track.name} · before inserts`, kind: 'track', trackIndex: index,
        channels: [new Float32Array(pre.left), new Float32Array(pre.right)], recombine: false, stage: 'pre-insert' });
    }
    if (options.laneStems && track.trackKind === 'rhythmic') for (let lane = 0; lane < track.drumLanes.length; lane++) {
      await yieldThread(); signal?.throwIfAborted();
      const rendered = session.renderTrack(index, lane, true,frames/sampleRate);
      stems.push({ id: `${track.id}-lane-${lane}`, name: `${track.name} · ${track.drumLanes[lane].voiceId}`, kind: 'lane', trackIndex: index,
        channels: [new Float32Array(rendered.left), new Float32Array(rendered.right)], recombine: false, stage: 'pre-insert' });
    }
    options.onProgress?.({ completed: index + 1, total, stage: track.name, cacheHit: trackCacheHit });
  }
  if(legacy&&dryGain!==1)for(let i=0;i<frames;i++){preMaster[0][i]*=dryGain;preMaster[1][i]*=dryGain;}
  const wet = empty();
  if (reverbSettings) applyReverbSend(wet[0], wet[1], legacy?reverbSend[0].slice():reverbSend[0], legacy?reverbSend[1].slice():reverbSend[1], reverbSettings, sampleRate, project.a4);
  if (project.reverb.enabled && project.reverb.wet > -96) {
    if(legacy&&reverbSettings)applyReverbSend(preMaster[0],preMaster[1],reverbSend[0],reverbSend[1],reverbSettings,sampleRate,project.a4);
    else add(preMaster, wet);
    stems.push({ id: 'global-reverb', name: 'Global reverb', kind: 'return', channels: wet, recombine: true, stage: 'wet' }); }
  const blockFrames = options.blockFrames ?? 16384;
  if (!Number.isInteger(blockFrames) || blockFrames < 1 || blockFrames > 1_048_576) throw new Error('blockFrames must be 1…1048576');
  for (const [index, aux] of (project.studio?.returns ?? []).entries()) {
    const key=await renderKey({return:aux,trackKeys,bpm:project.bpm,frames:fullFrames,sampleRate});
    const prefixKey=frames===fullFrames?key:await renderKey({return:key,completedPrefixFrames:frames});
    let cached=await options.cache?.get(key);cached ??= await options.cache?.get(prefixKey);
    if(cached&&cached.left.length<frames)cached=undefined;
    const inputs = auxInputs.get(aux.id)!, channels = cached?[new Float32Array(cached.left.subarray(0,frames)),new Float32Array(cached.right.subarray(0,frames))] as StereoChannels:empty();
    if(cached)returnCacheHits++;
    const processor = cached?undefined:createReturnProcessor(aux, sampleRate, project.bpm);
    for (let start = 0; !cached&&start < frames; start += blockFrames) {
      signal?.throwIfAborted(); const end = Math.min(frames, start + blockFrames);
      const processed = processor!.processBlock(inputs[0].subarray(start, end), inputs[1].subarray(start, end), start);
      channels[0].set(processed[0], start); channels[1].set(processed[1], start);
      if ((start / blockFrames) % 8 === 0) await yieldThread();
    }
    signal?.throwIfAborted();
    if(!cached&&reverbSettings)await options.cache?.put(prefixKey,{left:channels[0],right:channels[1],reverbLeft:null,reverbRight:null,sampleRate,a4:project.a4,masterGain:project.masterGain,reverb:reverbSettings});
    add(preMaster, channels); stems.push({ id: aux.id, name: aux.name, kind: 'return', channels, recombine: true, stage: 'wet' });
    options.onProgress?.({ completed: project.tracks.length + index + 1, total, stage: aux.name });
  }
  signal?.throwIfAborted();
  const startFrame = Math.floor(range.start * sampleRate), endFrame = Math.min(frames, Math.ceil(range.end * sampleRate));
  const sliced = (pair: StereoChannels): StereoChannels => startFrame===0&&endFrame===frames?pair:[pair[0].slice(startFrame, endFrame), pair[1].slice(startFrame, endFrame)];
  const trimmed = sliced(preMaster), masterGain = gain(project.masterGain);
  const channels: StereoChannels = trimmed.map(channel => Float32Array.from(channel, sample => {
    if(!Number.isFinite(sample))throw new Error('Non-finite pre-master mix');
    return applyMasterClip(sample * masterGain);
  })) as StereoChannels;
  options.onProgress?.({ completed: total, total, stage: 'Complete' });
  return { channels, preMaster: trimmed, stems: stems.map(s => ({ ...s, channels: sliced(s.channels) })), sampleRate,
    songDuration: resolved.duration, range: { start: startFrame / sampleRate, end: endFrame / sampleRate },
    measurements: measureChannels(channels, sampleRate), stats: { milliseconds: performance.now() - started, cacheHits,returnCacheHits, renderedTracks, workingBufferBytes }, resolved };
}
