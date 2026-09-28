import { generatePartialSpectrum, normalizePartialGenerator } from './partialGenerator.js';
import { resolvePartialSourceSpectrum, resolvePartialWavetableConfigurationSource, getPartialWavetableWeights,
  getModulatedPartialWavetablePosition, type PartialSourceSnapshot } from './partialWavetable.js';
import { interpolateModulatedTonewheelDrawbars, type TonewheelWavetable } from './tonewheelWavetable.js';
import type { ModulationSettings, ModulationTime, ModulationValues } from './modulation.js';

export interface SpectralSourceSettings extends PartialSourceSnapshot {
  tonewheelWavetable: TonewheelWavetable;
  unisonVoices: number;
  unisonDetune: number;
}
export const SPECTRAL_TARGETS = ['spectralTilt', 'spectralContrast', 'spectralBalance', 'harmonicCount', 'mappingExponent'] as const;
export function hasSpectralModulation(settings: ModulationSettings): boolean {
  const active = new Set(settings.sources.filter(s => s.enabled).map(s => s.id));
  return settings.routes.some(r => r.enabled && r.amount !== 0 && active.has(r.source)
    && (SPECTRAL_TARGETS as readonly string[]).includes(r.target));
}
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Offsets change generator controls before normalization; no saved parameter is mutated. */
export function modulatedSourceSpectrum(source: PartialSourceSnapshot, m: ModulationValues): number[] {
  const base = normalizePartialGenerator(source.partialGenerator);
  if (base.type === 'waveform') return generatePartialSpectrum({ ...base,
    tilt: clamp(base.tilt + m.spectralTilt, -24, 24),
    contrast: clamp(base.contrast + m.spectralContrast, 0.25, 4),
    oddEvenBalance: clamp(base.oddEvenBalance + m.spectralBalance, -24, 24),
    harmonicCount: clamp(Math.round(base.harmonicCount + m.harmonicCount), 1, 64),
  }, source.waveform, source.tonewheelDrawbars);
  if (base.type !== 'tonewheel') {
    const spectrum = generatePartialSpectrum({ ...base,
      tilt: clamp(base.tilt + m.spectralTilt, -24, 24),
      exponent: clamp(base.exponent + m.mappingExponent, 0.1, 4),
      harmonicCount: clamp(Math.round(base.harmonicCount + m.harmonicCount), 1, 64),
      normalize: base.normalize,
    }, source.waveform, source.tonewheelDrawbars);
    const shaped = shapeSpectrum(spectrum, m, false);
    const peak = Math.max(...shaped.map(Math.abs));
    return base.normalize && peak > 0 ? shaped.map(v => v / peak) : shaped;
  }
  return shapeSpectrum(resolvePartialSourceSpectrum(source), m, true);
}

function shapeSpectrum(spectrum: number[], m: ModulationValues, tonewheel: boolean): number[] {
  const contrast = clamp(1 + m.spectralContrast, 0.25, 4);
  const balance = clamp(m.spectralBalance, -24, 24);
  const count = clamp(Math.round(8 + m.harmonicCount), 1, 64);
  return spectrum.map((value, i) => {
    const harmonic = (i + 1) / 2;
    if (tonewheel && harmonic > count) return 0;
    // Subharmonic and 3/2 drawbars are retained; odd/even applies to integer harmonics.
    const balanceDb = Number.isInteger(harmonic) ? harmonic % 2 ? -Math.max(0, balance) : Math.min(0, balance) : 0;
    const tiltDb = tonewheel ? clamp(m.spectralTilt, -24, 24) * Math.log2(harmonic) : 0;
    return Math.sign(value) * Math.abs(value) ** contrast * 10 ** ((tiltDb + balanceDb) / 20);
  });
}

/** Wavetable motion and matrix timbre motion compose on the same half-fundamental basis. */
export function spectralSpectrumAtTime(s: SpectralSourceSettings, m: ModulationValues, t: ModulationTime): number[] {
  const w = s.tonewheelWavetable;
  const timing = { timeSeconds: t.time, noteStartSeconds: t.noteStart, songStartSeconds: t.songStart ?? 0, bpm: t.bpm };
  if (w.enabled && w.configurations.some(c => c.source)) {
    const weights = getPartialWavetableWeights(w, getModulatedPartialWavetablePosition(w, timing));
    if (weights.length) {
      const spectra = w.configurations.map(c => modulatedSourceSpectrum(resolvePartialWavetableConfigurationSource(c, s), m));
      return Array.from({ length: Math.max(...spectra.map(p => p.length)) }, (_, i) =>
        spectra.reduce((sum, p, j) => sum + (p[i] ?? 0) * weights[j], 0));
    }
  }
  const drawbars = s.partialGenerator.type === 'tonewheel'
    ? interpolateModulatedTonewheelDrawbars(w, s.tonewheelDrawbars, timing) : s.tonewheelDrawbars;
  return modulatedSourceSpectrum({ ...s, tonewheelDrawbars: drawbars }, m);
}
