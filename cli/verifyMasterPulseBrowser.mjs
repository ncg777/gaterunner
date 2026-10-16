// Disposable headless checks; this profile never reads the user's browser data.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const output = resolve('dist/master-pulse-browser');
mkdirSync(output, { recursive: true });
// Restrict dependency discovery to the app; disposable browser profiles and older
// build artifacts elsewhere in dist can contain thousands of unrelated files.
const config = `${output}/vite.config.mts`;
writeFileSync(config, `import base from '../../vite.config.mts';\nexport default { ...base, server: { ...base.server, watch: null }, optimizeDeps: { entries: ['index.html'], holdUntilCrawlEnd: false }, cacheDir: 'dist/master-pulse-browser/vite-cache' };\n`);
const url = process.argv[2] ?? 'http://127.0.0.1:3197/gaterunner/';
const vite = process.argv[2] ? undefined : spawn(process.execPath,
  ['node_modules/vite/bin/vite.js', '--config', config, '--host', '127.0.0.1', '--port', '3197', '--strictPort'],
  { windowsHide: true, stdio: 'pipe' });
let serverLog = '', chrome, socket;
vite?.stdout.on('data', data => { serverLog += data; });
vite?.stderr.on('data', data => { serverLog += data; });
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    if (i > 240) throw new Error(`Vite startup failed: ${serverLog}`);
    await delay(250);
  }
  chrome = spawn(process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    ['--headless=new', '--remote-debugging-port=9397', `--user-data-dir=${output}/chrome-${process.pid}`,
      '--no-first-run', '--disable-background-networking', '--autoplay-policy=no-user-gesture-required', '--mute-audio', 'about:blank'],
    { windowsHide: true, stdio: 'ignore' });
  let page;
  for (let i = 0; ; i++) {
    try { page = await (await fetch('http://127.0.0.1:9397/json/new?about:blank', { method: 'PUT' })).json(); break; } catch {}
    if (i > 100) throw new Error('Chrome startup failed');
    await delay(250);
  }
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map(), browserErrors = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data), request = pending.get(message.id);
    if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') browserErrors.push(message.params.args);
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
  await send('Network.enable');
  await send('Runtime.enable');
  await send('Network.setBlockedURLs', { urls: ['*fonts.googleapis.com*', '*fonts.gstatic.com*'] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  for (let i = 0; ; i++) {
    if (await evaluate(`Boolean(document.querySelector('.master-pulse-controls'))`)) break;
    if (i > 240) {
      const state = await evaluate(`({url:location.href,body:document.body.innerText,resources:performance.getEntriesByType('resource').slice(-15).map(r=>r.name)})`);
      throw new Error(`Master Pulse UI did not mount: ${JSON.stringify({ state, browserErrors, serverLog })}`);
    }
    await delay(250);
  }
  console.log('Master Pulse mounted; checking worklet audio.');
  const audio = await evaluate(`(async () => {
    const { runMasterPulseChecks } = await import('/gaterunner/src/__tests__/masterPulse.browser.ts');
    return runMasterPulseChecks();
  })()`);
  console.log('Worklet audio passed; checking playback and controls.');
  const ui = await evaluate(`(async () => {
    const app = document.querySelector('#app').__vue_app__._instance.proxy;
    const nextTick = () => new Promise(resolve => setTimeout(resolve, 0));
    const { getMasterBus, setMasterPulse } = await import('/gaterunner/src/audio/masterBus.ts');
    const { normalizePresetData } = await import('/gaterunner/src/presets.ts');
    const saved = app.getDraftData();
    app.applyDraftData(normalizePresetData({ bpm: 240, tracks: [{ sequenceInput: '1 2 3 4', gain: -24, release: 0.01 }],
      reverb: { enabled: false }, masterPulse: { enabled: true, shape: 'pulse', depth: 1, frequency: 10 } }));
    await nextTick();
    document.querySelector('.master-pulse-controls').open = true;
    const shortcut = document.querySelector('[aria-label="Theta 6 Hz"]'); shortcut.click();
    await nextTick();
    if (app.masterPulse.frequency !== 6 || !app.getDraftData().masterPulse.enabled) throw new Error('Frequency shortcut did not persist');
    app.handleMasterPulseChange({ ...app.masterPulse, rateMode: 'sync' });
    await nextTick();
    const divisionSelect = [...document.querySelectorAll('.master-pulse-controls .v-select')].map(element => {
      let component = element.__vueParentComponent;
      while (component && !(component.props.label === 'Tempo division' && Array.isArray(component.props.items))) component = component.parent;
      return component;
    }).find(Boolean);
    if (!divisionSelect) throw new Error('Master Pulse tempo selector missing');
    for (const division of ['1/64', '1/64D', '1/64T']) {
      if (!divisionSelect.props.items.includes(division)) throw new Error('Missing tempo option: ' + division);
      divisionSelect.emit('update:modelValue', division);
      await nextTick();
      if (app.masterPulse.division !== division || app.getDraftData().masterPulse.division !== division) throw new Error('Tempo division did not persist: ' + division);
    }
    await app.startSequencer();
    if (!app.isRunning) throw new Error('Master Pulse playback did not start');
    const bus = getMasterBus(), control = bus.pulseControl;
    app.handleMasterPulseChange({ ...app.masterPulse, rateMode: 'hz', frequency: 40, shape: 'sine', depth: 0.35 });
    await setMasterPulse(bus, app.masterPulse, app.bpm);
    if (!app.isRunning || control !== bus.pulseControl) throw new Error('Live edit restarted playback or the pulse oscillator');
    app.stopSequencer();
    await app.startSequencer();
    if (!app.isRunning || control !== getMasterBus().pulseControl) throw new Error('Restart did not reuse the pulse oscillator');
    app.stopSequencer();
    app.handleMasterPulseChange({ ...app.masterPulse, rateMode: 'sync', division: '1/64T', shape: 'pulse', depth: 1 });
    const wav = await app.renderMixWav();
    if (!wav || wav.byteLength < 100) throw new Error('Browser WAV export failed');
    await nextTick();
    document.querySelector('.master-pulse-controls').scrollIntoView({ block: 'center' });
    window.__masterPulseRestore = () => app.applyDraftData(saved);
    return { tempoDivisions: ['1/64', '1/64D', '1/64T'], shortcut: true, playback: true, liveEdits: true, restart: true, wavBytes: wav.byteLength };
  })()`);
  await delay(200);
  const desktop = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(`${output}/desktop.png`, Buffer.from(desktop.data, 'base64'));
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const mobile = await evaluate(`(async () => {
    document.querySelector('.master-pulse-controls').scrollIntoView({ block: 'center' });
    await new Promise(resolve => setTimeout(resolve, 100));
    const panel = document.querySelector('.master-pulse-controls'), rect = panel.getBoundingClientRect();
    if (rect.left < 0 || rect.right > innerWidth || panel.scrollWidth > panel.clientWidth + 1) throw new Error('Master Pulse controls overflow on mobile');
    return { width: rect.width, noOverflow: true };
  })()`);
  const phone = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(`${output}/mobile.png`, Buffer.from(phone.data, 'base64'));
  await evaluate('window.__masterPulseRestore()');
  const report = { audio, ui, mobile };
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { socket?.close(); chrome?.kill(); vite?.kill(); }
