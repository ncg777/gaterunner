interface SchedulingContext {
  isOffline: boolean;
  lookAhead: number;
  updateInterval?: number;
}

/** Keep the note scheduling cushion without batching 30 Hz modulation into 5 Hz bursts. */
export function configureRealtimeScheduling(context: SchedulingContext): void {
  if (context.isOffline || typeof context.updateInterval !== 'number') return;
  // Tone's lookAhead setter also changes updateInterval to lookAhead / 2.
  if (context.lookAhead !== 0.4) context.lookAhead = 0.4;
  if (context.updateInterval !== 0.01) context.updateInterval = 0.01;
}
