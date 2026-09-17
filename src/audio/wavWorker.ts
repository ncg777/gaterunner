import { encodeWavFromChannels, type EncodeWavOptions } from './wav';
import { WAV_WORKER_CHUNK_FRAMES, type WavEncodeRequest, type WavEncodeResponse } from './wavWorkerProtocol';

class WavWorkerError extends Error {}

/** Transfer bounded PCM copies; AudioBuffer channel storage stays attached. */
export async function encodeWavInWorker(
  channels: Float32Array[],
  sampleRate: number,
  options: EncodeWavOptions = {},
): Promise<Uint8Array> {
  options.signal?.throwIfAborted();
  let worker: Worker;
  try {
    worker = new Worker(new URL('./wavEncoder.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return encodeWavFromChannels(channels, sampleRate, options);
  }
  let onAbort: (() => void) | undefined;
  try {
    return await new Promise<Uint8Array>((resolve, reject) => {
      onAbort = () => {
        worker.terminate();
        reject(options.signal!.reason);
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });
      const frameCount = channels[0]?.length ?? 0;
      const post = (message: WavEncodeRequest, transfer: Transferable[] = []) => {
        try { worker.postMessage(message, transfer); }
        catch (error) { reject(new WavWorkerError(String(error))); }
      };
      worker.onerror = event => {
        event.preventDefault();
        reject(new WavWorkerError(event.message));
      };
      worker.onmessageerror = () => reject(new WavWorkerError('Unable to receive encoded WAV.'));
      worker.onmessage = ({ data }: MessageEvent<WavEncodeResponse>) => {
        if (options.signal?.aborted) return;
        if (data.type === 'error') {
          reject(new WavWorkerError(data.message));
          return;
        }
        try {
          options.onProgress?.(data.type === 'complete' ? 1 : data.frames / Math.max(1, frameCount));
          options.signal?.throwIfAborted();
        } catch (error) {
          // Callback errors belong to the caller, not to the worker fallback.
          reject(error);
          return;
        }
        if (data.type === 'complete') {
          resolve(data.bytes);
          return;
        }
        try {
          const end = Math.min(frameCount, data.frames + WAV_WORKER_CHUNK_FRAMES);
          const chunk = channels.map(channel => channel.slice(data.frames, end));
          post({ type: 'chunk', channels: chunk }, chunk.map(channel => channel.buffer));
        } catch (error) {
          reject(new WavWorkerError(String(error)));
        }
      };
      post({ type: 'init', channels: channels.length, frames: frameCount, sampleRate, dither: options.dither });
    });
  } catch (error) {
    options.signal?.throwIfAborted();
    if (!(error instanceof WavWorkerError)) throw error;
    // Keep export working in browsers/CSP configurations that cannot run workers.
    worker.terminate();
    return encodeWavFromChannels(channels, sampleRate, options);
  } finally {
    if (onAbort) options.signal?.removeEventListener('abort', onAbort);
    worker.terminate();
  }
}
