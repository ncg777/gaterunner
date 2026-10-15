import type { PresetTrackData } from '../presets.js';
import type { ScheduledEvent } from './scheduling.js';

/** Draw scheduled note gates in full-loop coordinates, including tails across clips. */
export function trackNotePreview(track: PresetTrackData, events: readonly ScheduledEvent[], duration: number): string {
  if (!(duration > 0) || !Number.isFinite(duration)) return '';
  const rhythmic = track.trackKind === 'rhythmic';
  let low = 127, high = 0;
  for (const event of events) for (const note of event.notes) {
    low = Math.min(low, note);
    high = Math.max(high, note);
  }
  const rows = rhythmic ? Math.max(1, track.drumLanes.length) : Math.max(12, high - low + 1);
  const height = Math.min(2, 30 / rows * 0.8);
  const parts: string[] = [];
  for (const event of events) {
    const start = Math.max(0, event.time), end = Math.min(duration, event.time + event.duration);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const x = start / duration * 100, width = (end - start) / duration * 100;
    event.notes.forEach((note, index) => {
      const row = rhythmic
        ? track.drumLanes.findIndex(lane => lane.voiceId === event.drumVoiceIds?.[index])
        : note - low;
      if (row < 0) return;
      const y = 33 - row * (30 / rows);
      parts.push(`M${x.toFixed(4)},${y.toFixed(4)}h${width.toFixed(4)}v${height.toFixed(4)}h-${width.toFixed(4)}z`);
    });
  }
  return parts.join('');
}
