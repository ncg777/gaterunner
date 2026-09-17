import { availableParallelism, freemem } from 'node:os';
import { Worker } from 'node:worker_threads';
import {
  createWavRenderSession,
  type GenerateOptions,
  type WavChannelRenderResult,
} from './generate.js';

interface WorkerResultMessage {
  result?: WavChannelRenderResult;
  error?: string;
}

export function resolvedThreadCount(requestedThreads: number | undefined, trackCount: number,
  estimatedTrackBytes = 1, availableBytes = freemem()): number {
  const automatic = Math.max(1, availableParallelism() - 1);
  const requested = Number.isFinite(requestedThreads)
    ? Math.max(1, Math.floor(requestedThreads as number))
    : automatic;
  // Allow two outstanding tracks per worker, retaining source-order mixing.
  const budget = Math.min(1024 ** 3, availableBytes / 2);
  const memoryLimit = Math.max(1, Math.floor(budget / (2 * estimatedTrackBytes)));
  return Math.min(trackCount, requested, memoryLimit);
}

function createRenderWorker(options: GenerateOptions): Worker {
  const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
  const workerUrl = new URL(`./renderTrackWorker.${extension}`, import.meta.url);
  return extension === 'ts'
    ? new Worker(`
        const { workerData } = require('node:worker_threads');
        import('tsx/esm/api').then(({ tsImport }) => tsImport(workerData.moduleUrl, workerData.moduleUrl));
      `, { eval: true, workerData: { options, moduleUrl: workerUrl.href } })
    : new Worker(workerUrl, { workerData: { options } });
}

function renderTrackInWorker(worker: Worker, trackIndex: number): Promise<WavChannelRenderResult> {
  return new Promise<WavChannelRenderResult>((resolve, reject) => {
    const cleanup = () => {
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
    };
    const onMessage = (message: WorkerResultMessage) => {
      cleanup();
      if (message.error || !message.result) {
        reject(new Error(message.error ?? 'WAV render worker returned no result.'));
        return;
      }
      resolve(message.result);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number) => {
      cleanup();
      reject(new Error(`WAV render worker exited before returning a result (code ${code}).`));
    };
    worker.once('message', onMessage);
    worker.once('error', onError);
    worker.once('exit', onExit);
    worker.postMessage(trackIndex);
  });
}

export async function* iterateWavChannelRenders(
  options: GenerateOptions,
  trackCount: number,
  requestedThreads?: number,
): AsyncGenerator<WavChannelRenderResult> {
  const snapshot = structuredClone(options);
  const session = await createWavRenderSession(snapshot);
  const threadCount = resolvedThreadCount(requestedThreads, trackCount, session.estimatedTrackBytes);
  if (threadCount <= 1) {
    for (let trackIndex = 0; trackIndex < trackCount; trackIndex += 1) {
      yield session.renderTrack(trackIndex);
    }
    return;
  }

  const workers: Worker[] = [];
  const pending = new Map<number, Promise<WorkerResultMessage>>();
  const idle = new Set<Worker>();
  let nextTrack = 0;
  let consumed = 0;
  let stopped = false;
  const dispatch = (worker: Worker): void => {
    if (stopped || nextTrack >= trackCount || nextTrack >= consumed + 2 * threadCount) {
      idle.add(worker);
      return;
    }
    idle.delete(worker);
    const index = nextTrack++;
    const task = renderTrackInWorker(worker, index).then(
      (result): WorkerResultMessage => ({ result }),
      (error: unknown): WorkerResultMessage => ({ error: error instanceof Error ? error.message : String(error) }),
    ).then(message => {
      // Refill on completion, without waiting for earlier tracks to finish mixing.
      dispatch(worker);
      return message;
    });
    pending.set(index, task);
  };
  try {
    for (let trackIndex = 0; trackIndex < threadCount; trackIndex += 1) {
      const worker = createRenderWorker(snapshot);
      workers.push(worker);
      dispatch(worker);
    }
    for (let trackIndex = 0; trackIndex < trackCount; trackIndex += 1) {
      const message = await pending.get(trackIndex);
      pending.delete(trackIndex);
      if (!message?.result) {
        throw new Error(message?.error ?? 'WAV render worker returned no result.');
      }
      yield message.result;
      consumed = trackIndex + 1;
      for (const worker of [...idle]) dispatch(worker);
    }
  } finally {
    stopped = true;
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
}

export async function renderWavChannelsInPool(
  options: GenerateOptions,
  trackCount: number,
  requestedThreads?: number,
): Promise<WavChannelRenderResult[]> {
  const results: WavChannelRenderResult[] = [];
  for await (const result of iterateWavChannelRenders(options, trackCount, requestedThreads)) {
    results.push(result);
  }
  return results;
}
