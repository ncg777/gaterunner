import type * as Tone from 'tone';

interface WaveContext {
  currentTime: number;
  isOffline: boolean;
  createPeriodicWave(real: Float32Array, imag: Float32Array): PeriodicWave;
}

interface CustomOscillator {
  context: WaveContext;
  _type: string;
  _phase: number;
  _partials: number[];
  _partialCount: number;
  _wave: PeriodicWave | undefined;
  _oscillator: {
    _startTime: number;
    _stopTime: number;
    setPeriodicWave(wave: PeriodicWave): void;
  } | null;
  _getRealImaginary(type: string, phase: number): [Float32Array, Float32Array];
  _start(time: number): void;
}

interface SpectrumWaves {
  coefficients: number[];
  phases: Map<number, PeriodicWave>;
}

// Contexts and spectra disappear with their owners. Retain only a bounded number
// of phases even when a caller repeatedly edits the phase of one static spectrum.
const contexts = new WeakMap<WaveContext, WeakMap<number[], SpectrumWaves>>();
const preparedOscillators = new WeakSet<CustomOscillator>();
const MAX_CACHED_PHASES = 32;

function getWave(oscillator: CustomOscillator): PeriodicWave {
  let spectra = contexts.get(oscillator.context);
  if (!spectra) {
    spectra = new WeakMap();
    contexts.set(oscillator.context, spectra);
  }
  const partials = oscillator._partials;
  let spectrum = spectra.get(partials);
  // Arrays coming from the app are immutable, but do not serve a stale wave if
  // another caller edits an array in place.
  if (!spectrum || spectrum.coefficients.length !== partials.length
    || !partials.every((value, index) => value === spectrum!.coefficients[index])) {
    spectrum = { coefficients: partials.slice(), phases: new Map() };
    spectra.set(partials, spectrum);
  }
  let wave = spectrum.phases.get(oscillator._phase);
  if (!wave) {
    // Match Tone's custom-wave calculation, allocating only the actual spectrum
    // rather than two 2048-bin arrays for every phase of every modulation tick.
    const length = Math.max(2, partials.length + 1);
    const real = new Float32Array(length);
    const imag = new Float32Array(length);
    for (let harmonic = 1; harmonic <= partials.length; harmonic++) {
      const amplitude = partials[harmonic - 1];
      if (amplitude !== 0) {
        real[harmonic] = -amplitude * Math.sin(oscillator._phase * harmonic);
        imag[harmonic] = amplitude * Math.cos(oscillator._phase * harmonic);
      }
    }
    wave = oscillator.context.createPeriodicWave(real, imag);
    if (spectrum.phases.size >= MAX_CACHED_PHASES) spectrum.phases.clear();
    spectrum.phases.set(oscillator._phase, wave);
  }
  return wave;
}

function supportsSharedWaves(value: unknown): value is CustomOscillator {
  if (!value || typeof value !== 'object') return false;
  const oscillator = value as CustomOscillator;
  const node = oscillator._oscillator;
  return oscillator._type === 'custom' && typeof oscillator._phase === 'number'
    && Array.isArray(oscillator._partials) && '_partialCount' in oscillator && '_wave' in oscillator
    && typeof oscillator._getRealImaginary === 'function' && typeof oscillator._start === 'function'
    && typeof oscillator.context?.createPeriodicWave === 'function'
    && typeof oscillator.context.currentTime === 'number' && typeof oscillator.context.isOffline === 'boolean'
    && (node === null || (typeof node?.setPeriodicWave === 'function'
      && typeof node._startTime === 'number' && typeof node._stopTime === 'number'));
}

/**
 * Tone 15 adapter for modulation of custom/fatcustom oscillators. Its public
 * partials setter scans a global 100-wave cache for every oscillator, including
 * idle pooled voices. Unison voices start at the same phase, then diverge at
 * their individual detuned frequencies. Evenly spaced phases cancel harmonics
 * at zero spread and require a separate native wave for every unison member.
 * Share waves by context, spectrum and the common starting phase instead.
 * Return false when internals differ so the caller can use Tone's public setter.
 */
export function setSharedUnisonPartials(omni: Tone.Synth['oscillator'], partials: number[]): boolean {
  if (!partials.length || partials.length > 2047 || !partials.every(Number.isFinite)) return false;
  const source = (omni as unknown as {
    _sourceType: string;
    _oscillator: CustomOscillator & { _oscillators?: CustomOscillator[] };
  });
  if (source._sourceType !== 'oscillator' && source._sourceType !== 'fat') return false;
  const group = source._oscillator;
  if (source._sourceType === 'fat' && !Number.isFinite(group?._phase)) return false;
  const oscillators = source._sourceType === 'fat' ? group?._oscillators : [group];
  if (!oscillators?.length || !oscillators.every(supportsSharedWaves)) return false;

  // FatOscillator stores its group phase in degrees; child Oscillators store
  // radians. Frequency and detune buses remain independent for every member.
  const unisonPhase = source._sourceType === 'fat' ? group._phase * Math.PI / 180 : undefined;

  for (const oscillator of oscillators) {
    if (!preparedOscillators.has(oscillator)) {
      const start = oscillator._start;
      oscillator._start = function (time) {
        if (this._type === 'custom' && !this._wave) this._wave = getWave(this);
        start.call(this, time);
      };
      preparedOscillators.add(oscillator);
    }
    oscillator._partials = partials;
    oscillator._partialCount = partials.length;
    if (unisonPhase !== undefined) oscillator._phase = unisonPhase;
    const node = oscillator._oscillator;
    // Raw audio time, rather than Tone.now() (which includes lookahead), keeps
    // release tails and nodes scheduled to start in the future up to date.
    // Offline nodes must keep Tone's eager updates for identical rendered PCM.
    if (node && (oscillator.context.isOffline || node._stopTime === -1
      || node._stopTime >= oscillator.context.currentTime)) {
      oscillator._wave = getWave(oscillator);
      node.setPeriodicWave(oscillator._wave);
    } else {
      oscillator._wave = undefined;
    }
  }
  if (source._sourceType === 'fat') {
    group._partials = partials;
    group._partialCount = partials.length;
  }
  return true;
}
