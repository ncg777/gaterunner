import type { PresetData } from '../presets.js';
import type { DevelopmentRenderOptions, DevelopmentRenderResult } from './developmentRender.js';
let worker: Worker | undefined, request = 0, busy = false;
/** The shared native DSP runs off the UI thread; cancellation terminates its audio state. */
export async function renderBrowserDevelopment(project: PresetData, options: DevelopmentRenderOptions = {}): Promise<DevelopmentRenderResult> {
  options.signal?.throwIfAborted();
  if (busy) throw new Error('A render is already running');
  worker ??= new Worker(new URL('./developmentRender.worker.ts', import.meta.url), { type: 'module' });
  busy = true; const active = worker, id = ++request;
  return new Promise((resolve, reject) => {
    const cleanup = () => { active.removeEventListener('message', message); active.removeEventListener('error', failed);
      options.signal?.removeEventListener('abort', cancel); busy = false; };
    const cancel = () => { active.terminate(); worker = undefined; cleanup(); reject(options.signal?.reason ?? new DOMException('Cancelled', 'AbortError')); };
    const failed = (event: ErrorEvent) => { active.terminate(); worker = undefined; cleanup(); reject(new Error(event.message)); };
    const message = (event: MessageEvent) => {
      if (event.data.id !== id) return;
      if (event.data.progress) { try{options.onProgress?.(event.data.progress);}catch(error){active.terminate();worker=undefined;cleanup();reject(error);} return; }
      cleanup(); if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.rendered);
    };
    active.addEventListener('message', message); active.addEventListener('error', failed);
    options.signal?.addEventListener('abort', cancel, { once: true });
    const { signal: _signal, onProgress: _progress, cache: _cache, ...serializable } = options;
    active.postMessage({ id, project: JSON.parse(JSON.stringify(project)), options: serializable });
  });
}
