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

type Clock = { isOffline: boolean; currentTime: number; sampleRate?: number; lookAhead?: number; rawContext?: unknown };
interface CallbackEvent { kind: 'callback'; atMs: number; lateMs: number; durationMs: number; trackId?: string; notes?: number }
interface GapEvent { kind: 'scheduler-gap'; atMs: number; durationMs: number }
interface LongTaskEvent { kind: 'long-task'; atMs: number; durationMs: number }
interface BuildEvent { kind: 'graph-build'; atMs: number; durationMs: number; trackId: string }
type DiagnosticEvent = CallbackEvent | GapEvent | LongTaskEvent | BuildEvent;
interface DiagnosticSession {
  startedAt: string; startPerformance: number; buffering: LiveBuffering;
  events: DiagnosticEvent[]; callbacks: number; late: number; worstLateMs: number;
  observer?: PerformanceObserver; timer?: ReturnType<typeof setInterval>; lastPoll?: number;
  context: Clock;
}
const sessions = new WeakMap<Clock, DiagnosticSession>();
let latest: DiagnosticSession | null = null;
const MAX_EVENTS = 4000;
const add = (session: DiagnosticSession, event: DiagnosticEvent) => {
  if (session.events.length < MAX_EVENTS) session.events.push(event);
};

export function startLiveDiagnostics(context: Clock, buffering: LiveBuffering): void {
  stopLiveDiagnostics(context);
  const now = performance.now();
  const session: DiagnosticSession = { startedAt: new Date().toISOString(), startPerformance: now,
    buffering, events: [], callbacks: 0, late: 0, worstLateMs: 0, context, lastPoll: now };
  sessions.set(context, session); latest = session;
  session.timer = setInterval(() => {
    const current = performance.now(), gap = current - (session.lastPoll ?? current);
    session.lastPoll = current;
    if (gap > 100) add(session, { kind: 'scheduler-gap', atMs: current - now, durationMs: gap });
  }, 50);
  if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    session.observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) add(session, { kind: 'long-task',
        atMs: entry.startTime - now, durationMs: entry.duration });
    });
    session.observer.observe({ entryTypes: ['longtask'] });
  }
}
export function stopLiveDiagnostics(context: Clock): void {
  const session = sessions.get(context);
  if (!session) return;
  if (session.timer) clearInterval(session.timer);
  session.observer?.disconnect();
  session.timer = undefined; session.observer = undefined;
}
export function beginLiveScheduling(context: Clock, when: number, trackId?: string, notes?: number): () => void {
  if (context.isOffline) return () => {};
  const started = performance.now();
  let session = sessions.get(context);
  if (!session) { startLiveDiagnostics(context, readLiveBuffering()); session = sessions.get(context)!; }
  const lateMs = Math.max(0, (context.currentTime - when) * 1000);
  return () => {
    const durationMs = performance.now() - started;
    session!.callbacks++;
    if (lateMs > 0) { session!.late++; session!.worstLateMs = Math.max(session!.worstLateMs, lateMs); }
    add(session!, { kind: 'callback', atMs: started - session!.startPerformance, lateMs, durationMs, trackId, notes });
  };
}
export function recordLiveGraphBuild(context: Clock, trackId: string, started: number): void {
  const session = sessions.get(context); if (!session) return;
  add(session, { kind: 'graph-build', atMs: started - session.startPerformance,
    durationMs: performance.now() - started, trackId });
}
export function resetLiveScheduling(context: Clock): void { startLiveDiagnostics(context, readLiveBuffering()); }
export function readLiveScheduling(context: Clock) {
  const s = sessions.get(context);
  return { callbacks: s?.callbacks ?? 0, late: s?.late ?? 0, worstLateMs: s?.worstLateMs ?? 0 };
}
export function exportLiveDiagnostics(extra: Record<string, unknown> = {}) {
  const s = latest;
  const raw = s?.context.rawContext as { baseLatency?: number; outputLatency?: number } | undefined;
  return {
    schema: 1, generatedAt: new Date().toISOString(), userAgent: navigator.userAgent,
    session: s ? { startedAt: s.startedAt, elapsedMs: performance.now() - s.startPerformance,
      buffering: s.buffering, sampleRate: s.context.sampleRate, lookAheadMs: (s.context.lookAhead ?? 0) * 1000,
      baseLatencyMs: typeof raw?.baseLatency === 'number' ? raw.baseLatency * 1000 : null,
      outputLatencyMs: typeof raw?.outputLatency === 'number' ? raw.outputLatency * 1000 : null,
      callbacks: s.callbacks, lateCallbacks: s.late, worstLateMs: s.worstLateMs,
      eventsTruncated: s.events.length >= MAX_EVENTS, events: s.events } : null,
    ...extra,
  };
}
