import { DEFAULT_TONEWHEEL_DRAWBARS } from './tonewheelSpectrum.js';
import { MAX_WAVETABLE_CONFIGURATIONS, MAX_WAVETABLE_DIMENSIONS, MAX_WAVETABLE_LFOS,
  type TonewheelWavetable, type TonewheelWavetableDimension, type TonewheelConfiguration, type TonewheelWavetableLfo } from './tonewheelWavetable.js';
import { normalizePartialSourceSnapshot, type PartialSourceSnapshot } from './partialWavetable.js';
import { LFO_FREE_RATE_MIN_HZ, LFO_FREE_RATE_MAX_HZ, LFO_WAVEFORM_VALUES, LFO_SYNC_RATE_VALUES,
  type LfoWaveform, type LfoSyncRateValue } from './lfo.js';
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
function parseNumber(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}
function parseInteger(v: string, fallback: number): number {
  const n = Number.parseInt(v, 10); return Number.isFinite(n) ? n : fallback;
}
export function normalizeTonewheelDrawbars(value: unknown): number[] {
  const raw = Array.isArray(value) ? value : [];
  return DEFAULT_TONEWHEEL_DRAWBARS.map((fallback, index) => clamp(parseNumber(raw[index], fallback), 0, 8));
}

export function normalizeTonewheelWavetable(value: unknown): TonewheelWavetable {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<TonewheelWavetable>;
  const rawDimensions = Array.isArray(raw.dimensions) ? raw.dimensions : [];
  const dimensions: TonewheelWavetableDimension[] = rawDimensions
    .slice(0, MAX_WAVETABLE_DIMENSIONS)
    .map((value, index) => {
      const dimension = (typeof value === 'object' && value !== null ? value : {}) as Partial<TonewheelWavetableDimension>;
      const name = typeof dimension.name === 'string' ? dimension.name.trim().slice(0, 40) : '';
      return {
        name: name || `Morph ${index + 1}`,
        value: clamp(parseNumber(dimension.value, 0), 0, 1),
      };
    });
  const rawConfigurations = Array.isArray(raw.configurations) ? raw.configurations : [];
  const configurations: TonewheelConfiguration[] = rawConfigurations
    .slice(0, MAX_WAVETABLE_CONFIGURATIONS)
    .map((value, index) => {
      const configuration = (typeof value === 'object' && value !== null ? value : {}) as Partial<TonewheelConfiguration>;
      const name = typeof configuration.name === 'string' ? configuration.name.trim().slice(0, 40) : '';
      const rawPosition = Array.isArray(configuration.position) ? configuration.position : [];
      const drawbars = normalizeTonewheelDrawbars(configuration.drawbars);
      const source = typeof configuration.source === 'object' && configuration.source !== null
        ? normalizePartialSourceSnapshot({
          partialGenerator: configuration.source.partialGenerator,
          waveform: typeof configuration.source.waveform === 'string' ? configuration.source.waveform : 'sine',
          tonewheelDrawbars: Array.isArray(configuration.source.tonewheelDrawbars)
            ? configuration.source.tonewheelDrawbars : drawbars,
        } as PartialSourceSnapshot)
        : undefined;
      return {
        name: name || `Configuration ${index + 1}`,
        position: dimensions.map((_, dimensionIndex) => clamp(parseNumber(rawPosition[dimensionIndex], 0), 0, 1)),
        drawbars,
        ...(source ? { source } : {}),
      };
    });
  const rawLfos = Array.isArray(raw.lfos) ? raw.lfos : [];
  const lfos: TonewheelWavetableLfo[] = rawLfos
    .slice(0, MAX_WAVETABLE_LFOS)
    .map((value, index) => {
      const lfo = (typeof value === 'object' && value !== null ? value : {}) as Partial<TonewheelWavetableLfo>;
      const name = typeof lfo.name === 'string' ? lfo.name.trim().slice(0, 40) : '';
      const waveform = typeof lfo.waveform === 'string' && LFO_WAVEFORM_VALUES.has(lfo.waveform)
        ? lfo.waveform as LfoWaveform
        : 'sine';
      const syncRate = typeof lfo.syncRate === 'string' && LFO_SYNC_RATE_VALUES.has(lfo.syncRate)
        ? lfo.syncRate as LfoSyncRateValue
        : '1/4';
      const polarity = lfo.polarity === 'unipolar' ? 'unipolar' : 'bipolar';
      const rawRetrigger = lfo.retrigger as string | undefined;
      const retrigger = rawRetrigger === 'note' || rawRetrigger === 'song' || rawRetrigger === 'bar'
        ? rawRetrigger === 'bar' ? 'song' : rawRetrigger
        : 'free';
      const fmSource = clamp(parseInteger(String(lfo.fmSource ?? -1), -1), -1, index - 1);
      const rawRoutes = Array.isArray(lfo.routes) ? lfo.routes : [];
      return {
        name: name || `Vector LFO ${index + 1}`,
        enabled: Boolean(lfo.enabled ?? true),
        waveform,
        sync: Boolean(lfo.sync ?? true),
        rateHz: clamp(parseNumber(lfo.rateHz, 0.5), LFO_FREE_RATE_MIN_HZ, LFO_FREE_RATE_MAX_HZ),
        syncRate,
        phase: clamp(parseNumber(lfo.phase, 0), 0, 0.999999),
        depth: clamp(parseNumber(lfo.depth, 0.25), 0, 1),
        polarity,
        retrigger,
        smoothing: clamp(parseNumber(lfo.smoothing, 0), 0, 1),
        fmSource,
        fmAmount: clamp(parseNumber(lfo.fmAmount, 0), -4, 4),
        routes: dimensions.map((_, dimensionIndex) => clamp(parseNumber(rawRoutes[dimensionIndex], 0), -1, 1)),
      };
    });

  return {
    enabled: Boolean(raw.enabled) && dimensions.length > 0 && configurations.length > 0,
    dimensions,
    configurations,
    lfos,
  };
}
