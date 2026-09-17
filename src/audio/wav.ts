function nextXorshift32(state: number): number {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return state >>> 0;
}

function yieldToMainThread(): Promise<void> {
  const scheduler = (globalThis as typeof globalThis & {
    scheduler?: { yield?: () => Promise<void> };
  }).scheduler;
  if (scheduler?.yield) {
    return scheduler.yield();
  }
  if (typeof MessageChannel !== 'undefined') {
    return new Promise<void>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.addEventListener('message', () => {
        channel.port1.close();
        channel.port2.close();
        resolve();
      }, { once: true });
      channel.port1.start();
      channel.port2.postMessage(undefined);
    });
  }
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

export interface EncodeWavOptions {  /**
   * Invoked with a 0..1 ratio while the PCM data is being interleaved.
   */
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
  /**
    * Applies TPDF dither at 1 LSB before 24-bit quantization. Enabled by default;
   * dithering decorrelates quantization error from the signal, trading a tiny
   * noise floor increase for the removal of harmonic distortion at low levels.
   */
  dither?: boolean;
}

export interface WavEncoder {
  bytes: Uint8Array;
  frameCount: number;
  encodeFrames: (channels: Float32Array[], startFrame: number, endFrame: number) => void;
}

export function createWavEncoder(
  numChannels: number,
  frameCount: number,
  sampleRate: number,
  options: EncodeWavOptions = {},
): WavEncoder {
  const bitDepth = 24;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataLength = frameCount * blockAlign;
  const wavBuffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(wavBuffer);
  const bytes = new Uint8Array(wavBuffer);

  let offset = 0;
  const writeString = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      bytes[offset] = value.charCodeAt(index);
      offset += 1;
    }
  };

  writeString('RIFF');
  view.setUint32(offset, 36 + dataLength, true);
  offset += 4;
  writeString('WAVE');
  writeString('fmt ');
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, numChannels, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, sampleRate * blockAlign, true);
  offset += 4;
  view.setUint16(offset, blockAlign, true);
  offset += 2;
  view.setUint16(offset, bitDepth, true);
  offset += 2;
  writeString('data');
  view.setUint32(offset, dataLength, true);
  offset += 4;

  // WAV PCM has no Int24Array, so pack each signed sample into three little-endian bytes.
  const dither = options.dither !== false;
  // One LSB of 24-bit audio. TPDF dither is the difference of two independent
  // uniform random values in [0, 1 LSB), giving triangular noise of ±1 LSB.
  const lsb = 1 / 0x800000;
  let ditherStateA = 0x9e3779b9;
  let ditherStateB = 0x243f6a88;
  let writeIndex = 0;

  const encodeFrames = (channels: Float32Array[], startFrame: number, endFrame: number) => {
    for (let frame = startFrame; frame < endFrame; frame += 1) {
      for (let channel = 0; channel < numChannels; channel += 1) {
        const raw = channels[channel][frame];
        if (dither) {
          ditherStateA = nextXorshift32(ditherStateA);
          ditherStateB = nextXorshift32(ditherStateB);
        }
        const dithered = dither
          ? raw + ((ditherStateA - ditherStateB) / 0x100000000) * lsb
          : raw;
        const sample = dithered > 1 ? 1 : dithered < -1 ? -1 : dithered;
        const intSample = Math.round(sample < 0 ? sample * 0x800000 : sample * 0x7fffff);
        const sampleOffset = offset + writeIndex * bytesPerSample;
        bytes[sampleOffset] = intSample & 0xff;
        bytes[sampleOffset + 1] = (intSample >>> 8) & 0xff;
        bytes[sampleOffset + 2] = (intSample >>> 16) & 0xff;
        writeIndex += 1;
      }
    }
  };

  return { bytes, frameCount, encodeFrames };
}

export function encodeWavFromChannelsSync(
  channels: Float32Array[],
  sampleRate: number,
  options: EncodeWavOptions = {},
): Uint8Array {
  const encoder = createWavEncoder(channels.length, channels[0]?.length ?? 0, sampleRate, options);
  encoder.encodeFrames(channels, 0, encoder.frameCount);
  options.onProgress?.(1);
  return encoder.bytes;
}

export async function encodeWavFromChannels(
  channels: Float32Array[],
  sampleRate: number,
  options: EncodeWavOptions = {},
): Promise<Uint8Array> {
  options.signal?.throwIfAborted();
  const encoder = createWavEncoder(channels.length, channels[0]?.length ?? 0, sampleRate, options);
  const chunkSize = 262144;

  for (let chunkStart = 0; chunkStart < encoder.frameCount; chunkStart += chunkSize) {
    options.signal?.throwIfAborted();
    const chunkEnd = Math.min(encoder.frameCount, chunkStart + chunkSize);
    encoder.encodeFrames(channels, chunkStart, chunkEnd);

    options.onProgress?.(chunkEnd / encoder.frameCount);
    options.signal?.throwIfAborted();
    if (chunkEnd < encoder.frameCount) {
      await yieldToMainThread();
    }
  }

  options.onProgress?.(1);
  options.signal?.throwIfAborted();
  return encoder.bytes;
}
