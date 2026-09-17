/** Engine settings are shared by presets, the Web Audio voices and the native WAV renderer. */
export type SynthMode = 'additive' | 'resonant-noise' | 'choir';
export type Vowel = 'a' | 'e' | 'i' | 'o' | 'u';
export interface NoiseEngineSettings {
  color: 'white' | 'pink' | 'brown';
  frequency: number; keyTrack: number; resonance: number; bands: number;
  spacing: number; oddEven: number; tilt: number; dry: number;
  attack: number; decay: number; sustain: number; release: number; envelopeAmount: number;
  lfoRate: number; lfoDepth: number;
}
export interface ChoirEngineSettings {
  vowel: Vowel; targetVowel: Vowel; morph: number; morphTime: number;
  formantShift: number; bandwidth: number; brightness: number; breath: number;
  voices: number; detune: number; vibratoRate: number; vibratoDepth: number;
  formantOffsets: number[]; formantGains: number[];
}
export interface SynthEngineSettings {
  synthMode: SynthMode;
  noiseEngine: NoiseEngineSettings;
  choirEngine: ChoirEngineSettings;
}
export const DEFAULT_NOISE_ENGINE: NoiseEngineSettings = {
  color: 'pink', frequency: 440, keyTrack: 1, resonance: 18, bands: 4,
  spacing: 1, oddEven: 0, tilt: -6, dry: 0.03,
  attack: 0.03, decay: 0.3, sustain: 0.2, release: 0.3, envelopeAmount: 0,
  lfoRate: 0.7, lfoDepth: 0,
};
export const DEFAULT_CHOIR_ENGINE: ChoirEngineSettings = {
  vowel: 'a', targetVowel: 'o', morph: 0, morphTime: 0.4,
  formantShift: 0, bandwidth: 1.3, brightness: 5500, breath: 0.06,
  voices: 3, detune: 14, vibratoRate: 5.1, vibratoDepth: 9,
  formantOffsets: [0, 0, 0, 0, 0], formantGains: [0, 0, 0, 0, 0],
};
export const LEGACY_NOISE_WAVEFORMS = ['flute', 'oboe', 'clarinet', 'saxophone', 'pink-noise', 'brown-noise',
  'helmholtz', 'formant', 'duct', 'aeolian', 'stochastic-bandpass'];
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const number = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
const choice = <T extends string>(v: unknown, choices: readonly T[], fallback: T): T => choices.includes(v as T) ? v as T : fallback;
export function normalizeNoiseEngine(value: unknown): NoiseEngineSettings {
  const r = object(value), d = DEFAULT_NOISE_ENGINE;
  return {
    color: choice(r.color, ['white', 'pink', 'brown'], d.color),
    frequency: number(r.frequency, d.frequency, 30, 12000), keyTrack: number(r.keyTrack, d.keyTrack, 0, 1),
    resonance: number(r.resonance, d.resonance, 0.5, 80), bands: Math.round(number(r.bands, d.bands, 1, 8)),
    spacing: number(r.spacing, d.spacing, 0.25, 3), oddEven: number(r.oddEven, d.oddEven, -24, 24),
    tilt: number(r.tilt, d.tilt, -24, 6), dry: number(r.dry, d.dry, 0, 1),
    attack: number(r.attack, d.attack, 0, 10), decay: number(r.decay, d.decay, 0, 10),
    sustain: number(r.sustain, d.sustain, 0, 1), release: number(r.release, d.release, 0, 20),
    envelopeAmount: number(r.envelopeAmount, d.envelopeAmount, -48, 48),
    lfoRate: number(r.lfoRate, d.lfoRate, 0.01, 20), lfoDepth: number(r.lfoDepth, d.lfoDepth, 0, 24),
  };
}
export function normalizeChoirEngine(value: unknown): ChoirEngineSettings {
  const r = object(value), d = DEFAULT_CHOIR_ENGINE;
  return {
    vowel: choice(r.vowel, ['a', 'e', 'i', 'o', 'u'], d.vowel),
    targetVowel: choice(r.targetVowel, ['a', 'e', 'i', 'o', 'u'], d.targetVowel),
    morph: number(r.morph, d.morph, 0, 1), morphTime: number(r.morphTime, d.morphTime, 0, 10),
    formantShift: number(r.formantShift, d.formantShift, -24, 24), bandwidth: number(r.bandwidth, d.bandwidth, 0.3, 4),
    brightness: number(r.brightness, d.brightness, 500, 16000), breath: number(r.breath, d.breath, 0, 1),
    voices: Math.round(number(r.voices, d.voices, 1, 8)), detune: number(r.detune, d.detune, 0, 60),
    vibratoRate: number(r.vibratoRate, d.vibratoRate, 0.1, 12), vibratoDepth: number(r.vibratoDepth, d.vibratoDepth, 0, 100),
    formantOffsets: Array.from({ length: 5 }, (_, i) => number(Array.isArray(r.formantOffsets) ? r.formantOffsets[i] : undefined, 0, -12, 12)),
    formantGains: Array.from({ length: 5 }, (_, i) => number(Array.isArray(r.formantGains) ? r.formantGains[i] : undefined, 0, -24, 12)),
  };
}
export function normalizeSynthEngine(value: unknown): SynthEngineSettings {
  const r = object(value), source = object(r.partialGenerator);
  // Explicit modes win. Do not reinterpret inactive waveform metadata in mathematical/tonewheel sources.
  const legacyActive = source.type === 'waveform' || !['tonewheel', 'sequence', 'binary'].includes(String(source.type));
  const wave = String(r.waveform);
  const fallback: SynthMode = legacyActive && wave.startsWith('choir-') ? 'choir'
    : legacyActive && LEGACY_NOISE_WAVEFORMS.includes(wave) ? 'resonant-noise' : 'additive';
  const noiseDefaults: Partial<NoiseEngineSettings> = wave === 'brown-noise' ? { color: 'brown' }
    : wave === 'flute' ? { bands: 2, resonance: 35, tilt: -12 }
    : wave === 'oboe' ? { color: 'white', bands: 6, resonance: 28, tilt: -3 }
    : wave === 'clarinet' ? { bands: 6, oddEven: -24, resonance: 30 }
    : wave === 'saxophone' ? { color: 'white', bands: 8, resonance: 12, tilt: -4 } : {};
  return {
    synthMode: choice(r.synthMode, ['additive', 'resonant-noise', 'choir'], fallback),
    noiseEngine: normalizeNoiseEngine({ ...noiseDefaults, ...object(r.noiseEngine) }),
    choirEngine: normalizeChoirEngine({ ...(wave === 'choir-oh' ? { vowel: 'o', targetVowel: 'a' } : {}), ...object(r.choirEngine) }),
  };
}

