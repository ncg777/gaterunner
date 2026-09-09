import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

import {
  createWaveshaperProcessor,
  getWaveshaperHighpassCoefficients,
  lookupTransferCurve,
  TANH_CURVE,
} from '../audio/trackDistortion.js';
import { DEFAULT_WAVESHAPER_SETTINGS, type WaveshaperSettings } from '../audio/waveshaper.js';

function settings(overrides: Partial<WaveshaperSettings> = {}): WaveshaperSettings {
  return {
    ...structuredClone(DEFAULT_WAVESHAPER_SETTINGS),
    enabled: true,
    curve: 'custom',
    expression: 'x',
    customParameters: [],
    inputDriveDb: 0,
    mix: 100,
    dcBlock: false,
    ...overrides,
  };
}

test('legacy tanh preserves every Tone 15 default Float32 sample', () => {
  assert.equal(TANH_CURVE.length, 1024);
  for (let index = 0; index < TANH_CURVE.length; index += 1) {
    assert.equal(TANH_CURVE[index], Math.fround(Math.tanh(index / 1023 * 2 - 1)));
  }
  assert.equal(lookupTransferCurve(TANH_CURVE, 0), 0);
  assert.equal(lookupTransferCurve(TANH_CURVE, 20), TANH_CURVE[1023]);
  assert.equal(lookupTransferCurve(TANH_CURVE, -20), TANH_CURVE[0]);
});

test('lookup clamps endpoints and linearly interpolates asymmetric fixtures', () => {
  const curve = new Float32Array([-1, 0.5, 0, 1, -0.5]);
  for (const [input, expected] of [
    [-2, -1], [-1, -1], [-0.75, -0.25], [-0.5, 0.5],
    [-0.25, 0.25], [0, 0], [0.25, 0.5], [0.5, 1], [0.75, 0.25], [1, -0.5], [2, -0.5],
  ]) {
    assert.equal(lookupTransferCurve(curve, input), expected);
  }
  assert.equal(lookupTransferCurve(new Float32Array([0.25, 0.75]), 0), 0.5);
});

test('lookup has finite fallbacks for non-finite inputs and corrupt tables', () => {
  assert.equal(lookupTransferCurve(TANH_CURVE, Infinity), TANH_CURVE[1023]);
  assert.equal(lookupTransferCurve(TANH_CURVE, -Infinity), TANH_CURVE[0]);
  assert.equal(lookupTransferCurve(TANH_CURVE, NaN), 0);
  assert.equal(lookupTransferCurve(new Float32Array([NaN, Infinity]), 0), 0);
  assert.equal(lookupTransferCurve(new Float32Array(), 3), 3);
});

test('disabled, zero mix and invalid expressions are exact identities', () => {
  for (const overrides of [
    { enabled: false }, { mix: 0 }, { expression: 'sqrt(-1)' }, { expression: 'sin(' },
  ]) {
    const process = createWaveshaperProcessor(settings({ ...overrides, dcBlock: true, inputDriveDb: 36 }), 48000);
    for (const input of [-20, -1, -0, 0, 0.5, 1, 20, NaN, Infinity, -Infinity]) {
      assert.ok(Object.is(process(input), input));
    }
  }
});

test('drive only affects the wet path and the mix is linear', () => {
  const process = createWaveshaperProcessor(settings({ inputDriveDb: 20 * Math.log10(2), mix: 25 }), 48000);
  assert.equal(process(0.25), 0.3125);
  assert.equal(process(4), 3.25);
  assert.equal(process(-4), -3.25);
});

test('identity LUT clamps high input while asymmetric curves process silence', () => {
  const identity = createWaveshaperProcessor(settings(), 48000);
  assert.equal(identity(4), 1);
  assert.equal(identity(-4), -1);
  assert.equal(identity(0), 0);
  const bias = createWaveshaperProcessor(settings({ expression: '0.5' }), 48000);
  assert.equal(bias(0), 0.5);
});

test('DC blocker uses shared Butterworth coefficients and rejects steady bias', () => {
  for (const sampleRate of [22050, 44100, 48000, 96000]) {
    const coefficients = getWaveshaperHighpassCoefficients(sampleRate);
    assert.equal(coefficients.frequency, 10);
    assert.equal(coefficients.q, Math.SQRT1_2);
    assert.ok(Math.abs(Math.pow(10, coefficients.qDb / 20) - coefficients.q) < 1e-15);
    const process = createWaveshaperProcessor(settings({ expression: '0.5', dcBlock: true }), sampleRate);
    assert.equal(process(0), 0.5 * coefficients.b0);
    let output = 0;
    for (let frame = 1; frame < sampleRate; frame += 1) output = process(0);
    assert.ok(Math.abs(output) < 1e-8, `${sampleRate}: ${output}`);
  }
});

