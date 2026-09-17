import * as Tone from 'tone';

interface OfflineClockInternals {
  _duration: number;
  _currentTime: number;
  _renderClock(asynchronous: boolean): Promise<void>;
}

function yieldClock(): Promise<void> {
  // A normal posted task also lets timers/progress run. Prioritized scheduler.yield
  // continuations can otherwise starve those tasks during a long clock pass.
  return new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(undefined);
  });
}

/** Keep Tone's exact 128-frame ticks, but bound work between UI yields. */
export function prepareOfflineClock(context: Tone.OfflineContext): void {
  const clock = context as unknown as OfflineClockInternals;
  // This adapter matches Tone 15's clock fields. Future incompatible versions
  // retain Tone's own scheduler rather than receiving a partially working patch.
  if (typeof clock._renderClock !== 'function' || !Number.isFinite(clock._currentTime)
    || !Number.isFinite(clock._duration)) return;
  clock._renderClock = async function (asynchronous) {
    let deadline = performance.now() + 8;
    while (this._duration - this._currentTime >= 0) {
      const previous = Tone.getContext();
      Tone.setContext(context);
      try {
        context.emit('tick');
      } finally {
        Tone.setContext(previous);
      }
      this._currentTime += 128 / context.sampleRate;
      if (asynchronous && performance.now() >= deadline) {
        await yieldClock();
        deadline = performance.now() + 8;
      }
    }
  };
}