// Five parallel vocal-tract resonances. Pitch and formant position are independent.
const VOWELS: Record<Vowel, number[]> = {
  a: [730, 1090, 2440, 3400, 4500], e: [530, 1840, 2480, 3500, 4950],
  i: [270, 2290, 3010, 3900, 4950], o: [450, 800, 2830, 3500, 4500], u: [325, 700, 2530, 3500, 4950],
};
export function choirBands(s: ChoirEngineSettings, morph = s.morph) {
  return VOWELS[s.vowel].map((from, i) => ({
    frequency: from * (VOWELS[s.targetVowel][i] / from) ** morph * 2 ** ((s.formantShift + s.formantOffsets[i]) / 12),
    Q: Math.max(0.5, from / ([90, 110, 140, 220, 280][i] * s.bandwidth)),
    gain: 10 ** (([0, -4, -8, -14, -20][i] + s.formantGains[i]) / 20) * 3,
  }));
}
export function noiseBands(s: NoiseEngineSettings) {
  const bands = Array.from({ length: s.bands }, (_, i) => {
    const harmonic = i + 1;
    return { ratio: harmonic ** s.spacing, gain: 10 ** ((s.tilt * Math.log2(harmonic)
      + (harmonic % 2 ? -Math.max(0, s.oddEven) : Math.min(0, s.oddEven))) / 20) };
  });
  const sum = Math.sqrt(bands.reduce((n, b) => n + b.gain ** 2, 0));
  return bands.map(b => ({ ...b, gain: b.gain / sum * Math.sqrt(s.resonance) * 1.8 * (1 - s.dry) }));
}
