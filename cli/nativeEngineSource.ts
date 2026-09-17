import { choirBands, noiseBands, type SynthEngineSettings } from '../src/audio/synthEngine.js';
import { createNativeNoise } from './nativeDrumVoice.js';

/** Constant-peak bandpass, transposed direct form II; coefficients update at control rate. */
class Bandpass {
  private b = 0; private a1 = 0; private a2 = 0; private z1 = 0; private z2 = 0;
  tune(frequency: number, Q: number, sampleRate: number) {
    const w = 2 * Math.PI * Math.max(20, Math.min(sampleRate * 0.45, frequency)) / sampleRate;
    const alpha = Math.sin(w) / (2 * Q), a0 = 1 + alpha;
    this.b = alpha / a0; this.a1 = -2 * Math.cos(w) / a0; this.a2 = (1 - alpha) / a0;
  }
  sample(x: number): number {
    const y = this.b * x + this.z1;
    this.z1 = -this.a1 * y + this.z2;
    this.z2 = -this.b * x - this.a2 * y;
    return y;
  }
}
const blep = (phase: number, dt: number) => {
  if (phase < dt) { const t = phase / dt; return t + t - t * t - 1; }
  if (phase > 1 - dt) { const t = (phase - 1) / dt; return t * t + t + t + 1; }
  return 0;
};
function envelope(t: number, duration: number, s: SynthEngineSettings['noiseEngine']): number {
  const held = (time: number) => time < s.attack ? time / Math.max(1e-6, s.attack)
    : time < s.attack + s.decay ? 1 + (s.sustain - 1) * (time - s.attack) / Math.max(1e-6, s.decay) : s.sustain;
  return t < duration ? held(t) : held(duration) * Math.max(0, 1 - (t - duration) / Math.max(1e-6, s.release));
}

/** Native WAV equivalent of EngineSource. Seeded noise keeps renders reproducible. */
export function createNativeEngineSource(settings: SynthEngineSettings, sampleRate: number, seed = 1) {
  const s = settings.noiseEngine, c = settings.choirEngine, choir = settings.synthMode === 'choir';
  const noise = createNativeNoise(choir ? 'pink' : s.color, seed);
  const resonators = noiseBands(s), formants = choirBands(c);
  const filters = Array.from({ length: choir ? 5 : s.bands }, () => new Bandpass());
  const phases = Array.from({ length: c.voices }, (_, i) => (i * 137.5 / 360) % 1);
  let frame = 0, bright1 = 0, bright2 = 0;
  // Two-pole Butterworth lowpass for glottal spectral tilt, matching Web Audio Q=0 dB.
  const w = 2 * Math.PI * Math.min(sampleRate * 0.45, c.brightness) / sampleRate;
  const alpha = Math.sin(w) / 2, a0 = 1 + alpha;
  const b0 = (1 - Math.cos(w)) / (2 * a0), b1 = 2 * b0, a1 = -2 * Math.cos(w) / a0, a2 = (1 - alpha) / a0;
  return (frequency: number, elapsed: number, duration: number, absoluteTime = elapsed): number => {
    if (frame++ % 16 === 0) {
      if (choir) {
        const morph = c.morph * (c.morphTime > 0 ? Math.min(1, elapsed / c.morphTime) : 1);
        choirBands(c, morph).forEach((b, i) => filters[i].tune(b.frequency, b.Q, sampleRate));
      } else {
        const depth = s.envelopeAmount * envelope(elapsed, duration, s)
          + s.lfoDepth * Math.sin(2 * Math.PI * s.lfoRate * absoluteTime);
        const base = s.frequency * (frequency / 440) ** s.keyTrack * 2 ** (depth / 12);
        resonators.forEach((b, i) => filters[i].tune(base * b.ratio, s.resonance, sampleRate));
      }
    }
    let input = noise();
    if (choir) {
      let voiced = 0;
      for (let i = 0; i < c.voices; i++) {
        const detune = (c.voices === 1 ? 0 : (i / (c.voices - 1) - 0.5) * c.detune)
          + c.vibratoDepth * Math.sin(2 * Math.PI * c.vibratoRate * (1 + i * 0.017) * absoluteTime + i * 73 * Math.PI / 180);
        const dt = Math.min(0.45, frequency * 2 ** (detune / 1200) / sampleRate);
        voiced += 2 * phases[i] - 1 - blep(phases[i], dt);
        phases[i] = (phases[i] + dt) % 1;
      }
      input = input * c.breath + voiced * (1 - c.breath) / Math.sqrt(c.voices);
      const bright = b0 * input + bright1;
      bright1 = b1 * input - a1 * bright + bright2;
      bright2 = b0 * input - a2 * bright;
      input = bright;
    }
    let output = choir ? 0 : input * s.dry;
    for (let i = 0; i < filters.length; i++) output += filters[i].sample(input) * (choir ? formants[i].gain : resonators[i].gain);
    return output;
  };
}
