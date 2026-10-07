import { parentPort, workerData } from 'node:worker_threads';
import { renderDevelopment } from '../src/audio/developmentRender.js';
import { DiskRenderCache } from './diskRenderCache.js';
try {
  const rendered=await renderDevelopment(workerData.project,{...workerData.options,
    cache:workerData.cacheDirectory?new DiskRenderCache(workerData.cacheDirectory):undefined,
    onProgress:progress=>parentPort!.postMessage({progress})});
  const buffers=new Set<ArrayBuffer>();
  [...rendered.channels,...rendered.preMaster,...rendered.stems.flatMap(s=>s.channels)].forEach(c=>buffers.add(c.buffer as ArrayBuffer));
  parentPort!.postMessage({rendered},[...buffers]);
}catch(error){parentPort!.postMessage({error:error instanceof Error?error.message:String(error)});}
