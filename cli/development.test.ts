import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ToneMidi from '@tonejs/midi';
import { normalizePresetData, clonePresetData, clonePresetTrackData, createNamedPreset, buildSinglePresetExport,
  parsePresetImportPayload, buildDraftFromUrl, mergePresetTracks, arePresetDataEqual, buildPresetLibraryExport } from '../src/presets.js';
import { normalizeDevelopment, evaluateControl, seededChoice, conditionMatches } from '../src/domain/development.js';
import { validateProject } from '../src/domain/projectValidation.js';
import { resolveProjectEvents } from '../src/domain/developmentSchedule.js';
import { renderDevelopment, generateDevelopedMidi } from '../src/audio/developmentRender.js';
import { MemoryRenderCache, renderKey } from '../src/audio/renderCache.js';
import { createReturnProcessor } from '../src/audio/auxiliaryReturns.js';
import { createSampleAsset, importWavAsset, selectSample, createSampleVoice } from '../src/audio/sampleAssets.js';
import { encodeWavFromChannelsSync } from '../src/audio/wav.js';
import { DiskRenderCache } from './diskRenderCache.js';
import { exportStems, bounceSample, exportProjectPackage, loadProject, supportedFeatures } from './projectApi.js';
import { generateMidi, generateWav } from './generate.js';
import { presetDataToGeneratorInput } from './cli.js';

const basic = () => normalizePresetData({ bpm:240, forte:'5-35.05',tracks:[{id:'bass',sequenceInput:'1 2 1 2',denominator:4,
  gain:-18,release:0.02,polyphony:1,glideTime:0.03,monoLegato:true,lengthFactor:120,
  development:normalizeDevelopment({enabled:true,seed:17,patterns:[{id:'main',name:'Main',sequence:'1 2 1 2'},
    {id:'other',name:'Other',sequence:'4 2 4 2'}],sections:[{id:'a',name:'Main',pattern:'main',length:2,unit:'beats'},
    {id:'b',name:'Fill',pattern:'other',length:2,unit:'beats',fill:true}]})}] });
const close = (a:number,b:number,tolerance=1e-6) => assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);

