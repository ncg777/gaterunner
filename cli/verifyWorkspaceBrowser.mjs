// Run against a local Vite server. Chrome uses an isolated, disposable profile.
// Usage: node cli/verifyWorkspaceBrowser.mjs [http://127.0.0.1:3000/gaterunner/]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const url = process.argv[2] ?? 'http://127.0.0.1:3000/gaterunner/';
const output = resolve('dist/workspace-browser');
mkdirSync(output, { recursive: true });
const chrome = spawn(process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9401', `--user-data-dir=${output}/chrome-${process.pid}`,
  '--no-first-run', '--disable-background-networking', '--autoplay-policy=no-user-gesture-required', 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
let socket;
try {
  let page;
  for (let i = 0; i < 80; i++) {
    try { page = await (await fetch('http://127.0.0.1:9401/json/new?about:blank', { method: 'PUT' })).json(); break; } catch {}
    await delay(250);
  }
  assert.ok(page, 'Chrome must start');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map(), errors = [], networkRequests = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.method === 'Network.requestWillBeSent') networkRequests.set(message.params.requestId, message.params.request.url);
    if (message.method === 'Network.loadingFinished' || message.method === 'Network.loadingFailed') networkRequests.delete(message.params.requestId);
    const request = pending.get(message.id);
    if (request) { pending.delete(message.id); message.error ? request.reject(message.error) : request.resolve(message.result); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 30000 });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['https://fonts.googleapis.com/*', 'https://fonts.gstatic.com/*'] });
  await send('Page.navigate', { url });
  for (let i = 0; i < 240; i++) {
    if (await evaluate(`Boolean(document.querySelector('.sequence-grid'))`)) break;
    if (i === 239) throw new Error(`Workspace failed to mount: ${JSON.stringify({ errors, pendingRequests: [...networkRequests.values()], body: await evaluate('document.body.innerText') })}`);
    await delay(250);
  }
  console.log('Workspace mounted; checking editing, mixer, navigation, and playback.');
  // Check native wheel input and the last control, rather than just page dimensions.
  // A clipped wrapper can fit the viewport while silently hiding most of the editor.
  const scrollingChecks = [];
  for (const [width, height] of [[1280, 720], [1024, 600], [1280, 480]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.querySelector('#app').__vue_app__._instance.proxy.openEditor('playback')`);
    await delay(400);
    const before = await evaluate(`(() => {
      const dock = document.querySelector('.dock-body'); dock.scrollTop = 0;
      const rect = dock.getBoundingClientRect();
      return { client: dock.clientHeight, scroll: dock.scrollHeight, x: rect.right - 24, y: Math.max(1, Math.min(innerHeight - 20, rect.top + 40)), editorHeight: document.querySelector('.editor-surface').getBoundingClientRect().height };
    })()`);
    assert.ok(before.client > 0 && before.scroll > before.client, `Editor must expose overflowing controls at ${width}×${height}: ${JSON.stringify(before)}`);
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: before.x, y: before.y, deltaX: 0, deltaY: before.scroll });
    await delay(300);
    const after = await evaluate(`(() => {
      const dock = document.querySelector('.dock-body');
      const fields = [...document.querySelectorAll('.control-tab-panel.v-window-item--active .editable-slider')];
      const last = fields.at(-1).getBoundingClientRect(), rect = dock.getBoundingClientRect();
      return { top: dock.scrollTop, lastBottom: last.bottom, dockBottom: rect.bottom };
    })()`);
    assert.ok(after.top > 0, `Mouse wheel must scroll the editor at ${width}×${height}`);
    assert.ok(after.lastBottom <= after.dockBottom, `Last playback control must be reachable at ${width}×${height}: ${JSON.stringify(after)}`);
    // Once the editor reaches its end, wheel input can reveal the rest of a short window.
    if (after.lastBottom > height) {
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: before.x, y: before.y, deltaX: 0, deltaY: height * 2 });
      await delay(300);
    }
    const lastControlBottom = await evaluate(`[...document.querySelectorAll('.control-tab-panel.v-window-item--active .editable-slider')].at(-1).getBoundingClientRect().bottom`);
    assert.ok(lastControlBottom > 0 && lastControlBottom <= height, `Last playback control must be visible in the window at ${width}×${height}: ${lastControlBottom}`);
    scrollingChecks.push({ width, height, wheelScrolled: true, lastControlReachable: true, lastControlVisible: true });
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await evaluate(`(() => { const app = document.querySelector('#app').__vue_app__._instance.proxy; app.openEditor('sequence'); document.querySelector('.dock-body').scrollTop = 0; })()`);
  await delay(400);
  const checks = await evaluate(`(async () => {
    const app = document.querySelector('#app').__vue_app__._instance.proxy;
    const initialScaleReady = app.scale.length > 0;
    const { clonePresetData, DEFAULT_PRESET_DATA } = await import('/gaterunner/src/presets.ts');
    const { nextTick } = await import('/gaterunner/node_modules/.vite/deps/vue.js');
    const tick = async () => { await nextTick(); await new Promise(r => setTimeout(r, 30)); };
    const project = clonePresetData(DEFAULT_PRESET_DATA);
    project.reverb.enabled = false; project.tracks[0].sequenceInput = '1 2 4 8 3 5 7 0'; project.tracks[0].repeats = 2;
    project.forte = '7-35.11';
    app.applyDraftData(project); await tick();
    const sequenceInput = document.querySelector('.integer-sequence-input textarea:not([readonly])');
    const sequenceInputAboveGrid = sequenceInput.getBoundingClientRect().bottom < document.querySelector('.sequence-grid').getBoundingClientRect().top;
    const typedSequence = ['1 3', '5 0'].join(String.fromCharCode(10));
    sequenceInput.value = typedSequence; sequenceInput.dispatchEvent(new Event('input', { bubbles: true })); await tick();
    const textInputEditsProject = app.currentTrack.sequenceInput === typedSequence;
    sequenceInput.value = project.tracks[0].sequenceInput; sequenceInput.dispatchEvent(new Event('input', { bubbles: true })); await tick();
    const original = app.currentTrack.sequenceInput;
    const cell = document.querySelector('.note-cell');
    const wasActive = cell.getAttribute('aria-pressed'); cell.click(); await tick();
    const gridEditsProject = app.currentTrack.sequenceInput !== original && cell.getAttribute('aria-pressed') !== wasActive;
    cell.click(); await tick();
    const gridRoundTrips = app.currentTrack.sequenceInput === original;
    app.addTrack('rhythmic'); await tick();
    app.handleTrackDraftChange({ ...app.currentTrack, drumVelocityBits: 3, sequenceInput: '0 0 0 0' }); await tick();
    document.querySelector('.note-cell').click(); await tick();
    const drumGridEdits = BigInt(app.currentTrack.sequenceInput.split(' ')[0]) > 0n;
    const drumId = app.currentTrack.id, firstId = app.tracks[0].id;
    app.handleTrackSelection(firstId); app.mainView = 'mixer'; await tick();
    const fader = document.querySelectorAll('.mixer-channel input')[1]; fader.value = '-12.5'; fader.dispatchEvent(new Event('input', { bubbles: true })); await tick();
    const mixerTargetsCorrectTrack = app.tracks[1].gain === -12.5 && app.currentTrack.id === firstId;
    document.querySelectorAll('.channel-switches button')[2].click(); await tick();
    const mixerMute = app.trackMixStates[drumId].muted;
    document.querySelectorAll('.channel-switches button')[3].click(); await tick();
    const mixerSolo = app.trackMixStates[drumId].soloed;
    app.toggleTrackMuted(drumId); app.toggleTrackSoloed(drumId);
    app.mainView = 'arrangement'; await tick();
    const editor = app.$refs.trackEditor;
    const reachable = [];
    for (const tab of ['sequence','playback','time-warp','generator','modulation','unison','drive','chorus','flanger','phaser','filter','effects','reverb']) {
      editor.setControlTab(tab); await tick();
      if (document.querySelector('.control-tabs .v-tab--selected')?.getAttribute('value') === tab || editor.activeControlTab === tab) reachable.push(tab);
    }
    const studioViews = [];
    for (const view of ['phrases','steps','motion','returns','samples','render']) {
      app.openDock(view); await tick();
      const panel = document.querySelector('.development-panel');
      if (panel.getBoundingClientRect().height > 60 && panel.querySelector('.v-window-item--active')) studioViews.push(view);
    }
    app.openEditor('sequence'); await tick();
    const input = document.querySelector('.tempo-display input'); input.value = '123'; input.dispatchEvent(new Event('change', { bubbles: true })); await tick();
    const tempoUpdates = app.bpm === 123;
    const name = document.querySelector('.track-name-input'); name.focus();
    name.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true })); await tick();
    const typingDoesNotPlay = !app.isRunning; name.blur();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true }));
    for (let i=0; i<100 && !app.isRunning; i++) await new Promise(r=>setTimeout(r, 50));
    await new Promise(r=>setTimeout(r, 200));
    const keyboardPlays = app.isRunning && app.playbackSeconds > 0;
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true })); await tick();
    const keyboardStops = !app.isRunning && app.playbackSeconds === 0;
    const starting = app.startSequencer(); app.stopSequencer(); await starting; await tick();
    const stopCancelsStart = !app.isRunning && !app.isStarting;
    const before = app.getDraftData(); const order = before.tracks.map(t=>t.id);
    app.reorderTracks(order[1], order[0]); await tick();
    const reorders = app.tracks[0].id === order[1];
    app.reorderTracks(order[0], order[1]);
    app.useMidiOutput = true; await tick(); app.openEditor('generator'); await tick();
    const midiModeHasSequence = editor.activeControlTab === 'sequence';
    app.useMidiOutput = false; app.openEditor('sequence'); await tick();
    return { initialScaleReady, sequenceInputAboveGrid, textInputEditsProject, gridEditsProject, gridRoundTrips, drumGridEdits, mixerTargetsCorrectTrack, mixerMute, mixerSolo,
      editorTabs: reachable.length, studioViews: studioViews.length, tempoUpdates, typingDoesNotPlay, keyboardPlays, keyboardStops, stopCancelsStart, reorders, midiModeHasSequence };
  })()`);
  for (const [name, result] of Object.entries(checks)) assert.equal(result, name === 'editorTabs' ? 13 : name === 'studioViews' ? 6 : true, name);
  const review = await evaluate(`(async () => {
    const app = document.querySelector('#app').__vue_app__._instance.proxy;
    const { normalizePresetData } = await import('/gaterunner/src/presets.ts');
    const tick = () => new Promise(resolve => setTimeout(resolve, 90));
    app.applyDraftData(normalizePresetData({ bpm: 60, forte: '12-1.00', tracks: [{ id: 'preview', sequenceInput: '1 0 2 0', lengthFactor: 100, lengthOffset: 0 }] }));
    app.openEditor('playback'); await tick();
    const geometry = () => document.querySelector('.track-note-preview path').getAttribute('d').split('M').slice(1).map(part => ({ x: parseFloat(part), width: parseFloat(part.split('h')[1]) }));
    const editSlider = async (label, value) => {
      [...document.querySelectorAll('.control-tab-panel.v-window-item--active .editable-slider__label')].find(el => el.textContent.startsWith(label)).click();
      await tick();
      const input = document.querySelector('.editable-slider__input input');
      input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await tick();
    };
    const fullWidth = geometry()[0].width;
    await editSlider('Track Note Length', 50);
    const lengthSliderUpdatesPreview = geometry()[0].width === fullWidth / 2 && app.currentTrack.lengthFactor === 50;
    await editSlider('Fixed Note Length', 0.5);
    const fixedLengthUpdatesPreview = geometry()[0].width === 37.5;
    app.handleTrackDraftChange({ ...app.currentTrack, phase: 1 }); await tick();
    const phaseUpdatesPreview = geometry()[0].x === 25;
    app.handleTrackDraftChange({ ...app.currentTrack, phase: 0, lengthOffset: 0, lengthFactor: 100, sequenceInput: Array(128).fill('1').join(' ') }); await tick();
    const longSequencePreview = geometry().length === 128 && geometry().at(-1).x > 99;
    document.querySelector('.track-name-input').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await tick();
    const renamePreservesEditor = app.$refs.trackEditor.activeControlTab === 'playback';
    app.openEditor('sequence'); await tick();
    const up = document.querySelector('[aria-label="Show higher notes or drum lanes"]');
    while (!up.disabled) { up.click(); await tick(); }
    app.handleTrackDraftChange({ ...app.currentTrack, octave: 10 }); await tick();
    const shrinkingScaleKeepsRows = document.querySelectorAll('.note-cell').length > 0;
    app.addTrack('rhythmic'); await tick();
    app.openEditor('generator'); await tick();
    const drumInstrumentNavigation = app.$refs.trackEditor.activeControlTab === 'drum-sounds';
    return { lengthSliderUpdatesPreview, fixedLengthUpdatesPreview, phaseUpdatesPreview, longSequencePreview, renamePreservesEditor, shrinkingScaleKeepsRows, drumInstrumentNavigation };
  })()`);
  for (const [name, passed] of Object.entries(review)) assert.equal(passed, true, name);
  Object.assign(checks, review);
  const demo = JSON.parse(readFileSync('cli/fixtures/development-demo.json', 'utf8')).preset.data;
  await evaluate(`document.querySelector('#app').__vue_app__._instance.proxy.applyDraftData(${JSON.stringify(demo)})`);
  checks.phraseEditing = await evaluate(`(async () => {
    const app = document.querySelector('#app').__vue_app__._instance.proxy;
    const tick = () => new Promise(resolve => setTimeout(resolve, 80));
    await tick();
    for (const track of app.tracks.slice(0, 2)) {
      const pattern = track.development.patterns[0];
      const base = track.sequenceInput, sequence = pattern.sequence;
      app.editTrackPattern(track.id, pattern.id); await tick();
      const input = document.querySelector('.integer-sequence-input textarea:not([readonly])');
      input.value = '1 2 0'; input.dispatchEvent(new Event('input', { bubbles: true })); await tick();
      if (app.currentTrack.development.patterns[0].sequence !== '1 2 0' || app.currentTrack.sequenceInput !== base) return false;
      input.value = sequence; input.dispatchEvent(new Event('input', { bubbles: true })); await tick();
      const cell = document.querySelector('.note-cell'); cell.click(); await tick();
      if (app.currentTrack.development.patterns[0].sequence === sequence || app.currentTrack.sequenceInput !== base) return false;
      cell.click(); await tick();
      if (app.currentTrack.development.patterns[0].sequence !== sequence) return false;
    }
    app.editTrackPattern(app.tracks[0].id, app.tracks[0].development.patterns[0].id); await tick();
    return true;
  })()`);
  assert.equal(checks.phraseEditing, true, 'Pattern editing must target the selected phrase and preserve the base sequence');
  await delay(400);
  const screenshot = async name => { const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); writeFileSync(resolve(output, name), Buffer.from(shot.data, 'base64')); };
  await screenshot('arrangement.png');
  await evaluate(`document.querySelector('#app').__vue_app__._instance.proxy.mainView = 'mixer'`); await delay(200);
  await screenshot('mixer.png');
  await evaluate(`document.querySelector('#app').__vue_app__._instance.proxy.mainView = 'arrangement'`);
  const widths = [1440, 1024, 768, 390, 320];
  for (const width of widths) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false }); await delay(200);
    const dimensions = await evaluate(`({ viewport: innerWidth, document: document.documentElement.scrollWidth, height: innerHeight, documentHeight: document.documentElement.scrollHeight })`);
    assert.ok(dimensions.document <= dimensions.viewport, `Page overflows at ${width}px: ${JSON.stringify(dimensions)}`);
    if (width > 900) assert.ok(dimensions.documentHeight <= dimensions.height, 'Desktop panels scroll independently');
    if (width === 390) await screenshot('mobile.png');
  }
  const mobileChecks = [];
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const tap = async expression => {
    await evaluate(`(${expression}).scrollIntoView({ block: 'center', inline: 'nearest' })`); await delay(150);
    const point = await evaluate(`(() => { const r = (${expression}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, radiusX: 4, radiusY: 4 }] });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await delay(180);
  };
  const swipe = async (x, y, dx, dy) => {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 12; i++) {
      await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 12, y: y + dy * i / 12 }] });
      await delay(20);
    }
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await delay(200);
  };
  for (const [width, height] of [[320, 568], [390, 844], [768, 1024], [844, 390]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
    await evaluate(`(() => { const app = document.querySelector('#app').__vue_app__._instance.proxy; app.mainView = 'arrangement'; app.openEditor('sequence'); window.scrollTo(0, 0); })()`); await delay(250);
    const controlsFit = await evaluate(`(() => {
      const selectors = ['.transport-controls', '.tempo-display', '.output-button', '.track-timeline-controls', '.track-note-preview'];
      return selectors.every(selector => [...document.querySelectorAll(selector)].every(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth; }));
    })()`);
    assert.ok(controlsFit, `Transport and track controls must fit at ${width}×${height}`);
    if (width <= 900) {
      await tap(`document.querySelector('.track-timeline-controls button[aria-label^="Actions for"]')`);
      const firstId = await evaluate(`document.querySelector('#app').__vue_app__._instance.proxy.tracks[0].id`);
      await tap(`[...document.querySelectorAll('.v-overlay--active .v-list-item')].find(el => el.textContent.includes('Move track down'))`);
      assert.equal(await evaluate(`document.querySelector('#app').__vue_app__._instance.proxy.tracks[1].id`), firstId, 'Touch menu reorders tracks');
      await evaluate(`(() => { const app = document.querySelector('#app').__vue_app__._instance.proxy; app.reorderTracks(app.tracks[1].id, app.tracks[0].id); })()`);
      // Restore the left edge after the previous viewport's horizontal swipe;
      // scrollIntoView alone can put the first cell underneath sticky note labels.
      await evaluate(`document.querySelector('.sequence-grid-scroll').scrollLeft = 0`);
      const original = await evaluate(`document.querySelector('#app').__vue_app__._instance.proxy.$refs.trackEditor.sequenceTrack.sequenceInput`);
      await tap(`document.querySelector('.note-cell')`);
      assert.notEqual(await evaluate(`document.querySelector('#app').__vue_app__._instance.proxy.$refs.trackEditor.sequenceTrack.sequenceInput`), original, 'Touch edits notes at ' + width);
      await tap(`document.querySelector('.note-cell')`);
      const transport = await evaluate(`(() => { const r = document.querySelector('.transport-bar').getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; })()`);
      assert.ok(transport.top >= 0 && transport.bottom < height, 'Transport stays visible while editing');
      // A 32-step phrase also overflows tablets; a 16-step phrase can fit naturally.
      await evaluate(`document.querySelector('#app').__vue_app__._instance.proxy.$refs.trackEditor.handleSequenceChange(${JSON.stringify(original + ' ' + original)})`); await delay(150);
      await evaluate(`document.querySelector('.sequence-grid-scroll').scrollLeft = 0`);
      const gridPoint = await evaluate(`(() => { const r = document.querySelector('.note-cell').getBoundingClientRect(), grid = document.querySelector('.sequence-grid-scroll').getBoundingClientRect(); return { x: grid.right - 15, y: r.y + r.height / 2 }; })()`);
      await swipe(gridPoint.x, gridPoint.y, -140, 0);
      const gridState = await evaluate(`(() => { const grid = document.querySelector('.sequence-grid-scroll'); return { left: grid.scrollLeft, width: grid.clientWidth, scrollWidth: grid.scrollWidth, hit: document.elementFromPoint(${gridPoint.x}, ${gridPoint.y})?.className }; })()`);
      assert.ok(gridState.left > 0, 'Touch swipe scrolls the note grid: ' + JSON.stringify({ width, gridPoint, gridState }));
      const beforeScroll = await evaluate('window.scrollY');
      await swipe(gridPoint.x, gridPoint.y, 0, -120);
      assert.ok(await evaluate('window.scrollY') > beforeScroll, 'Touch swipe scrolls the page');
      await evaluate(`document.querySelector('#app').__vue_app__._instance.proxy.$refs.trackEditor.handleSequenceChange(${JSON.stringify(original)})`); await delay(100);
    }
    for (const tab of ['sequence','playback','time-warp','generator','modulation','unison','drive','chorus','flanger','phaser','filter','effects','reverb']) {
      await evaluate(`document.querySelector('#app').__vue_app__._instance.proxy.openEditor('${tab}')`); await delay(100);
      const overflow = await evaluate(`(() => {
        const panel = document.querySelector('.control-tab-panel.v-window-item--active');
        return [...panel.querySelectorAll('.v-input, .editable-slider, .v-btn')].filter(el => { const r = el.getBoundingClientRect(); return r.width && (r.width > innerWidth - 16 || r.left < 0 || r.right > innerWidth); }).map(el => el.textContent.trim().slice(0, 50));
      })()`);
      assert.deepEqual(overflow, [], 'Editor controls fit: ' + tab + ' at ' + width);
    }
    // Dense studio forms must wrap within small screens, with their final control reachable.
    for (const view of ['phrases', 'steps', 'motion', 'returns', 'samples', 'render']) {
      await evaluate(`document.querySelector('#app').__vue_app__._instance.proxy.openDock('${view}')`); await delay(130);
      const overflow = await evaluate(`(() => {
        const panel = document.querySelector('.development-panel .v-window-item--active');
        return [...panel.querySelectorAll('.v-input, .v-btn')].filter(el => { const r = el.getBoundingClientRect(); return r.width && (r.width > innerWidth - 16 || r.left < 0 || r.right > innerWidth); }).map(el => el.textContent.trim().slice(0, 50));
      })()`);
      assert.deepEqual(overflow, [], 'Studio controls fit: ' + view + ' at ' + width);
      await evaluate(`(() => { const controls = [...document.querySelectorAll('.development-panel .v-window-item--active input, .development-panel .v-window-item--active button')].filter(el => el.getBoundingClientRect().height); controls.at(-1)?.scrollIntoView({ block: 'center' }); })()`); await delay(100);
      const reachable = await evaluate(`(() => { const controls = [...document.querySelectorAll('.development-panel .v-window-item--active input, .development-panel .v-window-item--active button')].filter(el => el.getBoundingClientRect().height); if (!controls.length) return true; const r = controls.at(-1).getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()`);
      assert.ok(reachable, 'Last control reachable: ' + view + ' at ' + width);
    }
    mobileChecks.push({ width, height, controlsFit, studioViews: 6, editorTabs: 13, touchEditing: true, touchScrolling: true });
    await evaluate(`(() => { const app = document.querySelector('#app').__vue_app__._instance.proxy; app.openEditor('sequence'); window.scrollTo(0, 0); })()`); await delay(150);
    if (width === 390) await screenshot('mobile.png');
  }
  assert.deepEqual(errors, [], 'No browser runtime errors');
  const report = { ...checks, scrollingChecks, responsiveWidths: widths, mobileChecks, runtimeErrors: errors.length };
  writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { socket?.close(); chrome.kill(); }
