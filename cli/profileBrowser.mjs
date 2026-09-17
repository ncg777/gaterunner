// Requires an installed Chromium browser. Uses a disposable profile, never user data.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const output = resolve(process.env.PROFILE_OUTPUT ?? 'dist/browser-profile');
mkdirSync(output, { recursive: true });
const browser = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '3197', '--strictPort'], { windowsHide: true, stdio: 'ignore' });
let chrome;
let socket;
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch('http://127.0.0.1:3197/gaterunner/')).ok) break; } catch {}
    if (i === 80) throw new Error('Vite startup failed');
    await delay(250);
  }
  chrome = spawn(browser, ['--headless=new', '--remote-debugging-port=9397',
    `--user-data-dir=${output}/chrome`, '--no-first-run', '--disable-background-networking',
    '--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--autoplay-policy=no-user-gesture-required', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let page;
  for (let i = 0; ; i++) {
    try { page = await (await fetch('http://127.0.0.1:9397/json/new?http://127.0.0.1:3197/gaterunner/', { method: 'PUT' })).json(); break; } catch {}
    if (i === 80) throw new Error('Chrome startup failed');
    await delay(250);
  }
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') console.error(JSON.stringify(message.params));
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
  await send('Runtime.enable');
  await send('Page.bringToFront');
  for (let i = 0; ; i++) {
    if (await evaluate('!!document.querySelector("#app")?.__vue_app__?._instance?.proxy')) break;
    if (i === 240) throw new Error(`App startup failed: ${await evaluate('document.body.innerText.slice(0, 1500)')}`);
    await delay(250);
  }
  await evaluate(`(async () => { globalThis.app = document.querySelector('#app').__vue_app__._instance.proxy;
    globalThis.bench = await import('/gaterunner/src/__tests__/performance.browser.ts');
    ${process.env.PROFILE_BASELINE === '1' ? 'bench.installBrowserProfileBaseline();' : ''}
    ${process.env.PROFILE_POLL_BASELINE === '1' ? 'bench.installRealtimePollingBaseline(app);' : ''}
    await bench.prepareBrowserPerformanceProject(app); })()`);
  const checks = process.argv.slice(2);
  if (checks.length) {
    for (const check of checks) console.log(JSON.stringify(await evaluate(`(async () => {
      const checks = await import('/gaterunner/src/__tests__/offlineRender.browser.ts');
      return { check: '${check}', result: await checks['${check}'](app) };
    })()`)));
  }
  const results = [];
  for (const mode of checks.length ? [] : (process.env.PROFILE_MODES ?? 'playback,export').split(',')) {
    await send('Profiler.enable');
    await send('Profiler.start');
    const result = await evaluate(`bench.runBrowserPerformance(app, '${mode}')`);
    const { profile } = await send('Profiler.stop');
    if (mode === 'export') {
      const base64 = await evaluate(`(() => { let text = ''; const bytes = globalThis.performanceWav;
        for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
        return btoa(text); })()`);
      writeFileSync(`${output}/export-${results.length}.wav`, Buffer.from(base64, 'base64'));
    }
    writeFileSync(`${output}/${mode}.cpuprofile`, JSON.stringify(profile));
    console.log(JSON.stringify(result));
    results.push(result);
    const totals = new Map();
    profile.samples.forEach((sample, index) => totals.set(sample, (totals.get(sample) ?? 0) + profile.timeDeltas[index]));
    console.log(profile.nodes.map(node => ({ name: node.callFrame.functionName, url: node.callFrame.url,
      line: node.callFrame.lineNumber + 1, ms: Math.round((totals.get(node.id) ?? 0) / 1000) }))
      .sort((a, b) => b.ms - a.ms).slice(0, 12));
  }
  if (results.length) writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
} finally {
  socket?.close();
  chrome?.kill();
  vite.kill();
}
