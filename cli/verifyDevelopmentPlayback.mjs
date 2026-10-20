// End-to-end live playback check in a disposable browser profile.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const project = input.project ?? input;
const output = resolve('dist/development-playback-browser');
mkdirSync(output, { recursive: true });
const config = `${output}/vite.config.mts`;
writeFileSync(config, `import base from '../../vite.config.mts';
export default { ...base, server: { ...base.server, watch: null }, optimizeDeps: { entries: ['index.html'], holdUntilCrawlEnd: false }, cacheDir: 'dist/development-playback-browser/vite-cache' };`);
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', config, '--host', '127.0.0.1', '--port', '3198', '--strictPort'],
  { windowsHide: true, stdio: 'pipe' });
let log = '', chrome, socket;
vite.stdout.on('data', data => { log += data; }); vite.stderr.on('data', data => { log += data; });
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch('http://127.0.0.1:3198/gaterunner/')).ok) break; } catch {}
    if (i > 240) throw new Error(`Vite startup failed: ${log}`);
    await delay(250);
  }
  chrome = spawn(process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    ['--headless=new', '--remote-debugging-port=9398', `--user-data-dir=${output}/chrome-${process.pid}`,
      '--no-first-run', '--disable-background-networking', '--autoplay-policy=no-user-gesture-required', '--mute-audio', 'about:blank'],
    { windowsHide: true, stdio: 'ignore' });
  let page;
  for (let i = 0; ; i++) {
    try { page = await (await fetch('http://127.0.0.1:9398/json/new?about:blank', { method: 'PUT' })).json(); break; } catch {}
    if (i > 100) throw new Error('Chrome startup failed');
    await delay(250);
  }
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map(), errors = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data), request = pending.get(message.id);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params);
    if (request) { pending.delete(message.id); message.error ? request.reject(message.error) : request.resolve(message.result); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 60000 });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['*fonts.googleapis.com*', '*fonts.gstatic.com*'] });
  await send('Page.navigate', { url: 'http://127.0.0.1:3198/gaterunner/' });
  for (let i = 0; ; i++) {
    if (await evaluate(`Boolean(document.querySelector('#app')?.__vue_app__?._instance?.proxy?.scale?.length)`)) break;
    if (i > 240) throw new Error(`App startup failed: ${log}`);
    await delay(250);
  }
  console.log('App ready; loading the complete preset.');
  const report = await evaluate(`(async () => {
    const app = document.querySelector('#app').__vue_app__._instance.proxy;
    const { normalizePresetData } = await import('/gaterunner/src/presets.ts');
    const { canPlayDevelopmentLive } = await import('/gaterunner/src/audio/liveDevelopment.ts');
    const { getMasterBus } = await import('/gaterunner/src/audio/masterBus.ts');
    const project = normalizePresetData(${JSON.stringify(project)});
    if (!canPlayDevelopmentLive(project)) throw new Error('Preset unexpectedly requires full rendering');
    app.applyDraftData(project);
    await new Promise(resolve => setTimeout(resolve, 0));
    const started = performance.now();
    await app.startSequencer();
    const startupMs = performance.now() - started;
    if (!app.isRunning || app.isStarting || app.developmentPlayer || !app.developmentSchedule) throw new Error('Live development did not start: ' + app.playbackErrorMessage);
    if (startupMs > 10000) throw new Error('Playback startup took ' + startupMs + 'ms');
    const context = getMasterBus().input.context;
    const analyser = context.createAnalyser(); analyser.fftSize = 2048;
    getMasterBus().clipper.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let peak = 0;
    for (let i = 0; i < 35; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      analyser.getFloatTimeDomainData(samples);
      for (const value of samples) { if (!Number.isFinite(value)) throw new Error('Non-finite live output'); peak = Math.max(peak, Math.abs(value)); }
    }
    getMasterBus().clipper.disconnect(analyser);
    if (peak < 0.00001) throw new Error('Live playback is silent');
    const position = app.playbackSeconds;
    if (position < 1) throw new Error('Playback position did not advance');
    const eventCount = app.developmentSchedule.tracks.reduce((sum, track) => sum + track.events.length, 0);
    const songDuration = app.developmentSchedule.duration;
    const loops = Object.values(app.trackLoops);
    if (loops.some(part => part.loop)) throw new Error('Developed song unexpectedly loops');
    app.stopSequencer();
    if (app.developmentSendCleanup || app.developmentEndEvent !== null) throw new Error('Stop leaked development scheduling');
    await app.startSequencer();
    if (!app.isRunning) throw new Error('Restart failed');
    app.stopSequencer();
    app.applyDraftData(normalizePresetData({ bpm: 300, reverb: { enabled: false }, tracks: [{
      sequenceInput: '1', denominator: 4, release: 0.01, polyphony: 2,
      development: { enabled: true, steps: [{ step: 0, locks: { attack: 0.012, release: 0.01 } }] }
    }] }));
    await new Promise(resolve => setTimeout(resolve, 0));
    await app.startSequencer();
    await new Promise(resolve => setTimeout(resolve, 3000));
    if (app.isRunning || app.developmentEndEvent !== null || app.developmentSendCleanup) throw new Error('Finite developed playback did not finish cleanly');
    return { startupMs, peak, position, eventCount, tracks: project.tracks.length, fullSongSeconds: songDuration,
      stopAndRestart: true, finitePlayback: true };
  })()`);
  if (errors.length) throw new Error(JSON.stringify(errors));
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { socket?.close(); chrome?.kill(); vite.kill(); }
