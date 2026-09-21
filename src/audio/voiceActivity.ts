export type VoiceEvent =
  | { type: 'attack'; time: number; mono: boolean; stopTime?: number }
  | { type: 'release'; time: number; ampRelease?: number };

/** Raw audio time, not lookahead time: release tails and future notes remain active. */
export function hasVoiceActivity(
  events: readonly VoiceEvent[], now: number, release: number, tail = 0,
): boolean {
  for (let i = 0; i < events.length; i++) {
    const attack = events[i];
    if (attack.type !== 'attack') continue;
    let end = attack.stopTime ?? Infinity;
    for (let j = i + 1; j < events.length; j++) {
      const event = events[j];
      if (event.type === 'attack') {
        end = Math.min(end, event.time);
        break;
      }
      end = Math.min(end, event.time + (event.ampRelease ?? release));
      break;
    }
    if (end + tail > now) return true;
  }
  return false;
}
