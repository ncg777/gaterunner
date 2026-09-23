import * as Tone from 'tone';
import { prepareOfflineClock } from './offlineClock';

export async function renderOfflineAudio(
  schedule: (context: Tone.OfflineContext) => void | Promise<void>,
  duration: number,
  channels: number,
  sampleRate: number,
  signal?: AbortSignal,
): Promise<Tone.ToneAudioBuffer> {
  signal?.throwIfAborted();
  const originalContext = Tone.getContext();
  // The compatibility context retains/replays every AudioParam event and scans
  // its full history on each ramp. Long, densely warped/filter-modulated tracks
  // make that bookkeeping quadratic. Tone accepts a native context directly;
  // keep its scheduler and graph, without the duplicate automation history.
  // Older browsers still need the compatibility implementation of cancel/hold.
  const nativeSupported = typeof globalThis.OfflineAudioContext === 'function'
    && typeof globalThis.AudioParam?.prototype.cancelAndHoldAtTime === 'function';
  const context = nativeSupported
    ? new Tone.OfflineContext(new globalThis.OfflineAudioContext(channels, duration * sampleRate, sampleRate))
    : new Tone.OfflineContext(channels, duration, sampleRate);
  prepareOfflineClock(context, duration);
  const proxy = context.rawContext as unknown as OfflineAudioContext & {
    _nativeOfflineAudioContext?: OfflineAudioContext;
  };
  let nativeStarted = false;
  const startRendering = proxy.startRendering;
  // Check again at the clock/native boundary, including cancellation during
  // Tone's final clock yield, when there may be no further tick to stop it.
  if (signal) {
    proxy.startRendering = () => {
      signal.throwIfAborted();
      nativeStarted = true;
      return startRendering.call(proxy);
    };
  }
  const checkCancellation = () => {
    if (signal?.aborted) {
      // Tone's clock does not restore the global context when a tick throws.
      Tone.setContext(originalContext);
      signal.throwIfAborted();
    }
  };
  if (signal) context.on('tick', checkCancellation);
  let onAbort: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      // During the clock pass, the next tick stops rendering before the native
      // render starts. Wait for that rejection before disposing its listeners.
      if (!nativeStarted) return;
      const native = proxy._nativeOfflineAudioContext ?? proxy;
      if (typeof native.suspend === 'function') {
        const quantum = 128 / sampleRate;
        const when = (Math.floor(native.currentTime / quantum) + 1) * quantum;
        if (when < duration) void native.suspend(when).catch(() => {});
      }
      reject(signal!.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    let rendering: Promise<Tone.ToneAudioBuffer>;
    Tone.setContext(context);
    try {
      await schedule(context);
      signal?.throwIfAborted();
      // Preserve Tone's clock ticks, yielding by elapsed work time so dense
      // projects do not monopolize the UI for a whole second of audio events.
      rendering = context.render(true);
    } finally {
      Tone.setContext(originalContext);
    }
    const buffer = await Promise.race([rendering, cancelled]);
    signal?.throwIfAborted();
    return buffer;
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    if (signal) proxy.startRendering = startRendering;
    context.dispose();
  }
}
