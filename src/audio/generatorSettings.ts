/** Portable controls for the generators introduced in 2026.10.9. */
export const GENERATOR_MODES = ['modal', 'pulse', 'fm', 'pluck', 'granular'] as const;
export type GeneratorMode = typeof GENERATOR_MODES[number];
export function isGeneratorMode(mode: string): mode is GeneratorMode {
  return (GENERATOR_MODES as readonly string[]).includes(mode);
}
export interface GeneratorEngines {
  modal: { material: 'bell' | 'bar' | 'glass' | 'harmonic'; modes: number; decay: number; damping: number; brightness: number; strike: number };
  pulse: { width: number; harmonics: number };
  fm: { ratio: number; index: number; attack: number; decay: number; sustain: number; release: number };
  pluck: { decay: number; brightness: number; position: number; seed: number };
  granular: { asset: string; rootNote: number; size: number; density: number; position: number; scatter: number; pitchScatter: number; seed: number };
}
export interface GeneratorField { key: string; label: string; min: number; max: number; step: number; default: number }
/** Shared bounds keep UI, imports and DSP in agreement. */
export const GENERATOR_FIELDS: Record<GeneratorMode, readonly GeneratorField[]> = {
  modal: [
    { key: 'modes', label: 'Resonant modes', min: 1, max: 16, step: 1, default: 12 },
    { key: 'decay', label: 'Ring decay (seconds)', min: 0.05, max: 20, step: 0.05, default: 2 },
    { key: 'damping', label: 'High mode damping', min: 0, max: 3, step: 0.01, default: 0.6 },
    { key: 'brightness', label: 'Strike brightness (dB/oct)', min: -24, max: 12, step: 0.5, default: -6 },
    { key: 'strike', label: 'Strike noise', min: 0, max: 1, step: 0.01, default: 0.08 },
  ],
  pulse: [
    { key: 'width', label: 'Pulse width', min: 0.02, max: 0.98, step: 0.01, default: 0.5 },
    { key: 'harmonics', label: 'Harmonic count', min: 1, max: 64, step: 1, default: 32 },
  ],
  fm: [
    { key: 'ratio', label: 'Modulator / carrier ratio', min: 0.125, max: 16, step: 0.025, default: 2 },
    { key: 'index', label: 'Modulation index', min: 0, max: 12, step: 0.05, default: 2 },
    { key: 'attack', label: 'Modulation attack (seconds)', min: 0, max: 10, step: 0.005, default: 0.005 },
    { key: 'decay', label: 'Modulation decay (seconds)', min: 0, max: 10, step: 0.01, default: 0.4 },
    { key: 'sustain', label: 'Modulation sustain', min: 0, max: 1, step: 0.01, default: 0.15 },
    { key: 'release', label: 'Modulation release (seconds)', min: 0, max: 20, step: 0.01, default: 0.3 },
  ],
  pluck: [
    { key: 'decay', label: 'String decay (seconds)', min: 0.1, max: 20, step: 0.05, default: 2 },
    { key: 'brightness', label: 'String brightness', min: 0, max: 1, step: 0.01, default: 0.6 },
    { key: 'position', label: 'Pluck position', min: 0.05, max: 0.95, step: 0.01, default: 0.25 },
    { key: 'seed', label: 'Excitation seed', min: 0, max: 65535, step: 1, default: 1 },
  ],
  granular: [
    { key: 'rootNote', label: 'Sample root (MIDI note)', min: 0, max: 127, step: 1, default: 60 },
    { key: 'size', label: 'Grain size (seconds)', min: 0.005, max: 0.5, step: 0.005, default: 0.1 },
    { key: 'density', label: 'Grains per second', min: 1, max: 100, step: 1, default: 20 },
    { key: 'position', label: 'Sample position', min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: 'scatter', label: 'Position scatter', min: 0, max: 1, step: 0.01, default: 0.1 },
    { key: 'pitchScatter', label: 'Pitch scatter (semitones)', min: 0, max: 24, step: 0.1, default: 0 },
    { key: 'seed', label: 'Grain seed', min: 0, max: 65535, step: 1, default: 1 },
  ],
};
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' ? v as Record<string, unknown> : {};
export function normalizeGeneratorEngines(value: unknown): GeneratorEngines {
  const raw = record(value), result: Record<string, Record<string, unknown>> = {};
  for (const mode of GENERATOR_MODES) {
    const input = record(raw[mode]), settings: Record<string, unknown> = {};
    for (const field of GENERATOR_FIELDS[mode]) {
      const v = input[field.key];
      const bounded = typeof v === 'number' && Number.isFinite(v) ? Math.max(field.min, Math.min(field.max, v)) : field.default;
      settings[field.key] = field.step === 1 ? Math.round(bounded) : bounded;
    }
    result[mode] = settings;
  }
  const material = record(raw.modal).material;
  result.modal.material = ['bell', 'bar', 'glass', 'harmonic'].includes(String(material)) ? material : 'bell';
  const asset = record(raw.granular).asset;
  result.granular.asset = typeof asset === 'string' ? asset.slice(0, 64) : '';
  return result as unknown as GeneratorEngines;
}
/** Per-voice offsets from the existing modulation matrix. */
export const GENERATOR_MODULATION = {
  pulseWidth: { title: 'Pulse width', unit: 'width offset', min: -0.96, max: 0.96, step: 0.01 },
  fmIndex: { title: 'FM index', unit: 'index offset', min: -12, max: 12, step: 0.05 },
  modalDamping: { title: 'Modal damping', unit: 'damping offset', min: -3, max: 3, step: 0.01 },
  pluckBrightness: { title: 'Pluck brightness', unit: 'brightness offset', min: -1, max: 1, step: 0.01 },
  grainPosition: { title: 'Grain position', unit: 'position offset', min: -1, max: 1, step: 0.01 },
  grainSize: { title: 'Grain size', unit: 'seconds offset', min: -0.495, max: 0.495, step: 0.005 },
} as const;
export type GeneratorModulation = Partial<Record<keyof typeof GENERATOR_MODULATION, number>>;
