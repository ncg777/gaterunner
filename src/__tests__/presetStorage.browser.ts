import PresetManager from '../components/PresetManager.vue';
import { arePresetDataEqual, loadPresetLibrary, parsePresetImportPayload, type PresetLibrary } from '../presets';

const check = (value: boolean, message: string) => { if (!value) throw new Error(message); };

// Run against an already imported fixture in a local browser. Read-only checks
// use real IndexedDB; failures use a temporary factory that cannot write data.
export async function runPresetStorageChecks(sourceJson: string) {
  const source = parsePresetImportPayload(sourceJson);
  check(source.kind === 'preset-library', 'Fixture must be a preset library');
  if (source.kind !== 'preset-library') return;
  const saved = await loadPresetLibrary();
  for (const preset of source.presets) {
    const actual = saved.presets.find(entry => entry.name === preset.name);
    check(Boolean(actual) && arePresetDataEqual(actual!.data, preset.data), `Stored data differs: ${preset.name}`);
    check(JSON.stringify(actual!.data.studio?.assets) === JSON.stringify(preset.data.studio?.assets), `Embedded samples differ: ${preset.name}`);
  }

  const notices: Array<{ message: string; color: string }> = [];
  let applied = 0, synchronized = 0, confirmed = 0;
  const methods = PresetManager.methods!;
  const manager = {
    ...methods, presetLibrary: saved, isPersisting: false,
    activePresetFolderId: null, currentPreset: saved.presets[0], draftData: saved.presets[0].data,
    showNotice(message: string, color: string) { notices.push({ message, color }); },
    syncDirtyState() { synchronized++; },
    applyDraftData() { applied++; },
    confirmDiscardChanges: async () => { confirmed++; return true; },
  } as unknown as InstanceType<typeof PresetManager>;
  const originalFactory = Object.getOwnPropertyDescriptor(window, 'indexedDB');
  const failingFactory = { open() {
    const request: any = {};
    queueMicrotask(() => {
      request.error = new DOMException('Quota exceeded', 'QuotaExceededError');
      request.onerror();
    });
    return request;
  } };
  try {
    Object.defineProperty(window, 'indexedDB', { value: failingFactory, configurable: true });
    const candidate: PresetLibrary = { ...saved, presets: [...saved.presets, saved.presets[0]] };
    check(!(await manager.persistPresetLibrary(candidate)), 'Failed storage reported success');
    check(manager.presetLibrary === saved, 'Failed storage changed the library');
    check(!manager.isPersisting && synchronized === 0, 'Failed storage changed dirty state or left saving locked');

    const input = { files: [new File([sourceJson], 'album.json')], value: 'album.json' };
    await manager.handlePresetFileImport({ target: input } as unknown as Event);
    check(manager.presetLibrary === saved && applied === 0 && confirmed === 1, 'Failed import loaded or selected a preset');
    check(input.value === '', 'Failed import cannot be retried');
    await manager.saveCurrentPreset();
    check(manager.presetLibrary === saved && synchronized === 0, 'Failed save lost the dirty draft');
    check(notices.every(notice => notice.color === 'error' && notice.message.includes('Export your current library')), 'Quota failure reported success or raw browser text');
  } finally {
    if (originalFactory) Object.defineProperty(window, 'indexedDB', originalFactory);
    else delete (window as any).indexedDB;
  }
  return { presetsVerified: source.presets.length, selectedPresetId: saved.selectedPresetId,
    embeddedSamplesIntact: true, failedSaveAndImportPreservedLibrary: true };
}
