import assert from 'node:assert/strict';
import test from 'node:test';
import { GeneratorInputGate } from '../audio/generatorInputGate';

function fixture(isOffline = false) {
  let now = 0, id = 0, connects = 0, disconnects = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const gate = new GeneratorInputGate({ get currentTime() { return now; }, isOffline,
    setTimeout(callback, delay) { const key = ++id; timers.set(key, { at: now + delay, callback }); return key; },
    clearTimeout(key) { timers.delete(key); } }, () => connects++, () => disconnects++);
  return { gate, timers, get connects() { return connects; }, get disconnects() { return disconnects; },
    advance(end: number) { for (;;) { const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break; now = next[1].at; timers.delete(next[0]); next[1].callback(); } now = end; } };
}

test('generator input graphs sleep only after the raw audio release and reconnect for reuse', () => {
  const f = fixture(); assert.equal(f.gate.awake, false);
  f.gate.attack(0.4, false); f.gate.release(0.6, 0.3);
  f.advance(0.89); assert.equal(f.disconnects, 0);
  f.advance(1.1); assert.equal(f.disconnects, 1); assert.equal(f.gate.awake, false);
  f.gate.attack(1.5, false); assert.equal(f.connects, 2);
  f.gate.release(1.7, 0.1); f.advance(2); assert.equal(f.disconnects, 2);
});

test('future reservations and mono gaps retain their pitch inputs and phase state', () => {
  const f = fixture(); f.gate.attack(0, false); f.gate.release(0.1, 0.1);
  f.gate.attack(1, false); f.gate.release(1.1, 0.1);
  f.advance(0.8); assert.equal(f.disconnects, 0);
  f.advance(1.3); assert.equal(f.disconnects, 1);
  f.gate.attack(1.4, true); f.gate.release(1.6, 0.1);
  f.advance(3); assert.equal(f.disconnects, 1);
  f.gate.reset(3.4); f.advance(3.3); assert.equal(f.disconnects, 1);
  f.advance(3.6); assert.equal(f.disconnects, 2);
});

test('offline graphs stay connected, one-shot ends sleep, and disposal cancels timers', () => {
  const offline = fixture(true); offline.gate.attack(0, false); offline.gate.release(0.1, 0.1);
  offline.advance(2); assert.equal(offline.disconnects, 0); assert.equal(offline.timers.size, 0); offline.gate.dispose();
  const live = fixture(); live.gate.attack(0, false, 0.2); live.advance(0.4); assert.equal(live.disconnects, 1);
  live.gate.attack(1, false); live.gate.release(2, 1); live.gate.dispose(); assert.equal(live.timers.size, 0);
});