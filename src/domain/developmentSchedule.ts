import { PCS12 } from 'ultra-mega-enumerator';
import type { PresetData, PresetTrackData } from '../presets.js';
import { decodeRhythmSequence } from './rhythmTrack.js';
import { buildLegacyTrackEvents, type ScheduleEntry, type ScheduledEvent } from './scheduling.js';
import { parseBitmaskSequenceInput, gateEventByActivation } from '../trackActivation.js';
import { conditionMatches, evaluateControl, seededChoice, type ControlValue, type StepControl, type Pattern } from './development.js';
import {limitPolyphony} from '../audio/glide.js';

export interface DevelopedEvent extends ScheduledEvent {
  boundaryEnd?: number;
  id: string; trackId: string; sectionId?: string; patternId?: string; repetition: number;
  locks?: Record<string, ControlValue>; laneIndices?: number[]; settings?: Record<string, ControlValue>;
  tie?: boolean; sampleOrdinal?: number;
}
export interface ResolvedProject { duration: number; beats: number; tracks: { track: PresetTrackData; events: DevelopedEvent[] }[] }
let initialized: Promise<void> | undefined;
export async function pitchScale(forte: string) {
  await (initialized ??= PCS12.init());
  const pcs = PCS12.parseForte(forte);
  if (!pcs) throw new Error(`Invalid Forte number: ${forte}`);
  return { scale: (pcs.asSequence() ?? []).flatMap(n => Array.from({ length: 11 }, (_, octave) => n + octave * 12))
    .filter(n => n < 128).sort((a, b) => a - b), count: pcs.getK() ?? 0 };
}
export function decodeTrack(track: PresetTrackData, bpm: number, scale: number[], count: number): ScheduleEntry {
  const quant = 60 / (bpm * track.denominator);
  if (track.trackKind === 'rhythmic') {
    const hits = decodeRhythmSequence(track.sequenceInput, track.drumLanes, track.drumVelocityBits);
    return { track, quant, actualNotes: hits.map(s => s.map(h => h.midi)),
      noteVelocities: hits.map(s => s.map(h => h.velocity)), drumVoiceIds: hits.map(s => s.map(h => h.voiceId)) };
  }
  const sequence = track.sequenceInput.trim().split(/\s+/).map(s => Number.parseInt(s.trim(), 10)).filter(n => !Number.isNaN(n));
  return { track, quant, actualNotes: sequence.map(n => {
    const bits = Math.abs(n).toString(2).split('').reverse(), sign = Math.sign(n) || 1;
    return scale.filter((_, index) => { const bit = sign * (index - track.octave * count); return bit >= 0 && bit < bits.length && bits[bit] === '1'; });
  }) };
}
export function trackDurationBeats(track: PresetTrackData) {
  const d = track.development;
  return track.delay * track.numerator + (d?.enabled && d.sections.length
    ? d.sections.reduce((sum, s) => sum + s.length * (s.unit === 'bars' ? track.numerator : 1), 0)
    : track.repeats * ((track.paddingBefore + track.paddingAfter) * track.numerator
      + track.sequenceInput.trim().split(/\s+/).filter(Boolean).length / track.denominator));
}
function applyStep(event: DevelopedEvent, control: StepControl, bpm: number, seed: number): boolean {
  if (!conditionMatches(control.condition, event.repetition, event.sectionId?.endsWith(':fill') ?? false,
    seededChoice(seed, event.id, control.lane ?? '', control.note ?? '', 'condition'))) return false;
  event.time += ((control.offsetBeats ?? 0) + (seededChoice(seed, event.id, 'timing') * 2 - 1) * (control.timingVariation ?? 0)) * 60 / bpm;
  event.duration = control.durationBeats !== undefined ? control.durationBeats * 60 / bpm : event.duration * (control.gate ?? 1);
  const varied = (seededChoice(seed, event.id, 'velocity') * 2 - 1) * (control.velocityVariation ?? 0);
  if (control.velocity !== undefined || varied !== 0) {
    event.velocity = Math.max(0, Math.min(1, (control.velocity ?? event.velocity) + varied));
    event.noteVelocities = event.notes.map(() => event.velocity);
  }
  event.locks = { ...event.locks, ...control.locks };
  if (control.slide !== undefined) { event.locks.glideTime = control.slide; event.locks.glideMode='always'; }
  if (control.legato !== undefined) event.locks.monoLegato = control.legato;
  event.tie = control.tie;
  return true;
}
/** Arrangement and random choices are resolved in full song coordinates, before slicing. */
export async function resolveProjectEvents(project: PresetData): Promise<ResolvedProject> {
  const { scale, count } = await pitchScale(project.forte), bpm = project.bpm;
  const beats = Math.max(1e-9, ...project.tracks.map(trackDurationBeats)), duration = beats * 60 / bpm;
  const masks = parseBitmaskSequenceInput(project.bitmaskSequenceInput).masks;
  const tracks = project.tracks.map((track, trackIndex) => {
    const d = track.development, enabled = d?.enabled, seed = (d?.seed ?? 0) ^ (project.studio?.seed ?? 0);
    const events: DevelopedEvent[] = [];
    const splitMelodicNotes = enabled && [...d.steps,...d.patterns.flatMap(p=>p.steps ?? [])].some(s=>s.note!==undefined);
    const append = (patternTrack: PresetTrackData, pattern: Pattern | undefined, start: number, length: number,
      sectionId: string | undefined, fill: boolean, boundary: 'cut' | 'carry', choices: { pattern: string; condition: import('./development.js').Condition }[] = []) => {
      const entry = decodeTrack(patternTrack, bpm, scale, count);
      const period = ((patternTrack.paddingBefore + patternTrack.paddingAfter) * patternTrack.numerator
        + entry.actualNotes.length / patternTrack.denominator) * 60 / bpm;
      if (!(period > 0)) return;
      const repetitions = Math.ceil(length / period);
      for (let repetition = 0; repetition < repetitions; repetition++) {
        let selected = pattern;
        for (const [choiceIndex, choice] of choices.entries()) if (conditionMatches(choice.condition, repetition, fill,
          seededChoice(seed, track.id, sectionId ?? '', repetition, choiceIndex, 'pattern'))) selected = d?.patterns.find(p => p.id === choice.pattern) ?? selected;
        const localTrack = { ...patternTrack, ...selected?.overrides, sequenceInput: selected?.sequence ?? patternTrack.sequenceInput, delay: 0, repeats: 1 } as PresetTrackData;
        const selectedEntry = selected === pattern ? entry : decodeTrack(localTrack, bpm, scale, count);
        const local = buildLegacyTrackEvents({ ...selectedEntry, track: localTrack }, bpm, Math.max(period, length), trackIndex, []);
        for (const raw of local) {
          if(raw.time>=period)continue;
          const id = `${track.id}/${sectionId ?? 'sequence'}/${repetition}/${raw.step}`;
          let event: DevelopedEvent = { ...raw, time: start + repetition * period + raw.time, id, trackId: track.id,
            sectionId, patternId: selected?.id, repetition, locks: {}, settings: selected?.overrides,
            boundaryEnd: boundary === 'cut' ? start + length : undefined };
          if (event.time >= start + length) continue;
          const controls = [...(d?.steps ?? []), ...(selected?.steps ?? [])].filter(s => s.step === raw.step);
          const whole = controls.filter(s => s.lane === undefined && s.note === undefined);
          const matchWhole = whole.every(s => conditionMatches(s.condition, repetition, fill, seededChoice(seed, id, 'condition')));
          if (!matchWhole || !whole.every(s => applyStep(event, { ...s, condition: undefined }, bpm, seed))) continue;
          const individual = controls.filter(s => s.lane !== undefined || s.note !== undefined);
          const split = individual.length > 0 || splitMelodicNotes || track.trackKind === 'rhythmic';
          if(split&&track.trackKind!=='rhythmic'){
            const originalNotes=event.notes,velocities=event.noteVelocities;
            event.notes=limitPolyphony(originalNotes,track.polyphony);
            event.noteVelocities=velocities?event.notes.map(note=>velocities[originalNotes.indexOf(note)]):undefined;
          }
          const parts = split ? event.notes.map((note, noteIndex) => {
            const lane = track.trackKind === 'rhythmic' ? track.drumLanes.findIndex(l => l.voiceId === event.drumVoiceIds?.[noteIndex]) : undefined;
            const part: DevelopedEvent = { ...event, id: `${id}/${lane ?? note}`, notes: [note],
              drumVoiceIds: event.drumVoiceIds ? [event.drumVoiceIds[noteIndex]] : undefined,
              noteVelocities: event.noteVelocities ? [event.noteVelocities[noteIndex]] : undefined,
              locks: { ...event.locks }, laneIndices: lane === undefined ? undefined : [lane] };
            if (!individual.filter(s => (s.lane !== undefined && s.lane === lane) || (s.note !== undefined && s.note === note)).every(s =>
              conditionMatches(s.condition, repetition, fill, seededChoice(seed, part.id, 'condition'))
              && applyStep(part, { ...s, condition: undefined }, bpm, seed))) return null;
            return part;
          }).filter((e): e is DevelopedEvent => !!e) : [event];
          for (event of parts) {
            if (boundary === 'cut') event.duration = Math.min(event.duration, start + length - event.time);
            if (event.time < start || event.time >= start + length || event.duration <= 0) continue;
            events.push(event);
          }
        }
      }
    };
    if (enabled && d.sections.length) {
      let position = track.delay * track.numerator * 60 / bpm;
      for (const section of d.sections) {
        const length = section.length * (section.unit === 'bars' ? track.numerator : 1) * 60 / bpm;
        const pattern = d.patterns.find(p => p.id === section.pattern);
        if (pattern) append({ ...track, ...pattern.overrides, sequenceInput: pattern.sequence } as PresetTrackData,
          pattern, position, length, section.id, !!section.fill, section.boundary ?? 'cut', section.choices);
        position += length;
      }
    } else if (enabled) {
      append(track, undefined, track.delay * track.numerator * 60 / bpm,
        (trackDurationBeats(track) - track.delay * track.numerator) * 60 / bpm, undefined, false, 'carry');
    } else {
      events.push(...buildLegacyTrackEvents(decodeTrack(track, bpm, scale, count), bpm, duration, trackIndex, masks)
        .map((e, i) => ({ ...e, id: `${track.id}/legacy/${i}`, trackId: track.id, repetition: 0 })));
    }
    if (enabled) for (let index = events.length - 1; index >= 0; index--) {
      const e = events[index], gate = gateEventByActivation({time:e.time,duration:e.duration,trackIndex,loopDuration:duration,masks});
      if (gate) Object.assign(e, gate); else events.splice(index,1);
    }
    events.sort((a, b) => a.time - b.time || a.order - b.order || a.id.localeCompare(b.id));
    // A tie removes the next attack only when pitches and lane agree. Boundaries marked cut stop ties.
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      if (!event.tie) continue;
      const nextIndex = events.findIndex((next, j) => j > i && JSON.stringify(next.notes) === JSON.stringify(event.notes)
        && JSON.stringify(next.laneIndices) === JSON.stringify(event.laneIndices) && next.time < (event.boundaryEnd ?? Infinity)
        && next.time <= event.time + event.duration + 1e-8);
      if (nextIndex >= 0) { const next = events[nextIndex]; event.duration = Math.max(event.duration, next.time + next.duration - event.time);
        event.tie = next.tie; events.splice(nextIndex, 1); i--; }
    }
    const gated = enabled ? events.flatMap(e => {
      const gate = gateEventByActivation({ time: e.time, duration: e.duration, trackIndex, loopDuration: duration, masks });
      return gate ? [{ ...e, ...gate }] : [];
    }) : events;
    const laneOrdinals = new Map<number, number>();
    gated.forEach((event, ordinal) => { event.order = ordinal; const key=event.laneIndices?.[0] ?? -1;
      event.sampleOrdinal=laneOrdinals.get(key) ?? 0; laneOrdinals.set(key,event.sampleOrdinal+1);
      if (enabled) {
        const lane = event.laneIndices?.[0];
        for (const target of ['attack', 'decay', 'sustain', 'release', 'glideTime', 'glideMode', 'monoLegato', 'filterEnabled', 'filterType']) {
          const value = evaluateControl(d, target, (event.settings?.[target] ?? track[target as keyof PresetTrackData]) as ControlValue,
            event.time * bpm / 60, event.time * bpm / 60, event.locks, lane);
          event.settings = { ...event.settings, [target]: value };
        }
      }
    });
    return { track, events: gated };
  });
  return { duration, beats, tracks };
}
