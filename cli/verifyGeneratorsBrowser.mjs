// Isolated headless integration checks; no access to the user's browser profile.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { tsImport } from 'tsx/esm/api';
import { setTimeout as delay } from 'node:timers/promises';
const output = resolve('dist/generator-browser'); mkdirSync(output, { recursive: true });
const production = process.argv.includes('--production');
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...(production ? ['preview'] : process.argv.includes('--debug') ? ['--force', '--debug'] : []), '--host', '127.0.0.1', '--port', '3196', '--strictPort'], { windowsHide: true, stdio: 'pipe' });
let log = ''; vite.stdout.on('data', data => { log += data; }); vite.stderr.on('data', data => { log += data; });
let chrome, socket;
try {
  for (let i = 0; ; i++) { try { if ((await fetch('http://127.0.0.1:3196/gaterunner/')).ok) break; } catch {}
    if (i > 240) throw new Error(`Vite startup failed: ${log}`); await delay(250); }
  chrome = spawn(process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=9396',
    `--user-data-dir=${resolve(tmpdir(), `gaterunner-generators-${process.pid}`)}`, '--no-first-run', '--disable-background-networking', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let page; for (let i = 0; ; i++) { try { page = await (await fetch('http://127.0.0.1:9396/json/new?about:blank', { method: 'PUT' })).json(); break; } catch {}
    if (i > 80) throw new Error('Chrome startup failed'); await delay(250); }
  socket = new WebSocket(page.webSocketDebuggerUrl); await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0; const pending = new Map(); const errors = []; const requests = new Map();
  socket.onmessage = event => { const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params);
    if (message.method === 'Runtime.consoleAPICalled') console.log(message.params.type, message.params.args.map(arg => arg.value ?? arg.description).join(' ').slice(0, 2000));
    if (message.method === 'Network.requestWillBeSent') requests.set(message.params.requestId, message.params.request.url);
    if (message.method === 'Network.loadingFinished' || message.method === 'Network.loadingFailed') requests.delete(message.params.requestId);
    const request = pending.get(message.id); if (request) { pending.delete(message.id); message.error ? request.reject(message.error) : request.resolve(message.result); } };
  const send = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 180000 });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  await send('Network.enable'); await send('Network.setBlockedURLs', { urls: ['*fonts.googleapis.com*', '*fonts.gstatic.com*'] });
  await send('Runtime.enable'); await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:3196/gaterunner/' });
  for (let i = 0; ; i++) { if (await evaluate('!!(document.querySelector("#app")?.__vue_app__?._instance?.proxy ?? document.querySelector("#app")?._vnode?.component?.proxy)')) break;
    if (i > 240) throw new Error(`App startup failed: ${JSON.stringify(await evaluate('({url:location.href,body:document.body.innerText,root:document.querySelector("#app")?.outerHTML.slice(0,1000),ready:document.readyState,keys:Object.keys(document.querySelector("#app") ?? {})})'))} ${log.slice(-3000)} ${JSON.stringify({errors,requests:[...requests.values()]})}`); await delay(250); }
  console.log('App mounted; checking generators.');
  if (production) {
    const sampleModule = new URL('../src/audio/sampleAssets.ts', import.meta.url).href;
    const { createSampleAsset } = await tsImport(sampleModule, import.meta.url);
    const asset = await createSampleAsset([Float32Array.from({ length: 4800 }, (_, i) => Math.sin(2 * Math.PI * 261.625565 * i / 48000))], 48000, 'Production test sine');
    const result = await evaluate(`(async () => {
      const root = document.querySelector('#app'); const app = root.__vue_app__._instance?.proxy ?? root._vnode?.component?.proxy;
      const results = [];
      const scenarios = ['modal','pulse','fm','pluck','granular'].map(mode => ({ mode, second: false }));
      scenarios.push(...['additive','partial-bank','resonant-noise','choir','modal','pulse','fm','pluck','granular'].map(mode => ({ mode, second: true })));
      for (const { mode, second } of scenarios) {
        const project = app.getDraftData(); project.bpm = 240;
        project.tracks = [{ ...project.tracks[0], synthMode: second ? 'additive' : mode, sequenceInput: '1 3', release: 0.05,
          generatorEngines: { granular: { asset: '${asset.hash}' } },
          engineCombination: second ? { mode: 'rm', depth: 0.75, frequencyRatio: 1.5, engineB: {
            synthMode: mode, generatorEngines: { granular: { asset: '${asset.hash}' } } } } : undefined }];
        project.studio = { version: 1, seed: 0, returns: [], assets: [${JSON.stringify(asset)}] };
        app.applyDraftData(project); await app.startSequencer();
        if (!app.isRunning) throw new Error(mode + ': production playback failed');
        await new Promise(resolve => setTimeout(resolve, 200)); app.stopSequencer();
        const wav = await app.renderMixWav();
        if (wav.length <= 44 || new DataView(wav.buffer, wav.byteOffset, wav.byteLength).getUint16(34, true) !== 24) throw new Error(mode + ': expected a 24-bit WAV');
        let peak = 0;
        for (let i = 44; i + 2 < wav.length; i += 3) {
          let value = wav[i] | wav[i + 1] << 8 | wav[i + 2] << 16;
          if (value >= 0x800000) value -= 0x1000000;
          peak = Math.max(peak, Math.abs(value) / 0x800000);
        }
        if (peak < 0.001) throw new Error(mode + ': production WAV must contain audible sound');
        results.push({ mode, second, wavBytes: wav.length, peak });
      }
      return { version: app.appVersion, production: results };
    })()`);
    console.log(JSON.stringify(result, null, 2)); writeFileSync(`${output}/production.json`, JSON.stringify(result, null, 2) + '\n');
  } else {
    const report = await evaluate(`import('/gaterunner/src/__tests__/generators.browser.ts').then(module => module.runGeneratorChecks())`);
    const dualEngine = await evaluate(`import('/gaterunner/src/__tests__/dualEngine.browser.ts').then(module => module.runDualEngineChecks())`);
    report.dualEngine = dualEngine;
    if (errors.length) throw new Error(JSON.stringify(errors));
    writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
    const screenshot = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${output}/generators.png`, Buffer.from(screenshot.data, 'base64'));
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    const mobileLayout = await evaluate(`(() => {
      const source = document.querySelector('.editor-surface--source');
      return source && { width: source.getBoundingClientRect().width, panelWidth: source.querySelector('.control-tab-content').getBoundingClientRect().width,
        viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth };
    })()`);
    if (!mobileLayout || mobileLayout.panelWidth < mobileLayout.width * 0.85 || mobileLayout.scrollWidth > mobileLayout.viewport + 1) throw new Error(`Mobile engine layout: ${JSON.stringify(mobileLayout)}`);
    const mobileScreenshot = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${output}/generators-mobile.png`, Buffer.from(mobileScreenshot.data, 'base64'));
  }
} finally { writeFileSync(`${output}/vite.log`, log); socket?.close(); chrome?.kill(); vite.kill(); }
