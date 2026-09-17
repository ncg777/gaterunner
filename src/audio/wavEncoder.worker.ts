import { createWavEncoder, type WavEncoder } from './wav';
import type { WavEncodeRequest, WavEncodeResponse } from './wavWorkerProtocol';

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<WavEncodeRequest>) => void;
  postMessage(message: WavEncodeResponse, transfer?: Transferable[]): void;
};
let encoder: WavEncoder | undefined;
let encodedFrames = 0;

scope.onmessage = ({ data }) => {
  try {
    if (data.type === 'init') {
      encoder = createWavEncoder(data.channels, data.frames, data.sampleRate, { dither: data.dither });
      encodedFrames = 0;
    } else {
      if (!encoder) throw new Error('WAV encoder has not been initialized.');
      const frames = data.channels[0]?.length ?? 0;
      encoder.encodeFrames(data.channels, 0, frames);
      encodedFrames += frames;
    }
    if (encoder && encodedFrames === encoder.frameCount) {
      const bytes = encoder.bytes;
      scope.postMessage({ type: 'complete', bytes }, [bytes.buffer as ArrayBuffer]);
      encoder = undefined;
    } else {
      scope.postMessage({ type: 'ready', frames: encodedFrames });
    }
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    encoder = undefined;
  }
};
