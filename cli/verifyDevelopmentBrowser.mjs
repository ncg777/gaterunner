// Disposable headless browser integration check; never opens the user's browser profile.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { tsImport } from 'tsx/esm/api';
const output=resolve('dist/development-browser');mkdirSync(output,{recursive:true});
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','3199','--strictPort'],{windowsHide:true,stdio:'pipe'});
let serverLog='';vite.stdout.on('data',data=>{serverLog+=data;});vite.stderr.on('data',data=>{serverLog+=data;});
let chrome,socket;
try{
  for(let i=0;;i++){try{if((await fetch('http://127.0.0.1:3199/gaterunner/')).ok)break;}catch{}if(i>240)throw new Error(`Vite startup failed: ${serverLog}`);await delay(250);}
  chrome=spawn(process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--remote-debugging-port=9398',`--user-data-dir=${output}/chrome-${process.pid}`,'--no-first-run','--disable-background-networking','--autoplay-policy=no-user-gesture-required','about:blank'],{windowsHide:true,stdio:'ignore'});
  let page;for(let i=0;;i++){try{page=await(await fetch('http://127.0.0.1:9398/json/new?about:blank',{method:'PUT'})).json();break;}catch{}if(i>80)throw new Error('Chrome startup failed');await delay(250);}
  socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let id=0;const pending=new Map();socket.onmessage=event=>{const message=JSON.parse(event.data),request=pending.get(message.id);if(request){pending.delete(message.id);message.error?request.reject(message.error):request.resolve(message.result);}};
  const send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,timeout:180000});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await send('Network.enable');
  await send('Network.setBlockedURLs',{urls:['https://fonts.googleapis.com/*','https://fonts.gstatic.com/*']});
  await send('Runtime.enable');let browserErrors=[];
  const pendingRequests=new Map();
  const previousHandler=socket.onmessage;socket.onmessage=event=>{const message=JSON.parse(event.data);
    if(message.method==='Runtime.exceptionThrown'||message.method==='Network.loadingFailed')browserErrors.push(message.params);
    if(message.method==='Network.requestWillBeSent')pendingRequests.set(message.params.requestId,message.params.request.url);
    if(message.method==='Network.loadingFinished'||message.method==='Network.loadingFailed')pendingRequests.delete(message.params.requestId);
    previousHandler(event);};
  await send('Page.navigate',{url:'http://127.0.0.1:3199/gaterunner/'});
  for(let i=0;i<240;i++){if(await evaluate(`Boolean(document.querySelector('.development-panel'))`))break;await delay(250);if(i===239){const pageState=await evaluate(`({url:location.href,body:document.body.innerText,html:document.head.innerHTML})`);throw new Error(`Studio panel failed to mount: ${JSON.stringify({pageState,browserErrors,pendingRequests:[...pendingRequests.values()],serverLog})}`);}}
  console.log('Studio mounted; checking rendering and playback.');
  const project=JSON.parse(readFileSync('cli/fixtures/development-demo.json','utf8')).preset.data;
  for(const track of project.tracks)track.development.sections=[{...track.development.sections[0],length:1,unit:'beats'}];
  project.studio.returns[0].chain[0].feedback=0.1;
  const browser=await evaluate(`(async()=>{
    const {renderBrowserDevelopment}=await import('/gaterunner/src/audio/browserDevelopment.ts');
    const {generateDevelopedMidi}=await import('/gaterunner/src/audio/developmentRender.ts');
    const {resolveProjectEvents}=await import('/gaterunner/src/domain/developmentSchedule.ts');
    const {default:App}=await import('/gaterunner/src/App.vue');
    const app=document.querySelector('#app').__vue_app__._instance.proxy;
    app.applyDraftData(${JSON.stringify(project)});
    document.querySelector('.development-panel button').click();
    const first=await renderBrowserDevelopment(${JSON.stringify(project)}), second=await renderBrowserDevelopment(${JSON.stringify(project)},{range:{start:0.1,end:0.25,unit:'seconds'}});
    await app.startSequencer();const playing=app.isRunning&&!!app.developmentPlayer;
    app.handleTrackDraftChange({...app.currentTrack,gain:app.currentTrack.gain-1});
    const editStopped=!app.isRunning&&!app.developmentPlayer;
    app.applyDraftData(${JSON.stringify(project)});
    const starting=app.startSequencer();
    for(let i=0;i<200&&!app.developmentController;i++)await new Promise(resolve=>setTimeout(resolve,5));
    if(!app.developmentController)throw new Error('Playback preparation did not start');
    app.toggleTrackMuted(app.tracks[0].id);await starting;
    const preparationCancelled=!app.isRunning&&!app.developmentPlayer&&!app.developmentController;
    await app.startSequencer();
    const muted=await renderBrowserDevelopment(app.getDraftData(),{mutedTrackIds:[app.tracks[0].id]});
    const actual=app.developmentPlayer.buffer.getChannelData(0);
    const mutedPlaybackMatches=actual.length===muted.preMaster[0].length&&actual.every((v,i)=>v===muted.preMaster[0][i]);
    app.stopSequencer();
    const arranged=${JSON.stringify(project)};
    arranged.tracks.forEach(track=>{track.sequenceInput='';track.development.sections[0].length=16;});
    app.applyDraftData(arranged);app.useMidiOutput=true;await app.startSequencer();
    const arrangedMidiPlays=Object.keys(app.trackLoops).length===arranged.tracks.length
      &&app.getLoopDurationSecondsFromTrackLengths()===app.developmentSchedule.duration;
    app.handleBitmaskSequenceInput('1');
    const midiEditStopped=!app.isRunning&&!app.developmentSchedule;
    app.stopSequencer();app.useMidiOutput=false;app.applyDraftData(${JSON.stringify(project)});
    return {left:Array.from(first.channels[0]),right:Array.from(first.channels[1]),excerpt:Array.from(second.channels[0]),
      events:(await resolveProjectEvents(${JSON.stringify(project)})).tracks.map(t=>t.events),midi:Array.from(await generateDevelopedMidi(${JSON.stringify(project)})),
      cacheHits:second.stats.cacheHits,playing,editStopped,preparationCancelled,mutedPlaybackMatches,arrangedMidiPlays,midiEditStopped,
      panel:document.querySelector('.development-panel').textContent.includes('Phrases')};
  })()`);
  const moduleUrl=new URL('../src/audio/developmentRender.ts',import.meta.url).href;
  const {renderDevelopment,generateDevelopedMidi}=await tsImport(moduleUrl,moduleUrl);
  const native=await renderDevelopment(project);let maximumDifference=0;
  for(let channel=0;channel<2;channel++){const actual=channel?browser.right:browser.left;if(actual.length!==native.channels[channel].length)throw new Error('Browser/native duration differs');for(let i=0;i<actual.length;i++)maximumDifference=Math.max(maximumDifference,Math.abs(actual[i]-native.channels[channel][i]));}
  if(maximumDifference>1e-6)throw new Error(`Browser/native samples differ by ${maximumDifference}`);
  const nativeMidi=await generateDevelopedMidi(project);if(JSON.stringify(browser.midi)!==JSON.stringify(Array.from(nativeMidi)))throw new Error('Browser/native MIDI differs');
  if(JSON.stringify(browser.events)!==JSON.stringify(native.resolved.tracks.map(t=>t.events)))throw new Error('Browser/native schedules differ');
  if(!browser.playing||browser.cacheHits!==3)throw new Error('Browser playback or cache failed');
  if(!browser.editStopped||!browser.preparationCancelled||!browser.mutedPlaybackMatches)throw new Error('Developed playback invalidation or muting failed');
  if(!browser.arrangedMidiPlays||!browser.midiEditStopped)throw new Error('Arranged MIDI playback or edit invalidation failed');
  for(let i=0;i<browser.excerpt.length;i++)if(browser.excerpt[i]!==browser.left[i+4800])throw new Error('Browser excerpt differs');
  await evaluate(`document.querySelector('.development-panel').scrollIntoView({block:'start'})`);await delay(400);
  const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(`${output}/studio.png`,Buffer.from(screenshot.data,'base64'));
  const report={maximumDifference,browserMidiMatches:true,schedulesMatch:true,excerptMatches:true,cacheHits:browser.cacheHits,playbackStarted:browser.playing,
    editStopped:browser.editStopped,preparationCancelled:browser.preparationCancelled,mutedPlaybackMatches:browser.mutedPlaybackMatches,
    arrangedMidiPlays:browser.arrangedMidiPlays,midiEditStopped:browser.midiEditStopped,studioMounted:browser.panel};
  writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{socket?.close();chrome?.kill();vite.kill();}
