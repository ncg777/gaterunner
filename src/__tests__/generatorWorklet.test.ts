import assert from 'node:assert/strict';
import test from 'node:test';
import { GeneratorDSP } from '../audio/generatorDSP';
import { GENERATOR_MODES, GENERATOR_MODULATION, normalizeGeneratorEngines } from '../audio/generatorSettings';

test('generator worklets skip silent quanta and preserve sample-accurate sound and events', async () => {
  let Processor: any;
  const globals = globalThis as any;
  globals.sampleRate = 48000; globals.currentFrame = 0;
  globals.AudioWorkletProcessor = class { port = { onmessage: undefined, postMessage() {} }; };
  globals.registerProcessor = (_name: string, implementation: unknown) => { Processor = implementation; };
  try {
    await import('../audio/generator.worklet');
    for (const mode of GENERATOR_MODES.filter(mode => mode !== 'granular')) {
      const settings = normalizeGeneratorEngines({});
      const processor = new Processor({ processorOptions: { mode, settings } });
      const source = new GeneratorDSP(mode, settings, 48000);
      let pitchReads = 0;
      const pitch = new Proxy(new Float32Array(128).fill(110), { get(target, key) {
        if (typeof key === 'string' && /^\d+$/.test(key)) pitchReads++;
        return Reflect.get(target, key, target);
      } });
      const parameters = Object.fromEntries(Object.keys(GENERATOR_MODULATION).map(key => [key, new Float32Array([0])]));
      const out = new Float32Array(128).fill(1);
      globals.currentFrame = 0;
      processor.process([[pitch], [new Float32Array(128)]], [[out]], parameters);
      assert.equal(pitchReads, 0, `${mode}: idle source must not evaluate pitch`);
      assert.ok(out.every(value => value === 0));
      const attack = 151, release = 345, stop = 480;
      for (const event of [{ type: 'attack', frame: attack }, { type: 'release', frame: release, stop }]) processor.port.onmessage({ data: event });
      for (let frame = 128; frame < 640; frame += 128) {
        globals.currentFrame = frame;
        processor.process([[pitch], [new Float32Array(128)]], [[out]], parameters);
        for (let i = 0; i < 128; i++) {
          const at = frame + i;
          if (at === attack) source.attack(220);
          const expected = at >= attack && at < stop ? Math.fround(source.sample(220, (at - attack) / 48000,
            at < release ? Infinity : (release - attack) / 48000)) : 0;
          assert.equal(out[i], expected, `${mode}: frame ${at}`);
        }
      }
      const reads = pitchReads;
      globals.currentFrame = 640;
      processor.process([[pitch], [new Float32Array(128)]], [[out]], parameters);
      assert.equal(pitchReads, reads, `${mode}: released source must return to the idle path`);
    }
  } finally {
    for (const key of ['sampleRate', 'currentFrame', 'AudioWorkletProcessor', 'registerProcessor']) delete globals[key];
  }
});
