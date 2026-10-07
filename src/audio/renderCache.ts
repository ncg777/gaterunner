import type { WavChannelRenderResult } from './nativeRenderer.js';
export const RENDERER_VERSION = '2026.10.7-development-3';
export function canonicalJSON(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}
export async function renderKey(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJSON({ renderer: RENDERER_VERSION, value }));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
}
export interface RenderCache { get(key: string): Promise<WavChannelRenderResult | undefined>;
  put(key: string, result: WavChannelRenderResult): Promise<void> }
export function resultBytes(result: WavChannelRenderResult): number {
  return result.left.byteLength + result.right.byteLength + (result.reverbLeft?.byteLength ?? 0)
    + (result.reverbRight?.byteLength ?? 0) + Object.values(result.auxSends ?? {}).reduce((sum, pair) => sum + pair[0].byteLength + pair[1].byteLength, 0);
}
/** Completed track buffers only; interrupted work never becomes a cache entry. */
export class MemoryRenderCache implements RenderCache {
  private entries = new Map<string, WavChannelRenderResult>(); private bytes = 0;
  constructor(readonly maximumBytes = 256 * 1024 * 1024) {}
  async get(key: string) { const result = this.entries.get(key); if (result) { this.entries.delete(key); this.entries.set(key, result); } return result; }
  async put(key: string, result: WavChannelRenderResult) {
    const bytes = resultBytes(result);
    if (bytes > this.maximumBytes || this.entries.has(key)) return;
    while (this.bytes + bytes > this.maximumBytes && this.entries.size) { const first = this.entries.keys().next().value!;
      this.bytes -= resultBytes(this.entries.get(first)!); this.entries.delete(first); }
    this.entries.set(key, result); this.bytes += bytes;
  }
  clear() { this.entries.clear(); this.bytes = 0; }
}
