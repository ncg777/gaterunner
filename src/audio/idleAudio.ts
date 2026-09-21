import * as Tone from 'tone';

/** Silence must be continuous and longer than any silent gap in an effect's tail. */
export class AudioIdleGate {
  private quietSince: number | null = null;

  ready(now: number, peak: number, protectedUntil: number, quietSeconds: number): boolean {
    if (!Number.isFinite(peak) || peak > 1e-6 || now < protectedUntil) {
      this.quietSince = null;
      return false;
    }
    this.quietSince ??= now;
    return now - this.quietSince >= quietSeconds;
  }
}

export interface AudioSleep {
  /** Await an already-issued suspend before resuming, avoiding a rapid Stop/Play race. */
  cancel(): Promise<void>;
}

/** Only the stopped realtime context sleeps; offline rendering is never suspended here. */
export function sleepWhenSilent(
  context: Tone.BaseContext,
  source: Tone.ToneAudioNode,
  protectedUntil: number,
  quietSeconds: number,
): AudioSleep | null {
  if (context.isOffline || context.state !== 'running') return null;
  const raw = context.rawContext as AudioContext;
  if (typeof raw.suspend !== 'function') return null;
  const analyser = new Tone.Analyser({ context, type: 'waveform', size: 16384, channels: 2 });
  source.connect(analyser);
  const gate = new AudioIdleGate();
  let pending = Promise.resolve();
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(timer);
    source.disconnect(analyser);
    analyser.dispose();
  };
  const timer = setInterval(() => {
    if (context.state !== 'running') { cleanup(); return; }
    const channels = analyser.getValue() as Float32Array[];
    let peak = 0;
    for (const channel of channels) for (const value of channel) peak = Math.max(peak, Math.abs(value));
    if (!gate.ready(context.currentTime, peak, protectedUntil, quietSeconds)) return;
    cleanup();
    pending = raw.suspend().catch(error => {
      // Sleeping is optional; leave playback recoverable if a browser rejects it.
      console.warn('Unable to suspend idle audio:', error);
    });
  }, Math.min(50, 8192 / context.sampleRate * 1000));
  return { cancel() { cleanup(); return pending; } };
}
