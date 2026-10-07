import { getDrumParameterDefinitions, type DrumLane } from './rhythmTrack.js';
import { MODULATION_TARGETS } from '../audio/modulation.js';

export const DEVELOPMENT_VERSION = 1;
export type ControlValue = number | string | boolean;
export interface Condition { every?: number; first?: boolean; fill?: boolean; probability?: number }
export interface StepControl {
  step: number; lane?: number; note?: number; condition?: Condition;
  velocity?: number; gate?: number; durationBeats?: number; tie?: boolean; legato?: boolean;
  slide?: number; offsetBeats?: number; timingVariation?: number; velocityVariation?: number;
  locks?: Record<string, ControlValue>;
}
export interface Pattern { id: string; name: string; sequence: string; steps?: StepControl[]; overrides?: Record<string, ControlValue> }
export interface Section { id: string; name: string; pattern: string; length: number; unit: 'bars' | 'beats';
  fill?: boolean; boundary?: 'cut' | 'carry'; choices?: { pattern: string; condition: Condition }[] }
export interface ControlPoint { beat: number; value: ControlValue }
export interface Automation { id: string; target: string; lane?: number; interpolation: 'linear' | 'step' | 'smooth';
  clock?: 'song' | 'note'; points: ControlPoint[] }
export interface SoundSnapshot { id: string; name: string; values: Record<string, ControlValue> }
export interface SnapshotCue { beat: number; snapshot: string; morphBeats?: number; lane?: number }
export interface SampleAlternative { asset: string; minVelocity?: number; maxVelocity?: number }
export interface SampleSource { alternatives: SampleAlternative[]; selection: 'round-robin' | 'random';
  start: number; end?: number; gain: number; rootNote: number; tune: number; attack: number; release: number;
  mode: 'one-shot' | 'loop'; lane?: number }
export interface TrackDevelopment { enabled: boolean; seed: number; patterns: Pattern[]; sections: Section[];
  steps: StepControl[]; automation: Automation[]; snapshots: SoundSnapshot[]; snapshotCues: SnapshotCue[];
  sends: Record<string, number>; samples: SampleSource[] }
export interface SampleAsset { hash: string; name: string; sampleRate: number; channels: number[][];
  provenance?: { project: unknown; range: { start: number; end: number }; renderer: string; sampleRate: number; source: string } }
export type ReturnProcessor = { id: string; type: 'delay'; beats: number; feedback: number; cutoff: number; drive: number; mode: 'stereo' | 'mono' | 'ping-pong' }
  | { id: string; type: 'filter'; frequency: number; mode: 'lowpass' | 'highpass' }
  | { id: string; type: 'saturation'; drive: number }
  | { id: string; type: 'gain'; gain: number };
export interface AuxiliaryReturn { id: string; name: string; level: number; chain: ReturnProcessor[]; automation: Automation[] }
export interface ProjectStudio { version: 1; seed: number; returns: AuxiliaryReturn[]; assets: SampleAsset[] }
export interface ParameterDefinition { label: string; min?: number; max?: number; options?: readonly ControlValue[];
  scope: 'voice' | 'bus'; continuous: boolean; unit?: string }
/** Absolute values. Existing modulation routes remain additive, applied last. */
export const TRACK_PARAMETERS: Record<string, ParameterDefinition> = {
  gain: { label: 'Level', min: -96, max: 24, scope: 'bus', continuous: true, unit: 'dB' },
  filterFrequency: { label: 'Cutoff', min: 0, max: 127, scope: 'voice', continuous: true, unit: 'MIDI pitch' },
  filterQ: { label: 'Resonance', min: 0, max: 30, scope: 'voice', continuous: true },
  filterGain: { label: 'Filter gain', min: -48, max: 48, scope: 'voice', continuous: true, unit: 'dB' },
  filterEnabled: { label: 'Filter', options: [false, true], scope: 'voice', continuous: false },
  filterType: { label: 'Filter type', options: ['lowpass', 'highpass', 'bandpass', 'lowshelf', 'highshelf', 'notch', 'allpass', 'peaking'], scope: 'voice', continuous: false },
  attack: { label: 'Attack', min: 0, max: 60, scope: 'voice', continuous: false, unit: 'seconds' },
  decay: { label: 'Decay', min: 0, max: 60, scope: 'voice', continuous: false, unit: 'seconds' },
  sustain: { label: 'Sustain', min: 0, max: 1, scope: 'voice', continuous: false },
  release: { label: 'Release', min: 0, max: 60, scope: 'voice', continuous: false, unit: 'seconds' },
  glideTime: { label: 'Slide', min: 0, max: 5, scope: 'voice', continuous: false, unit: 'seconds' },
  glideMode: { label: 'Slide mode', options: ['legato','always'], scope:'voice', continuous:false },
  monoLegato: { label: 'Legato', options: [false, true], scope: 'voice', continuous: false },
  reverbWet: { label: 'Reverb send', min: -96, max: 0, scope: 'bus', continuous: true, unit: 'dB' },
  echoWet: { label: 'Echo level', min: -96, max: 0, scope: 'bus', continuous: true, unit: 'dB' },
  echoFeedback: { label: 'Echo feedback', min: 0, max: 0.95, scope: 'bus', continuous: true },
};
for (const [target, bounds] of Object.entries(MODULATION_TARGETS)) TRACK_PARAMETERS[`modulation.${target}`] = {
  label: bounds.title, min: bounds.min, max: bounds.max, scope: 'voice', continuous: true, unit: bounds.unit };