test('DC filter matches a direct-form cookbook impulse response', () => {
  const process = createWaveshaperProcessor(settings({ dcBlock: true }), 48000);
  const coefficients = getWaveshaperHighpassCoefficients(48000);
  let input1 = 0;
  let input2 = 0;
  let output1 = 0;
  let output2 = 0;
  for (let frame = 0; frame < 4096; frame += 1) {
    const input = frame === 0 ? 1 : 0;
    const expected = coefficients.b0 * input + coefficients.b1 * input1 + coefficients.b2 * input2
      - coefficients.a1 * output1 - coefficients.a2 * output2;
    assert.ok(Math.abs(process(input) - expected) < 1e-12);
    input2 = input1;
    input1 = input;
    output2 = output1;
    output1 = expected;
  }
});

test('DC filtering is wet-only and processor state is independent per channel', () => {
  const mixed = createWaveshaperProcessor(settings({ expression: '0.5', dcBlock: true, mix: 25 }), 48000);
  let output = 0;
  for (let frame = 0; frame < 48000; frame += 1) output = mixed(4);
  assert.ok(Math.abs(output - 3) < 1e-8);
  const left = createWaveshaperProcessor(settings({ dcBlock: true }), 48000);
  const right = createWaveshaperProcessor(settings({ dcBlock: true }), 48000);
  left(1);
  assert.notEqual(left(0), 0);
  assert.equal(right(0), 0);
});

test('active processors guard non-finite values and recover without poisoned state', () => {
  const process = createWaveshaperProcessor(settings({ dcBlock: true, inputDriveDb: Infinity }), NaN);
  for (const input of [NaN, Infinity, -Infinity, Number.MAX_VALUE, -Number.MAX_VALUE, 0, 0.25]) {
    assert.ok(Number.isFinite(process(input)));
  }
  process(NaN);
  assert.equal(process(0), 0);
  assert.equal(createWaveshaperProcessor(settings({ mix: NaN }), 48000)(4), 4);
});

test('processor captures settings for a render instead of following later mutations', () => {
  const source = settings({ expression: '0.5' });
  const process = createWaveshaperProcessor(source, 48000);
  source.dcBlock = true;
  source.mix = 0;
  assert.equal(process(0), 0.5);
});

