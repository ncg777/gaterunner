import { markRaw } from 'vue';
import * as Tone from 'tone';

import { getWaveshaperHighpassCoefficients, getWaveshaperLevels } from './trackDistortion.js';
import { resolveWaveshaperCurve, type WaveshaperSettings } from './waveshaper.js';

const RAMP_SECONDS = 0.01;
const CURVE_DELAY_SECONDS = 0.075;

interface GainRamp {
  from: number;
  to: number;
  start: number;
  end: number;
}

export interface WaveshaperAudioChain {
  input: Tone.Gain;
  output: Tone.Gain;
  context: ReturnType<typeof Tone.getContext>;
  dry: GainNode;
  drive: GainNode;
  wet: GainNode;
  shaped: GainNode;
  dcFilter: IIRFilterNode;
  dcFiltered: GainNode;
  dcDirect: GainNode;
  shapers: [WaveShaperNode, WaveShaperNode];
  fades: [GainNode, GainNode];
  activeIndex: 0 | 1;
  curve: Float32Array | null;
  error: string | null;
  curveSignature: string | null;
  controlSignature: string | null;
  controls: { enabled: boolean; drive: number; mix: number; dcBlock: boolean };
  ramps: Map<AudioParam, GainRamp>;
  pendingCurve: Float32Array | null;
  pendingDeadline: number;
  debounceTimer: number | null;
  transitionTimer: number | null;
  transitionEnd: number | null;
  initialized: boolean;
  disposed: boolean;
}

function curveSignature(settings: WaveshaperSettings): string {
  const parameters = settings.curve === 'custom'
    ? settings.customParameters.map(parameter => [parameter.name, parameter.value] as const)
    : Object.entries(settings.builtinParameters[settings.curve] ?? {});
  parameters.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return JSON.stringify([settings.curve, settings.curve === 'custom' ? settings.expression : '', parameters]);
}