export const RETURN_PARAMETERS: Record<string, ParameterDefinition> = {
  level: { label: 'Return level', min: -96, max: 12, scope: 'bus', continuous: true },
  gain: { label: 'Gain', min: -96, max: 12, scope: 'bus', continuous: true },
  beats: { label: 'Delay', min: 0.03125, max: 16, scope: 'bus', continuous: true },
  feedback: { label: 'Feedback', min: 0, max: 0.95, scope: 'bus', continuous: true },
  cutoff: { label: 'Feedback cutoff', min: 20, max: 20000, scope: 'bus', continuous: true },
  frequency: { label: 'Cutoff', min: 20, max: 20000, scope: 'bus', continuous: true },
  drive: { label: 'Saturation', min: 0, max: 24, scope: 'bus', continuous: true },
  mode: { label: 'Mode', options: ['mono', 'stereo', 'ping-pong', 'lowpass', 'highpass'], scope: 'bus', continuous: false },
};
export function parameterDefinitions(lanes: readonly DrumLane[] = [], returnIds: readonly string[] = [], trackKind: 'melodic'|'rhythmic' = 'melodic') {
  const definitions = { ...TRACK_PARAMETERS };
  if(trackKind==='rhythmic'){
    for(const key of ['filterFrequency','filterQ','filterGain'])definitions[key]={...definitions[key],scope:'bus'};
    for(const key of ['filterEnabled','filterType','attack','decay','sustain','release','glideTime','glideMode','monoLegato',...Object.keys(definitions).filter(k=>k.startsWith('modulation.'))])delete definitions[key];
  }
  for (const id of returnIds) definitions[`send.${id}`] = { label: `Send · ${id}`, min: -96, max: 0, scope: 'voice', continuous: true, unit: 'dB' };
  // Lane parameter names stay exactly as defined by the existing drum voices.
  if (trackKind === 'rhythmic') lanes.forEach((lane, index) => getDrumParameterDefinitions(lane.voiceId).forEach(p => {
    definitions[`lane.${index}.${p.name}`] = { label: p.label, min: p.min, max: p.max, options: p.options,
      scope: 'voice', continuous: ['filterFrequency', 'filterResonance', 'filterGain', 'echoSend', 'reverbSend', 'gain'].includes(p.name) };
  }));
  return definitions;
}
export function validControl(value: unknown, definition: ParameterDefinition): value is ControlValue {
  return definition.options ? definition.options.includes(value as ControlValue)
    : typeof value === 'number' && Number.isFinite(value) && value >= (definition.min ?? -Infinity) && value <= (definition.max ?? Infinity);
}
export function seededChoice(seed: number, ...identity: (string | number)[]): number {
  let hash = (seed >>> 0) ^ 2166136261;
  for (const part of identity) for (const c of `${String(part).length}:${part}|`) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x7feb352d); hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b); hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}
