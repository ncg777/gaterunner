// Usage: node cli/verifyAutomationBrowser.mjs [http://127.0.0.1:3000/gaterunner/]
// Uses an isolated Chrome profile and writes screenshots/report to ignored dist/.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const output = resolve('dist/automation-browser'); mkdirSync(output, { recursive: true });
const url = process.argv[2] ?? 'http://127.0.0.1:3000/gaterunner/';
const chrome = spawn(process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9403', `--user-data-dir=${output}/chrome-${process.pid}`,
  '--no-first-run', '--disable-background-networking', '--autoplay-policy=no-user-gesture-required', 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
let socket;
try {
  let page;
  for (let i = 0; i < 100; i++) { try { page = await (await fetch('http://127.0.0.1:9403/json/new?about:blank', { method: 'PUT' })).json(); break; } catch {} await delay(250); }
  assert.ok(page, 'Chrome starts');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0; const pending = new Map(), errors = [], requests = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.method === 'Network.requestWillBeSent') requests.set(message.params.requestId, message.params.request.url);
    if (message.method === 'Network.loadingFinished' || message.method === 'Network.loadingFailed') requests.delete(message.params.requestId);
    const request = pending.get(message.id);
    if (request) { pending.delete(message.id); message.error ? request.reject(message.error) : request.resolve(message.result); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value;
  };
  await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['https://fonts.googleapis.com/*', 'https://fonts.gstatic.com/*'] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  for (let i = 0; i < 720; i++) {
    if (await evaluate(`Boolean(document.querySelector('.sequence-grid'))`)) break;
    // A transient Windows socket-buffer failure can leave an ES module unloaded.
    if ((i === 80 || i === 240) && requests.size === 0) await send('Page.reload', { ignoreCache: true });
    if (i === 719) throw new Error(`App did not mount: ${JSON.stringify({ errors, requests: [...requests.values()], body: await evaluate('document.body.innerText') })}`); await delay(250);
  }
  console.log('Workspace mounted; checking automation interactions.');
  await evaluate(`(async()=>{
    window.app = document.querySelector('#app').__vue_app__._instance.proxy;
    const project = app.getDraftData(); const track = project.tracks[0];
    track.development = { enabled:true, seed:0, patterns:[], sections:[], steps:[], snapshots:[], snapshotCues:[], sends:{}, samples:[],
      automation:[{id:'cut',target:'filterFrequency',clock:'song',interpolation:'smooth',points:[{beat:0,value:30},{beat:8,value:100}]}] };
    project.studio = {version:1,seed:0,assets:[],returns:[{id:'dub',name:'Dub',level:-6,chain:[{id:'delay',type:'delay',beats:.5,feedback:.3,cutoff:4000,drive:0,mode:'stereo'}],automation:[{id:'level',target:'level',interpolation:'linear',points:[{beat:0,value:-30},{beat:16,value:-6}]}]}]};
    app.applyDraftData(project); app.openDock('motion'); window.initial = JSON.stringify(app.getDraftData());
    window.commits=0; app.$watch(()=>JSON.stringify(app.getDraftData()),()=>commits++);
  })()`);
  await delay(400);
  assert.equal(await evaluate('JSON.stringify(app.getDraftData()) === initial'), true, 'Opening automation preserves data');
  await evaluate('app.startSequencer()');
  assert.equal(await evaluate('app.isRunning'), true, 'Playback starts before editing');
  const curve = `document.querySelector('.automation-editor')`;
  const position = async (index, dx = 0, dy = 0) => evaluate(`(()=>{const e=${curve}.querySelector('[data-point-index="${index}"]');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2+${dx},y:r.y+r.height/2+${dy}}})()`);
  const mouse = (type, p, extra = {}) => send('Input.dispatchMouseEvent', { type, ...p, ...extra });
  const start = await position(1), end = { x: start.x + 70, y: start.y + 30 };
  await mouse('mousePressed', start, { button: 'left', clickCount: 1 });
  await mouse('mouseMoved', end, { button: 'left', buttons: 1 });
  assert.equal(await evaluate('commits'), 0, 'Drag preview does not commit');
  assert.equal(await evaluate('app.isRunning'), true, 'Drag preview keeps playback running');
  assert.equal(await evaluate('JSON.stringify(app.getDraftData()) === initial'), true);
  await mouse('mouseReleased', end, { button: 'left', clickCount: 1 }); await delay(100);
  assert.equal(await evaluate('commits'), 1, 'Drag releases exactly one project update');
  assert.equal(await evaluate('app.isRunning'), false, 'Committed editing stops playback');
  assert.notEqual(await evaluate('JSON.stringify(app.getDraftData())'), await evaluate('initial'));
  // Escape and pointer cancellation discard previews.
  const saved = await evaluate('JSON.stringify(app.getDraftData())');
  const second = await position(1);
  await mouse('mousePressed', second, { button: 'left', clickCount: 1 });
  await mouse('mouseMoved', { x: second.x - 50, y: second.y + 30 }, { button: 'left', buttons: 1 });
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await mouse('mouseReleased', second, { button: 'left', clickCount: 1 });
  assert.equal(await evaluate('JSON.stringify(app.getDraftData())'), saved);
  // Graph insertion and keyboard movement/deletion.
  const background = await evaluate(`(()=>{const r=${curve}.querySelector('.curve-background').getBoundingClientRect();return {x:r.x+r.width*.25,y:r.y+r.height*.5}})()`);
  await mouse('mousePressed', background, { button: 'left', clickCount: 1 }); await mouse('mouseReleased', background, { button: 'left', clickCount: 1 }); await delay(80);
  assert.equal(await evaluate('app.getDraftData().tracks[0].development.automation[0].points.length'), 3);
  const beforeKey = await evaluate('app.getDraftData().tracks[0].development.automation[0].points[1].beat');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight' }); await delay(80);
  assert.equal(await evaluate('app.getDraftData().tracks[0].development.automation[0].points[1].beat'), beforeKey + .25);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete' }); await delay(80);
  assert.equal(await evaluate('app.getDraftData().tracks[0].development.automation[0].points.length'), 2);
  const exact = 7.123456789;
  await evaluate(`(()=>{const input=${curve}.querySelector('[aria-label="Selected point beat"]');input.value='${exact}';input.dispatchEvent(new Event('change',{bubbles:true}));})()`); await delay(80);
  assert.equal(await evaluate('app.getDraftData().tracks[0].development.automation[0].points.at(-1).beat'), exact);
  // Categorical, bus and note targets retain the existing contract.
  await evaluate(`(()=>{const p=app.getDraftData();p.tracks[0].development.automation.push({id:'type',target:'filterType',clock:'note',interpolation:'step',points:[{beat:0,value:'lowpass'},{beat:4,value:'highpass'}]});app.applyDraftData(p);})()`); await delay(100);
  assert.equal(await evaluate(`document.querySelectorAll('.automation-editor')[1].querySelectorAll('.curve-point').length`), 2);
  await evaluate(`${curve}.scrollIntoView({block:'center'})`); await delay(100);
  const screenshot = async name => { const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); writeFileSync(resolve(output, name), Buffer.from(shot.data, 'base64')); };
  await screenshot('track-desktop.png');
  // Return editing uses the same graph and saves through studio updates.
  await evaluate(`app.openDock('returns')`); await delay(200);
  await evaluate(`(()=>{const titles=[...document.querySelectorAll('.v-expansion-panel-title')];titles.find(e=>e.textContent.includes('Return motion')).click();})()`); await delay(300);
  const returnEditor = `document.querySelector('[aria-label="Return level automation editor"]')`;
  assert.equal(await evaluate(`Boolean(${returnEditor})`), true);
  await evaluate(`(async()=>{const {nextTick}=await import('/gaterunner/node_modules/.vite/deps/vue.js');const editor=${returnEditor};editor.querySelector('[data-point-index="1"]').focus();await nextTick();const input=editor.querySelector('[aria-label="Selected point value"]');input.value='-12.3456789';input.dispatchEvent(new Event('change',{bubbles:true}));})()`); await delay(100);
  assert.equal(await evaluate('app.getDraftData().studio.returns[0].automation[0].points[1].value'), -12.3456789);
  await evaluate(`${returnEditor}.scrollIntoView({block:'center'})`); await delay(100); await screenshot('return-desktop.png');
  // Round-trip through actual preset normalization/serialization.
  assert.equal(await evaluate(`(async()=>{const {normalizePresetData}=await import('/gaterunner/src/presets.ts');const data=app.getDraftData();const next=normalizePresetData(JSON.parse(JSON.stringify(data)));return JSON.stringify(next.tracks[0].development.automation)===JSON.stringify(data.tracks[0].development.automation)&&JSON.stringify(next.studio.returns)===JSON.stringify(data.studio.returns);})()`), true);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await evaluate(`app.openDock('motion')`); await delay(200); await evaluate(`${curve}.scrollIntoView({block:'start'})`); await delay(100);
  assert.equal(await evaluate(`(()=>{const e=${curve},r=e.getBoundingClientRect();return r.width<=390&&e.scrollWidth<=e.clientWidth+2;})()`), true, 'Editor fits narrow viewport');
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const touchPoint = await evaluate(`(()=>{const r=${curve}.querySelector('.curve-background').getBoundingClientRect();return {x:r.x+r.width*.8,y:r.y+r.height*.6}})()`);
  const beforeTouch = await evaluate('app.getDraftData().tracks[0].development.automation[0].points.length');
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...touchPoint, id: 1 }] });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await delay(100);
  assert.equal(await evaluate('app.getDraftData().tracks[0].development.automation[0].points.length'), beforeTouch + 1, 'Touch adds an automation point');
  await screenshot('track-mobile.png');
  // Replacing the project while a drag is in flight discards the old preview.
  const replacement = await evaluate('JSON.stringify(app.getDraftData())');
  const mobileStart = await position(1);
  await mouse('mousePressed', mobileStart, { button: 'left', clickCount: 1 });
  await mouse('mouseMoved', { x: mobileStart.x + 10, y: mobileStart.y + 10 }, { button: 'left', buttons: 1 });
  await evaluate(`app.applyDraftData(JSON.parse(${JSON.stringify(replacement)}))`); await delay(80);
  await mouse('mouseReleased', mobileStart, { button: 'left', clickCount: 1 });
  assert.equal(await evaluate('JSON.stringify(app.getDraftData())'), replacement, 'Project replacement cancels a drag');
  await evaluate(`window.firstTrack=app.selectedTrackId;app.addTrack('melodic');app.openDock('motion')`); await delay(100);
  assert.equal(await evaluate(`document.querySelector('.development-panel .v-window-item--active').querySelectorAll('.automation-editor').length`), 0, 'New track does not inherit curve state');
  await evaluate('app.selectedTrackId=firstTrack'); await delay(100);
  assert.equal(await evaluate(`${curve}.querySelectorAll('.curve-point').length`), 3, 'Returning to a track restores its saved curve');
  assert.deepEqual(errors, [], 'No browser exceptions');
  const report = { dragCommitCount: 1, playbackInvalidation: true, cancellation: true, insertion: true, keyboard: true, preciseNumericInput: true, categorical: true, returnEditing: true, roundTrip: true, responsive: true, touchEditing: true, projectReplacement: true, trackSwitching: true, browserErrors: errors.length };
  writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { socket?.close(); chrome.kill(); }