function sameCurve(left: Float32Array | null, right: Float32Array): boolean {
  return left === right || !!left && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function setGain(chain: WaveshaperAudioChain, parameter: AudioParam, value: number, immediate: boolean) {
  const now = chain.context.immediate();
  const previous = chain.ramps.get(parameter);
  const progress = previous ? Math.max(0, Math.min(1, (now - previous.start) / (previous.end - previous.start))) : 1;
  const current = previous ? previous.from + (previous.to - previous.from) * progress : parameter.value;
  parameter.cancelScheduledValues(chain.context.isOffline ? 0 : now);
  if (immediate || chain.context.isOffline) {
    parameter.value = value;
    parameter.setValueAtTime(value, chain.context.isOffline ? 0 : now);
    chain.ramps.delete(parameter);
  } else {
    parameter.setValueAtTime(current, now);
    parameter.linearRampToValueAtTime(value, now + RAMP_SECONDS);
    chain.ramps.set(parameter, { from: current, to: value, start: now, end: now + RAMP_SECONDS });
  }
}

function applyControls(chain: WaveshaperAudioChain, immediate: boolean) {
  const { enabled, drive, mix, dcBlock } = chain.controls;
  const wetMix = enabled && chain.curve && !chain.error ? mix : 0;
  const signature = JSON.stringify([drive, wetMix, dcBlock]);
  if (signature === chain.controlSignature && !immediate) return;
  chain.controlSignature = signature;
  setGain(chain, chain.drive.gain, drive, immediate);
  setGain(chain, chain.dry.gain, 1 - wetMix, immediate);
  setGain(chain, chain.wet.gain, wetMix, immediate);
  setGain(chain, chain.dcFiltered.gain, dcBlock ? 1 : 0, immediate);
  setGain(chain, chain.dcDirect.gain, dcBlock ? 0 : 1, immediate);
}

function cancelPending(chain: WaveshaperAudioChain) {
  if (chain.debounceTimer !== null) chain.context.clearTimeout(chain.debounceTimer);
  chain.debounceTimer = null;
  chain.pendingCurve = null;
}

function settleTransition(chain: WaveshaperAudioChain) {
  if (chain.transitionTimer !== null) chain.context.clearTimeout(chain.transitionTimer);
  chain.transitionTimer = null;
  chain.transitionEnd = null;
  setGain(chain, chain.fades[chain.activeIndex].gain, 1, true);
  setGain(chain, chain.fades[chain.activeIndex === 0 ? 1 : 0].gain, 0, true);
}

function schedulePending(chain: WaveshaperAudioChain) {
  if (chain.disposed || !chain.pendingCurve || chain.debounceTimer !== null) return;
  const deadline = Math.max(chain.pendingDeadline, chain.transitionEnd ?? 0);
  chain.debounceTimer = chain.context.setTimeout(() => {
    chain.debounceTimer = null;
    if (chain.disposed || !chain.pendingCurve) return;
    if (chain.context.immediate() < deadline) {
      schedulePending(chain);
      return;
    }
    const curve = chain.pendingCurve;
    chain.pendingCurve = null;
    if (chain.transitionEnd !== null) settleTransition(chain);
    if (sameCurve(chain.curve, curve)) return;
    const previousIndex = chain.activeIndex;
    const nextIndex = previousIndex === 0 ? 1 : 0;
    chain.shapers[nextIndex].curve = Float32Array.from(curve);
    setGain(chain, chain.fades[nextIndex].gain, 0, true);
    setGain(chain, chain.fades[nextIndex].gain, 1, false);
    setGain(chain, chain.fades[previousIndex].gain, 0, false);
    chain.activeIndex = nextIndex;
    chain.curve = curve;
    chain.transitionEnd = chain.context.immediate() + RAMP_SECONDS;
    applyControls(chain, false);
    scheduleTransitionEnd(chain);
  }, Math.max(0, deadline - chain.context.immediate()));
}

function scheduleTransitionEnd(chain: WaveshaperAudioChain) {
  const end = chain.transitionEnd;
  if (chain.disposed || end === null) return;
  chain.transitionTimer = chain.context.setTimeout(() => {
    chain.transitionTimer = null;
    if (chain.disposed) return;
    if (chain.context.immediate() < end) {
      scheduleTransitionEnd(chain);
      return;
    }
    settleTransition(chain);
    schedulePending(chain);
  }, Math.max(0, end - chain.context.immediate()));
}

export function createWaveshaperAudioChain(settings: WaveshaperSettings): WaveshaperAudioChain {
  const context = Tone.getContext();
  const input = markRaw(new Tone.Gain({ context, gain: 1 }));
  const output = markRaw(new Tone.Gain({ context, gain: 1 }));
  const dry = context.createGain();
  const drive = context.createGain();
  const wet = context.createGain();
  const shaped = context.createGain();
  const coefficients = getWaveshaperHighpassCoefficients(context.sampleRate);
  const dcFilter = context.createIIRFilter(
    [coefficients.b0, coefficients.b1, coefficients.b2],
    [1, coefficients.a1, coefficients.a2],
  );
  const dcFiltered = context.createGain();
  const dcDirect = context.createGain();
  const shapers: [WaveShaperNode, WaveShaperNode] = [context.createWaveShaper(), context.createWaveShaper()];
  const fades: [GainNode, GainNode] = [context.createGain(), context.createGain()];
  input.connect(dry);
  input.connect(drive);
  Tone.connect(dry, output);
  shapers.forEach((shaper, index) => {
    shaper.oversample = 'none';
    drive.connect(shaper);
    shaper.connect(fades[index]);
    fades[index].connect(shaped);
  });
  shaped.connect(dcFilter);
  dcFilter.connect(dcFiltered);
  dcFiltered.connect(wet);
  shaped.connect(dcDirect);
  dcDirect.connect(wet);
  Tone.connect(wet, output);
  const chain: WaveshaperAudioChain = markRaw({
    input, output, context, dry, drive, wet, shaped, dcFilter, dcFiltered, dcDirect, shapers, fades,
    activeIndex: 0,
    curve: null,
    error: null,
    curveSignature: null,
    controlSignature: null,
    controls: { enabled: false, drive: 1, mix: 0, dcBlock: false },
    ramps: new Map(),
    pendingCurve: null,
    pendingDeadline: 0,
    debounceTimer: null,
    transitionTimer: null,
    transitionEnd: null,
    initialized: false,
    disposed: false,
  });
  settleTransition(chain);
  updateWaveshaperAudioChain(chain, settings);
  return chain;
}

export function updateWaveshaperAudioChain(chain: WaveshaperAudioChain, settings: WaveshaperSettings): void {
  if (chain.disposed) return;
  const immediate = !chain.initialized || chain.context.isOffline;
  chain.controls = { ...getWaveshaperLevels(settings), enabled: settings.enabled, dcBlock: settings.dcBlock };
  const signature = curveSignature(settings);
  let invalidated = false;
  if (signature !== chain.curveSignature) {
    chain.curveSignature = signature;
    const { curve, error } = resolveWaveshaperCurve(settings);
    chain.error = error;
    if (!curve || error) {
      cancelPending(chain);
      settleTransition(chain);
      chain.curve = null;
      invalidated = true;
    } else if (immediate) {
      cancelPending(chain);
      chain.activeIndex = 0;
      settleTransition(chain);
      chain.shapers.forEach(shaper => { shaper.curve = Float32Array.from(curve); });
      chain.curve = curve;
    } else if (sameCurve(chain.curve, curve)) {
      cancelPending(chain);
    } else {
      if (!chain.pendingCurve) chain.pendingDeadline = chain.context.immediate() + CURVE_DELAY_SECONDS;
      chain.pendingCurve = curve;
      schedulePending(chain);
    }
  }
  applyControls(chain, immediate || invalidated);
  chain.initialized = true;
}

export function disposeWaveshaperAudioChain(chain: WaveshaperAudioChain): void {
  if (chain.disposed) return;
  chain.disposed = true;
  cancelPending(chain);
  if (chain.transitionTimer !== null) chain.context.clearTimeout(chain.transitionTimer);
  chain.transitionTimer = null;
  chain.transitionEnd = null;
  for (const parameter of chain.ramps.keys()) parameter.cancelScheduledValues(chain.context.immediate());
  chain.ramps.clear();
  chain.input.dispose();
  chain.output.dispose();
  for (const node of [chain.dry, chain.drive, chain.wet, chain.shaped, chain.dcFilter,
    chain.dcFiltered, chain.dcDirect, ...chain.shapers, ...chain.fades]) node.disconnect();
  chain.shapers.forEach(shaper => { shaper.curve = null; });
  chain.curve = null;
}