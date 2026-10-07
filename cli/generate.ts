export * from '../src/audio/nativeRenderer.js';
import { combineWavChannelRenders, renderWavChannels, type GenerateOptions, type WavRenderOptions } from '../src/audio/nativeRenderer.js';
import { usesDevelopment } from '../src/domain/development.js';
import { encodeWavFromChannelsSync } from '../src/audio/wav.js';
export async function generateWav(
  options: GenerateOptions,
  renderOptions: WavRenderOptions = {},
): Promise<Uint8Array> {
  if (usesDevelopment(options)) {
    const started=performance.now();
    const { renderDevelopment, generatorProject } = await import('../src/audio/developmentRender.js');
    const rendered = await renderDevelopment(generatorProject(options));
    renderOptions.onTiming?.({stage:'render',milliseconds:performance.now()-started});
    const encodeStarted=performance.now(),bytes=encodeWavFromChannelsSync(rendered.channels, rendered.sampleRate);
    renderOptions.onTiming?.({stage:'encode',milliseconds:performance.now()-encodeStarted});
    return bytes;
  }
  const renderStarted = performance.now();
  const trackCount = Array.isArray(options.tracks) && options.tracks.length > 0 ? options.tracks.length : 1;
  let rendered: { channels: Float32Array[]; sampleRate: number };
  if (trackCount === 1) {
    rendered = await combineWavChannelRenders([await renderWavChannels(options)]);
  } else {
    try {
      const { iterateWavChannelRenders } = await import('./renderPool.js');
      rendered = await combineWavChannelRenders(iterateWavChannelRenders(options, trackCount, renderOptions.threads));
    } catch {
      rendered = await combineWavChannelRenders([await renderWavChannels(options)]);
    }
  }
  renderOptions.onTiming?.({ stage: 'render', milliseconds: performance.now() - renderStarted });

  const encodeStarted = performance.now();
  const bytes = encodeWavFromChannelsSync(rendered.channels, rendered.sampleRate);
  renderOptions.onTiming?.({ stage: 'encode', milliseconds: performance.now() - encodeStarted });
  return bytes;
}
