import { isMonophonic, limitPolyphony } from '../src/audio/glide.js';
import { claimVoices, type SoundingNote } from '../src/audio/voicePool.js';

interface NoteEvent { time: number; duration: number; velocity: number; notes: number[]; order: number }

export interface NativeVoiceEvent extends NoteEvent {
  noteDurations: number[];
  envelopeStart: number;
  envelopeVelocity: number;
  /** A mono oscillator continues at the next note; it must not render a second release tail. */
  stopTime: number;
  legato: boolean;
}

/** Share the browser's oldest-note stealing policy and mono high-note priority. */
export function planNativeVoices(events: readonly NoteEvent[], polyphony: number, monoLegato: boolean): NativeVoiceEvent[] {
  const sounding: SoundingNote[] = [];
  const active: Array<{ event: NativeVoiceEvent; noteIndex: number }> = [];
  const planned: NativeVoiceEvent[] = [];
  const mono = isMonophonic(polyphony);
  for (const event of events) {
    const notes = limitPolyphony(event.notes, polyphony);
    const previous = planned.at(-1);
    const legato = mono && !!previous && event.time < previous.time + previous.duration - 1e-4;
    const keepEnvelope = legato && monoLegato;
    const voice: NativeVoiceEvent = { ...event, notes, noteDurations: notes.map(() => event.duration),
      envelopeStart: keepEnvelope ? previous!.envelopeStart : event.time,
      envelopeVelocity: keepEnvelope ? previous!.envelopeVelocity : event.velocity,
      stopTime: Number.POSITIVE_INFINITY, legato };
    if (mono && previous) previous.stopTime = event.time;
    const stolen = claimVoices(sounding, notes, event.time, event.time + event.duration, polyphony);
    for (const pitch of stolen) {
      for (const entry of active) {
        if (entry.event.notes[entry.noteIndex] === pitch && entry.event.time + entry.event.noteDurations[entry.noteIndex] > event.time) {
          entry.event.noteDurations[entry.noteIndex] = Math.max(0, event.time - entry.event.time);
        }
      }
    }
    for (let index = active.length - 1; index >= 0; index--) {
      const entry = active[index];
      if (entry.event.time + entry.event.noteDurations[entry.noteIndex] <= event.time) active.splice(index, 1);
    }
    notes.forEach((_, noteIndex) => active.push({ event: voice, noteIndex }));
    planned.push(voice);
  }
  return planned;
}
