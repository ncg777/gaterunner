import { hasVoiceActivity, type VoiceEvent } from './voiceActivity';

interface Clock { readonly currentTime: number; readonly isOffline: boolean;
  setTimeout(callback: () => void, delay: number): number; clearTimeout(id: number): void }

/** An always-live worklet can keep its upstream signal graph rendering through silence. */
export class GeneratorInputGate {
  private events: VoiceEvent[] = [];
  private continuous = false;
  private timer: number | null = null;
  private protectedUntil = 0;
  private connected = false;
  constructor(private context: Clock, private connect: () => void, private disconnect: () => void) {}
  get awake() { return this.context.isOffline || this.connected; }
  private wake() { if (!this.connected) { this.connected = true; this.connect(); } }
  private remember(event: VoiceEvent) {
    this.events.push(event); this.events.sort((a, b) => a.time - b.time);
    let last = -1;
    this.events.forEach((event, index) => { if (event.type === 'attack' && event.time <= this.context.currentTime) last = index; });
    if (last > 0) this.events.splice(0, last);
  }
  attack(time: number, mono: boolean, stopTime?: number) {
    this.continuous = mono;
    this.remember({ type: 'attack', time, mono, stopTime }); this.wake();
    if (stopTime !== undefined) this.sleepLater();
  }
  release(time: number, ampRelease?: number) { this.remember({ type: 'release', time, ampRelease }); this.sleepLater(); }
  cancel(time: number) { this.events = this.events.filter(event => event.time < time); this.wake(); }
  reset(time: number) {
    this.events = this.events.filter(event => event.time > time); this.continuous = false;
    this.protectedUntil = Math.max(this.protectedUntil, time); this.sleepLater();
  }
  private sleepLater() {
    if (this.context.isOffline || this.timer !== null || this.continuous) return;
    this.timer = this.context.setTimeout(() => {
      this.timer = null;
      if (this.continuous) return;
      if (this.context.currentTime < this.protectedUntil || hasVoiceActivity(this.events, this.context.currentTime, Infinity)) {
        this.sleepLater();
      } else if (this.connected) { this.connected = false; this.disconnect(); }
    }, 0.1);
  }
  dispose() {
    if (this.timer !== null) this.context.clearTimeout(this.timer);
    this.timer = null;
    if (this.connected) this.disconnect();
    this.connected = false; this.events = [];
  }
}