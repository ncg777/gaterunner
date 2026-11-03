// Uses an isolated Chrome profile and real IndexedDB, never the user's library.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { arePresetDataEqual, createNamedPreset, DEFAULT_PRESET_DATA, parsePresetImportPayload } from '../src/presets.ts';

const output = resolve('dist/preset-draft-browser');
mkdirSync(output, { recursive: true });
// Run against the already-built production site; no development server or bundler.
const site = resolve('docs');
const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = resolve(site, pathname.replace(/^\/gaterunner\//, '') || 'index.html');
  if (!file.startsWith(site + sep)) { response.writeHead(404).end(); return; }
  try { response.setHeader('Content-Type', contentTypes[extname(file)] ?? 'application/octet-stream'); response.end(readFileSync(file)); }
  catch { response.writeHead(404).end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(3197, '127.0.0.1', resolve); });
let chrome, socket;
const errors = [];
const diagnostics = [];
async function eventually(fn, message, tries = 160) {
  for (let i = 0; i < tries; i++) { if (await fn()) return; await delay(250); }
  throw new Error(message);
}
try {
  chrome = spawn(process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--remote-debugging-port=9397', `--user-data-dir=${output}/profile`, '--no-first-run',
    '--disable-background-networking', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });
  chrome.on('error', error => errors.push(error.message));
  let page;
  await eventually(async () => { try { page = await (await fetch('http://127.0.0.1:9397/json/new?about:blank', { method: 'PUT' })).json(); return !!page.webSocketDebuggerUrl; } catch { return false; } }, 'Chrome did not start (set CHROME_PATH if needed)');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(message.params.exceptionDetails));
    if (message.method === 'Network.loadingFailed') diagnostics.push(message.params);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') diagnostics.push(message.params.args);
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
  const menu = async label => { await click('.preset-menu-btn'); await clickText('.v-overlay--active .v-list-item', label); };
  const confirm = async (accept = true) => { await eventually(() => evaluate('app.showConfirmDialog'), 'Missing discard confirmation'); await evaluate(`app.resolveConfirmDialog(${accept})`); await tick(); };
  const screenshot = async name => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(resolve(output, name), Buffer.from(data, 'base64')); };
  const library = () => evaluate('JSON.stringify(manager.presetLibrary)');
  const stored = () => evaluate('readPresetLibraryStorage().then(result => result.value)');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setBlockedURLs', { urls: ['*fonts.googleapis.com*', '*fonts.gstatic.com*'] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:3197/gaterunner/' });
  await send('Page.bringToFront');
  try {
    await eventually(() => evaluate('!!document.querySelector("#app")?._vnode?.component?.proxy?.$refs.presetManager'), 'App did not mount', 240);
  } catch (error) {
    console.error(await evaluate('document.body.innerText.slice(0, 2000)'));
    console.error(await evaluate('({url:location.href, ready:document.readyState, html:document.documentElement.outerHTML.slice(0,2000), resources:performance.getEntriesByType("resource").slice(-8).map(r=>r.name)})'));
    console.error({ errors, diagnostics });
    throw error;
  }
  await evaluate(`(async () => {
    globalThis.app = document.querySelector('#app')._vnode.component.proxy;
    globalThis.manager = app.$refs.presetManager;
    globalThis.DEFAULT_PRESET_DATA = ${JSON.stringify(DEFAULT_PRESET_DATA)};
    globalThis.readPresetLibraryStorage = () => new Promise((resolve, reject) => {
      const request = indexedDB.open('gaterunner-presets', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, transaction = db.transaction('libraries');
        const read = transaction.objectStore('libraries').get('current');
        transaction.oncomplete = () => { db.close(); resolve({ value: read.result }); };
        transaction.onabort = () => { db.close(); reject(transaction.error); };
      };
    });
    const timestamp = new Date().toISOString();
    const folder = { id: 'sketches', name: 'Sketches', parentFolderId: null, createdAt: timestamp, updatedAt: timestamp };
    const preset = { ...${JSON.stringify(createNamedPreset('Original', { ...DEFAULT_PRESET_DATA, bpm: 123 }))}, folderId: folder.id };
    await manager.persistPresetLibrary({ version: 2, folders: [folder], presets: [preset], selectedPresetId: preset.id });
    await manager.loadPresetById(preset.id);
    globalThis.originalId = preset.id;
  })()`);
  await tick();
  const original = await library(), originalStored = await stored();

  // New must not name, create, select or write a saved preset.
  await menu('New');
  assert.equal(await evaluate('manager.isDraft && manager.currentPreset === null && app.isDirty'), true);
  assert.equal(await evaluate('app.showInputDialog'), false);
  assert.equal(arePresetDataEqual(await evaluate('app.getDraftData()'), DEFAULT_PRESET_DATA), true);
  assert.equal(await library(), original);
  assert.equal(await stored(), originalStored);
  assert.equal(await evaluate('document.querySelector(".preset-browser-launch-name").textContent'), 'Untitled draft');
  assert.equal(await evaluate('document.querySelector(".preset-state-pill").textContent.trim()'), 'Draft');
  assert.equal(await evaluate('document.querySelector(".project-save-button").disabled'), false);
  await screenshot('preset-draft-desktop.png');
  await click('.preset-menu-btn');
  assert.equal(await evaluate('Array.from(document.querySelectorAll(".v-overlay--active .v-list-item")).filter(el => ["Rename", "Delete"].includes(el.textContent.trim())).every(el => el.classList.contains("v-list-item--disabled"))'), true);
  await click('.preset-menu-btn');

  // Cancelled Clear, load and Save preserve the working draft and library.
  await evaluate('app.bpm = 137; app.tracks[0].sequenceInput = "3 5 9"'); await tick();
  const draft = await evaluate('JSON.stringify(app.getDraftData())');
  await menu('Clear'); await confirm(false);
  assert.equal(await evaluate('JSON.stringify(app.getDraftData())'), draft);
  await evaluate('void manager.handlePresetSelection(originalId)'); await confirm(false);
  assert.equal(await evaluate('JSON.stringify(app.getDraftData())'), draft);
  await click('.project-save-button');
  await eventually(() => evaluate('app.showInputDialog'), 'Draft Save did not ask for a name');
  await evaluate('app.resolveInputDialog(false)'); await tick();
  assert.equal(await evaluate('manager.isDraft && app.isDirty'), true);
  assert.equal(await library(), original);
  assert.equal(await stored(), originalStored);

  // Both export formats round-trip unnamed drafts without saving them.
  await evaluate('globalThis.exports = []; manager.downloadJson = (filename, payload) => exports.push({ filename, payload }); manager.exportCurrentPreset(); manager.exportPresetLibrary()');
  assert.equal(arePresetDataEqual(parsePresetImportPayload(await evaluate('JSON.stringify(exports[0].payload)')).preset.data, await evaluate('app.getDraftData()')), true);
  assert.equal(await evaluate('exports[1].payload.presets.length'), 2);
  assert.equal(arePresetDataEqual(await evaluate('exports[1].payload.presets.find(p => p.id === exports[1].payload.selectedPresetId).data'), await evaluate('app.getDraftData()')), true);
  assert.equal(await library(), original);
  assert.equal(await stored(), originalStored);

  // A failed first save retains the unnamed draft and previous stored library.
  await evaluate(`globalThis.originalFactory = Object.getOwnPropertyDescriptor(window, 'indexedDB');
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: { open() {
      const request = {}; queueMicrotask(() => { request.error = new DOMException('Quota exceeded', 'QuotaExceededError'); request.onerror(); }); return request;
    } } }); void 0;`);
  await click('.project-save-button');
  await evaluate('app.inputDialogValue = "Failed save"; app.resolveInputDialog(true)');
  await eventually(() => evaluate('!manager.isPersisting && app.appNoticeMessage.includes("Export your current library")'), 'Missing quota failure notice');
  assert.equal(await evaluate('manager.isDraft && app.isDirty && !manager.currentPreset'), true);
  assert.equal(await evaluate('JSON.stringify(app.getDraftData())'), draft);
  assert.equal(await library(), original);
  await evaluate('Object.defineProperty(window, "indexedDB", originalFactory); void 0');
  assert.equal(await stored(), originalStored);

  // Clear resets settings, arrangement/assets and patterns, but keeps an editable track.
  await evaluate('app.studio = { version: 1, seed: 77, returns: [], assets: [] }; app.masterGain = -12; app.addTrack()'); await tick();
  await menu('Clear'); await confirm();
  assert.equal(await evaluate('app.bpm === DEFAULT_PRESET_DATA.bpm && app.masterGain === DEFAULT_PRESET_DATA.masterGain && app.tracks.length === 1 && app.tracks[0].sequenceInput === "" && app.getDraftData().studio === undefined'), true);
  assert.equal(await library(), original);
  assert.equal(await stored(), originalStored);
  await evaluate('manager.openPresetBrowser()'); await tick();
  assert.equal(await evaluate('document.querySelectorAll(".preset-item-row.active").length'), 0);
  // Loading the saved preset that was selected before New must work, too.
  await evaluate('void manager.loadPresetFromBrowser(originalId)'); await confirm();
  await eventually(() => evaluate('!manager.isDraft && !manager.showPresetBrowser && !app.isDirty'), 'Loading the previous saved preset failed');
  assert.equal(await evaluate('app.bpm'), 123);
  await menu('Clear');
  await evaluate('void manager.mergeTracksFromPreset(originalId)'); await confirm();
  assert.equal(await evaluate('manager.isDraft && app.isDirty && app.tracks.length === 2 && app.bpm === DEFAULT_PRESET_DATA.bpm'), true);
  assert.equal(await stored(), originalStored);

  // Save creates exactly one named preset; later Save updates that entry.
  await click('.project-save-button');
  await evaluate('app.inputDialogValue = "My draft"; app.resolveInputDialog(true)');
  await eventually(() => evaluate('!manager.isDraft && !app.isDirty && manager.currentPreset?.name === "My draft"'), 'First Save failed');
  assert.equal(await evaluate('manager.presetLibrary.presets.length'), 2);
  assert.equal(await evaluate('manager.currentPreset.folderId'), 'sketches');
  assert.equal(await evaluate('manager.presetLibrary.presets.find(p => p.id === originalId).data.bpm'), 123);
  await evaluate('app.bpm = 151'); await tick();
  await click('.project-save-button');
  await eventually(() => evaluate('!app.isDirty && manager.currentPreset.data.bpm === 151'), 'Second Save failed');
  assert.equal(await evaluate('manager.presetLibrary.presets.length'), 2);
  assert.equal(JSON.parse(await stored()).presets.find(p => p.name === 'My draft').data.bpm, 151);

  // Import can add to the library without replacing an unnamed draft, then load it.
  await menu('New');
  const importDraft = await evaluate('JSON.stringify(app.getDraftData())');
  await evaluate('globalThis.importFile = new File([JSON.stringify(exports[0].payload)], "draft.json"); void manager.handlePresetFileImport({ target: { files: [importFile], value: "draft.json" } })');
  await confirm(false);
  await eventually(() => evaluate('manager.presetLibrary.presets.length === 3'), 'Import did not add to library');
  assert.equal(await evaluate('manager.isDraft'), true);
  assert.equal(await evaluate('JSON.stringify(app.getDraftData())'), importDraft);
  await evaluate('void manager.handlePresetFileImport({ target: { files: [importFile], value: "draft.json" } })');
  await confirm();
  await eventually(() => evaluate('!manager.isDraft && !app.isDirty && manager.presetLibrary.presets.length === 4'), 'Import did not load saved preset');

  // Phone layout retains the Draft label and accessible Save control.
  await menu('Clear');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate('app.showAppNotice = false');
  await tick(); await screenshot('preset-draft-mobile.png');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  assert.equal(await evaluate('document.querySelector(".project-save-button").disabled'), false);
  assert.deepEqual(errors, []);
  console.log(`Preset draft browser checks passed: New/Clear without library writes, cancel/discard, first Save and updates, quota recovery, export/import, merging, previous selection, desktop and phone. Screenshots: ${output}`);
} finally {
  socket?.close();
  chrome?.kill();
  server.closeAllConnections();
  server.close();
}
