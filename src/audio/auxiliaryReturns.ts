import { curveValue, type AuxiliaryReturn, type ControlValue } from '../domain/development.js';

const gain = (db: number) => db <= -96 ? 0 : 10 ** (db / 20);
/** Private state survives processBlock calls, including fractional delay and feedback filters. */
export function createReturnProcessor(aux: AuxiliaryReturn, sampleRate: number, bpm: number) {
  const secondsPerBeat = 60 / bpm, smoothRate = 1 - Math.exp(-1 / (0.005 * sampleRate));
  const states = aux.chain.map(processor => {
    const delay = processor.type === 'delay';
    const maximumBeats = delay ? Math.max(processor.beats, ...aux.automation.filter(c => c.target === `${processor.id}.beats`)
      .flatMap(c => c.points.map(p => Number(p.value)))) : 0;
    const length = delay ? Math.ceil(maximumBeats * secondsPerBeat * sampleRate) + 2 : 1;
    if (length > 100_000_000) throw new Error('Return delay exceeds supported memory; shorten its delay');
    return { processor, left: new Float32Array(length), right: new Float32Array(length), cursor: 0,
      filterL: 0, filterR: 0, inputL: 0, inputR: 0, smooth: new Map<string, number>() };
  });
  let expectedFrame = 0;
  const value = (target: string, base: ControlValue, beat: number, smoothing: Map<string, number>): ControlValue => {
    let evaluated = base;
    for (const curve of aux.automation) if (curve.target === target) evaluated = curveValue(curve, beat, evaluated);
    if (typeof evaluated !== 'number') return evaluated;
    const previous = smoothing.get(target) ?? evaluated, result = previous + (evaluated - previous) * smoothRate;
    smoothing.set(target, result); return result;
  };
  const levels = new Map<string, number>();
  return {
    processBlock(left: Float32Array, right: Float32Array, startFrame = expectedFrame): [Float32Array, Float32Array] {
      if (startFrame !== expectedFrame || left.length !== right.length) throw new Error('Return blocks must be contiguous stereo frames');
      const outL = new Float32Array(left.length), outR = new Float32Array(right.length);
      for (let i = 0; i < left.length; i++) {
        const beat = (startFrame + i) / sampleRate / secondsPerBeat;
        let l = left[i], r = right[i];
        for (const state of states) {
          const p = state.processor, control = (key: string, base: ControlValue) => value(`${p.id}.${key}`, base, beat, state.smooth);
          if (p.type === 'gain') { const trim = gain(Number(control('gain', p.gain))); l *= trim; r *= trim; }
          else if (p.type === 'saturation') {
            const drive = Number(control('drive', p.drive)), input = 10 ** (drive / 20);
            if (drive > 0) { l = Math.tanh(l * input) / input; r = Math.tanh(r * input) / input; }
          } else if (p.type === 'filter') {
            const frequency = Number(control('frequency', p.frequency)), alpha = 1 - Math.exp(-2 * Math.PI * frequency / sampleRate);
            state.filterL += alpha * (l - state.filterL); state.filterR += alpha * (r - state.filterR);
            const mode = control('mode', p.mode);
            l = mode === 'highpass' ? l - state.filterL : state.filterL; r = mode === 'highpass' ? r - state.filterR : state.filterR;
          } else {
            const delay = Math.max(1, Number(control('beats', p.beats)) * secondsPerBeat * sampleRate);
            const position = (state.cursor - delay + state.left.length * 2) % state.left.length;
            const index = Math.floor(position), frac = position - index, next = (index + 1) % state.left.length;
            const echoL = state.left[index] * (1 - frac) + state.left[next] * frac;
            const echoR = state.right[index] * (1 - frac) + state.right[next] * frac;
            const alpha = 1 - Math.exp(-2 * Math.PI * Number(control('cutoff', p.cutoff)) / sampleRate);
            state.filterL += alpha * (echoL - state.filterL); state.filterR += alpha * (echoR - state.filterR);
            const drive = Number(control('drive', p.drive)), input = 10 ** (drive / 20), feedback = Number(control('feedback', p.feedback));
            const feedbackL = drive > 0 ? Math.tanh(state.filterL * input) / input : state.filterL;
            const feedbackR = drive > 0 ? Math.tanh(state.filterR * input) / input : state.filterR;
            const mode = control('mode', p.mode), mono = (l + r) / 2;
            state.left[state.cursor] = (mode === 'stereo' ? l : mono) + feedback * (mode === 'ping-pong' ? feedbackR : feedbackL);
            state.right[state.cursor] = (mode === 'ping-pong' ? 0 : mode === 'mono' ? mono : r) + feedback * (mode === 'ping-pong' ? feedbackL : feedbackR);
            state.cursor = (state.cursor + 1) % state.left.length;
            l = echoL; r = echoR;
          }
        }
        const level = gain(Number(value('level', aux.level, beat, levels)));
        if (!Number.isFinite(Math.fround(l*level)) || !Number.isFinite(Math.fround(r*level))) throw new Error(`Non-finite audio on return ${aux.name}`);
        outL[i] = l * level; outR[i] = r * level;
      }
      expectedFrame += left.length;
      return [outL, outR];
    },
  };
}
export function auxiliaryTailSeconds(returns: readonly AuxiliaryReturn[], bpm: number): number {
  return Math.max(0, ...returns.map(aux => aux.chain.reduce((sum, p) => {
    if (p.type !== 'delay') return sum;
    const beats = Math.max(p.beats, ...aux.automation.filter(c => c.target === `${p.id}.beats`).flatMap(c => c.points.map(p => Number(p.value))));
    const feedback = Math.max(p.feedback, ...aux.automation.filter(c => c.target === `${p.id}.feedback`).flatMap(c => c.points.map(p => Number(p.value))));
    return sum + beats * 60 / bpm * (feedback <= 0 ? 1 : 1 + Math.ceil(Math.log(1e-5) / Math.log(feedback)));
  }, 0)));
}
