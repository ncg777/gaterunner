// Run from the repository root: node cli/benchHotspots.mjs
// Transpile these dependency-free function bodies in memory; no child compiler.
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { cpus } from 'node:os';
import ts from 'typescript';

async function loadTs(source) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { getRealtimePartialSpectrumGain } = await loadTs(readFileSync('src/audio/partialSpectrumGain.ts', 'utf8'));
const source = readFileSync('cli/partialOscillator.ts', 'utf8');
const start = source.indexOf('const TABLE_SIZE');
const end = source.indexOf('/** Waveform and procedural');
assert(start >= 0 && end > start);
const { preparePartialSpectrumOscillator, prepareModulatedSpectrumOscillator } = await loadTs(source.slice(start, end));

function timed(fn) {
  const start = performance.now();
  const result = fn();
  return { milliseconds: performance.now() - start, result };
}
function legacyGain(spectrum) {
  let peak = 0;
  for (let sample = 0; sample < 4099; sample++) {
    let value = 0;
    for (let index = 0; index < spectrum.length; index++) {
      value += spectrum[index] * Math.sin(2 * Math.PI * (index + 1) * sample / 4099);
    }
    peak = Math.max(peak, Math.abs(value));
  }
  return peak;
}
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model }));
const spectra = Array.from({ length: 90 }, (_, tick) => Array.from({ length: 128 }, (_, index) => (
  index % 2 === 0 ? 0 : Math.sin((tick + 1) * (index + 1)) / (index + 1)
)));
// Warm basis construction separately; distinct copies prevent peak-cache hits.
const setup = timed(() => getRealtimePartialSpectrumGain(spectra[0]));
const beforeGain = timed(() => spectra.map(legacyGain));
const afterGain = timed(() => spectra.map(spectrum => getRealtimePartialSpectrumGain(spectrum.slice())));
assert.deepEqual(afterGain.result, beforeGain.result);
console.log(JSON.stringify({ experiment: '90 changing 128-partial spectra',
  baselineMs: beforeGain.milliseconds, optimizedMs: afterGain.milliseconds,
  setupMs: setup.milliseconds, exactlyEqual: true,
}));

const harmonics = [1, 2, 3, 4, 6, 8, 10, 12, 16];
const oscillatorSpectra = Array.from({ length: 128 }, (_, block) => Array.from({ length: 16 }, (_, index) => (
  harmonics.includes(index + 1) ? (1 + Math.sin((block + 1) * (index + 1))) / 18 : 0
)));
function render(prepare) {
  return oscillatorSpectra.flatMap((spectrum, block) => {
    const oscillator = prepare(spectrum, `hotspot-${block}`);
    return Array.from({ length: 64 }, (_, sample) => oscillator(
      (block * 64 + sample) * 137.2 / 48000, [110, 1100, 4000][block % 3], 48000,
    ));
  });
}
const beforeOscillator = timed(() => render(preparePartialSpectrumOscillator));
// Include cold harmonic-table construction in this timing.
const afterOscillator = timed(() => render(prepareModulatedSpectrumOscillator));
assert.deepEqual(afterOscillator.result, beforeOscillator.result);
console.log(JSON.stringify({ experiment: '128 changing 64-frame tonewheel blocks',
  baselineMs: beforeOscillator.milliseconds, optimizedMs: afterOscillator.milliseconds,
  exactlyEqual: true,
}));
