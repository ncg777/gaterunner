import { DEFAULT_MASTER_PULSE, MasterPulseDSP, type MasterPulseSettings } from './masterPulse.js';

declare const sampleRate: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

type PulseEvent = { type: 'settings'; frame: number; settings: MasterPulseSettings; bpm: number }
  | { type: 'reset'; frame: number };

class MasterPulseProcessor extends AudioWorkletProcessor {
  private dsp = new MasterPulseDSP(sampleRate, { ...DEFAULT_MASTER_PULSE }, 90);
  private events: PulseEvent[] = [];
  private disposed = false;

  constructor() {
    super();
    this.port.onmessage = ({ data }) => {
      if (data.type === 'dispose') { this.disposed = true; return; }
      this.events.push(data as PulseEvent);
      this.events.sort((a, b) => a.frame - b.frame);
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (this.disposed) return false;
    const output = outputs[0]![0]!;
    for (let i = 0; i < output.length; i++) {
      while (this.events.length && this.events[0]!.frame <= currentFrame + i) {
        const event = this.events.shift()!;
        if (event.type === 'reset') this.dsp.reset();
        else this.dsp.set(event.settings, event.bpm);
      }
      output[i] = this.dsp.nextGain();
    }
    return true;
  }
}
registerProcessor('gaterunner-master-pulse', MasterPulseProcessor);
