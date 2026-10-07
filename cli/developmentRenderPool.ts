import { Worker } from 'node:worker_threads';
import type { PresetData } from '../src/presets.js';
import type { DevelopmentRenderOptions, DevelopmentRenderResult } from '../src/audio/developmentRender.js';
export function renderOffThread(project:PresetData,options:DevelopmentRenderOptions & {cacheDirectory?:string}):Promise<DevelopmentRenderResult>{
  options.signal?.throwIfAborted();
  const extension=import.meta.url.endsWith('.ts')?'ts':'js',url=new URL(`./developmentRenderWorker.${extension}`,import.meta.url);
  const {signal,onProgress,cache:_cache,cacheDirectory,...serializable}=options;
  const data={project,options:serializable,cacheDirectory,moduleUrl:url.href};
  const worker=extension==='ts'?new Worker(`const {workerData}=require('node:worker_threads'); import('tsx/esm/api').then(({tsImport})=>tsImport(workerData.moduleUrl,workerData.moduleUrl));`,{eval:true,workerData:data})
    :new Worker(url,{workerData:data});
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{signal?.removeEventListener('abort',cancel);worker.removeAllListeners();void worker.terminate();};
    const cancel=()=>{cleanup();reject(signal?.reason ?? new Error('Render aborted'));};
    signal?.addEventListener('abort',cancel,{once:true});
    worker.on('message',message=>{if(message.progress){try{onProgress?.(message.progress);}catch(error){cleanup();reject(error);}return;}cleanup();message.error?reject(new Error(message.error)):resolve(message.rendered);});
    worker.once('error',error=>{cleanup();reject(error);});worker.once('exit',code=>{cleanup();reject(new Error(`Render worker exited before completion (${code})`));});
  });
}
