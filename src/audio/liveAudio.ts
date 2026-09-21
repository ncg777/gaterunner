import * as Tone from 'tone';
import { configureRealtimeScheduling } from './realtimeScheduling';

export type LiveBuffering = 'interactive' | 'playback';
const storageKey = 'gaterunner.liveBuffering';
export function readLiveBuffering(): LiveBuffering {
  try { return localStorage.getItem(storageKey) === 'playback' ? 'playback' : 'interactive'; }
  catch { return 'interactive'; }
}
export function saveLiveBuffering(mode: LiveBuffering): boolean {
  try { localStorage.setItem(storageKey, mode); return true; } catch { return false; }
}
export function createLiveContext(mode: LiveBuffering): Tone.Context {
  const context = new Tone.Context({ latencyHint: mode });
  configureRealtimeScheduling(context);
  return context;
}

type Clock = { isOffline: boolean; currentTime: number };
const scheduling = new WeakMap<Clock, { callbacks: number; late: number; worstLateMs: number }>();
export function resetLiveScheduling(context: Clock): void {
  scheduling.delete(context);
}
export function recordLiveScheduling(context: Clock, when: number): void {
  if (context.isOffline) return;
  const stats = scheduling.get(context) ?? { callbacks: 0, late: 0, worstLateMs: 0 };
  stats.callbacks++;
  const lateMs = (context.currentTime - when) * 1000;
  if (lateMs > 0) { stats.late++; stats.worstLateMs = Math.max(stats.worstLateMs, lateMs); }
  scheduling.set(context, stats);
}
export function readLiveScheduling(context: Clock) {
  return { ...(scheduling.get(context) ?? { callbacks: 0, late: 0, worstLateMs: 0 }) };
}
