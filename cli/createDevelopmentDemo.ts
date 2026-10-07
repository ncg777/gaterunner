/** Reproducible application fixture; this is not a separate composition release. */
import { writeFileSync } from 'node:fs';
import { normalizePresetData, createNamedPreset, buildSinglePresetExport } from '../src/presets.js';
import { normalizeDevelopment } from '../src/domain/development.js';
import { createSampleAsset } from '../src/audio/sampleAssets.js';
import { createDefaultRhythmLanes } from '../src/domain/rhythmTrack.js';
import { requireValidProject } from '../src/domain/projectValidation.js';
const metallic = (frequency: number) => Float32Array.from({length:640},(_,i)=>0.35*Math.exp(-i/130)*
  (Math.sin(2*Math.PI*frequency*i/8000)+0.4*Math.sin(2*Math.PI*frequency*1.713*i/8000)));
const assets = [await createSampleAsset([metallic(1550)],8000,'Metal A'),await createSampleAsset([metallic(1680)],8000,'Metal B')];
const sections = (prefix:string) => [
  {id:`${prefix}-main`,name:'Main groove',pattern:'main',length:4,unit:'bars' as const,boundary:'carry' as const},
  {id:`${prefix}-variation`,name:'Related phrase',pattern:'variation',length:4,unit:'bars' as const},
  {id:`${prefix}-sparse`,name:'Breathing room',pattern:'sparse',length:2,unit:'bars' as const},
  {id:`${prefix}-fill`,name:'Fill',pattern:'fill',length:2,unit:'bars' as const,fill:true},
  {id:`${prefix}-return`,name:'Return',pattern:'main',length:4,unit:'bars' as const},
];
const project = requireValidProject(normalizePresetData({bpm:120,forte:'5-35.05',masterGain:-6,
  studio:{version:1,seed:1977,assets,returns:[{id:'dub',name:'Warm dub return',level:-9,
    chain:[{id:'feedback',type:'delay',beats:0.75,feedback:0.52,cutoff:3200,drive:9,mode:'ping-pong'}],
    automation:[{id:'darken',target:'feedback.cutoff',interpolation:'smooth',points:[{beat:0,value:6500},{beat:64,value:1800}]}]}]},
  reverb:{enabled:true,decay:0.5,wet:-24,dry:0},tracks:[
    {id:'bass',name:'Related bass',sequenceInput:'1 0 0 0 1 0 4 0 0 0 2 0 1 0 0 0',denominator:4,octave:3,
      gain:-17,polyphony:1,filterEnabled:true,filterFrequency:62,attack:0.008,release:0.09,lengthFactor:70,
      development:normalizeDevelopment({enabled:true,seed:3,patterns:[
        {id:'main',name:'Main',sequence:'1 0 0 0 1 0 4 0 0 0 2 0 1 0 0 0',steps:[{step:0,velocity:0.72}]},
        {id:'variation',name:'Related',sequence:'1 0 0 0 1 0 8 0 0 0 2 0 4 0 0 0',steps:[{step:6,slide:0.07,gate:1.7},{step:12,velocity:0.65}]},
        {id:'sparse',name:'Sparse',sequence:'1 0 0 0 0 0 0 0 0 0 2 0 0 0 0 0'},
        {id:'fill',name:'Turnaround',sequence:'1 0 0 0 1 0 4 0 0 0 2 0 8 0 4 0',steps:[{step:14,condition:{every:2},velocity:0.75,slide:0.06}]},
      ],sections:sections('bass')})},
    {id:'drums',name:'Evolving hats',trackKind:'rhythmic',drumLanes:createDefaultRhythmLanes(),drumVelocityBits:1,
      sequenceInput:'5 0 4 0 6 0 4 0 5 0 4 0 6 0 4 0',denominator:4,gain:-19,
      development:normalizeDevelopment({enabled:true,seed:19,patterns:[
        {id:'main',name:'Main',sequence:'5 0 4 0 6 0 4 0 5 0 4 0 6 0 4 0'},
        {id:'variation',name:'Related',sequence:'5 0 4 0 6 0 4 0 4 0 5 0 6 0 4 0'},
        {id:'sparse',name:'Sparse',sequence:'1 0 4 0 0 0 0 0 0 0 4 0 2 0 0 0'},
        {id:'fill',name:'Fill',sequence:'5 0 4 0 6 0 4 0 5 0 4 0 6 2 4 2'},
      ],sections:sections('drums'),steps:[{step:2,lane:2,locks:{'lane.2.decay':0.03,'lane.2.brightness':2200}},
        {step:10,lane:2,condition:{every:2},velocity:0.75,locks:{'lane.2.decay':0.15,'lane.2.brightness':6500}}],
      automation:[{id:'shorten',target:'lane.2.decay',interpolation:'smooth',points:[{beat:0,value:0.13},{beat:64,value:0.04}]},
        {id:'darken',target:'lane.2.brightness',interpolation:'smooth',points:[{beat:0,value:7500},{beat:64,value:2600}]}],
      samples:[{lane:2,alternatives:assets.map(a=>({asset:a.hash,minVelocity:0,maxVelocity:1})),selection:'round-robin',
        start:0,gain:-3,rootNote:60,tune:0,attack:0.001,release:0.03,mode:'one-shot'}]})},
    {id:'chords',name:'Dub throw',sequenceInput:'3 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0',denominator:4,
      octave:5,lengthFactor:80,gain:-22,attack:0.012,release:0.4,filterEnabled:true,filterFrequency:78,
      development:normalizeDevelopment({enabled:true,seed:29,patterns:[{id:'held',name:'Held',sequence:'3 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0'}],
        sections:[{id:'texture',name:'Texture',pattern:'held',length:16,unit:'bars',boundary:'carry'}],sends:{dub:-96},
        automation:[{id:'throw',target:'send.dub',interpolation:'smooth',points:[{beat:0,value:-96},{beat:27.9,value:-96},
          {beat:28,value:-3},{beat:29,value:-3},{beat:30,value:-96},{beat:64,value:-96}]}],
        snapshots:[{id:'settled',name:'Settled texture',values:{filterFrequency:67,release:0.8}}],
        snapshotCues:[{beat:48,snapshot:'settled',morphBeats:8}]})},
]}));
const preset = createNamedPreset('Development studio demo',project,'2026-10-07T12:00:00.000Z'); preset.id='development-demo';
const exported=buildSinglePresetExport(preset); exported.exportedAt='2026-10-07T12:00:00.000Z';
writeFileSync('cli/fixtures/development-demo.json',JSON.stringify(exported,null,2)+'\n');
