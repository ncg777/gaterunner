import { createSkewLfoState, getLfoFrequencyHz, LFO_SYNC_RATE_VALUES, LFO_WAVEFORM_VALUES,
  sampleLfoAtTime, type LfoSyncRateValue, type LfoWaveform } from './lfo.js';

/** Amounts are offsets in destination units; routes sum before destination limits. */
export const MODULATION_TARGETS = {
  positionA: { title: 'Position function · a', unit: 'parameter offset', min: -1200, max: 1200, step: 0.01 },
  positionB: { title: 'Position function · b', unit: 'parameter offset', min: -100, max: 100, step: 0.01 },
  positionC: { title: 'Position function · c', unit: 'parameter offset', min: -32, max: 32, step: 0.01 },
  targetA: { title: 'Target position · a', unit: 'parameter offset', min: -1200, max: 1200, step: 0.01 },
  targetB: { title: 'Target position · b', unit: 'parameter offset', min: -100, max: 100, step: 0.01 },
  targetC: { title: 'Target position · c', unit: 'parameter offset', min: -32, max: 32, step: 0.01 },
  positionMorph: { title: 'Position morph', unit: 'morph offset', min: -1, max: 1, step: 0.01 },
  spectralTilt: { title: 'Spectral tilt', unit: 'dB/octave', min: -48, max: 48, step: 0.5 },
  spectralContrast: { title: 'Spectral contrast', unit: 'exponent offset', min: -3.75, max: 3.75, step: 0.05 },
  spectralBalance: { title: 'Odd/even balance', unit: 'dB (+ favors even)', min: -48, max: 48, step: 0.5 },
  harmonicCount: { title: 'Harmonic count', unit: 'harmonics offset', min: -63, max: 63, step: 1 },
  mappingExponent: { title: 'Mapping exponent (power mapping)', unit: 'exponent offset', min: -3.9, max: 3.9, step: 0.05 },
  pitch: { title: 'Pitch', unit: 'semitones', min: -48, max: 48, step: 0.1 },
  level: { title: 'Level', unit: 'dB', min: -96, max: 24, step: 0.5 },
  pan: { title: 'Pan', unit: '−1 left / +1 right', min: -1, max: 1, step: 0.01 },
  cutoff: { title: 'Filter cutoff', unit: 'semitones', min: -96, max: 96, step: 0.5 },
  resonance: { title: 'Filter resonance', unit: 'Q', min: -30, max: 30, step: 0.1 },
  filterGain: { title: 'Filter gain', unit: 'dB', min: -48, max: 48, step: 0.5 },
} as const;
export type ModulationTarget = keyof typeof MODULATION_TARGETS;
const TARGET_KEYS = Object.keys(MODULATION_TARGETS) as ModulationTarget[];
interface Source { id: string; name: string; enabled: boolean }
export interface ModulationEnvelope extends Source {
  type: 'envelope'; attack: number; decay: number; sustain: number; release: number; curve: number;
}
export interface ModulationLfo extends Source {
  type: 'lfo'; waveform: LfoWaveform; rateHz: number; sync: boolean; syncRate: LfoSyncRateValue;
  phase: number; retrigger: 'note' | 'song' | 'free'; unipolar: boolean;
}
export type ModulationSource = ModulationEnvelope | ModulationLfo;
export interface ModulationRoute { id: string; source: string; target: ModulationTarget; amount: number; enabled: boolean }
export interface ModulationSettings { sources: ModulationSource[]; routes: ModulationRoute[] }
export type ModulationValues = Record<ModulationTarget, number>;
export const emptyModulationValues = (): ModulationValues => ({ spectralTilt: 0, spectralContrast: 0,
  positionA: 0, positionB: 0, positionC: 0, targetA: 0, targetB: 0, targetC: 0, positionMorph: 0,
  spectralBalance: 0, harmonicCount: 0, mappingExponent: 0, pitch: 0, level: 0, pan: 0, cutoff: 0, resonance: 0, filterGain: 0 });
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' ? v as Record<string, unknown> : {};
const num = (v: unknown, fallback: number, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
const name = (v: unknown, fallback: string) => typeof v === 'string' && v.trim() ? v.trim().slice(0, 100) : fallback;

/** No source/route count ceiling. IDs survive reordering and invalid references are discarded. */
export function normalizeModulation(value: unknown): ModulationSettings {
  const r = record(value), ids = new Set<string>(), routeIds = new Set<string>();
  const sources: ModulationSource[] = [];
  for (const [i, raw] of (Array.isArray(r.sources) ? r.sources : []).entries()) {
    const s = record(raw);
    if (s.type !== 'envelope' && s.type !== 'lfo') continue;
    const id = name(s.id, `source-${i + 1}`);
    if (ids.has(id)) continue;
    ids.add(id);
    const base = { id, name: name(s.name, `${s.type === 'lfo' ? 'LFO' : 'Envelope'} ${i + 1}`), enabled: s.enabled !== false };
    sources.push(s.type === 'envelope' ? { ...base, type: 'envelope',
      attack: num(s.attack, 0.1, 0, 60), decay: num(s.decay, 0.3, 0, 60), sustain: num(s.sustain, 0.5, 0, 1),
      release: num(s.release, 0.5, 0, 60), curve: num(s.curve, 0, -10, 10) }
      : { ...base, type: 'lfo', waveform: LFO_WAVEFORM_VALUES.has(String(s.waveform)) ? s.waveform as LfoWaveform : 'sine',
        rateHz: num(s.rateHz, 1, 0.01, 20), sync: s.sync === true,
        syncRate: LFO_SYNC_RATE_VALUES.has(String(s.syncRate)) ? s.syncRate as LfoSyncRateValue : '1/4',
        phase: num(s.phase, 0, 0, 1), retrigger: s.retrigger === 'song' || s.retrigger === 'free' ? s.retrigger : 'note',
        unipolar: s.unipolar === true });
  }
  const routes: ModulationRoute[] = [];
  for (const [i, raw] of (Array.isArray(r.routes) ? r.routes : []).entries()) {
    const s = record(raw), id = name(s.id, `route-${i + 1}`);
    if (!ids.has(String(s.source)) || !Object.prototype.hasOwnProperty.call(MODULATION_TARGETS, String(s.target)) || routeIds.has(id)) continue;
    routeIds.add(id);
    const target = s.target as ModulationTarget, bounds = MODULATION_TARGETS[target];
    routes.push({ id, source: String(s.source), target, amount: num(s.amount, 0, bounds.min, bounds.max), enabled: s.enabled !== false });
  }
  return { sources, routes };
}

export function modulationEnvelopeLevel(s: ModulationEnvelope, elapsed: number, releaseAt = Infinity): number {
  const shape = (x: number) => Math.abs(s.curve) < 1e-6 ? x : Math.expm1(s.curve * x) / Math.expm1(s.curve);
  const held = (t: number) => t < 0 ? 0 : t < s.attack ? shape(t / s.attack)
    : t < s.attack + s.decay ? 1 + (s.sustain - 1) * shape((t - s.attack) / s.decay) : s.sustain;
  if (elapsed < releaseAt) return held(elapsed);
  return s.release === 0 || elapsed >= releaseAt + s.release ? 0
    : held(releaseAt) * (1 - shape((elapsed - releaseAt) / s.release));
}

export interface ModulationTime { time: number; noteStart: number; releaseTime?: number; songStart?: number; bpm: number }
/** Compile once per patch; evaluate only connected sources, once each per sample. */
export function compileModulation(settings: ModulationSettings) {
  const connected = settings.sources.filter(s => s.enabled).map(source => ({ source,
    bpm: NaN, frequency: 1,
    state: createSkewLfoState(Array.from(source.id).reduce((h, c) => Math.imul(h, 31) + c.charCodeAt(0), 2166136261)),
    routes: settings.routes.filter(r => r.enabled && r.amount !== 0 && r.source === source.id),
  })).filter(s => s.routes.length);
  return {
    active: connected.length > 0,
    sample(t: ModulationTime, out = emptyModulationValues()): ModulationValues {
      for (const key of TARGET_KEYS) out[key] = 0;
      for (const compiled of connected) {
        const { source: s, state, routes } = compiled;
        let value: number;
        if (s.type === 'envelope') value = modulationEnvelopeLevel(s, t.time - t.noteStart,
          t.releaseTime === undefined ? Infinity : t.releaseTime - t.noteStart);
        else {
          const origin = s.retrigger === 'note' ? t.noteStart : s.retrigger === 'song' ? t.songStart ?? 0 : 0;
          if (compiled.bpm !== t.bpm) {
            compiled.frequency = getLfoFrequencyHz({ sync: s.sync, syncRate: s.syncRate, rateHz: s.rateHz, bpm: t.bpm });
            compiled.bpm = t.bpm;
          }
          value = sampleLfoAtTime(state, Math.max(0, t.time - origin), compiled.frequency, s.waveform, s.phase);
          if (s.unipolar) value = (value + 1) / 2;
        }
        for (const route of routes) out[route.target] += value * route.amount;
      }
      for (const key of TARGET_KEYS) {
        const bounds = MODULATION_TARGETS[key];
        out[key] = Math.max(bounds.min, Math.min(bounds.max, out[key]));
      }
      return out;
    },
  };
}

