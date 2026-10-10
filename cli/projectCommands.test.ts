import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {normalizePresetData,clonePresetTrackData} from '../src/presets.js';
import {normalizeDevelopment} from '../src/domain/development.js';
import {renderProject} from './projectApi.js';

test('project subcommands own their output and verbose flags; exported reports and assets reload',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'gaterunner-commands-'));
  const run=(...args:string[])=>{
    const result=spawnSync(process.execPath,['--import','tsx','cli/cli.ts',...args],{encoding:'utf8',timeout:30000});
    assert.equal(result.status,0,result.stderr);return result.stdout;
  };
  try{
    const project=normalizePresetData({bpm:300,tracks:[{id:'bass',sequenceInput:'1 2',gain:-20,release:0.01,
      development:normalizeDevelopment({enabled:true,seed:3})}]});
    const input=join(directory,'project.json');await writeFile(input,JSON.stringify(project));
    assert.equal(JSON.parse(run('features')).version,'2026.10.9');
    assert.equal(JSON.parse(run('validate','--project',input)).valid,true);
    const events=join(directory,'events.json');run('resolve','--project',input,'--output',events);assert.ok(JSON.parse(await readFile(events,'utf8')).tracks[0].events.length);
    const output=join(directory,'range.wav'),report=join(directory,'report.json');
    run('render','--project',input,'--output',output,'--start','0.05','--end','0.1','--unit','seconds','--verbose','--report',report);
    assert.equal((await readFile(output)).subarray(0,4).toString(),'RIFF');assert.equal(JSON.parse(await readFile(report,'utf8')).measurements.duration,0.05);
    const packed=join(directory,'package.json');run('pack','--project',input,'--output',packed);assert.equal(JSON.parse(await readFile(packed,'utf8')).type,'gaterunner-asset-package');
    const unsupportedPackage=join(directory,'unsupported-package.json');await writeFile(unsupportedPackage,JSON.stringify({type:'gaterunner-asset-package',version:2,project}));
    const invalid=spawnSync(process.execPath,['--import','tsx','cli/cli.ts','validate','--project',unsupportedPackage],{encoding:'utf8',timeout:30000});
    assert.equal(invalid.status,1);assert.ok(JSON.parse(invalid.stdout).diagnostics.some((d:{message:string})=>d.message.includes('package version')));
    const stems=join(directory,'stems');run('stems','--project',input,'--output',stems,'--start','0.05','--end','0.1','--unit','seconds','--stem-stage','post','--no-lane-stems','--no-pre-insert-stems');
    const manifest=JSON.parse(await readFile(join(stems,'stems.json'),'utf8'));assert.equal(manifest.stemStage,'post');assert.ok(manifest.files.every((f:{recombine:boolean})=>f.recombine));
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('worker cancellation resumes only completed disk entries and progress exceptions reject',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'gaterunner-worker-cache-'));
  try{
    const project=normalizePresetData({bpm:300,tracks:[{id:'a',sequenceInput:'1 2',gain:-20,release:0.01,
      development:normalizeDevelopment({enabled:true})}]});
    project.tracks.push({...clonePresetTrackData(project.tracks[0]),id:'b'});
    const controller=new AbortController();
    await assert.rejects(renderProject(project,{cacheDirectory:directory,signal:controller.signal,
      onProgress:p=>{if(p.completed===1)controller.abort();}}),/abort/i);
    const resumed=await renderProject(project,{cacheDirectory:directory});assert.ok(resumed.stats.cacheHits>=1);
    await assert.rejects(renderProject(project,{signal:new AbortController().signal,
      onProgress:()=>{throw new Error('Progress failed');}}),/Progress failed/);
  }finally{await rm(directory,{recursive:true,force:true});}
});
