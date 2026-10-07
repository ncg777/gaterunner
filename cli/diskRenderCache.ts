import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { RENDERER_VERSION, canonicalJSON, type RenderCache } from '../src/audio/renderCache.js';
import type { WavChannelRenderResult } from './generate.js';

interface Descriptor { name: string; type: 'f32' | 'f64'; length: number; offset: number }
/** Atomic completed entries, checked against renderer version, key, payload hash and dimensions. */
export class DiskRenderCache implements RenderCache {
  constructor(readonly directory: string) {}
  private file(key: string) { if (!/^[0-9a-f]{64}$/.test(key)) throw new Error('Invalid cache key'); return join(this.directory, `${key}.grcache`); }
  async get(key: string): Promise<WavChannelRenderResult | undefined> {
    try {
      const data = await readFile(this.file(key)), headerLength = data.readUInt32LE(0);
      if (headerLength < 1 || headerLength > 100000 || data.length < headerLength + 4) return undefined;
      const header = JSON.parse(data.subarray(4, headerLength + 4).toString('utf8'));
      const payload = data.subarray(headerLength + 4);
      const identity={version:header.version,key:header.key,arrays:header.arrays,settings:header.settings,auxIds:header.auxIds};
      if (header.version !== RENDERER_VERSION || header.key !== key || createHash('sha256').update(payload).update(canonicalJSON(identity)).digest('hex') !== header.hash) return undefined;
      const arrays: Record<string, Float32Array | Float64Array> = {};
      let expected = 0;
      for (const d of header.arrays as Descriptor[]) {
        const bytes = d.length * (d.type === 'f64' ? 8 : 4);
        if (!Number.isInteger(d.length) || d.length < 1 || d.offset !== expected || d.offset + bytes > payload.length || !['f32', 'f64'].includes(d.type)) return undefined;
        const copy = new Uint8Array(payload.subarray(d.offset, d.offset + bytes)).buffer;
        const array = d.type === 'f64' ? new Float64Array(copy) : new Float32Array(copy);
        if (array.some(v => !Number.isFinite(v))) return undefined;
        arrays[d.name] = array; expected += bytes;
      }
      if (expected !== payload.length || !arrays.left || arrays.left.length !== arrays.right?.length || header.settings.sampleRate !== 48000
        || Object.values(arrays).some(a=>a.length!==arrays.left.length)) return undefined;
      const auxSends: Record<string, [Float32Array, Float32Array]> = Object.create(null);
      for (const id of header.auxIds as string[]) {
        const l = arrays[`aux.${id}.left`], r = arrays[`aux.${id}.right`];
        if (!(l instanceof Float32Array) || !(r instanceof Float32Array) || l.length !== arrays.left.length || r.length !== l.length) return undefined;
        auxSends[id] = [l, r];
      }
      return { ...header.settings, left: arrays.left, right: arrays.right, reverbLeft: arrays.reverbLeft ?? null,
        reverbRight: arrays.reverbRight ?? null, ...(header.auxIds.length ? { auxSends } : {}) };
    } catch { return undefined; }
  }
  async put(key: string, result: WavChannelRenderResult) {
    const arrays: Descriptor[] = [], chunks: Buffer[] = []; let offset = 0;
    const add = (name: string, value: Float32Array | Float64Array | null) => {
      if (!value) return;
      const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      arrays.push({ name, type: value instanceof Float64Array ? 'f64' : 'f32', length: value.length, offset }); chunks.push(bytes); offset += bytes.length;
    };
    add('left', result.left); add('right', result.right); add('reverbLeft', result.reverbLeft); add('reverbRight', result.reverbRight);
    for (const [id, pair] of Object.entries(result.auxSends ?? {})) { add(`aux.${id}.left`, pair[0]); add(`aux.${id}.right`, pair[1]); }
    const payload = Buffer.concat(chunks), settings = { sampleRate: result.sampleRate, a4: result.a4, masterGain: result.masterGain, reverb: result.reverb };
    const identity={version:RENDERER_VERSION,key,arrays,settings,auxIds:Object.keys(result.auxSends ?? {})};
    const header = Buffer.from(JSON.stringify({...identity,hash:createHash('sha256').update(payload).update(canonicalJSON(identity)).digest('hex')}));
    const prefix = Buffer.alloc(4); prefix.writeUInt32LE(header.length);
    await mkdir(this.directory, { recursive: true });
    const path = this.file(key), temporary = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, Buffer.concat([prefix, header, payload])); await rename(temporary, path); }
    finally { await unlink(temporary).catch(() => {}); }
  }
}
