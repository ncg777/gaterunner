export type WavEncodeRequest =
  | { type: 'init'; channels: number; frames: number; sampleRate: number; dither?: boolean }
  | { type: 'chunk'; channels: Float32Array[] };

export type WavEncodeResponse =
  | { type: 'ready'; frames: number }
  | { type: 'complete'; bytes: Uint8Array }
  | { type: 'error'; message: string };

// One stereo chunk is 2 MiB. Only one chunk is in flight at a time.
export const WAV_WORKER_CHUNK_FRAMES = 262144;
