import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PRESET_STORAGE_KEY, readPresetLibraryStorage, writePresetLibraryStorage, presetStorageErrorMessage } from '../presetStorage.js';
import { DEFAULT_PRESET_DATA, loadPresetLibrary } from '../presets.js';

// Model the browser's important failure boundary: a request succeeds, but the
// transaction subsequently aborts. The old local copy must survive that case.
function storageFixture(t: TestContext, abortWrite = false) {
  const local = new Map<string, string>();
  const records = new Map<string, string>();
  const storage = {
    getItem: (key: string) => local.get(key) ?? null,
    setItem: (key: string, value: string) => { local.set(key, value); },
    removeItem: (key: string) => { local.delete(key); },
  };
  const factory = {
    open() {
      const request: any = {};
      queueMicrotask(() => {
        request.result = {
          close() {},
          transaction(_store: string, mode: string) {
            const transaction: any = {};
            transaction.objectStore = () => ({
              get(key: string) { return operation(key); },
              put(value: string, key: string) { return operation(key, value); },
            });
            function operation(key: string, value?: string) {
              const operationRequest: any = {};
              queueMicrotask(() => {
                operationRequest.result = records.get(key);
                operationRequest.onsuccess?.();
                queueMicrotask(() => {
                  if (mode === 'readwrite' && abortWrite) {
                    transaction.error = new DOMException('Quota exceeded', 'QuotaExceededError');
                    transaction.onabort?.();
                  } else {
                    if (value !== undefined) records.set(key, value);
                    transaction.oncomplete?.();
                  }
                });
              });
              return operationRequest;
            }
            return transaction;
          },
        };
        request.onsuccess?.();
      });
      return request;
    },
  };
  const originalLocal = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const originalIdb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  Object.defineProperty(globalThis, 'indexedDB', { value: factory, configurable: true });
  t.after(() => {
    if (originalLocal) Object.defineProperty(globalThis, 'localStorage', originalLocal);
    else delete (globalThis as any).localStorage;
    if (originalIdb) Object.defineProperty(globalThis, 'indexedDB', originalIdb);
    else delete (globalThis as any).indexedDB;
  });
  return { local, records };
}

test('large libraries commit to IndexedDB and survive a fresh read', async (t) => {
  const { local, records } = storageFixture(t);
  local.set(PRESET_STORAGE_KEY, 'legacy-backup');
  const library = JSON.stringify({ embeddedSamples: 'x'.repeat(6_000_000) });
  await writePresetLibraryStorage(library);
  assert.equal(records.get('current'), library);
  assert.equal(local.has(PRESET_STORAGE_KEY), false);
  assert.deepEqual(await readPresetLibraryStorage(), { value: library, needsMigration: false });
});

test('an aborted write rejects after request success and preserves both previous copies', async (t) => {
  const { local, records } = storageFixture(t, true);
  local.set(PRESET_STORAGE_KEY, 'legacy-backup');
  records.set('current', 'saved-library');
  await assert.rejects(writePresetLibraryStorage('imported-library'), { name: 'QuotaExceededError' });
  assert.equal(records.get('current'), 'saved-library');
  assert.equal(local.get(PRESET_STORAGE_KEY), 'legacy-backup');
});

test('local presets are marked for migration only when no IndexedDB library exists', async (t) => {
  const { local, records } = storageFixture(t);
  local.set(PRESET_STORAGE_KEY, 'legacy-library');
  assert.deepEqual(await readPresetLibraryStorage(), { value: 'legacy-library', needsMigration: true });
  assert.equal(local.get(PRESET_STORAGE_KEY), 'legacy-library');
  records.set('current', 'new-library');
  assert.deepEqual(await readPresetLibraryStorage(), { value: 'new-library', needsMigration: false });
});

test('browsers without IndexedDB retain the existing small-library storage path', async (t) => {
  const { local } = storageFixture(t);
  Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true });
  await writePresetLibraryStorage('small-library');
  assert.equal(local.get(PRESET_STORAGE_KEY), 'small-library');
  assert.deepEqual(await readPresetLibraryStorage(), { value: 'small-library', needsMigration: false });
});

test('quota errors give an actionable message without suggesting destructive resets', () => {
  const message = presetStorageErrorMessage(new DOMException('Quota exceeded', 'QuotaExceededError'));
  assert.match(message, /Export your current library/);
  assert.match(message, /retry/);
});

function legacyLibrary(version: 1 | 2) {
  return { version, migratedLegacy: true, selectedPresetId: 'existing',
    folders: version === 2 ? [{ id: 'album', name: 'My album', parentFolderId: null }] : undefined,
    presets: [{ id: 'existing', name: 'Existing song', folderId: version === 2 ? 'album' : null,
      data: { ...DEFAULT_PRESET_DATA, bpm: 123 } }] };
}

for (const version of [1, 2] as const) {
  test(`v${version} local presets migrate with their selection and data intact`, async (t) => {
    const { local, records } = storageFixture(t);
    const key = `ss3k_preset_library_v${version}`;
    local.set(key, JSON.stringify(legacyLibrary(version)));
    const library = await loadPresetLibrary();
    assert.equal(library.selectedPresetId, 'existing');
    assert.equal(library.presets[0].name, 'Existing song');
    assert.equal(library.presets[0].data.bpm, 123);
    assert.equal(library.presets[0].folderId, version === 2 ? 'album' : null);
    assert.deepEqual(await loadPresetLibrary(), library);
    assert.ok(records.has('current'));
  });
}

test('failed legacy migration retains its source and never stores a default library', async (t) => {
  const { local, records } = storageFixture(t, true);
  const source = JSON.stringify(legacyLibrary(2));
  local.set(PRESET_STORAGE_KEY, source);
  await assert.rejects(loadPresetLibrary(), { name: 'QuotaExceededError' });
  assert.equal(local.get(PRESET_STORAGE_KEY), source);
  assert.equal(records.size, 0);
});

test('corrupt IndexedDB data is preserved instead of resetting saved presets', async (t) => {
  const { records } = storageFixture(t);
  records.set('current', '{broken');
  await assert.rejects(loadPresetLibrary(), SyntaxError);
  assert.equal(records.get('current'), '{broken');
});
