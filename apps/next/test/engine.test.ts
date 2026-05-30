/**
 * WalletApp lifecycle wiring (audit P1 — Data Sources reset can orphan an
 * unlocked engine; Delete Wallet blocked by an open IndexedDB connection).
 *
 * Verifies the host-side teardown chain WITHOUT loading real WDK: constructing
 * the engine is inert (the @tetherto adapter is lazy-imported only on the first
 * engine method), and dispose()/resetWalletApp() on a never-unlocked app take
 * the lock path that touches neither the adapter nor storage reads. We install
 * a tiny in-memory `indexedDB` so we can also prove the IndexedDB handle is
 * actually closed when one was opened. Node env (no real IndexedDB), so the
 * `blocked`-event browser behaviour is left to manual QA.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getWalletApp, resetWalletApp } from "../src/lib/engine";

/** Minimal fake IDBDatabase that records close() calls. */
class FakeDb {
  closeCalls = 0;
  onversionchange: (() => void) | null = null;
  readonly objectStoreNames = { contains: () => true };
  createObjectStore(): void {}
  close(): void {
    this.closeCalls++;
  }
  transaction() {
    return {
      objectStore: () => ({
        get() {
          const req: { result: unknown; onsuccess: (() => void) | null; onerror: (() => void) | null } = {
            result: undefined,
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

function installFakeIndexedDb(): FakeDb {
  const db = new FakeDb();
  const open = vi.fn(() => {
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
  return db;
}

describe("WalletApp lifecycle (dispose / resetWalletApp)", () => {
  let db: FakeDb;
  beforeEach(() => {
    db = installFakeIndexedDb();
  });
  afterEach(async () => {
    // Leave the module singleton clean for the next test.
    await resetWalletApp();
    vi.unstubAllGlobals();
  });

  it("getWalletApp() memoises the same instance until reset", () => {
    const a = getWalletApp();
    const b = getWalletApp();
    expect(b).toBe(a);
  });

  it("dispose() resolves on a never-unlocked app (lock + storage.close, both no-throw) and is idempotent", async () => {
    const app = getWalletApp();
    await expect(app.dispose()).resolves.toBeUndefined();
    await expect(app.dispose()).resolves.toBeUndefined(); // idempotent
  });

  it("dispose() closes an open IndexedDB handle", async () => {
    const app = getWalletApp();
    // Force the storage to open its connection via the public engine surface.
    await app.engine.hasWallet();
    await app.dispose();
    await Promise.resolve();
    await Promise.resolve();
    expect(db.closeCalls).toBe(1);
  });

  it("resetWalletApp() disposes the current app and the next getWalletApp() is a fresh instance", async () => {
    const first = getWalletApp();
    await first.engine.hasWallet(); // opens the DB
    await resetWalletApp();
    await Promise.resolve();
    await Promise.resolve();
    expect(db.closeCalls).toBe(1); // the old handle was released
    const second = getWalletApp();
    expect(second).not.toBe(first); // rebuilt with fresh chain options
  });

  it("resetWalletApp() is safe when no app was ever built", async () => {
    await resetWalletApp(); // clear any prior instance
    await expect(resetWalletApp()).resolves.toBeUndefined();
  });
});
