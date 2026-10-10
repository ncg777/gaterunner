import { type GeneratorEngines, type GeneratorMode, type GeneratorModulation } from './generatorSettings.js';

export interface GeneratorSample { hash: string; sampleRate: number; channels: readonly ArrayLike<number>[] }
const TAU = 2 * Math.PI;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const wrap = (v: number) => v - Math.floor(v);
const SINE_SIZE = 8192;
const NO_MODULATION: GeneratorModulation = {};
const SINE = Float64Array.from({ length: SINE_SIZE + 1 }, (_, i) => Math.sin(TAU * i / SINE_SIZE));
function sine(phase: number): number {
  const p = wrap(phase) * SINE_SIZE, i = Math.floor(p);
  return SINE[i] + (SINE[i + 1] - SINE[i]) * (p - i);
}
const MATERIALS = {
  bell: [1, 2, 2.4, 3, 4.2, 5.4, 6.8, 8.2, 9.6, 11, 12.5, 14.1, 15.8, 17.6, 19.5, 21.5],
  bar: [1, 2.756, 5.404, 8.933, 13.344, 18.638, 24.813, 31.871, 39.811, 48.633, 58.337, 68.924, 80.393, 92.744, 105.978, 120.094],
  glass: [1, 1.52, 2.14, 2.79, 3.48, 4.22, 5.01, 5.85, 6.74, 7.68, 8.67, 9.71, 10.8, 11.94, 13.13, 14.37],
  harmonic: Array.from({ length: 16 }, (_, i) => i + 1),
};
/** Four-times FM oversampling followed by a fourth-order Butterworth low-pass. */
class Lowpass {
  private z1 = 0; private z2 = 0;
  private b0: number; private b1: number; private b2: number; private a1: number; private a2: number;
  constructor(Q: number) {
    const w = TAU * 0.42 / 4, c = Math.cos(w), alpha = Math.sin(w) / (2 * Q), a = 1 + alpha;
    this.b0 = (1 - c) / (2 * a); this.b1 = (1 - c) / a; this.b2 = this.b0;
    this.a1 = -2 * c / a; this.a2 = (1 - alpha) / a;
  }
  sample(x: number) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2; this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}
interface Grain { position: number; age: number; frames: number; rate: number; active: boolean }
/** Allocation-free sample loop shared by the AudioWorklet and native WAV renderer.
 * Each instance owns its phases, string history and bounded grain pool. */
