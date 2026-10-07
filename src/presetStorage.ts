// Keep the portable JSON format, but use IndexedDB for libraries with embedded
// samples and arrangements that exceed localStorage's small string quota.
export const PRESET_STORAGE_KEY = 'ss3k_preset_library_v2';
const DATABASE_NAME = 'gaterunner-presets';
const STORE_NAME = 'libraries';
const LIBRARY_KEY = 'current';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      if (blocked) database.close();
      else resolve(database);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Close other GateRunner tabs and retry to finish updating preset storage.'));
    };
  });
}

async function accessLibrary(mode: IDBTransactionMode, value?: string): Promise<string | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      const request = mode === 'readwrite' ? store.put(value, LIBRARY_KEY) : store.get(LIBRARY_KEY);
      let result: string | null = null;
      request.onsuccess = () => { if (mode === 'readonly') result = request.result ?? null; };
      // A successful request can still be rolled back (including quota errors).
      // Only publish the new library after the whole transaction commits.
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(transaction.error ?? request.error ?? new Error('Preset storage was interrupted.'));
      transaction.onerror = () => reject(transaction.error ?? request.error);
    });
  } finally {
    database.close();
  }
}

export async function readPresetLibraryStorage(): Promise<{ value: string | null; needsMigration: boolean }> {
  if (typeof indexedDB !== 'undefined') {
    const stored = await accessLibrary('readonly');
    if (stored !== null) return { value: stored, needsMigration: false };
  }
  const value = localStorage.getItem(PRESET_STORAGE_KEY);
  return { value, needsMigration: value !== null && typeof indexedDB !== 'undefined' };
}

export async function writePresetLibraryStorage(value: string): Promise<void> {
  if (typeof indexedDB === 'undefined') {
    localStorage.setItem(PRESET_STORAGE_KEY, value);
    return;
  }
  await accessLibrary('readwrite', value);
  // Never remove the old copy until the IndexedDB write has committed.
  try { localStorage.removeItem(PRESET_STORAGE_KEY); } catch { /* IndexedDB is already saved. */ }
}

export function presetStorageErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'QuotaExceededError') {
    return 'Your browser has no space left for this preset library. Export your current library as a backup, free browser or disk space, then retry.';
  }
  return error instanceof Error ? error.message : 'Unable to save the preset library. Check that browser storage is allowed and retry.';
}
