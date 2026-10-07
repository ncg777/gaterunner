import type { PresetTrackData } from '../presets.js';
import type { DrumVoiceId } from './rhythmTrack.js';
import { getStepDurations } from '../audio/stepDurations.js';
import { applyTrackPhase } from '../audio/trackPhase.js';
import { quantizeNormalizedTime, resolveTimeWarpFunction, warpNormalizedTime } from '../audio/timeWarp.js';
import { gateEventByActivation } from '../trackActivation.js';
export type TimingTrack = Pick<PresetTrackData, 'numerator' | 'denominator' | 'phase' | 'delay' | 'paddingBefore' | 'paddingAfter' | 'repeats' | 'timeWarpEnabled' | 'timeWarpAmount' | 'timeWarpCurve' | 'timeWarpExpression' | 'timeWarpRepeats' | 'timeWarpQuantize' | 'timeWarpNoteLengths' | 'lengthFactor' | 'lengthOffset' | 'velocityMultiplier'>;
export interface ScheduleEntry { track: TimingTrack; quant: number; actualNotes: number[][]; noteVelocities?: number[][]; drumVoiceIds?: DrumVoiceId[][] }
export interface ScheduledEvent { time: number; duration: number; velocity: number; notes: number[]; noteVelocities?: number[]; drumVoiceIds?: DrumVoiceId[]; order: number; step?: number }
function getTrackDelaySeconds(bpm: number, track: TimingTrack) { return track.delay * track.numerator * (60 / bpm); }
function getTrackRepeatDurationSeconds(bpm: number, entry: ScheduleEntry) { return (entry.track.paddingBefore + entry.track.paddingAfter) * entry.track.numerator * (60 / bpm) + entry.actualNotes.length * entry.quant; }
export function buildLegacyTrackEvents(
  entry: ScheduleEntry,
  bpm: number,
  totalLoopDuration: number,
  trackIndex: number,
  activationMasks: readonly bigint[],
): ScheduledEvent[] {
  if (entry.actualNotes.length === 0 || !Number.isFinite(totalLoopDuration) || !(totalLoopDuration > 0)) {
    return [];
  }

  const trackPeriod = entry.actualNotes.length * entry.quant;
  if (trackPeriod <= 0) {
    return [];
  }

  const delaySeconds = getTrackDelaySeconds(bpm, entry.track);
  const barSeconds = entry.track.numerator * (60 / bpm);
  const paddingBeforeSeconds = entry.track.paddingBefore * barSeconds;
  const repeatPeriod = getTrackRepeatDurationSeconds(bpm, entry);
  const warpAmount = entry.track.timeWarpEnabled ? entry.track.timeWarpAmount / 100 : 0;
  const warpEnabled = entry.track.timeWarpEnabled && warpAmount > 0;
  const warpResolution = resolveTimeWarpFunction(entry.track.timeWarpCurve, entry.track.timeWarpExpression);
  const warpChunks = entry.track.timeWarpEnabled ? Math.max(1, Math.floor(entry.track.timeWarpRepeats)) : 1;
  const chunkPeriod = trackPeriod / warpChunks;
  const quantizeDivisions = entry.track.timeWarpQuantize > 0
    ? Math.max(1, Math.round((entry.actualNotes.length / warpChunks) * entry.track.timeWarpQuantize))
    : 0;
  if (![entry.quant, trackPeriod, delaySeconds, paddingBeforeSeconds, repeatPeriod, chunkPeriod].every(Number.isFinite)
    || !(chunkPeriod > 0)) {
    return [];
  }
  const events: ScheduledEvent[] = [];
  const stepDurations = getStepDurations(entry.actualNotes);
  let order = 0;

  for (let repeat = 0; repeat < entry.track.repeats; repeat += 1) {
    const loopStart = delaySeconds + repeat * repeatPeriod + paddingBeforeSeconds;
    if (!Number.isFinite(loopStart)) {
      continue;
    }
    for (let i = 0; i < entry.actualNotes.length; i += 1) {
      const notes = entry.actualNotes[i];
      if (notes.length === 0) {
        continue;
      }

      const durSteps = stepDurations[i];
      const baseDuration = ((durSteps * entry.track.lengthFactor) / 100.0 + entry.track.lengthOffset) * entry.quant;
      if (!Number.isFinite(baseDuration)) {
        continue;
      }
      const localTime = i * entry.quant;
      const chunkIndex = Math.min(warpChunks - 1, Math.floor(localTime / chunkPeriod));
      const chunkStart = chunkIndex * chunkPeriod;
      let eventLocalTime = localTime;
      let duration = baseDuration;

      if (warpEnabled) {
        const startNormalized = (localTime - chunkIndex * chunkPeriod) / chunkPeriod;
        const endNormalized = Math.min(1, startNormalized + (baseDuration / chunkPeriod));
        let warpedStart = warpNormalizedTime(startNormalized, warpResolution.fn, warpAmount);
        let warpedEnd = warpNormalizedTime(endNormalized, warpResolution.fn, warpAmount);

        if (quantizeDivisions > 0) {
          warpedStart = quantizeNormalizedTime(warpedStart, quantizeDivisions);
          warpedEnd = quantizeNormalizedTime(warpedEnd, quantizeDivisions);
        }

        eventLocalTime = chunkStart + warpedStart * chunkPeriod;
        if (entry.track.timeWarpNoteLengths) {
          duration = Math.max(0.0005, Math.abs(warpedEnd - warpedStart) * chunkPeriod);
        }
      }

      const eventTime = loopStart + applyTrackPhase(eventLocalTime, entry.track.phase, entry.quant, trackPeriod);
      if (!Number.isFinite(eventTime) || !Number.isFinite(duration)
        || eventTime < 0 || eventTime >= totalLoopDuration || duration <= 0) {
        continue;
      }

      const gated = gateEventByActivation({
        time: eventTime,
        duration,
        trackIndex,
        loopDuration: totalLoopDuration,
        masks: activationMasks,
      });
      if (!gated || !Number.isFinite(gated.time) || !Number.isFinite(gated.duration)
        || gated.time < 0 || gated.duration <= 0) {
        continue;
      }

      events.push({
        step: i,
        time: gated.time,
        duration: gated.duration,
        velocity: Math.min(1, 0.5 * Math.sqrt(1.0 / notes.length) * entry.track.velocityMultiplier),
        notes,
        noteVelocities: entry.noteVelocities?.[i]?.map((velocity) => Math.min(1, velocity * entry.track.velocityMultiplier)),
        drumVoiceIds: entry.drumVoiceIds?.[i],
        order,
      });
      order += 1;
    }
  }

  if (warpEnabled || entry.track.phase > 0) {
    events.sort((left, right) => (left.time === right.time ? left.order - right.order : left.time - right.time));
  }

  return events;
}