export class GeneratorDSP {
  private phase = 0; private modPhase = 0; private randomState = 1;
  private modalPhases = new Float64Array(16);
  private modalLevels = new Float64Array(16);
  private modalRates = new Float64Array(16);
  private modalGains = new Float64Array(16);
  private modalEnergy = 1;
  private pulseAmplitudes = new Float64Array(64);
  private previousWidth = NaN; private previousHarmonics = 0;
  private previousDamping = NaN; private previousMaterial = ''; private previousDecay = NaN;
  private previousBrightness = NaN; private previousModes = 0;
  private delay: Float64Array; private write = 0; private pluckPrevious = 0;
  private allpassInput = 0; private allpassOutput = 0;
  private fmFilters = [new Lowpass(0.5411961), new Lowpass(1.306563)];
  private grains: Grain[] = Array.from({ length: 32 }, () => ({ position: 0, age: 0, frames: 0, rate: 1, active: false }));
  private untilGrain = 0;
  private controlFrame = 0;
  constructor(readonly mode: GeneratorMode, private settings: GeneratorEngines, readonly sampleRate: number,
    private asset?: GeneratorSample) {
    if (mode === 'granular' && (!asset || !asset.channels.length || !asset.channels[0].length)) throw new Error('Choose an imported sample for Granular');
    this.delay = new Float64Array(mode === 'pluck' ? Math.ceil(sampleRate / 20) + 4 : 0);
  }
  set(settings: GeneratorEngines) { this.settings = settings; this.previousWidth = NaN; this.previousDamping = NaN; }
  get sampleHash() { return this.asset?.hash; }
  private random() {
    let x = this.randomState;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.randomState = x >>> 0;
    return this.randomState / 4294967296;
  }
  private fmEnvelope(time: number): number {
    const s = this.settings.fm;
    return time < s.attack ? Math.max(0, time) / Math.max(1 / this.sampleRate, s.attack)
      : time < s.attack + s.decay ? 1 + (s.sustain - 1) * (time - s.attack) / Math.max(1 / this.sampleRate, s.decay) : s.sustain;
  }
  attack(frequency: number, preservePhase = false) {
    if (!preservePhase) { this.phase = 0; this.modPhase = 0; this.fmFilters = [new Lowpass(0.5411961), new Lowpass(1.306563)]; }
    this.modalPhases.fill(0); this.modalLevels.fill(1);
    this.previousDamping = NaN; this.controlFrame = 0;
    this.randomState = (this.mode === 'granular' ? this.settings.granular.seed : this.settings.pluck.seed) + 1;
    if (this.mode === 'pluck') {
      const s = this.settings.pluck, period = clamp(this.sampleRate / Math.max(20, frequency), 2, this.delay.length - 2);
      const noise = Float64Array.from({ length: this.delay.length }, () => this.random() * 2 - 1);
      const offset = Math.max(1, Math.round(period * s.position));
      let peak = 1e-9, previous = 0;
      for (let i = 0; i < this.delay.length; i++) {
        previous = previous * (1 - s.brightness * 0.9 - 0.05) + (noise[i] - noise[(i + offset) % noise.length]) * (s.brightness * 0.9 + 0.05);
        this.delay[i] = previous; peak = Math.max(peak, Math.abs(previous));
      }
      for (let i = 0; i < this.delay.length; i++) this.delay[i] *= 0.65 / peak;
      this.write = 0; this.pluckPrevious = 0; this.allpassInput = 0; this.allpassOutput = 0;
    }
    for (const grain of this.grains) grain.active = false;
    this.untilGrain = 0;
  }
  sample(frequency: number, elapsed: number, duration: number, mod: GeneratorModulation = NO_MODULATION): number {
    if (!Number.isFinite(frequency) || frequency <= 0) return 0;
    const nyquist = this.sampleRate * 0.5;
    if (this.mode === 'modal') {
      const s = this.settings.modal, ratios = MATERIALS[s.material];
      const damping = clamp(s.damping + (mod.modalDamping ?? 0), 0, 3);
      if (this.controlFrame++ % 16 === 0 && (damping !== this.previousDamping || s.material !== this.previousMaterial || s.decay !== this.previousDecay || s.brightness !== this.previousBrightness || s.modes !== this.previousModes)) {
        for (let i = 0; i < 16; i++) this.modalRates[i] = Math.exp(-Math.log(1000) * ratios[i] ** damping / (s.decay * this.sampleRate));
        let energy = 0;
        for (let i = 0; i < s.modes; i++) { const gain = 10 ** (s.brightness * Math.log2(ratios[i]) / 20); this.modalGains[i] = gain; energy += gain * gain; }
        this.modalEnergy = Math.sqrt(Math.max(1, energy));
        this.previousDamping = damping; this.previousMaterial = s.material; this.previousDecay = s.decay;
        this.previousBrightness = s.brightness; this.previousModes = s.modes;
      }
      let output = 0;
      for (let i = 0; i < s.modes; i++) {
        const hz = frequency * ratios[i], fade = clamp((nyquist - hz) / (nyquist * 0.1), 0, 1);
        output += sine(this.modalPhases[i]) * this.modalGains[i] * this.modalLevels[i] * fade;
        this.modalPhases[i] = wrap(this.modalPhases[i] + hz / this.sampleRate);
        this.modalLevels[i] *= this.modalRates[i];
      }
      const strike = elapsed < 0.015 ? (this.random() * 2 - 1) * s.strike * (1 - elapsed / 0.015) : 0;
      return output / this.modalEnergy * 0.7 + strike;
    }
    if (this.mode === 'pulse') {
      const s = this.settings.pulse, width = clamp(s.width + (mod.pulseWidth ?? 0), 0.02, 0.98);
      if (this.controlFrame++ % 16 === 0 && (width !== this.previousWidth || s.harmonics !== this.previousHarmonics)) {
        for (let i = 0; i < s.harmonics; i++) this.pulseAmplitudes[i] = Math.sin(Math.PI * (i + 1) * width) / (i + 1);
        this.previousWidth = width; this.previousHarmonics = s.harmonics;
      }
      // The signed sine coefficients match GateRunner's existing pulse spectra.
      const sn = sine(this.phase), cs = sine(this.phase + 0.25);
      let sh = sn, ch = cs, output = 0;
      const count = Math.min(s.harmonics, Math.floor(nyquist / frequency));
      for (let i = 0; i < count; i++) {
        output += sh * this.pulseAmplitudes[i] * clamp((nyquist - frequency * (i + 1)) / (nyquist * 0.1), 0, 1);
        const next = sh * cs + ch * sn; ch = ch * cs - sh * sn; sh = next;
      }
      this.phase = wrap(this.phase + frequency / this.sampleRate);
      return output * 0.65;
    }
    if (this.mode === 'fm') {
      const s = this.settings.fm;
      const envelope = elapsed <= duration ? this.fmEnvelope(elapsed) : this.fmEnvelope(duration) * Math.max(0, 1 - (elapsed - duration) / Math.max(1 / this.sampleRate, s.release));
      const modHz = frequency * s.ratio;
      // Reduce the index near Nyquist as well as oversampling; FM has infinitely many sidebands.
      const index = Math.min(clamp(s.index + (mod.fmIndex ?? 0), 0, 12), Math.max(0, (nyquist * 0.85 - frequency) / modHz - 1));
      let output = 0;
      for (let i = 0; i < 4; i++) {
        const hz = frequency + sine(this.modPhase) * modHz * index * envelope;
        this.phase = wrap(this.phase + hz / (this.sampleRate * 4));
        this.modPhase = wrap(this.modPhase + modHz / (this.sampleRate * 4));
        output = this.fmFilters[1].sample(this.fmFilters[0].sample(sine(this.phase)));
      }
      return output * 0.75 * clamp((nyquist - frequency) / (nyquist * 0.1), 0, 1);
    }
    if (this.mode === 'pluck') {
      const s = this.settings.pluck, hz = clamp(frequency, 20, Math.min(8000, this.sampleRate / 4));
      const brightness = 0.5 + clamp(s.brightness + (mod.pluckBrightness ?? 0), 0, 1) * 0.49;
      const omega = TAU * hz / this.sampleRate;
      const filterDelay = Math.atan2((1 - brightness) * Math.sin(omega), brightness + (1 - brightness) * Math.cos(omega)) / omega;
      const delay = clamp(this.sampleRate / hz - filterDelay, 2, this.delay.length - 2), integer = Math.floor(delay), fraction = delay - integer;
      const x = this.delay[(this.write - integer + this.delay.length) % this.delay.length];
      const coefficient = (1 - fraction) / (1 + fraction);
      const y = fraction < 1e-6 ? x : coefficient * (x - this.allpassOutput) + this.allpassInput;
      this.allpassInput = x; this.allpassOutput = y;
      const filtered = y * brightness + this.pluckPrevious * (1 - brightness);
      this.pluckPrevious = y;
      this.delay[this.write] = filtered * Math.exp(-Math.log(1000) / (hz * s.decay));
      this.write = (this.write + 1) % this.delay.length;
      return y;
    }
    const s = this.settings.granular, asset = this.asset!, length = asset.channels[0].length;
    const rootHz = 440 * 2 ** ((s.rootNote - 69) / 12);
    if (this.untilGrain-- <= 0 && elapsed <= duration) {
      let grain: Grain | undefined;
      for (const candidate of this.grains) if (!candidate.active) { grain = candidate; break; }
      if (grain) {
        grain.frames = Math.max(2, Math.round(clamp(s.size + (mod.grainSize ?? 0), 0.005, 0.5) * this.sampleRate));
        grain.position = wrap(clamp(s.position + (mod.grainPosition ?? 0), 0, 1) + (this.random() * 2 - 1) * s.scatter) * length;
        grain.age = 0; grain.rate = 2 ** ((this.random() * 2 - 1) * s.pitchScatter / 12); grain.active = true;
      }
      this.untilGrain += this.sampleRate / s.density;
    }
    let output = 0, weight = 0;
    for (const grain of this.grains) {
      if (!grain.active) continue;
      const window = 0.5 - 0.5 * Math.cos(TAU * grain.age / (grain.frames - 1));
      const position = ((grain.position % length) + length) % length, p = Math.floor(position), frac = position - p;
      let sample = 0;
      for (const channel of asset.channels) sample += channel[p] * (1 - frac) + channel[(p + 1) % length] * frac;
      output += sample / asset.channels.length * window; weight += window;
      grain.position += asset.sampleRate / this.sampleRate * frequency / rootHz * grain.rate;
      if (++grain.age >= grain.frames) grain.active = false;
    }
    // Window-weight normalization keeps dense clouds from becoming arbitrarily loud.
    return output / Math.max(1, weight) * 0.8;
  }
}
