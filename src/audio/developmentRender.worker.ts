/// <reference lib="webworker" />
import { renderDevelopment, type DevelopmentRenderOptions } from './developmentRender.js';
import { MemoryRenderCache } from './renderCache.js';
import type { PresetData } from '../presets.js';
const cache = new MemoryRenderCache();
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async (message: MessageEvent<{ id: number; project: PresetData; options: DevelopmentRenderOptions }>) => {
  const { id, project, options } = message.data;
  try {
    const rendered = await renderDevelopment(project, { ...options, cache,
      onProgress: progress => scope.postMessage({ id, progress }) });
    const buffers=new Set<ArrayBuffer>();
    [...rendered.channels,...rendered.preMaster,...rendered.stems.flatMap(s=>s.channels)].forEach(c=>buffers.add(c.buffer as ArrayBuffer));
    scope.postMessage({ id, rendered },[...buffers]);
  } catch (error) { scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
};