export function conditionMatches(condition: Condition | undefined, repetition: number, fill: boolean, random: number) {
  return !condition || ((!condition.first || repetition === 0) && (!condition.every || (repetition + 1) % condition.every === 0)
    && (condition.fill === undefined || condition.fill === fill) && random < (condition.probability ?? 1));
}
export function normalizeDevelopment(value: unknown): TrackDevelopment | undefined {
  if (value === undefined) return undefined;
  const raw = value && typeof value === 'object' ? value as Partial<TrackDevelopment> : {};
  const list = <T>(value: T[] | undefined): T[] => Array.isArray(value) ? JSON.parse(JSON.stringify(value)) : [];
  return { enabled: raw.enabled === true, seed: Number.isInteger(raw.seed) ? raw.seed! >>> 0 : 0,
    patterns: list(raw.patterns), sections: list(raw.sections), steps: list(raw.steps), automation: list(raw.automation),
    snapshots: list(raw.snapshots), snapshotCues: list(raw.snapshotCues), samples: list(raw.samples),
    sends: raw.sends && typeof raw.sends === 'object' ? JSON.parse(JSON.stringify(raw.sends)) : {} };
}
export function normalizeStudio(value: unknown): ProjectStudio | undefined {
  if (value === undefined) return undefined;
  const raw = value && typeof value === 'object' ? value as Partial<ProjectStudio> : {};
  return { version: 1, seed: Number.isInteger(raw.seed) ? raw.seed! >>> 0 : 0,
    returns: Array.isArray(raw.returns) ? JSON.parse(JSON.stringify(raw.returns)) : [],
    assets: Array.isArray(raw.assets) ? JSON.parse(JSON.stringify(raw.assets)) : [] };
}
export function curveValue(curve: Automation, beat: number, fallback: ControlValue): ControlValue {
  const points = curve.points;
  if (!points.length || beat < points[0].beat) return fallback;
  let previous = points[0];
  for (let i = 1; i < points.length; i++) {
    const next = points[i];
    if (beat < next.beat) {
      if (curve.interpolation === 'step' || typeof previous.value !== 'number' || typeof next.value !== 'number') return previous.value;
      let ratio = (beat - previous.beat) / (next.beat - previous.beat);
      if (curve.interpolation === 'smooth') ratio = ratio * ratio * (3 - 2 * ratio);
      return previous.value + (next.value - previous.value) * ratio;
    }
    previous = next;
  }
  return previous.value;
}
export function evaluateControl(development: TrackDevelopment | undefined, target: string, base: ControlValue,
  beat: number, noteBeat = 0, locks?: Record<string, ControlValue>, lane?: number): ControlValue {
  let value = base;
  if (!development?.enabled) return value;
  let segment: { start: number; length: number; from: ControlValue; to: ControlValue } | undefined;
  const snapshotAt = (position: number): ControlValue => {
    if (!segment) return base;
    const ratio = segment.length <= 0 ? 1 : Math.max(0, Math.min(1, (position - segment.start) / segment.length));
    return typeof segment.from === 'number' && typeof segment.to === 'number' ? segment.from + (segment.to - segment.from) * ratio
      : ratio >= 1 ? segment.to : segment.from;
  };
  for (const cue of development.snapshotCues) {
    if (cue.beat > beat || (cue.lane !== undefined && cue.lane !== lane)) continue;
    const snapshot = development.snapshots.find(s => s.id === cue.snapshot), next = snapshot?.values[target];
    if (next === undefined) continue;
    segment = { start: cue.beat, length: cue.morphBeats ?? 0, from: snapshotAt(cue.beat), to: next };
  }
  value = snapshotAt(beat);
  for (const curve of development.automation) if (curve.target === target && (curve.lane === undefined || curve.lane === lane))
    value = curveValue(curve, curve.clock === 'note' ? beat - noteBeat : beat, value);
  return locks?.[target] ?? value;
}
/** Compile only connected controls once per voice/bus, preserving the shared evaluator. */
export function compileControl(development: TrackDevelopment | undefined, target: string, base: ControlValue,
  noteBeat = 0, locks?: Record<string, ControlValue>, lane?: number, slewBeats = 0): (beat: number) => ControlValue {
  if (locks?.[target] !== undefined) return () => locks[target];
  if (!development?.enabled) return () => base;
  const automation=development.automation.filter(c=>c.target===target&&(c.lane===undefined||c.lane===lane));
  const snapshots=development.snapshots.filter(s=>s.values[target]!==undefined), ids=new Set(snapshots.map(s=>s.id));
  const snapshotCues=development.snapshotCues.filter(c=>ids.has(c.snapshot)&&(c.lane===undefined||c.lane===lane));
  if(!automation.length&&!snapshotCues.length)return ()=>base;
  const connected={...development,automation,snapshots,snapshotCues};
  let previousBeat=NaN,previous:ControlValue=base;
  return beat=>{
    const value=evaluateControl(connected,target,base,beat,noteBeat,undefined,lane);
    if(slewBeats>0&&Number.isFinite(previousBeat)&&typeof previous==='number'&&typeof value==='number')
      previous=previous+(value-previous)*(1-Math.exp(-Math.max(0,beat-previousBeat)/slewBeats));
    else previous=value;
    previousBeat=beat;return previous;
  };
}
export function usesDevelopment(project: { tracks?: { development?: TrackDevelopment }[]; studio?: ProjectStudio }): boolean {
  return !!project.studio?.returns.length || !!project.tracks?.some(t => t.development?.enabled);
}
