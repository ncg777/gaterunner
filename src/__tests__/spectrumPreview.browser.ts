import { nextTick } from 'vue';
import { normalizePartialGenerator } from '../audio/partialGenerator';
import type EditorSurface from '../components/EditorSurface.vue';
import { clonePresetTrackData } from '../presets';

export async function runSpectrumPreviewChecks(editor: InstanceType<typeof EditorSurface>) {
  const labels: string[] = [];
  const check = (condition: boolean, label: string) => {
    if (!condition) throw new Error(label);
    labels.push(label);
  };
  const original = clonePresetTrackData(editor.draftTrack);
  const originalTab = editor.activeControlTab;
  const root = editor.$el as HTMLElement;
  const bars = () => [...root.querySelectorAll<SVGLineElement>('.spectrum-bar')];
  const hasWaveformSelector = () => [...root.querySelectorAll('label')].some((label) => label.textContent === 'Waveform');
  try {
    editor.activeControlTab = 'generator';
    editor.draftTrack.tonewheelWavetable.enabled = false;
    editor.draftTrack.partialGenerator = normalizePartialGenerator({ type: 'sequence', harmonicCount: 8 });
    for (const waveform of ['sine', 'square', 'choir-ah', 'pink-noise']) {
      editor.draftTrack.waveform = waveform;
      await nextTick();
      check(bars().length === 8, `Sequence displays all eight partials regardless of stored ${waveform}`);
      check(!hasWaveformSelector(), `Sequence hides inactive ${waveform} selector`);
    }
    check(bars().every((bar) => getComputedStyle(bar).stroke !== 'none'), 'Spectrum bars have a visible stroke without a global color token');
    check(bars().every((bar) => Number(bar.getAttribute('y1')) < 120), 'Nonzero partials have visible height');
    editor.updatePartialGenerator({
      sequence: 'recaman', mapping: 'modulo', mappingModulus: 5,
      mask: 'periodic', maskPeriod: 4, maskOffset: 1, invertMask: true,
    });
    await nextTick();
    check(root.textContent!.includes('Mapping modulus (5)'), 'Modulo mapping exposes its modulus control');
    check(root.textContent!.includes('Mask period (4)') && root.textContent!.includes('Mask offset (1; 0 starts at harmonic 1)'),
      'Periodic mask exposes its period and zero-based offset controls');
    check(root.textContent!.includes('Invert harmonic mask'), 'Nonempty masks expose inversion');
    editor.updatePartialGenerator({ mask: 'none' });
    await nextTick();
    check(!root.textContent!.includes('Invert harmonic mask'), 'None mask clears and hides inversion');
    editor.draftTrack.partialGenerator = normalizePartialGenerator({ type: 'binary', mode: 'bit', bit: 5, harmonicCount: 8 });
    await nextTick();
    check(bars().length === 0 && root.textContent!.includes('Silent spectrum:'), 'All-zero spectra explicitly report silence');
    editor.draftTrack.partialGenerator = { type: 'waveform' };
    editor.draftTrack.waveform = 'square';
    await nextTick();
    check(hasWaveformSelector() && bars().length === 32, 'Waveform source exposes its selector and Fourier partials');
    check(root.textContent!.includes('Spectral contrast'), 'Waveform exposes spectral transform controls');
    editor.updatePartialGenerator({ harmonicCount: 8, tilt: -6, contrast: 0.5, oddEvenBalance: 6, normalize: true });
    await nextTick();
    check(bars().length === 4 && editor.partialSpectrum.length === 16, 'Editing waveform transforms updates the spectrum preview');
    check(editor.partialSpectrumPeak === 1, 'Waveform preview reflects peak normalization');
    const source = {
      partialGenerator: normalizePartialGenerator({ type: 'waveform', harmonicCount: 8, normalize: true }),
      waveform: 'square',
      tonewheelDrawbars: editor.draftTrack.tonewheelDrawbars.slice(),
    };
    editor.draftTrack.tonewheelWavetable = {
      enabled: true,
      dimensions: [{ name: 'Morph', value: 0 }],
      configurations: [
        { name: 'Configuration 1', position: [0], drawbars: source.tonewheelDrawbars.slice(), source },
        { name: 'Configuration 2', position: [1], drawbars: source.tonewheelDrawbars.slice(), source: {
          ...source,
          partialGenerator: { ...source.partialGenerator },
          tonewheelDrawbars: source.tonewheelDrawbars.slice(),
        } },
      ],
      lfos: [],
    };
    editor.selectedTonewheelConfigurationIndex = 1;
    await nextTick();
    const beforeTilt = bars().map((bar) => bar.getAttribute('y1'));
    editor.updatePartialGenerator({ tilt: 12 });
    await nextTick();
    check(JSON.stringify(beforeTilt) !== JSON.stringify(bars().map((bar) => bar.getAttribute('y1'))),
      'Selected configuration parameters update the preview even when its morph weight is zero');
    check(root.textContent!.includes('Selected configuration only'), 'Wavetable preview identifies its selected-configuration scope');
    editor.draftTrack.tonewheelWavetable.enabled = false;
    editor.updatePartialGenerator({ mask: 'even' });
    await nextTick();
    check(bars().length === 0 && root.textContent!.includes('Silent spectrum:'), 'Waveform masks can silence missing harmonics without filling zeros');
    editor.draftTrack.waveform = 'brown-noise';
    await nextTick();
    check(Boolean(root.querySelector('.partial-spectrum svg')) && bars().length === 4,
      'Brown spectrum displays its deterministic masked harmonics');
    check(root.textContent!.includes('Spectral contrast'), 'Brown spectrum exposes waveform transforms');
    editor.draftTrack.partialGenerator = { type: 'tonewheel' };
    editor.draftTrack.tonewheelWavetable.enabled = false;
    editor.draftTrack.tonewheelDrawbars = [0, 0, 8, 0, 0, 0, 0, 0, 0];
    await nextTick();
    check(!hasWaveformSelector() && bars().length === 1, 'Tonewheel displays sine drawbars even with a stored noise waveform');
    return labels;
  } finally {
    editor.draftTrack = original;
    editor.activeControlTab = originalTab;
    await nextTick();
  }
}
