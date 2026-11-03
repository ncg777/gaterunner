// Browser integration/visual checks in an isolated profile; never opens the user's library.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const output = resolve('dist/help-browser');
mkdirSync(output, { recursive: true });
const browser = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '3198', '--strictPort'], { windowsHide: true, stdio: 'ignore' });
let chrome, socket;
const errors = [];
async function eventually(fn, message, tries = 160) {
  for (let i = 0; i < tries; i++) { if (await fn()) return; await delay(250); }
  throw new Error(message);
}
try {
  await eventually(async () => { try { return (await fetch('http://127.0.0.1:3198/gaterunner/')).ok; } catch { return false; } }, 'Vite did not start');
  chrome = spawn(browser, ['--headless=new', '--remote-debugging-port=9398', `--user-data-dir=${output}/profile`, '--no-first-run', '--disable-background-networking', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  chrome.on('error', error => errors.push(error.message));
  let page;
  await eventually(async () => { try { page = await (await fetch('http://127.0.0.1:9398/json/new?about:blank', { method: 'PUT' })).json(); return !!page.webSocketDebuggerUrl; } catch { return false; } }, 'Chrome did not start (set CHROME_PATH if needed)');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(message.params.exceptionDetails));
    const request = pending.get(message.id);
    if (request) { pending.delete(message.id); message.error ? request.reject(message.error) : request.resolve(message.result); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timeout = setTimeout(() => { pending.delete(requestId); reject(new Error(`Timed out: ${method}`)); }, 45000);
    pending.set(requestId, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 30000 });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const tick = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const click = async selector => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await tick(); };
  const clickText = async (selector, label) => { await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(el => el.textContent.trim() === ${JSON.stringify(label)}).click()`); await tick(); };
  const key = async (key, code = key) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: key === 'F1' ? 112 : key === 'Escape' ? 27 : 13 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code }); await tick(); };
  const title = () => evaluate('document.querySelector("#help-topic-title").textContent');
  const search = async text => { await evaluate(`(() => { const el=document.querySelector('[aria-label="Search help"]'); el.value=${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`); await tick(); };
  const screenshot = async name => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(resolve(output, name), Buffer.from(data, 'base64')); };
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['*fonts.googleapis.com*', '*fonts.gstatic.com*'] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:3198/gaterunner/' });
  await send('Page.bringToFront');
  try {
    await eventually(() => evaluate('!!document.querySelector("#app")?.__vue_app__?._instance?.proxy'), 'App did not mount', 240);
  } catch (error) {
    console.error(await evaluate('document.body.innerText.slice(0, 2000)'));
    console.error(errors);
    throw error;
  }
  await evaluate('globalThis.app = document.querySelector("#app").__vue_app__._instance.proxy');
  const before = await evaluate('JSON.stringify(app.getDraftData())');
  await click('[aria-label="Help and reference"]');
  await eventually(() => evaluate('document.activeElement?.getAttribute("aria-label") === "Search help"'), 'Search was not focused');
  assert.equal(await title(), 'Help & tutorials');
  const topicCount = await evaluate('document.querySelectorAll(".help-topic-link").length');
  assert.ok(topicCount >= 35);
  await evaluate('document.fonts.ready.then(() => true)');
  await screenshot('help-desktop.png');
  await search('exclusive end');
  assert.ok(await evaluate('document.querySelector(".help-contents").textContent.includes("WAV, stems, excerpts & bounce")'));
  await clickText('.help-result strong', 'WAV, stems, excerpts & bounce');
  assert.equal(await title(), 'WAV, stems, excerpts & bounce');
  await click('[aria-label="Clear help search"]');
  await evaluate('document.querySelector(".help-article").scrollTop = 280');
  const scroll = await evaluate('document.querySelector(".help-article").scrollTop');
  await clickText('.help-topic-link', 'Samples & velocity layers');
  await click('[aria-label="Previous help topic"]');
  assert.equal(await title(), 'WAV, stems, excerpts & bounce');
  assert.equal(await evaluate('document.querySelector(".help-article").scrollTop'), scroll);
  await click('[aria-label="Close help"]');
  await delay(350);
  await click('[aria-label="Help and reference"]');
  await delay(350);
  assert.equal(await evaluate('document.querySelector(".help-article").scrollTop'), scroll);
  await search('does-not-exist-anywhere');
  assert.ok(await evaluate('!!document.querySelector(".help-no-results")'));
  await clickText('.help-no-results button', 'Show all topics');
  assert.equal(await evaluate('document.querySelectorAll(".help-topic-link").length'), topicCount);
  await clickText('.help-topic-link', 'Automation & graph editing');
  await clickText('.help-section-links button', 'Validation and playback');
  assert.equal(await evaluate('document.activeElement.textContent'), 'Validation and playback');
  await click('.help-open-controls');
  assert.equal(await evaluate('app.dockView'), 'motion');
  await delay(350);
  await click('[aria-label="Help for current editor"]');
  assert.equal(await title(), 'Automation & graph editing');
  await delay(350);
  await key('F1');
  assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), 'Search help');
  await key('Escape');
  await delay(350);
  assert.equal(await evaluate('app.showHelp'), false);
  await evaluate('app.openEditor("time-warp")');
  await tick();
  await key('F1');
  assert.equal(await title(), 'Time Warp');
  await click('[aria-label="Close help"]');
  await delay(350);
  assert.equal(await evaluate('JSON.stringify(app.getDraftData())'), before, 'Help navigation changed project data');

  // Small phone: search → result → article, contents, Open controls and every article's width.
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await click('[aria-label="Help and reference"]');
  await delay(350);
  await search('first melody');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".help-contents")).display'), 'block');
  await clickText('.help-result strong', 'Tutorial: first melody');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".help-contents")).display'), 'none');
  await click('[aria-label="Clear help search"]');
  await screenshot('help-mobile.png');
  const topicIds = await evaluate('import("/gaterunner/src/help/content.ts").then(module => module.helpTopics.map(topic => topic.id))');
  for (const topic of topicIds) {
    await evaluate(`app.helpTopic = ${JSON.stringify(topic)}`);
    await tick();
    const dimensions = await evaluate('(() => { const article=document.querySelector(".help-article"), shell=document.querySelector(".help-shell"), rect=shell.getBoundingClientRect(); return { width:article.clientWidth, scroll:article.scrollWidth, left:rect.left, right:rect.right, bottom:rect.bottom }; })()');
    assert.ok(dimensions.scroll <= dimensions.width + 1, `Horizontal article overflow: ${topic}`);
    assert.ok(dimensions.left >= 0 && dimensions.right <= 391 && dimensions.bottom <= 845, `Dialog leaves screen: ${topic}`);
  }
  await click('.help-contents-toggle');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".help-contents")).display'), 'block');
  await clickText('.help-topic-link', 'Tutorial: first melody');
  await click('.help-open-controls');
  assert.equal(await evaluate('app.dockView'), 'editor');
  assert.equal(await evaluate('app.$refs.trackEditor.activeControlTab'), 'sequence');
  assert.equal(await evaluate('JSON.stringify(app.getDraftData())'), before);
  assert.deepEqual(errors, []);
  console.log(`Help browser checks passed: ${topicCount} topics, search, history, scroll restoration, context, F1/Escape, section links, return to controls, mobile layout and unchanged project data. Screenshots: ${output}`);
} finally {
  socket?.close();
  chrome?.kill();
  vite.kill();
}
