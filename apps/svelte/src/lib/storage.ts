/**
 * `StorageAdapter` backed by IndexedDB — opaque blob persistence for the
 * sealed seed vault (and the unlock salt). No third-party idb wrapper: a
 * single object store with a tiny promisified request helper keeps the
 * dependency surface minimal, which matters for a wallet.
 *
 * The app provides this; wallet-core stays storage-agnostic. Copied verbatim
 * from apps/next/src/lib/storage.ts — host ports are the host-specific layer;
 * the portability claim is about the engine, not this glue (RN-TO-WEB-MAP.md).
 */
import type { StorageAdapter } from "@wdk-web/wallet-core";

const DB_NAME = "wdk-wallet";
const DB_VERSION = 1;
const STORE = "kv";

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

export class IndexedDbStorage implements StorageAdapter {
  #dbPromise: Promise<IDBDatabase> | null = null;

  #db(): Promise<IDBDatabase> {
    if (this.#dbPromise) return this.#dbPromise;
    this.#dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains(STORE)) {
          open.result.createObjectStore(STORE);
        }
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error ?? new Error("IndexedDB open failed"));
    });
    return this.#dbPromise;
  }

  async #tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.#db();
    return db.transaction(STORE, mode).objectStore(STORE);
  }

  async get(key: string): Promise<Uint8Array | null> {
    const store = await this.#tx("readonly");
    const value = await promisify<unknown>(store.get(key));
    if (value == null) return null;
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    throw new Error("corrupt storage entry: expected bytes");
  }

  async set(key: string, value: Uint8Array): Promise<void> {
    const store = await this.#tx("readwrite");
    await promisify(store.put(value, key));
  }

  async remove(key: string): Promise<void> {
    const store = await this.#tx("readwrite");
    await promisify(store.delete(key));
  }
}
