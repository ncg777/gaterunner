import { normalizePresetData, type PresetData } from '../presets.js';
import { parameterDefinitions, RETURN_PARAMETERS, validControl, type Automation, type Condition,
  type ParameterDefinition, type StepControl,usesDevelopment } from './development.js';
import { parseRhythmSequenceInput } from './rhythmTrack.js';

export interface ProjectDiagnostic { path: string; message: string; severity: 'error' | 'warning' }
function validateNormalizedProject(input: unknown): { project: PresetData; diagnostics: ProjectDiagnostic[]; valid: boolean } {
  const project = normalizePresetData(input), diagnostics: ProjectDiagnostic[] = [];
  const issue = (path: string, message: string, severity: 'error' | 'warning' = 'error') => diagnostics.push({ path, message, severity });
  const raw=input&&typeof input==='object'?input as Record<string,unknown>:{};
  if(raw.studio&&typeof raw.studio==='object'&&(raw.studio as {version?:unknown}).version!==undefined&&(raw.studio as {version?:unknown}).version!==1)issue('studio.version','Unsupported studio schema version');
  const rawTracks=Array.isArray(raw.tracks)?raw.tracks:[];
  rawTracks.forEach((value,index)=>{if(!value||typeof value!=='object')return;for(const [key,before]of Object.entries(value)){
    const after=(project.tracks[index] as unknown as Record<string,unknown>)?.[key];
    if(before!==undefined&&typeof after==='number'&&before!==after)issue(`tracks.${index}.${key}`,`Normalized to ${after}`,'warning');
  }});
  const number = (value: unknown, min: number, max: number, path: string, integer = false) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) issue(path, `Expected ${integer ? 'integer' : 'number'} in ${min}…${max}`);
  };
  const ids = (items: { id: string }[], path: string) => {
    const seen = new Set<string>();
    for (const [i, item] of items.entries()) {
      if (!item || typeof item.id !== 'string' || !/^[\w-]+$/.test(item.id) || seen.has(item.id)) issue(`${path}.${i}.id`, 'Use a unique stable identifier (letters, digits, underscore or hyphen)');
      seen.add(item?.id);
    }
    return seen;
  };
  const condition = (c: Condition | undefined, path: string) => {
    if (!c) return;
    if (typeof c !== 'object' || Array.isArray(c)) { issue(path, 'Expected condition object'); return; }
    if (c.every !== undefined) number(c.every, 1, 65536, `${path}.every`, true);
    if (c.probability !== undefined) number(c.probability, 0, 1, `${path}.probability`);
    if (c.first !== undefined && typeof c.first !== 'boolean') issue(path, 'first must be boolean');
    if (c.fill !== undefined && typeof c.fill !== 'boolean') issue(path, 'fill must be boolean');
  };
  const controls = (values: Record<string, unknown> | undefined, definitions: Record<string, ParameterDefinition>, path: string, voiceOnly = false) => {
    for (const [target, value] of Object.entries(values ?? {})) {
      if (!Object.hasOwn(definitions,target)) issue(`${path}.${target}`, 'Unsupported parameter target');
      else if (voiceOnly && definitions[target].scope !== 'voice') issue(`${path}.${target}`, 'Bus controls belong in timeline automation, not per-step locks');
      else if (!validControl(value, definitions[target])) issue(`${path}.${target}`, 'Value is outside the parameter definition');
    }
  };
  const automation = (curves: Automation[], definitions: Record<string, ParameterDefinition>, path: string, lanes = 0) => {
    ids(curves, path);
    for (const [i, curve] of curves.entries()) {
      if (!curve || typeof curve !== 'object') { issue(`${path}.${i}`, 'Expected curve'); continue; }
      const definition = Object.hasOwn(definitions,curve.target)?definitions[curve.target]:undefined;
      if (!definition) { issue(`${path}.${i}.target`, 'Unsupported automation target'); continue; }
      if (!['step', 'linear', 'smooth'].includes(curve.interpolation)) issue(`${path}.${i}`, 'Invalid interpolation');
      if(curve.clock!==undefined&&!['song','note'].includes(curve.clock))issue(`${path}.${i}.clock`,'Use song or note clock');
      if(curve.clock==='note'&&definition.scope==='bus')issue(`${path}.${i}.clock`,'Bus automation uses song time; note time requires a voice control');
      if (definition.options && curve.interpolation !== 'step') issue(`${path}.${i}`, 'Discrete targets require step interpolation');
      if (curve.lane !== undefined) {
        number(curve.lane, 0, lanes - 1, `${path}.${i}.lane`, true);
        if (definition.scope === 'bus') issue(`${path}.${i}.lane`, 'Bus automation applies to the whole track or return');
      }
      if (!Array.isArray(curve.points)) { issue(`${path}.${i}`, 'Expected points'); continue; }
      let previous = -1;
      for (const [j, point] of curve.points.entries()) {
        if (!point) { issue(`${path}.${i}.points.${j}`, 'Expected point'); continue; }
        number(point.beat, 0, 1e7, `${path}.${i}.points.${j}.beat`);
        if (point.beat <= previous) issue(`${path}.${i}.points.${j}`, 'Points must have increasing beats');
        previous = point.beat;
        if (!validControl(point.value, definition)) issue(`${path}.${i}.points.${j}.value`, 'Value is outside the parameter definition');
      }
    }
  };
  const returnIds = ids(project.studio?.returns ?? [], 'studio.returns'), assets = new Set<string>();
  for (const [index, asset] of (project.studio?.assets ?? []).entries()) {
    const path = `studio.assets.${index}`;
    if (!asset || typeof asset !== 'object') { issue(path, 'Expected asset'); continue; }
    if (!/^[a-f0-9]{64}$/.test(asset.hash)) issue(`${path}.hash`, 'Expected SHA-256 content hash');
    if (assets.has(asset.hash)) issue(path, 'Duplicate asset hash');
    assets.add(asset.hash);
    number(asset.sampleRate, 8000, 192000, `${path}.sampleRate`, true);
    if (!Array.isArray(asset.channels) || asset.channels.length < 1 || asset.channels.length > 2
      || !asset.channels.every(c => Array.isArray(c) && c.length > 0 && c.length === asset.channels[0].length && c.every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 32))) issue(path, 'Expected finite equal-length mono or stereo PCM channels');
  }
  for (const [i, aux] of (project.studio?.returns ?? []).entries()) {
    const path = `studio.returns.${i}`;
    if (!aux || !Array.isArray(aux.chain) || !Array.isArray(aux.automation)) { issue(path, 'Return requires chain and automation arrays'); continue; }
    number(aux.level, -96, 12, `${path}.level`);
    ids(aux.chain, `${path}.chain`);
    const definitions: Record<string, ParameterDefinition> = { level: RETURN_PARAMETERS.level };
    for (const [j, processor] of aux.chain.entries()) {
      if (!['delay', 'filter', 'saturation', 'gain'].includes(processor?.type)) { issue(`${path}.chain.${j}`, 'Unsupported processor; returns cannot route to other returns'); continue; }
      const required = processor.type === 'delay' ? ['beats', 'feedback', 'cutoff', 'drive', 'mode']
        : processor.type === 'filter' ? ['frequency', 'mode'] : processor.type === 'gain' ? ['gain'] : ['drive'];
      for (const [key, value] of Object.entries(processor)) {
        if (key === 'id' || key === 'type') continue;
        if (!required.includes(key)) { issue(`${path}.chain.${j}.${key}`, 'Unsupported parameter for this processor'); continue; }
        const definition = RETURN_PARAMETERS[key];
        if (!definition || !validControl(value, definition)) issue(`${path}.chain.${j}.${key}`, 'Invalid processor parameter');
        if (definition) definitions[`${processor.id}.${key}`] = key==='mode'?{...definition,options:processor.type==='delay'?['mono','stereo','ping-pong']:['lowpass','highpass']}:definition;
      }
      for (const key of required) if (!(key in processor)) issue(`${path}.chain.${j}.${key}`, 'Required processor parameter');
      if (processor.type === 'delay' && !['mono', 'stereo', 'ping-pong'].includes(processor.mode)) issue(path, 'Invalid delay mode');
      if (processor.type === 'filter' && !['lowpass', 'highpass'].includes(processor.mode)) issue(path, 'Invalid filter mode');
    }
    automation(aux.automation, definitions, `${path}.automation`);
  }
  if(usesDevelopment(project))ids(project.tracks, 'tracks');
  rawTracks.forEach((t,index)=>{
    const track=t as {id?:unknown;development?:{enabled?:unknown}};
    if(track?.development?.enabled===true&&(typeof track.id!=='string'||!track.id.length))issue(`tracks.${index}.id`,'Developed tracks require a saved stable ID');
  });
  for (const [index, track] of project.tracks.entries()) {
    const d = track.development, path = `tracks.${index}.development`;
    if (!d) continue;
    const definitions = parameterDefinitions(track.drumLanes, [...returnIds],track.trackKind);
    const patternIds = ids(d.patterns, `${path}.patterns`);
    ids(d.sections, `${path}.sections`);
    const steps = (list: StepControl[], prefix: string) => list.forEach((s, i) => {
      if (!s || typeof s !== 'object') { issue(`${prefix}.${i}`, 'Expected step control'); return; }
      number(s.step, 0, 1e7, `${prefix}.${i}.step`, true);
      if (s.lane !== undefined) number(s.lane, 0, track.drumLanes.length - 1, `${prefix}.${i}.lane`, true);
      if(s.lane!==undefined&&track.trackKind!=='rhythmic')issue(`${prefix}.${i}.lane`,'Lane controls require a drum track');
      if (s.note !== undefined) number(s.note, 0, 127, `${prefix}.${i}.note`, true);
      for (const key of ['tie', 'legato'] as const) if (s[key] !== undefined && typeof s[key] !== 'boolean') issue(`${prefix}.${i}.${key}`, 'Expected boolean');
      for (const [key, min, max] of [['velocity', 0, 1], ['gate', 0, 16], ['durationBeats', 0.00001, 1024],
        ['slide', 0, 5], ['offsetBeats', -4, 4], ['timingVariation', 0, 1], ['velocityVariation', 0, 1]] as const)
        if (s[key] !== undefined) number(s[key], min, max, `${prefix}.${i}.${key}`);
      if ((s.slide !== undefined || s.legato !== undefined) && (track.trackKind === 'rhythmic' || track.polyphony !== 1)) issue(`${prefix}.${i}`, 'Slides and legato require a monophonic melodic track');
      if(Object.keys(s.locks ?? {}).some(key=>['glideTime','glideMode','monoLegato'].includes(key))&&(track.trackKind==='rhythmic'||track.polyphony!==1))issue(`${prefix}.${i}.locks`,'Glide and legato locks require a monophonic melodic track');
      if(s.note!==undefined&&track.polyphony===1)issue(`${prefix}.${i}`,'Individual chord-note controls require polyphony greater than one');
      if (s.tie && track.trackKind === 'rhythmic') issue(`${prefix}.${i}`, 'Drum hits cannot tie');
      condition(s.condition, `${prefix}.${i}.condition`); controls(s.locks, definitions, `${prefix}.${i}.locks`, true);
    });
    steps(d.steps, `${path}.steps`);
    for (const [i, p] of d.patterns.entries()) {
      if (!p || typeof p.sequence !== 'string') { issue(`${path}.patterns.${i}`, 'Expected sequence string'); continue; }
      if (track.trackKind === 'rhythmic' && !parseRhythmSequenceInput(p.sequence).valid) issue(`${path}.patterns.${i}.sequence`, 'Invalid rhythm masks');
      if(p.steps!==undefined&&!Array.isArray(p.steps))issue(`${path}.patterns.${i}.steps`,'Expected step controls array');
      steps(Array.isArray(p.steps)?p.steps:[], `${path}.patterns.${i}.steps`); controls(p.overrides, definitions, `${path}.patterns.${i}.overrides`,true);
    }
    for (const [i, s] of d.sections.entries()) {
      if (!s) { issue(`${path}.sections.${i}`, 'Expected section'); continue; }
      number(s.length, 0.0001, 65536, `${path}.sections.${i}.length`);
      if (!['bars', 'beats'].includes(s.unit)) issue(`${path}.sections.${i}.unit`, 'Use bars or beats');
      if (!patternIds.has(s.pattern)) issue(`${path}.sections.${i}.pattern`, 'Missing pattern');
      if (s.boundary && !['cut', 'carry'].includes(s.boundary)) issue(`${path}.sections.${i}.boundary`, 'Use cut or carry');
      for (const choice of s.choices ?? []) { if (!patternIds.has(choice.pattern)) issue(path, 'Choice references missing pattern'); condition(choice.condition, path); }
    }
    automation(d.automation, definitions, `${path}.automation`, track.trackKind === 'rhythmic' ? track.drumLanes.length : 0);
    const snapshotIds = ids(d.snapshots, `${path}.snapshots`);
    d.snapshots.forEach((s, i) => controls(s.values, definitions, `${path}.snapshots.${i}.values`));
    let previousCue = -1;
    d.snapshotCues.forEach((cue, i) => {
      number(cue?.beat, 0, 1e7, `${path}.snapshotCues.${i}.beat`);
      if (cue?.beat < previousCue) issue(path, 'Snapshot cues must be ordered by beat'); previousCue = cue?.beat;
      if (!snapshotIds.has(cue?.snapshot)) issue(path, 'Missing snapshot');
      if (cue?.morphBeats !== undefined) number(cue.morphBeats, 0, 65536, `${path}.snapshotCues.${i}.morphBeats`);
      if (cue?.lane !== undefined) {
        number(cue.lane, 0, track.trackKind === 'rhythmic' ? track.drumLanes.length - 1 : -1, `${path}.snapshotCues.${i}.lane`, true);
        const values = d.snapshots.find(s => s.id === cue.snapshot)?.values ?? {};
        if (Object.keys(values).some(target => definitions[target]?.scope === 'bus')) issue(`${path}.snapshotCues.${i}.lane`, 'A lane snapshot cannot change a shared bus');
      }
    });
    controls(Object.fromEntries(Object.entries(d.sends).map(([id, value]) => [`send.${id}`, value])), definitions, `${path}.sends`);
    const sampleLanes=new Set<number>();
    for (const [i, source] of d.samples.entries()) {
      if (!source || !Array.isArray(source.alternatives) || !source.alternatives.length) { issue(`${path}.samples.${i}`, 'Sample requires alternatives'); continue; }
      if (source.lane !== undefined) number(source.lane, 0, track.drumLanes.length - 1, `${path}.samples.${i}.lane`, true);
      if(source.lane!==undefined&&track.trackKind!=='rhythmic')issue(path,'A melodic sample source must omit lane');
      if(sampleLanes.has(source.lane ?? -1))issue(path,'Use one sample source per lane, with alternatives inside it');sampleLanes.add(source.lane ?? -1);
      if (track.trackKind === 'rhythmic' && source.lane === undefined) issue(path, 'Drum sample must select a lane');
      number(source.start, 0, 1e7, `${path}.samples.${i}.start`);
      if (source.end !== undefined) { number(source.end, source.start + 1e-8, 1e7, `${path}.samples.${i}.end`); }
      for (const [key, min, max] of [['gain', -96, 24], ['rootNote', 0, 127], ['tune', -48, 48], ['attack', 0, 60], ['release', 0, 60]] as const) number(source[key], min, max, `${path}.samples.${i}.${key}`);
      if (!['round-robin', 'random'].includes(source.selection) || !['one-shot', 'loop'].includes(source.mode)) issue(path, 'Invalid sample selection or playback mode');
      for (const alternative of source.alternatives) {
        if (!assets.has(alternative.asset)) issue(path, `Missing sample asset ${alternative.asset}`);
        number(alternative.minVelocity ?? 0, 0, 1, path); number(alternative.maxVelocity ?? 1, alternative.minVelocity ?? 0, 1, path);
        const asset = project.studio?.assets.find(a => a.hash === alternative.asset);
        if (asset && source.start >= asset.channels[0]?.length / asset.sampleRate) issue(path, 'Sample region starts beyond asset');
        if(asset&&source.end!==undefined&&source.end>asset.channels[0]?.length/asset.sampleRate)issue(path,'Sample region ends beyond an alternative asset');
        if(asset&&Math.floor((source.end ?? asset.channels[0].length/asset.sampleRate)*asset.sampleRate)<=Math.floor(source.start*asset.sampleRate))issue(path,'Sample region must contain at least one frame');
      }
      if(source.lane!==undefined){
        const supported=new Set(['decay','brightness','tune','filterFrequency','filterResonance','filterGain','filterType','filterRolloff','echoSend','reverbSend']);
        const prefix=`lane.${source.lane}.`;
        const targets=[...d.automation.map(c=>c.target),...d.snapshots.flatMap(s=>Object.keys(s.values)),
          ...[...d.steps,...d.patterns.flatMap(p=>p.steps ?? [])].flatMap(s=>Object.keys(s.locks ?? {})),
          ...d.patterns.flatMap(p=>Object.keys(p.overrides ?? {}))];
        for(const target of targets)if(target.startsWith(prefix)&&!supported.has(target.slice(prefix.length)))issue(path,`${target} is a synthesized drum control and cannot alter an imported sample`);
      }
    }
    if (!d.enabled) issue(path, 'Development controls are saved but disabled', 'warning');
  }
  return { project, diagnostics, valid: !diagnostics.some(d => d.severity === 'error') };
}
export function validateProject(input:unknown):{project:PresetData;diagnostics:ProjectDiagnostic[];valid:boolean}{
  try{return validateNormalizedProject(input);}catch(error){
    let project:PresetData;try{project=normalizePresetData(input);}catch{project=normalizePresetData({});}
    return {project,valid:false,diagnostics:[{path:'project',severity:'error',message:`Malformed development data: ${error instanceof Error?error.message:String(error)}`}]};
  }
}
export function requireValidProject(input: unknown): PresetData {
  const result = validateProject(input);
  if (!result.valid) throw new Error(result.diagnostics.filter(d => d.severity === 'error').map(d => `${d.path}: ${d.message}`).join('\n'));
  return result.project;
}
