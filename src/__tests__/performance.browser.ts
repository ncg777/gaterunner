import { DEFAULT_PRESET_DATA, DEFAULT_PRESET_TRACK_DATA, normalizePresetData } from '../presets';
import type App from '../App.vue';
import * as Tone from 'tone';

export function installRealtimePollingBaseline(app: InstanceType<typeof App>) {
  const update = app.updateTrackChainSettings;
  app.updateTrackChainSettings = (track, chain) => {
    update(track, chain);
    const context = chain.sourceBus.context;
    if (!context.isOffline) (context as Tone.Context).updateInterval = 0.2;
  };
}

/** Restore pre-optimization behavior inside this disposable benchmark only. */
export function installBrowserProfileBaseline() {
  const create = Tone.Context.prototype.createPeriodicWave;
  Tone.Context.prototype.createPeriodicWave = function (real, imag, constraints) {
    const length = Math.max(2048, real.length, imag.length);
    const paddedReal = new Float32Array(length);
    const paddedImag = new Float32Array(length);
    paddedReal.set(real);
    paddedImag.set(imag);
    return create.call(this, paddedReal, paddedImag, constraints);
  };
  type Clock = { _renderClock(asynchronous: boolean): Promise<void> };
  const clock = (Tone.OfflineContext.prototype as unknown as Clock)._renderClock;
  const render = Tone.OfflineContext.prototype.render;
  Tone.OfflineContext.prototype.render = function (asynchronous) {
    (this as unknown as Clock)._renderClock = clock;
    return render.call(this, asynchronous);
  };
}

/** Run only in a disposable browser profile: installs a deterministic stress project. */
export async function prepareBrowserPerformanceProject(app: InstanceType<typeof App>, project = 'wavetable') {
  app.applyDraftData(normalizePresetData({
    ...DEFAULT_PRESET_DATA, bpm: 120,
    reverb: { ...DEFAULT_PRESET_DATA.reverb, enabled: false },
    tracks: Array.from({ length: 6 }, (_, index) => ({
      ...DEFAULT_PRESET_TRACK_DATA, id: `stress-${index}`, name: `Stress ${index + 1}`,
      sequenceInput: '3 5 9 17 6 10 18 12', denominator: 8, repeats: 4,
      polyphony: 4, unisonVoices: 3, unisonDetune: 18, gain: -24,
      filterEnabled: true, filterFrequency: 90, filterEnvelopeAmount: 12,
      tonewheelWavetable: {
        enabled: true, dimensions: [{ name: 'Brightness', value: 0.4 }],
        configurations: [
          { name: 'Dark', position: [0], drawbars: [0, 0, 8, 2, 0, 0, 0, 0, 0] },
          { name: 'Bright', position: [1], drawbars: [0, 0, 5, 8, 6, 4, 2, 0, 0] },
        ],
        lfos: [{ name: 'Sweep', enabled: true, waveform: 'sine', sync: false,
          rateHz: 0.7 + index * 0.1, syncRate: '1/4', phase: 0, depth: 0.3,
          polarity: 'bipolar', retrigger: 'free', smoothing: 0.2,
          fmSource: -1, fmAmount: 0, routes: [1] }],
      },
    })),
  }));
  if (project === 'time-warp') {
    app.applyDraftData(normalizePresetData({
      ...DEFAULT_PRESET_DATA, bpm: 120,
      reverb: { ...DEFAULT_PRESET_DATA.reverb, enabled: false },
      tracks: Array.from({ length: 2 }, (_, index) => ({
        ...DEFAULT_PRESET_TRACK_DATA, id: `warp-${index}`, name: `Warp ${index + 1}`,
        sequenceInput: Array.from({ length: 64 }, (_, step) => [3, 5, 9, 17, 6, 10, 18, 12][step % 8]).join(' '),
        denominator: 16, repeats: 8, polyphony: 4, unisonVoices: 3, gain: -24,
        timeWarpEnabled: true, timeWarpCurve: index ? 'fm_saw2' : 'custom',
        timeWarpExpression: 'T + sin(PI*T)*0.25*sin(24*PI*(T+0.25*sin(10*PI*T)))',
        timeWarpRepeats: 2, timeWarpNoteLengths: true,
        filterEnabled: true, filterLfoEnabled: true, filterLfoAmount: 12,
        filterLfoRateHz: 2.7, filterFrequency: 90, filterEnvelopeAmount: 12,
      })),
    }));
  }
  await app.$nextTick();
  await new Promise(resolve => setTimeout(resolve, 250));
}

export async function runBrowserPerformance(app: InstanceType<typeof App>, mode: 'playback' | 'steady' | 'export', warmup = true) {
  if (mode === 'steady' && warmup) {
    await app.startSequencer();
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  const longTasks: number[] = [];
  const observer = new PerformanceObserver(list => {
    for (const entry of list.getEntries()) longTasks.push(entry.duration);
  });
  observer.observe({ entryTypes: ['longtask'] });
  let maxTimerGap = 0;
  let previous = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    maxTimerGap = Math.max(maxTimerGap, now - previous);
    previous = now;
  }, 10);
  const started = performance.now();
  const phases: Array<{ status: string; milliseconds: number }> = [];
  const progress = app.setWavExportProgress;
  if (mode === 'export') {
    app.setWavExportProgress = (value, status) => {
      if (phases.at(-1)?.status !== status) phases.push({ status, milliseconds: performance.now() - started });
      progress(value, status);
    };
  }
  let hash: string | undefined;
  try {
    if (mode === 'playback' || mode === 'steady') {
      if (mode === 'playback') await app.startSequencer();
      if (!app.isRunning) throw new Error('Playback did not start');
      await new Promise(resolve => setTimeout(resolve, 8000));
      app.stopSequencer();
    } else {
      const bytes = await app.renderMixWav();
      (globalThis as typeof globalThis & { performanceWav?: Uint8Array }).performanceWav = bytes;
      hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)))
        .map(value => value.toString(16).padStart(2, '0')).join('');
    }
    await new Promise(resolve => setTimeout(resolve, 30));
    return { mode, milliseconds: performance.now() - started, maxTimerGap,
      longTaskCount: longTasks.length, longestTask: Math.max(0, ...longTasks), hash, phases };
  } finally {
    app.setWavExportProgress = progress;
    clearInterval(timer);
    observer.disconnect();
    if (app.isRunning) app.stopSequencer();
  }
}
