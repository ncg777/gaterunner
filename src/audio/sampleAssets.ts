import { seededChoice, type SampleAsset, type SampleSource } from '../domain/development.js';

/** Hash canonical Float32 PCM plus sample rate/channel count, independent of file metadata. */
export async function sampleContentHash(channels: readonly ArrayLike<number>[], sampleRate: number): Promise<string> {
  const frames = channels[0]?.length ?? 0;
  const bytes = new Uint8Array(12 + frames * channels.length * 4), view = new DataView(bytes.buffer);
  view.setUint32(0, sampleRate, true); view.setUint32(4, channels.length, true); view.setUint32(8, frames, true);
  let offset = 12;
  for (const channel of channels) {
    if (channel.length !== frames) throw new Error('Sample channels must have equal lengths');
    for (let i = 0; i < frames; i++, offset += 4) {
      if (!Number.isFinite(channel[i])) throw new Error('Sample contains non-finite PCM');
      view.setFloat32(offset, channel[i], true);
    }
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
}
export async function createSampleAsset(channels: readonly ArrayLike<number>[], sampleRate: number, name: string,
  provenance?: SampleAsset['provenance']): Promise<SampleAsset> {
  const canonical = channels.map(channel => Array.from(channel, value => Math.fround(value)));
  return { hash: await sampleContentHash(canonical, sampleRate), name, sampleRate, channels: canonical,
    ...(provenance ? { provenance } : {}) };
}
/** Portable import: RIFF WAVE PCM 8/16/24/32-bit and IEEE float 32/64-bit, mono/stereo. */
export async function importWavAsset(bytes: Uint8Array, name: string): Promise<SampleAsset> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (bytes.length < 12 || text(0, 4) !== 'RIFF' || text(8, 4) !== 'WAVE') throw new Error('Import a RIFF WAV file');
  let format = 0, channels = 0, sampleRate = 0, bits = 0, blockAlign = 0, dataOffset = 0, dataLength = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const length = view.getUint32(offset + 4, true), next = offset + 8 + length;
    if (next > bytes.length) throw new Error('Truncated WAV chunk');
    if (text(offset, 4) === 'fmt ') {
      if (length < 16) throw new Error('Truncated WAV format');
      format = view.getUint16(offset + 8, true); channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true); blockAlign = view.getUint16(offset + 20, true); bits = view.getUint16(offset + 22, true);
      if (format === 0xfffe && length >= 40) format = view.getUint16(offset + 32, true);
    } else if (text(offset, 4) === 'data') { dataOffset = offset + 8; dataLength = length; }
    offset = next + (length % 2);
  }
  if (![1, 3].includes(format) || ![1, 2].includes(channels) || sampleRate < 8000 || sampleRate > 192000
    || !(format === 1 ? [8, 16, 24, 32] : [32, 64]).includes(bits) || blockAlign !== channels * bits / 8 || !dataLength)
    throw new Error('Supported WAV: mono/stereo PCM 8/16/24/32 or float 32/64, 8–192 kHz');
  const frames = Math.floor(dataLength / blockAlign), decoded = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channels; channel++) {
    const p = dataOffset + frame * blockAlign + channel * bits / 8;
    const sample = format === 3 ? (bits === 32 ? view.getFloat32(p, true) : view.getFloat64(p, true))
      : bits === 8 ? (view.getUint8(p) - 128) / 128 : bits === 16 ? view.getInt16(p, true) / 32768
      : bits === 32 ? view.getInt32(p, true) / 2147483648 : ((view.getUint8(p) | view.getUint8(p + 1) << 8 | view.getInt8(p + 2) << 16) / 8388608);
    if (!Number.isFinite(sample) || Math.abs(sample) > 32) throw new Error('Invalid sample PCM');
    decoded[channel][frame] = sample;
  }
  return createSampleAsset(decoded, sampleRate, name);
}
export function selectSample(source: SampleSource, assets: readonly SampleAsset[], velocity: number, seed: number,
  eventId: string, ordinal: number): SampleAsset {
  const alternatives = source.alternatives.filter(a => velocity >= (a.minVelocity ?? 0) && velocity <= (a.maxVelocity ?? 1));
  if (!alternatives.length) throw new Error(`No sample velocity layer for ${velocity}`);
  const index = source.selection === 'random' ? Math.floor(seededChoice(seed, eventId, 'sample') * alternatives.length)
    : ordinal % alternatives.length;
  const asset = assets.find(a => a.hash === alternatives[index].asset);
  if (!asset) throw new Error(`Missing sample asset ${alternatives[index].asset}`);
  return asset;
}
/** Per-voice region/loop phase. Loop wraps within the region; envelope release stops it. */
export interface SamplePlaybackState { position?: number }
export function createSampleVoice(asset: SampleAsset, source: SampleSource, midi: number, duration: number, outputRate: number,
  state: SamplePlaybackState = {}, envelopeOffset = 0) {
  const begin = Math.floor(source.start * asset.sampleRate), end = Math.min(asset.channels[0].length,
    Math.floor((source.end ?? asset.channels[0].length / asset.sampleRate) * asset.sampleRate));
  if (end <= begin) throw new Error('Empty sample region');
  const rate = asset.sampleRate / outputRate * 2 ** ((midi - source.rootNote + source.tune) / 12);
  const gain = 10 ** (source.gain / 20);
  state.position ??= begin;
  return (elapsed: number, frequencyRatio = 1): [number, number] => {
    const envelope = Math.min(1, (elapsed + envelopeOffset) / Math.max(1 / outputRate, source.attack))
      * (elapsed <= duration ? 1 : Math.max(0, 1 - (elapsed - duration) / Math.max(1 / outputRate, source.release)));
    if (state.position! >= end && source.mode === 'loop') state.position = begin + (state.position! - begin) % (end - begin);
    const position = state.position!;
    if (position >= end || envelope <= 0 && elapsed > duration) return [0, 0];
    const p = Math.floor(position), frac = position - p;
    const next = p + 1 < end ? p + 1 : source.mode === 'loop' ? begin : p;
    const sample = (channel: number) => { const data = asset.channels[Math.min(channel, asset.channels.length - 1)];
      return (data[p] * (1 - frac) + data[next] * frac) * envelope * gain; };
    const result: [number, number] = [sample(0), sample(1)]; state.position = position + rate * frequencyRatio; return result;
  };
}
