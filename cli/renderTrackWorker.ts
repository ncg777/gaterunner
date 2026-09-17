import { parentPort, workerData } from 'node:worker_threads';
import {
  createWavRenderSession,
  type GenerateOptions,
  type WavChannelRenderResult,
} from './generate.js';

interface RenderWorkerData {
  options: GenerateOptions;
}

const data = workerData as RenderWorkerData;
// Keep preparation lazy so a rejected initialization is handled by the job reply.
let session: ReturnType<typeof createWavRenderSession> | undefined;

parentPort?.on('message', async (trackIndex: number) => {
  try {
    session ??= createWavRenderSession(data.options);
    const result = (await session).renderTrack(trackIndex);
    const transferList: ArrayBuffer[] = [
      result.left.buffer as ArrayBuffer,
      result.right.buffer as ArrayBuffer,
    ];
    if (result.reverbLeft) {
      transferList.push(result.reverbLeft.buffer as ArrayBuffer);
    }
    if (result.reverbRight) {
      transferList.push(result.reverbRight.buffer as ArrayBuffer);
    }
    parentPort?.postMessage({ result } satisfies { result: WavChannelRenderResult }, transferList);
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    parentPort?.postMessage({ error: message });
  }
});
