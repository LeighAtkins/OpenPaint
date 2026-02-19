const DB_NAME = 'openpaint-cloud-cache';
const DB_VERSION = 1;
const STORE_NAME = 'assets';

class CloudAssetCache {
  constructor() {
    this.dbPromise = null;
  }

  isSupported() {
    return typeof indexedDB !== 'undefined';
  }

  async open() {
    if (!this.isSupported()) return null;
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'hash' });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
    });

    return this.dbPromise;
  }

  async get(hash) {
    try {
      const db = await this.open();
      if (!db) return null;

      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(hash);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error('IndexedDB get failed'));
      });
    } catch {
      return null;
    }
  }

  async put(hash, blob, contentType = 'application/octet-stream', sizeBytes = null) {
    try {
      const db = await this.open();
      if (!db) return false;

      const record = {
        hash,
        blob,
        contentType,
        sizeBytes: typeof sizeBytes === 'number' ? sizeBytes : blob?.size || null,
        updatedAt: new Date().toISOString(),
      };

      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.put(record);
        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error || new Error('IndexedDB put failed'));
      });
      return true;
    } catch {
      return false;
    }
  }
}

export const cloudAssetCache = new CloudAssetCache();