test('legacy normalization adds no active development fields; disabled controls have identical MIDI/WAV', async()=>{
  const old=normalizePresetData({bpm:300,tracks:[{sequenceInput:'1 2',gain:-20,release:0.01}]});
  assert.equal(Object.hasOwn(old,'studio'),false); assert.equal(Object.hasOwn(old.tracks[0],'development'),false);
  const disabled=clonePresetData(old);disabled.tracks[0].development=normalizeDevelopment({enabled:false,seed:5});
  assert.deepEqual(await generateMidi(presetDataToGeneratorInput(old)),await generateMidi(presetDataToGeneratorInput(disabled)));
  assert.deepEqual(await generateWav(presetDataToGeneratorInput(old)),await generateWav(presetDataToGeneratorInput(disabled)));
});
test('integrated API keeps legacy multi-track MIDI bytes and native mixing arithmetic',async()=>{
  const project=normalizePresetData({bpm:300,tracks:[{id:'a',sequenceInput:'1 3',gain:-15,release:0.01,reverbWet:-12},
    {id:'b',sequenceInput:'2 4',gain:-17,release:0.02,reverbWet:-9}],reverb:{enabled:true,wet:-18,dry:-3,decay:0.1,preDelay:0}});
  const options=presetDataToGeneratorInput(project),rendered=await renderDevelopment(project);
  assert.deepEqual(encodeWavFromChannelsSync(rendered.channels,48000),await generateWav(options,{threads:1}));
  assert.deepEqual(await generateDevelopedMidi(project),await generateMidi(options));
});
test('sample legato retains region position while a new attack resets it',async()=>{
  const asset=await createSampleAsset([[0,0.2,0.4,0.6,0.8]],8000,'phase');
  const source={alternatives:[{asset:asset.hash,minVelocity:0,maxVelocity:1}],selection:'round-robin' as const,start:0,gain:0,rootNote:60,tune:0,attack:0,release:0.02,mode:'loop' as const};
  const state:{position?:number}={},first=createSampleVoice(asset,source,60,1,8000,state);
  first(0);close(first(1/8000)[0],0.2);
  const legato=createSampleVoice(asset,source,72,1,8000,state,1);close(legato(0)[0],0.4);
  const reset=createSampleVoice(asset,source,72,1,8000);assert.equal(reset(0)[0],0);
});
test('individual chord controls retain high-note polyphony priority before splitting',async()=>{
  const project=basic(),track=project.tracks[0],d=track.development!;track.polyphony=2;track.octave=7;
  d.sections=[{id:'a',name:'A',pattern:'main',length:1,unit:'beats'}];d.patterns[0].sequence='31';d.patterns[0].steps=[];
  const chord=(await resolveProjectEvents(project)).tracks[0].events[0].notes;
  d.steps=[{step:0,note:chord[0],velocity:0.8}];
  const notes=(await resolveProjectEvents(project)).tracks[0].events.filter(e=>e.repetition===0).flatMap(e=>e.notes).sort((a,b)=>b-a);
  assert.deepEqual(notes,chord.slice().sort((a,b)=>b-a).slice(0,2));
});
test('drum bus motion is continuous, excerpt-safe, and cannot masquerade as private hit locks',async()=>{
  const project=normalizePresetData({bpm:300,tracks:[{id:'drums',trackKind:'rhythmic',sequenceInput:'4 0 4 0',gain:-20,
    filterEnabled:true,filterFrequency:100,reverbWet:-6,development:normalizeDevelopment({enabled:true})}],
    reverb:{enabled:true,wet:-18,decay:0.1,preDelay:0}});
  const d=project.tracks[0].development!,base=await renderDevelopment(project);
  d.automation=[{id:'cut',target:'filterFrequency',interpolation:'smooth',points:[{beat:0,value:100},{beat:1,value:45}]},
    {id:'level',target:'gain',interpolation:'smooth',points:[{beat:0,value:-20},{beat:1,value:-50}]}];
  const full=await renderDevelopment(project),excerpt=await renderDevelopment(project,{range:{start:0.05,end:0.18,unit:'seconds'}});
  assert.notDeepEqual(full.channels,base.channels);assert.deepEqual(excerpt.channels[0],full.channels[0].slice(2400,8640));
  d.steps=[{step:0,locks:{filterFrequency:50}}];assert.ok(validateProject(project).diagnostics.some(e=>e.message.includes('Bus controls')));
  d.steps=[{step:0,lane:2,locks:{'lane.2.filterFrequency':1000}}];assert.equal(validateProject(project).valid,true);
});
test('uncached and prefix-cached sampled excerpts preserve convolution and return state',async()=>{
  const project=basic(),asset=await createSampleAsset([Array.from({length:160},(_,i)=>Math.sin(i*0.23)*0.2)],8000,'texture');
  project.reverb={...project.reverb,enabled:true,wet:-12,decay:0.12,preDelay:0.01};project.tracks[0].reverbWet=-6;
  project.studio={version:1,seed:4,assets:[asset],returns:[{id:'echo',name:'Echo',level:-12,chain:[{id:'delay',type:'delay',beats:0.5,feedback:0.2,cutoff:1600,drive:3,mode:'ping-pong'}],automation:[]}]};
  project.tracks[0].development!.samples=[{alternatives:[{asset:asset.hash,minVelocity:0,maxVelocity:1}],selection:'round-robin',start:0,gain:0,rootNote:60,tune:0,attack:0.002,release:0.03,mode:'loop'}];
  project.tracks[0].development!.sends.echo=-9;
  const full=await renderDevelopment(project),cache=new MemoryRenderCache(),range={start:0.1,end:0.8,unit:'seconds' as const};
  const first=await renderDevelopment(project,{cache,range}),second=await renderDevelopment(project,{cache,range});
  assert.deepEqual(first.channels[0],full.channels[0].slice(4800,38400));assert.deepEqual(second.channels,first.channels);
  assert.equal(second.stats.cacheHits,1);assert.equal(second.stats.returnCacheHits,1);
});
test('new settings survive cloning, presets, libraries, URL sharing and dirty comparison',()=>{
  const project=basic(),copy=clonePresetData(project);assert.deepEqual(copy,project);
  copy.tracks[0].development!.patterns[0].sequence='8';assert.equal(project.tracks[0].development!.patterns[0].sequence,'1 2 1 2');
  assert.equal(arePresetDataEqual(copy,project),false);
  const preset=createNamedPreset('new',project),single=parsePresetImportPayload(JSON.stringify(buildSinglePresetExport(preset)));
  assert.deepEqual(single.kind==='single-preset'?single.preset.data:null,project);
  const library=parsePresetImportPayload(JSON.stringify(buildPresetLibraryExport({version:2,folders:[],presets:[preset],selectedPresetId:preset.id,migratedLegacy:false})));
  assert.deepEqual(library.kind==='preset-library'?library.presets[0].data:null,project);
  assert.deepEqual(buildDraftFromUrl(`?project=${encodeURIComponent(JSON.stringify(project))}`,normalizePresetData({})),project);
  const trackCopy=clonePresetTrackData(project.tracks[0]);trackCopy.development!.sections[0].length=8;assert.equal(project.tracks[0].development!.sections[0].length,2);
});
test('merge remaps colliding return references without changing drum indices',()=>{
  const project=basic();project.studio={version:1,seed:2,assets:[],returns:[{id:'dub',name:'Dub',level:-12,chain:[],automation:[]}]};
  const d=project.tracks[0].development!;d.sends.dub=-6;d.automation.push({id:'send',target:'send.dub',interpolation:'linear',points:[{beat:0,value:-3}]});
  const merged=mergePresetTracks(project,project);assert.equal(merged.studio!.returns.length,2);
  const newId=merged.studio!.returns[1].id;assert.notEqual(newId,'dub');assert.equal(merged.tracks[1].development!.sends[newId],-6);
  assert.equal(merged.tracks[1].development!.automation[0].target,`send.${newId}`);assert.equal(validateProject(merged).valid,true);
});
test('stateless seeded conditions cover every N, first, fill and bounded probability',async()=>{
  assert.equal(conditionMatches({every:2},0,false,0),false);assert.equal(conditionMatches({every:2},1,false,0),true);
  assert.equal(conditionMatches({first:true},1,false,0),false);assert.equal(conditionMatches({fill:true},0,false,0),false);
  assert.equal(conditionMatches({probability:0},0,true,0),false);assert.equal(conditionMatches({probability:1},0,true,0.999),true);
  const project=basic();project.tracks[0].development!.steps=[{step:0,condition:{probability:0.4}}];
  const first=await resolveProjectEvents(project);assert.deepEqual(await resolveProjectEvents(project),first);
  assert.equal(seededChoice(23,'a',1),seededChoice(23,'a',1));assert.notEqual(seededChoice(23,'a',1),seededChoice(23,'a',2));
  project.tracks[0].development!.seed=18;assert.notEqual(seededChoice(17,'test'),seededChoice(18,'test'));
});
test('conditional phrase choices occur at phrase repetitions within a section',async()=>{
  const project=basic(),d=project.tracks[0].development!;d.sections=[{id:'a',name:'A',pattern:'main',length:4,unit:'beats',choices:[{pattern:'other',condition:{every:2}}]}];
  const events=(await resolveProjectEvents(project)).tracks[0].events;
  assert.equal(events.find(e=>e.repetition===0)!.patternId,'main');assert.equal(events.find(e=>e.repetition===1)!.patternId,'other');
});
test('boundaries, padding, phase, warp and B are independent; inactive B truncates a tie',async()=>{
  const project=basic(),track=project.tracks[0],d=track.development!;track.phase=0.5;track.paddingBefore=0.125;
  track.timeWarpEnabled=true;track.timeWarpAmount=70;track.timeWarpCurve='ease-in';track.lengthFactor=300;
  project.bitmaskSequenceInput='1 0 1 1';
  const events=(await resolveProjectEvents(project)).tracks[0].events;
  assert.ok(events.every(e=>e.time<0.25||e.time>=0.5));assert.ok(events.filter(e=>e.time<0.25).every(e=>e.time+e.duration<=0.25+1e-8));
  assert.ok(events.every(e=>e.time+e.duration <= (e.boundaryEnd ?? Infinity)+1e-8));
  const tied=basic();tied.tracks[0].development!.patterns[0].sequence='1 1 1 1';tied.tracks[0].development!.patterns[0].steps=[{step:0,tie:true},{step:1,tie:true}];
  tied.bitmaskSequenceInput='1 0 1 1';const tiedEvents=(await resolveProjectEvents(tied)).tracks[0].events;
  assert.ok(tiedEvents.filter(e=>e.time<0.25).every(e=>e.time+e.duration<=0.25+1e-8));
  d.sections[0].boundary='carry';assert.equal(validateProject(project).valid,true);
});
test('ties reduce attacks while note-specific articulation leaves other chord notes alone',async()=>{
  const project=basic(),track=project.tracks[0],d=track.development!;track.polyphony=4;track.glideTime=0;track.lengthFactor=100;
  d.patterns[0].sequence='3 3 3 3';d.patterns[0].steps=[{step:0,note:track.octave*12,velocity:0.9}];
  const untied=(await resolveProjectEvents(project)).tracks[0].events.length;
  d.steps=[{step:0,tie:true},{step:1,tie:true}];const events=(await resolveProjectEvents(project)).tracks[0].events;
  assert.ok(events.length<untied);assert.ok(events.every(e=>e.duration>0));
  d.steps=[];const chord=(await resolveProjectEvents(project)).tracks[0].events.filter(e=>e.sectionId==='a'&&e.repetition===0&&e.step===0);
  assert.equal(chord.length,2);assert.ok(chord.some(e=>e.velocity===0.9));assert.ok(chord.some(e=>e.velocity!==0.9));
});
test('per-step locks reset; slide CC resets; timing and velocities reach MIDI',async()=>{
  const project=basic(),d=project.tracks[0].development!;d.steps=[{step:0,velocity:0.8,gate:0.5,slide:0.09,offsetBeats:0.02,locks:{filterFrequency:40}}];
  const resolved=await resolveProjectEvents(project),events=resolved.tracks[0].events;
  assert.equal(events[0].locks!.filterFrequency,40);assert.equal(events[1].locks!.filterFrequency,undefined);
  close(events[0].time,0.005);close(events[0].velocity,0.8);
  const {Midi}=ToneMidi,midi=new Midi(await generateDevelopedMidi(project));
  close(midi.tracks[0].notes[0].velocity,Math.floor(0.8*127)/127,1/127);close(midi.tracks[0].notes[0].time,events[0].time,0.002);
  close(midi.tracks[0].notes[0].duration,events[0].duration,0.002);
  assert.ok(midi.tracks[0].controlChanges[5].length>=events.length);
  assert.deepEqual(await generateMidi(presetDataToGeneratorInput(project)),await generateDevelopedMidi(project));
});
test('snapshot morphs start at the prior sound; automation and locks have explicit precedence',()=>{
  const d=normalizeDevelopment({enabled:true,snapshots:[{id:'a',name:'A',values:{filterFrequency:100}},{id:'b',name:'B',values:{filterFrequency:20}}],
    snapshotCues:[{beat:0,snapshot:'a',morphBeats:10},{beat:5,snapshot:'b',morphBeats:10}]})!;
  close(Number(evaluateControl(d,'filterFrequency',60,10)),50);
  d.automation=[{id:'c',target:'filterFrequency',interpolation:'linear',points:[{beat:0,value:30},{beat:10,value:70}]}];
  close(Number(evaluateControl(d,'filterFrequency',60,5)),50);
  close(Number(evaluateControl(d,'filterFrequency',60,5,0,{filterFrequency:80})),80);
  d.automation[0].clock='note';close(Number(evaluateControl(d,'filterFrequency',60,7,2)),50);
});
test('validation rejects invalid targets, bus locks, unsupported slides, feedback and missing samples',()=>{
  const project=basic();const d=project.tracks[0].development!;d.steps=[{step:0,locks:{gain:-12,nonexistent:2}}];
  assert.equal(validateProject(project).valid,false);
  d.steps=[{step:0,slide:0.2}];project.tracks[0].polyphony=4;assert.equal(validateProject(project).valid,false);
  d.steps=[];project.studio={version:1,seed:0,assets:[],returns:[{id:'x',name:'X',level:0,automation:[],chain:[{id:'delay',type:'delay',beats:1,feedback:1,cutoff:3000,drive:3,mode:'mono'}]}]};
  assert.equal(validateProject(project).valid,false);
  project.studio.returns=[];d.samples=[{alternatives:[{asset:'absent'}],selection:'random',start:0,gain:0,rootNote:60,tune:0,attack:0,release:0,mode:'one-shot'}];
  assert.ok(validateProject(project).diagnostics.some(d=>d.message.includes('Missing sample')));
});
test('validation rejects ignored lane scopes, malformed articulation and processor-specific targets',async()=>{
  const project=basic(),d=project.tracks[0].development!;
  d.automation=[{id:'wrong-lane',target:'filterFrequency',lane:0,interpolation:'step',points:[{beat:0,value:60}]}];
  assert.equal(validateProject(project).valid,false);
  d.automation=[];d.steps=[{step:0,tie:'false' as unknown as boolean}];assert.equal(validateProject(project).valid,false);
  d.steps=[{step:0,condition:'first' as unknown as {first:boolean}}];assert.equal(validateProject(project).valid,false);
  d.steps=[];project.tracks[0].trackKind='rhythmic';d.patterns[0].sequence='4';d.patterns[1].sequence='4';
  project.tracks[0].drumLanes=normalizePresetData({tracks:[{trackKind:'rhythmic'}]}).tracks[0].drumLanes;
  d.automation=[{id:'bus-lane',target:'gain',lane:2,interpolation:'step',points:[{beat:0,value:-20}]}];
  assert.ok(validateProject(project).diagnostics.some(e=>e.message.includes('whole track')));
  d.automation=[];d.snapshots=[{id:'level',name:'Level',values:{gain:-18}}];d.snapshotCues=[{beat:0,snapshot:'level',lane:2}];
  assert.ok(validateProject(project).diagnostics.some(e=>e.message.includes('shared bus')));
  d.snapshotCues[0].lane=99;assert.equal(validateProject(project).valid,false);
  d.snapshots=[];d.snapshotCues=[];
  project.studio={version:1,seed:0,assets:[],returns:[{id:'x',name:'X',level:0,automation:[],chain:[{id:'g',type:'gain',gain:0,feedback:0.5} as any]}]};
  assert.ok(validateProject(project).diagnostics.some(e=>e.message.includes('this processor')));
  project.studio.returns=[];
  const asset=await createSampleAsset([Array.from({length:80},(_,i)=>Math.sin(i)*0.1)],8000,'Metal');project.studio.assets=[asset];
  d.samples=[{lane:2,alternatives:[{asset:asset.hash}],selection:'round-robin',start:0,gain:0,rootNote:60,tune:0,attack:0,release:0.01,mode:'one-shot'}];
  const unsupported=Object.keys(project.tracks[0].drumLanes[2].parameters).find(k=>!['decay','brightness','tune','filterFrequency','filterResonance','filterGain','filterType','filterRolloff','echoSend','reverbSend'].includes(k));
  assert.ok(unsupported);d.patterns[0].overrides={[`lane.2.${unsupported}`]:project.tracks[0].drumLanes[2].parameters[unsupported]};
  assert.ok(validateProject(project).diagnostics.some(e=>e.message.includes('cannot alter an imported sample')));
});
test('auxiliary feedback progressively filters echoes and keeps identical state across arbitrary blocks',()=>{
  const aux={id:'dub',name:'Dub',level:0,chain:[{id:'d',type:'delay' as const,beats:0.125,feedback:0.6,cutoff:1000,drive:6,mode:'ping-pong' as const}],automation:[]};
  const left=new Float32Array(20000),right=left.slice();left[0]=1;right[0]=1;
  const excessive={...aux,chain:Array.from({length:80},(_,i)=>({id:`gain-${i}`,type:'gain' as const,gain:12}))};
  assert.throws(()=>createReturnProcessor(excessive,48000,240).processBlock(Float32Array.of(1),Float32Array.of(1)),/Non-finite audio/);
  const complete=createReturnProcessor(aux,48000,240).processBlock(left,right);
  const processor=createReturnProcessor(aux,48000,240),split=[new Float32Array(left.length),new Float32Array(left.length)];
  for(let start=0;start<left.length;start+=137){const end=Math.min(left.length,start+137),out=processor.processBlock(left.subarray(start,end),right.subarray(start,end),start);split[0].set(out[0],start);split[1].set(out[1],start);}
  assert.deepEqual(split,complete);assert.ok(complete[0][1500]>0.9);assert.ok(complete[1].some(v=>v>0));assert.ok(complete[1][3000]<0.6);
  assert.throws(()=>processor.processBlock(left,right,0),/contiguous/);
});
test('sample formats, velocity layers, round robin, seeded random and loop regions are portable',async()=>{
  const a=await createSampleAsset([Float32Array.from({length:128},(_,i)=>Math.sin(i)*0.1)],8000,'A');
  const b=await createSampleAsset([Float32Array.from({length:128},(_,i)=>Math.cos(i)*0.1)],8000,'B');
  const imported=await importWavAsset(encodeWavFromChannelsSync([Float32Array.from(a.channels[0])],8000,{dither:false}),'WAV');
  assert.equal(imported.sampleRate,8000);assert.equal(imported.channels[0].length,128);
  const source={alternatives:[{asset:a.hash},{asset:b.hash}],selection:'round-robin' as const,start:0,end:0.01,gain:0,rootNote:60,tune:0,attack:0,release:0.02,mode:'loop' as const};
  assert.equal(selectSample(source,[a,b],0.5,2,'x',0).hash,a.hash);assert.equal(selectSample(source,[a,b],0.5,2,'x',1).hash,b.hash);
  const random={...source,selection:'random' as const};assert.equal(selectSample(random,[a,b],0.5,2,'x',8).hash,selectSample(random,[a,b],0.5,2,'x',0).hash);
  const voice=createSampleVoice(a,source,60,0.03,8000);for(let i=0;i<300;i++)assert.ok(voice(i/8000).every(Number.isFinite));
  assert.throws(()=>selectSample({...source,alternatives:[{asset:a.hash,minVelocity:0.8}]},[a],0.5,1,'x',0),/velocity layer/);
});
test('full warm-up excerpts exactly equal full audio through glide, automation, samples and return tails',async()=>{
  const project=basic();project.studio={version:1,seed:3,assets:[],returns:[{id:'dub',name:'Dub',level:-12,
    chain:[{id:'d',type:'delay',beats:0.25,feedback:0.3,cutoff:3000,drive:4,mode:'ping-pong'}],automation:[]}]};
  project.tracks[0].development!.sends.dub=-6;project.tracks[0].development!.automation=[{id:'cut',target:'filterFrequency',interpolation:'smooth',points:[{beat:0,value:60},{beat:4,value:85}]}];
  project.tracks[0].filterEnabled=true;
  const cache=new MemoryRenderCache(),full=await renderDevelopment(project,{cache}),range={start:0.25,end:0.8,unit:'seconds' as const};
  const excerpt=await renderDevelopment(project,{cache,range});assert.equal(excerpt.stats.cacheHits,1);
  assert.deepEqual(excerpt.channels[0],full.channels[0].slice(12000,38400));assert.deepEqual(excerpt.preMaster[1],full.preMaster[1].slice(12000,38400));
  const blocked=await renderDevelopment(project,{cache,blockFrames:113});assert.deepEqual(blocked.channels,full.channels);
  assert.ok(full.stems.find(s=>s.kind==='return')!.channels[0].subarray(48000).some(v=>Math.abs(v)>1e-9));
});
test('stems recombine before master; file export, bounce provenance and asset packages round-trip',async()=>{
  const project=basic(),directory=await mkdtemp(join(tmpdir(),'gaterunner-development-'));
  try {
    const result=await renderDevelopment(project),sum=[new Float32Array(result.preMaster[0].length),new Float32Array(result.preMaster[0].length)];
    for(const stem of result.stems.filter(s=>s.recombine))for(let i=0;i<sum[0].length;i++){sum[0][i]+=stem.channels[0][i];sum[1][i]+=stem.channels[1][i];}
    assert.deepEqual(sum,result.preMaster);
    const manifest=await exportStems(project,directory);assert.ok(manifest.files.every(f=>f.file.endsWith('.wav')));
    const asset=await bounceSample(project,'Bass excerpt','bass',{range:{start:0,end:1,unit:'beats'}});assert.equal(asset.provenance!.source,'bass');
    project.studio={version:1,seed:0,returns:[],assets:[asset]};const path=join(directory,'project.json');await exportProjectPackage(project,path);
    assert.deepEqual(await loadProject(path),project);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('completed disk cache entries validate payloads; cache keys include every audible dependency',async()=>{
  const project=basic(),directory=await mkdtemp(join(tmpdir(),'gaterunner-cache-'));
  try{
    const cache=new DiskRenderCache(directory),first=await renderDevelopment(project,{cache});assert.equal(first.stats.cacheHits,0);
    const second=await renderDevelopment(project,{cache});assert.equal(second.stats.cacheHits,1);assert.deepEqual(second.channels,first.channels);
    const file=join(directory,(await readdir(directory))[0]),bytes=await readFile(file);bytes[bytes.length-1]^=1;await writeFile(file,bytes);
    assert.equal((await renderDevelopment(project,{cache})).stats.cacheHits,0);
    const original=await renderKey(project);for(const edit of [(p:typeof project)=>p.tracks[0].gain--,(p:typeof project)=>p.tracks[0].development!.seed++,
      (p:typeof project)=>p.tracks[0].development!.sections[0].length++,(p:typeof project)=>p.tracks[0].development!.automation.push({id:'x',target:'gain',interpolation:'step',points:[{beat:0,value:-20}]})]){
      const copy=clonePresetData(project);edit(copy);assert.notEqual(await renderKey(copy),original);
    }
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('cancellation preserves only completed tracks and resumption uses them',async()=>{
  const project=basic();project.tracks.push({...clonePresetTrackData(project.tracks[0]),id:'second'});
  const cache=new MemoryRenderCache(),controller=new AbortController();
  await assert.rejects(renderDevelopment(project,{cache,signal:controller.signal,onProgress:p=>{if(p.completed===1)controller.abort();}}),/abort/i);
  const resumed=await renderDevelopment(project,{cache});assert.equal(resumed.stats.cacheHits,1);assert.equal(resumed.stats.renderedTracks,1);
  const aborted=new AbortController();aborted.abort();await assert.rejects(renderDevelopment(project,{signal:aborted.signal}),/abort/i);
});
test('feature query names supported controls and demo has sample assets, sparse/fill sections and throw',async()=>{
  assert.equal(supportedFeatures().version,'2026.10.7');const demo=await loadProject('cli/fixtures/development-demo.json');
  assert.equal(validateProject(demo).valid,true);assert.equal(demo.studio!.assets.length,2);
  const resolved=await resolveProjectEvents(demo);assert.equal(resolved.beats,64);assert.equal(resolved.tracks.length,3);
  assert.ok(resolved.tracks[0].events.some(e=>e.sectionId==='bass-sparse'));assert.ok(resolved.tracks[1].events.some(e=>e.sectionId==='drums-fill'));
});
