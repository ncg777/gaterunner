import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeModulation } from '../audio/modulation';

test('voice clocks ramp only connected controls, reset removed routes, and preserve generator modulation', async t => {
  class Param {
    ramps = 0; value = 0;
    constructor(options: { value?: number } = {}) { this.value = options.value ?? 0; }
    setValueAtTime(value: number) { this.value = value; return this; }
    linearRampToValueAtTime(value: number) { this.value = value; this.ramps++; return this; }
    cancelAndHoldAtTime() { return this; }
    connect() { return this; }
    dispose() {}
  }
  class Gain { gain = new Param(); connect() { return this; } dispose() {} }
  class Panner { pan = new Param(); connect() { return this; } dispose() {} }
  t.mock.module('tone', { namedExports: { Signal: Param, Gain, Panner, connect() {} } });
  const { VoiceModulation } = await import('../audio/voiceModulation');
  const ticks = new Set<() => void>();
  let now = 0;
  const context = { currentTime: 0, isOffline: false, state: 'running', now: () => now + 0.02,
    on: (_event: string, callback: () => void) => ticks.add(callback), off: (_event: string, callback: () => void) => ticks.delete(callback),
    transport: { state: 'stopped', on() {}, off() {}, bpm: { getValueAtTime: () => 120 } } };
  const filter = { Q: new Param(), gain: new Param(), detune: new Param() };
  const generatorValues: number[] = [];
  const voice = new VoiceModulation(context as never, new Param() as never, filter as never, () => true,
    { write: values => generatorValues.push(values.fmIndex), refresh() {} });
  const settings = normalizeModulation({ sources: [{ id: 'lfo', type: 'lfo', rateHz: 1 }], routes: [
    { source: 'lfo', target: 'pitch', amount: 12 }, { source: 'lfo', target: 'fmIndex', amount: 2 } ] });
  voice.set(settings, 2, 0); voice.attack(0);
  now = 0.1; ticks.forEach(tick => tick());
  assert.ok((voice as any).pitch.ramps > 0);
  assert.equal((voice as any).cutoff.ramps, 0);
  assert.equal((voice.pan.pan as any).ramps, 0);
  assert.equal(filter.Q.ramps, 0); assert.equal(filter.gain.ramps, 0);
  assert.ok(generatorValues.some(value => value !== 0));
  voice.set(normalizeModulation(undefined), 2, 0);
  assert.equal((voice as any).pitch.value, 0);
  assert.equal(ticks.size, 0);
  voice.dispose();
});