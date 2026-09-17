import * as Tone from 'tone';
import type { ChoirEngineSettings } from './synthEngine';

interface NoteWindow { start: number; end: number }
interface Singer {
  index: number;
  start: number;
  end: number;
  carrier: OscillatorNode;
  vibrato: OscillatorNode;
  depth: GainNode;
  gain: GainNode;
}

const waves = new WeakMap<Tone.BaseContext, PeriodicWave[]>();
const vibratoWaves = new WeakMap<Tone.BaseContext, PeriodicWave[]>();

function vibratoWave(context: Tone.BaseContext, index: number): PeriodicWave {
  let bank = vibratoWaves.get(context);
  if (!bank) { bank = []; vibratoWaves.set(context, bank); }
  if (!bank[index]) {
    const phase = index * 73 * Math.PI / 180;
    bank[index] = context.createPeriodicWave(
      new Float32Array([0, -Math.sin(phase)]), new Float32Array([0, Math.cos(phase)]),
    );
  }
  return bank[index];
}

/** Keep Tone's phased, band-limited saw spectrum, prepared once per context. */
function singerWave(context: Tone.BaseContext, index: number): PeriodicWave | undefined {
  if (index === 0) return undefined;
  let bank = waves.get(context);
  if (!bank) { bank = []; waves.set(context, bank); }
  if (!bank[index]) {
    const real = new Float32Array(2048), imag = new Float32Array(2048);
    const phase = index * 137.5 * Math.PI / 180;
    for (let n = 1; n < real.length; n++) {
      const b = 2 / (n * Math.PI) * (n & 1 ? 1 : -1);
      real[n] = -b * Math.sin(phase * n);
      imag[n] = b * Math.cos(phase * n);
    }
    bank[index] = context.createPeriodicWave(real, imag);
  }
  return bank[index];
}

/** Native singers exist only during notes, including their release tails. */
export class ChoirEnsemble {
  private windows: NoteWindow[] = [];
  private singers = new Set<Singer>();

  constructor(
    private readonly context: Tone.BaseContext,
    private readonly frequency: Tone.Multiply,
    private readonly detune: Tone.Signal<'cents'>,
    private readonly output: Tone.Gain,
    private settings: ChoirEngineSettings,
  ) {
    for (let i = 0; i < settings.voices; i++) {
      singerWave(context, i);
      vibratoWave(context, i);
    }
  }

  private startSinger(index: number, start: number, end: number): void {
    const c = this.settings;
    const carrier = this.context.createOscillator();
    carrier.frequency.value = 0;
    const wave = singerWave(this.context, index);
    if (wave) carrier.setPeriodicWave(wave);
    else carrier.type = 'sawtooth';
    carrier.detune.value = c.voices === 1 ? 0 : (index / (c.voices - 1) - 0.5) * c.detune;
    // Native AudioParams sum the pitch bus with static ensemble spread and vibrato.
    Tone.connect(this.frequency, carrier.frequency);
    Tone.connect(this.detune, carrier.detune);
    const vibrato = this.context.createOscillator();
    vibrato.frequency.value = c.vibratoRate * (1 + index * 0.017);
    vibrato.setPeriodicWave(vibratoWave(this.context, index));
    const depth = this.context.createGain();
    depth.gain.value = c.vibratoDepth;
    vibrato.connect(depth);
    depth.connect(carrier.detune);
    const gain = this.context.createGain();
    gain.gain.value = (1 - c.breath) / Math.sqrt(c.voices);
    carrier.connect(gain);
    Tone.connect(gain, this.output);
    const singer: Singer = { index, start, end, carrier, vibrato, depth, gain };
    this.singers.add(singer);
    carrier.onended = () => {
      Tone.disconnect(this.frequency, carrier.frequency);
      Tone.disconnect(this.detune, carrier.detune);
      carrier.disconnect(); vibrato.disconnect(); depth.disconnect(); gain.disconnect();
      this.singers.delete(singer);
    };
    carrier.start(start);
    vibrato.start(start);
    if (Number.isFinite(end)) { carrier.stop(end); vibrato.stop(end); }
  }

  start(time: number): void {
    this.windows = this.windows.filter(window => window.end > this.context.currentTime);
    this.windows.push({ start: time, end: Infinity });
    for (let i = 0; i < this.settings.voices; i++) this.startSinger(i, time, Infinity);
  }

  stop(time: number): void {
    for (const window of this.windows) window.end = Math.min(window.end, time);
    for (const singer of this.singers) {
      if (singer.end <= time) continue;
      singer.end = time;
      // Also cancel sources already scheduled to start after a reset/disposal.
      singer.carrier.stop(time);
      singer.vibrato.stop(time);
    }
  }

  set(settings: ChoirEngineSettings, time: number): void {
    const previous = this.settings;
    this.settings = settings;
    this.windows = this.windows.filter(window => window.end > this.context.currentTime);
    for (const singer of this.singers) {
      if (singer.end <= time) continue;
      const c = settings, at = Math.max(time, singer.start);
      singer.gain.gain.cancelScheduledValues(at);
      singer.gain.gain.setTargetAtTime(singer.index < c.voices ? (1 - c.breath) / Math.sqrt(c.voices) : 0, at, 0.005);
      if (singer.index >= c.voices) {
        singer.end = Math.min(singer.end, at + 0.02);
        singer.carrier.stop(singer.end); singer.vibrato.stop(singer.end);
      } else {
        singer.carrier.detune.setTargetAtTime(c.voices === 1 ? 0 : (singer.index / (c.voices - 1) - 0.5) * c.detune, at, 0.005);
        singer.vibrato.frequency.setTargetAtTime(c.vibratoRate * (1 + singer.index * 0.017), at, 0.005);
        singer.depth.gain.setTargetAtTime(c.vibratoDepth, at, 0.005);
      }
    }
    // New singers inherit held notes and every future note already scheduled on this voice.
    for (let i = previous.voices; i < settings.voices; i++) {
      for (const window of this.windows) {
        if (window.end > time) this.startSinger(i, Math.max(time, window.start), window.end);
      }
    }
  }

  dispose(): void {
    this.stop(this.context.currentTime);
    this.windows = [];
    // Offline contexts may never deliver onended after being disposed.
    for (const singer of this.singers) {
      Tone.disconnect(this.frequency, singer.carrier.frequency);
      Tone.disconnect(this.detune, singer.carrier.detune);
      singer.carrier.onended = null;
      singer.carrier.disconnect(); singer.vibrato.disconnect(); singer.depth.disconnect(); singer.gain.disconnect();
    }
    this.singers.clear();
  }
}
