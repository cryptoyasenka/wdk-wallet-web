/**
 * IndexedDbStorage lifecycle: close() reliability (audit P1 — Delete Wallet can
 * be blocked by an open IndexedDB connection).
 *
 * These run in the node env (apps/next/vitest.config.ts), which has no real
 * IndexedDB, so we install a tiny in-memory `indexedDB` global. It is a
 * deliberately small fake (one store, sync-resolving requests) — just enough to
 * drive the open → close branches and prove close() is idempotent and wires the
 * stale-connection guard. The `blocked` event a real `deleteDatabase` fires
 * while another tab holds a handle is browser-only and is covered by manual QA.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { IndexedDbStorage } from "../src/lib/storage";

/** Minimal fake IDBDatabase: records close() calls + holds a versionchange cb. */
class FakeDb {
  closeCalls = 0;
  onversionchange: (() => void) | null = null;
  readonly store = new Map<string, unknown>();
  readonly objectStoreNames = { contains: () => true };
  createObjectStore(): void {
    /* never reached: contains() returns true */
  }
  close(): void {
    this.closeCalls++;
  }
  transaction(_store: string, _mode: string) {
    const store = this.store;
    return {
      objectStore: () => ({
        get(key: string) {
          const req: { result: unknown; onsuccess: (() => void) | null; onerror: (() => void) | null } = {
            result: store.get(key) ?? undefined,
            onsuccess: null,
            onerror: null,
          };
          queueMicrotask(() => req.onsuccess?.());
          return req;
        },
        put(value: unknown, key: string) {
          store.set(key, value);
          const req: { onsuccess: (() => void) | null; onerror: (() => void) | null } = {
            onsuccess: null,
            onerror: null,
          };
          queueMicrotask(() => req.onsuccess?.());
          return req;
        },
      }),
    };
  }
}

/** Install a fake `indexedDB.open` that hands back one FakeDb. */
function installFakeIndexedDb(): { db: FakeDb; openCalls: () => number } {
  const db = new FakeDb();
  let opens = 0;
  const open = vi.fn(() => {
    opens++;
    const req: {
      result: FakeDb;
      onsuccess: (() => void) | null;
      onerror: (() => void) | null;
      onupgradeneeded: (() => void) | null;
    } = { result: db, onsuccess: null, onerror: null, onupgradeneeded: null };
    queueMicrotask(() => req.onsuccess?.());
    return req;
  });
  vi.stubGlobal("indexedDB", { open });
  return { db, openCalls: () => opens };
}

describe("IndexedDbStorage.close()", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is a no-op when the DB was never opened (idempotent from cold)", () => {
    const { db } = installFakeIndexedDb();
    const storage = new IndexedDbStorage();
    expect(() => storage.close()).not.toThrow();
    storage.close(); // again — still safe
    expect(db.closeCalls).toBe(0); // nothing was ever opened
  });

  it("closes the open connection and is safe to call twice", async () => {
    const { db } = installFakeIndexedDb();
    const storage = new IndexedDbStorage();
    await storage.get("seed-vault"); // forces the DB open
    storage.close();
    storage.close(); // idempotent — does not double-close a live handle
    // close() schedules the close on the open promise; let it settle.
    await Promise.resolve();
    await Promise.resolve();
    expect(db.closeCalls).toBe(1);
  });

  it("reopens lazily after close (next storage call gets a fresh handle)", async () => {
    const { openCalls } = installFakeIndexedDb();
    const storage = new IndexedDbStorage();
    await storage.get("a");
    expect(openCalls()).toBe(1);
    storage.close();
    await storage.get("b"); // must reopen, not reuse the closed promise
    expect(openCalls()).toBe(2);
  });

  it("registers onversionchange so another tab's delete can close this handle", async () => {
    const { db } = installFakeIndexedDb();
    const storage = new IndexedDbStorage();
    await storage.get("a");
    expect(typeof db.onversionchange).toBe("function");
    db.onversionchange?.(); // simulate a versionchange (e.g. deleteDatabase elsewhere)
    expect(db.closeCalls).toBe(1);
  });
});
