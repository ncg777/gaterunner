// Measure Chrome's audio-rendering load using a disposable browser profile.
// PROFILE_PRESET points to a single-preset export; no user browser data is read.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

if (!process.env.PROFILE_PRESET) throw new Error('Set PROFILE_PRESET to a preset JSON file');
const input = JSON.parse(readFileSync(process.env.PROFILE_PRESET, 'utf8'));
const preset = input.preset?.data ?? input.data ?? input;
const output = resolve(process.env.PROFILE_OUTPUT ?? 'dist/live-audio-profile');
mkdirSync(output, { recursive: true });
const duration = Number(process.env.PROFILE_SECONDS ?? 12);
const warmup = Number(process.env.PROFILE_WARMUP ?? 4);
const cases = (process.env.PROFILE_CASES ?? 'full,no-reverb,no-shapers,no-effects,first-track').split(',');
const browser = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '3198', '--strictPort'], { windowsHide: true, stdio: 'ignore' });
let chrome, socket;
const results = [];
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch('http://127.0.0.1:3198/gaterunner/')).ok) break; } catch {}
    if (i === 120) throw new Error('Vite startup failed');
    await delay(250);
  }
  chrome = spawn(browser, ['--headless=new', '--remote-debugging-port=9398',
    `--user-data-dir=${output}/chrome`, '--no-first-run', '--disable-background-networking',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--mute-audio',
    '--autoplay-policy=no-user-gesture-required', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let page;
  for (let i = 0; ; i++) {
    try { page = await (await fetch('http://127.0.0.1:9398/json/new?about:blank', { method: 'PUT' })).json(); break; } catch {}
    if (i === 120) throw new Error('Chrome startup failed');
    await delay(250);
  }
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map(), contexts = new Map(), nodes = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data), p = message.params;
    if (message.method === 'Runtime.exceptionThrown') console.error(JSON.stringify(p));
    if (message.method === 'WebAudio.contextCreated' || message.method === 'WebAudio.contextChanged') contexts.set(p.context.contextId, p.context);
    if (message.method === 'WebAudio.contextWillBeDestroyed') contexts.delete(p.contextId);
    if (message.method === 'WebAudio.audioNodeCreated') nodes.set(p.node.nodeId, p.node);
    if (message.method === 'WebAudio.audioNodeWillBeDestroyed') nodes.delete(p.nodeId);
    const request = pending.get(message.id);
    if (request) { pending.delete(message.id); message.error ? request.reject(message.error) : request.resolve(message.result); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 180000 });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await send('Runtime.enable'); await send('WebAudio.enable'); await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['*fonts.googleapis.com*', '*fonts.gstatic.com*'] });
  for (const variant of cases) {
    await send('Page.navigate', { url: 'about:blank' });
    for (let i = 0; await evaluate('location.href') !== 'about:blank'; i++) {
      if (i === 120) throw new Error('Previous page did not unload');
      await delay(250);
    }
    contexts.clear(); nodes.clear();
    await send('Page.navigate', { url: 'http://127.0.0.1:3198/gaterunner/' });
    for (let i = 0; ; i++) {
      if (await evaluate('!!document.querySelector("#app")?.__vue_app__?._instance?.proxy')) break;
      if (i === 240) throw new Error('App startup failed');
      await delay(250);
    }
    const setup = await evaluate(`(async () => {
      const app = globalThis.app = document.querySelector('#app').__vue_app__._instance.proxy;
      const profile = await import('/gaterunner/src/__tests__/liveAudioPerformance.browser.ts');
      await profile.configureLiveAudioProfile(app, ${variant === 'baseline' || process.env.PROFILE_BACKEND === 'compatibility'}, ${variant === 'baseline' || variant === 'native-awake' || process.env.PROFILE_KEEP_VOICES_AWAKE === '1'});
      const preset = ${JSON.stringify(preset)};
      const variant = ${JSON.stringify(variant)};
      if (variant === 'no-reverb' || variant === 'no-effects') preset.reverb.enabled = false;
      if (variant === 'first-track') { preset.tracks = preset.tracks.slice(0, 1); preset.bitmaskSequenceInput = ''; }
      if (${process.env.PROFILE_ALL_TRACKS === '1'}) preset.bitmaskSequenceInput = '';
      for (const track of preset.tracks) {
        for (const effect of ['filter', 'echo', 'phaser', 'flanger', 'chorus', 'tremolo', 'vibrato']) {
          if (variant === 'no-' + effect) track[effect + 'Enabled'] = false;
        }
        if (variant === 'no-shapers' || variant === 'no-effects') track.waveshaper.enabled = false;
        if (variant === 'no-effects') for (const effect of ['filter', 'echo', 'phaser', 'flanger', 'chorus', 'tremolo', 'vibrato']) track[effect + 'Enabled'] = false;
      }
      app.applyDraftData(preset); await app.$nextTick();
      await app.startSequencer();
      if (!app.isRunning) throw new Error(app.playbackErrorMessage);
      return { buffering: app.liveBuffering, tracks: Object.entries(app.trackSynths).map(([id, c]) => ({ id, allocated: c.synth?._voices?.length, active: c.synth?.activeVoices })) };
    })()`);
    await delay(warmup * 1000);
    const samples = [];
    for (let i = 0; i < duration; i++) {
      for (const context of contexts.values()) {
        if (context.contextType !== 'realtime' || context.contextState !== 'running') continue;
        const { realtimeData } = await send('WebAudio.getRealtimeData', { contextId: context.contextId });
        samples.push({ wallTime: performance.now(), contextId: context.contextId, ...realtimeData });
      }
      await delay(1000);
    }
    const graph = {};
    for (const node of nodes.values()) graph[node.nodeType] = (graph[node.nodeType] ?? 0) + 1;
    const stats = await evaluate(`(async () => {
      if (!app.isRunning || Object.keys(app.trackSynths).length !== ${setup.tracks.length}) throw new Error('Playback changed during measurement');
      const audio = await import('/gaterunner/src/audio/liveAudio.ts');
      const result = { diagnostics: audio.exportLiveDiagnostics(), tracks: Object.entries(app.trackSynths).map(([id, c]) => ({ id, allocated: c.synth?._voices?.length, active: c.synth?.activeVoices })) };
      app.stopSequencer(); return result;
    })()`);
    const capacities = samples.map(s => s.renderCapacity).filter(Number.isFinite);
    if (!capacities.length) throw new Error('Chrome returned no realtime audio load samples');
    const result = { variant, backend: variant === 'baseline' ? 'compatibility' : process.env.PROFILE_BACKEND ?? 'native',
      keepVoicesAwake: variant === 'baseline' || variant === 'native-awake' || process.env.PROFILE_KEEP_VOICES_AWAKE === '1',
      allTracks: process.env.PROFILE_ALL_TRACKS === '1', setup, graph, meanRenderCapacity: capacities.reduce((a, b) => a + b, 0) / capacities.length,
      maxRenderCapacity: Math.max(...capacities), samples, ...stats };
    results.push(result);
    writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ variant, meanRenderCapacity: result.meanRenderCapacity, maxRenderCapacity: result.maxRenderCapacity,
      tracks: result.tracks, graph, late: stats.diagnostics.session?.lateCallbacks }));
  }
} finally {
  socket?.close(); chrome?.kill(); vite.kill();
}