test('native adapter lifecycle with a deterministic audio clock', {
  skip: typeof mock.module !== 'function' && 'Requires --experimental-test-module-mocks',
}, async suite => {
  class Parameter {
    value = 1;
    events: { kind: string; value?: number; time: number }[] = [];
    cancelScheduledValues(time: number) { this.events.push({ kind: 'cancel', time }); }
    setValueAtTime(value: number, time: number) {
      this.value = value;
      this.events.push({ kind: 'set', value, time });
    }
    linearRampToValueAtTime(value: number, time: number) {
      this.events.push({ kind: 'ramp', value, time });
    }
  }
  class AudioNode {
    connections: unknown[] = [];
    disconnected = false;
    connect(destination: unknown) { this.connections.push(destination); }
    disconnect() { this.connections = []; this.disconnected = true; }
  }
  class Gain extends AudioNode {
    gain = new Parameter();
    dispose() { this.disconnect(); }
  }
  class Shaper extends AudioNode {
    curve: Float32Array | null = null;
    oversample = 'unset';
  }
  class Filter extends AudioNode {
    constructor(public feedforward: number[], public feedback: number[]) { super(); }
  }
  class AudioContext {
    time = 0;
    sampleRate = 48000;
    nextId = 0;
    timers = new Map<number, { callback: () => void; time: number }>();
    shapers: Shaper[] = [];
    constructor(public isOffline = false) {}
    immediate() { return this.time; }
    createGain() { return new Gain(); }
    createIIRFilter(feedforward: number[], feedback: number[]) { return new Filter(feedforward, feedback); }
    createWaveShaper() {
      const shaper = new Shaper();
      this.shapers.push(shaper);
      return shaper;
    }
    setTimeout(callback: () => void, seconds: number) {
      const id = ++this.nextId;
      this.timers.set(id, { callback, time: this.time + seconds });
      return id;
    }
    clearTimeout(id: number) { this.timers.delete(id); }
    advance(time: number) {
      for (;;) {
        const next = [...this.timers.entries()].sort((left, right) => left[1].time - right[1].time)[0];
        if (!next || next[1].time > time) break;
        this.time = next[1].time;
        this.timers.delete(next[0]);
        next[1].callback();
      }
      this.time = time;
    }
  }
  let currentContext = new AudioContext();
  const toneMock = mock.module('tone', {
    namedExports: {
      Gain,
      getContext: () => currentContext,
      connect: (source: AudioNode, destination: unknown) => source.connect(destination),
    },
  });
  try {
    const { createWaveshaperAudioChain, updateWaveshaperAudioChain, disposeWaveshaperAudioChain } =
      await import('../audio/waveshaperEffect.js');

    await suite.test('offline settings apply synchronously with all nodes allocated and no timers', () => {
      currentContext = new AudioContext(true);
      const chain = createWaveshaperAudioChain(settings());
      assert.equal(currentContext.shapers.length, 2);
      assert.equal(currentContext.timers.size, 0);
      assert.equal(chain.shapers[0].oversample, 'none');
      assert.equal(chain.shapers[1].oversample, 'none');
      assert.equal(chain.curve?.[4096], 1);
      updateWaveshaperAudioChain(chain, settings({ expression: '-x', mix: 25, dcBlock: true }));
      assert.equal(chain.curve?.[4096], -1);
      assert.equal(chain.shapers[0].curve?.[4096], -1);
      assert.equal(chain.shapers[1].curve?.[4096], -1);
      assert.equal(chain.wet.gain.value, 0.25);
      assert.equal(chain.dry.gain.value, 0.75);
      const coefficients = getWaveshaperHighpassCoefficients(currentContext.sampleRate);
      assert.ok(chain.dcFilter instanceof Filter);
      assert.deepEqual(chain.dcFilter.feedforward, [coefficients.b0, coefficients.b1, coefficients.b2]);
      assert.deepEqual(chain.dcFilter.feedback, [1, coefficients.a1, coefficients.a2]);
      assert.equal(currentContext.timers.size, 0);
      assert.equal(chain.ramps.size, 0);
      disposeWaveshaperAudioChain(chain);
    });

    await suite.test('live curve changes are latest-only with a fixed 75ms deadline', () => {
      currentContext = new AudioContext();
      const chain = createWaveshaperAudioChain(settings());
      const original = chain.shapers[0].curve;
      updateWaveshaperAudioChain(chain, settings({ expression: 'x*x' }));
      const deadline = chain.pendingDeadline;
      currentContext.advance(0.05);
      updateWaveshaperAudioChain(chain, settings({ expression: '-x' }));
      assert.equal(chain.pendingDeadline, deadline);
      assert.equal(chain.shapers[0].curve, original);
      assert.equal(chain.shapers[1].curve?.[4096], 1);
      assert.equal(currentContext.timers.size, 1);
      currentContext.advance(0.075);
      assert.equal(chain.activeIndex, 1);
      assert.equal(chain.shapers[1].curve?.[4096], -1);
      assert.equal(chain.shapers[0].curve, original);
      assert.ok(Math.abs((chain.transitionEnd ?? 0) - 0.085) < 1e-12);
      currentContext.advance(0.086);
      assert.equal(chain.transitionEnd, null);
      assert.equal(chain.fades[0].gain.value, 0);
      assert.equal(chain.fades[1].gain.value, 1);
      disposeWaveshaperAudioChain(chain);
    });

    await suite.test('updates during a fade do not overwrite either audible curve', () => {
      currentContext = new AudioContext();
      const chain = createWaveshaperAudioChain(settings());
      updateWaveshaperAudioChain(chain, settings({ expression: '-x' }));
      currentContext.advance(0.075);
      const tables = chain.shapers.map(shaper => shaper.curve);
      currentContext.advance(0.08);
      updateWaveshaperAudioChain(chain, settings({ expression: '0.5' }));
      updateWaveshaperAudioChain(chain, settings({ expression: '0.25' }));
      assert.equal(chain.shapers[0].curve, tables[0]);
      assert.equal(chain.shapers[1].curve, tables[1]);
      assert.equal(currentContext.shapers.length, 2);
      assert.ok(currentContext.timers.size <= 2);
      currentContext.advance(0.156);
      assert.equal(chain.curve?.[2048], 0.25);
      assert.equal(chain.shapers[0].curve?.[2048], 0.25);
      disposeWaveshaperAudioChain(chain);
    });

    await suite.test('invalid expressions bypass immediately and cancel stale work', () => {
      currentContext = new AudioContext();
      const chain = createWaveshaperAudioChain(settings());
      updateWaveshaperAudioChain(chain, settings({ expression: '-x' }));
      currentContext.advance(0.075);
      updateWaveshaperAudioChain(chain, settings({ expression: 'x*x' }));
      updateWaveshaperAudioChain(chain, settings({ expression: 'sqrt(-1)' }));
      assert.equal(chain.curve, null);
      assert.ok(chain.error);
      assert.equal(chain.dry.gain.value, 1);
      assert.equal(chain.wet.gain.value, 0);
      assert.equal(currentContext.timers.size, 0);
      currentContext.advance(1);
      assert.equal(chain.curve, null);
      updateWaveshaperAudioChain(chain, settings({ expression: '0.5' }));
      assert.equal(chain.wet.gain.value, 0);
      currentContext.advance(1.076);
      assert.equal(chain.curve?.[2048], 0.5);
      disposeWaveshaperAudioChain(chain);
    });

    await suite.test('metadata and unrelated parameters do not rebuild tables or reset ramps', () => {
      currentContext = new AudioContext();
      const source = settings({ expression: 'k*x', customParameters: [{ name: 'k', value: 1, min: 0, max: 2, step: 0.01 }] });
      const chain = createWaveshaperAudioChain(source);
      const table = chain.shapers[0].curve;
      updateWaveshaperAudioChain(chain, { ...source, mix: 50 });
      const ramp = chain.ramps.get(chain.wet.gain);
      updateWaveshaperAudioChain(chain, {
        ...source,
        mix: 50,
        customParameters: [{ name: 'k', value: 1, min: -2, max: 4, step: 0.1 }],
        builtinParameters: { 'sine-fold': { k: 8 } },
      });
      assert.equal(chain.shapers[0].curve, table);
      assert.equal(chain.ramps.get(chain.wet.gain), ramp);
      assert.equal(chain.pendingCurve, null);
      assert.equal(currentContext.timers.size, 0);
      disposeWaveshaperAudioChain(chain);
    });

    await suite.test('drive, mix and bypass use 10ms ramps without curve work', () => {
      currentContext = new AudioContext();
      const chain = createWaveshaperAudioChain(settings());
      updateWaveshaperAudioChain(chain, settings({ inputDriveDb: 6, mix: 50 }));
      assert.equal(chain.ramps.get(chain.wet.gain)?.to, 0.5);
      assert.equal(chain.ramps.get(chain.dry.gain)?.to, 0.5);
      assert.equal(chain.ramps.get(chain.drive.gain)?.to, Math.pow(10, 6 / 20));
      assert.equal(chain.ramps.get(chain.wet.gain)?.end, 0.01);
      currentContext.advance(0.005);
      updateWaveshaperAudioChain(chain, settings({ enabled: false }));
      assert.equal(chain.ramps.get(chain.wet.gain)?.from, 0.75);
      assert.equal(chain.ramps.get(chain.wet.gain)?.to, 0);
      assert.equal(chain.ramps.get(chain.dry.gain)?.to, 1);
      assert.equal(currentContext.timers.size, 0);
      assert.equal(currentContext.shapers.length, 2);
      disposeWaveshaperAudioChain(chain);
    });

    await suite.test('context swaps and disposal cannot redirect or resurrect callbacks', () => {
      currentContext = new AudioContext();
      const owner = currentContext;
      const chain = createWaveshaperAudioChain(settings());
      currentContext = new AudioContext(true);
      updateWaveshaperAudioChain(chain, settings({ expression: '-x' }));
      assert.equal(owner.timers.size, 1);
      assert.equal(currentContext.timers.size, 0);
      owner.advance(0.075);
      assert.equal(chain.curve?.[4096], -1);
      updateWaveshaperAudioChain(chain, settings({ expression: '0.5' }));
      const callbacks = [...owner.timers.values()].map(timer => timer.callback);
      disposeWaveshaperAudioChain(chain);
      disposeWaveshaperAudioChain(chain);
      assert.equal(owner.timers.size, 0);
      callbacks.forEach(callback => callback());
      updateWaveshaperAudioChain(chain, settings());
      assert.equal(owner.timers.size, 0);
      assert.equal(currentContext.timers.size, 0);
      assert.equal(chain.curve, null);
      assert.ok(owner.shapers.every(shaper => shaper.disconnected && shaper.curve === null));
    });
  } finally {
    toneMock.restore();
  }
});