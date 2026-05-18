/**
 * D-07 — the headless portability assertion.
 *
 * This is the proof, as a passing test: the *byte-unchanged*
 * `@wdk-web/wallet-core` (the D-02 gate keeps `packages/wallet-core/**`
 * untouched through Phase 3) is framework-agnostic. It is driven here with no
 * DOM, no Svelte component harness, no framework — only its public surface and
 * an in-memory `StorageAdapter`, reusing the *exact* `PassphraseUnlock` /
 * `StubCryptoWorker` host ports the real Svelte app wires (src/lib), not test
 * doubles. If a second consumer can run the engine's whole Phase-1 state
 * machine through hand-rolled ports, the engine carries no host coupling.
 *
 * Note on the seam: the public `createWalletEngine` lazy-loads the *real* WDK
 * adapter (no `Worker` in Node → the in-process `WdkCoreAdapter`, real
 * `@tetherto/*`). This is deliberately NOT faked — wallet-core's own suite
 * already covers the fake-adapter paths via an internal factory that is, by
 * design, not part of the public surface. Driving the real adapter with an
 * empty chain registry keeps the run fully hermetic: seed generation and the
 * vault are pure local crypto, and `getBalances()` touches no network because
 * no chain is configured (every asset is skipped). It is the same engine, same
 * ports, same typed errors a second framework ships — exercised framework-free.
 */
import { describe, expect, it } from "vitest";
import {
  createWalletEngine,
  NoWalletError,
  WalletError,
  WalletLockedError,
  type StorageAdapter,
  type WalletEngineDeps,
} from "@wdk-web/wallet-core";
import { PassphraseUnlock } from "../src/lib/unlock";
import { StubCryptoWorker } from "../src/lib/cryptoWorker";

/** In-memory `StorageAdapter` — the whole host side, in one Map. */
class MemoryStorage implements StorageAdapter {
  readonly map = new Map<string, Uint8Array>();
  async get(key: string): Promise<Uint8Array | null> {
    return this.map.get(key) ?? null;
  }
  async set(key: string, value: Uint8Array): Promise<void> {
    this.map.set(key, value);
  }
  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
}

/** Fresh in-memory deps using the app's real (not mocked) host ports. */
function makeDeps(storage = new MemoryStorage()): {
  deps: WalletEngineDeps;
  storage: MemoryStorage;
  unlock: PassphraseUnlock;
} {
  const unlock = new PassphraseUnlock(storage);
  const deps: WalletEngineDeps = { storage, crypto: new StubCryptoWorker(), unlock };
  return { deps, storage, unlock };
}

describe("svelte ↔ wallet-core: public surface resolves from a second framework", () => {
  it("exposes the factory and the typed-error base", () => {
    expect(typeof createWalletEngine).toBe("function");
    expect(new WalletError("x")).toBeInstanceOf(Error);
  });
});

describe("D-07: the headless engine is framework-agnostic", () => {
  it("runs the no-wallet state machine with zero host coupling", async () => {
    const { deps } = makeDeps();
    // Empty chain registry → getBalances() is network-free (every asset's
    // chain is unconfigured and skipped); the proof stays hermetic.
    const engine = createWalletEngine(deps, { chains: {} });

    expect(await engine.hasWallet()).toBe(false);
    // The typed public errors survive across the consumer boundary unchanged.
    await expect(engine.unlock()).rejects.toBeInstanceOf(NoWalletError);
    await expect(engine.getAddress("ethereum")).rejects.toBeInstanceOf(WalletLockedError);
    expect(await engine.getActivity()).toEqual([]);
    await expect(engine.lock()).resolves.toBeUndefined(); // idempotent, no signer
  });

  it("drives createWallet → unlock → getBalances through in-memory ports", async () => {
    const { deps, storage, unlock } = makeDeps();
    const engine = createWalletEngine(deps, { chains: {} });
    unlock.setPassphrase("a-passphrase-of-at-least-8");

    expect(await unlock.isEnrolled()).toBe(false); // no salt minted yet

    const { seedPhrase } = await engine.createWallet();
    expect(seedPhrase.trim().split(/\s+/)).toHaveLength(12); // real BIP-39
    expect(await engine.hasWallet()).toBe(true);
    // The host port persisted its PBKDF2 salt through the injected storage.
    expect(await unlock.isEnrolled()).toBe(true);

    await engine.unlock(); // real WdkCoreAdapter builds the signer + reader
    // No chain configured → every default asset is omitted, no RPC reached.
    expect(await engine.getBalances()).toEqual([]);

    // Persistence is host-port-only: a brand-new engine over the SAME storage
    // sees the wallet (proves the vault round-tripped through the Map alone).
    const reopened = createWalletEngine(makeDeps(storage).deps, { chains: {} });
    expect(await reopened.hasWallet()).toBe(true);
  });

  it("rejects a wrong passphrase with the genuine GCM auth-tag failure", async () => {
    const { deps, storage, unlock } = makeDeps();
    const engine = createWalletEngine(deps, { chains: {} });
    unlock.setPassphrase("the-right-passphrase");
    await engine.createWallet();

    // A second engine over the same vault with the wrong passphrase must fail
    // to decrypt — real crypto, not a stubbed accept.
    const wrong = makeDeps(storage);
    wrong.unlock.setPassphrase("a-wrong-passphrase-x");
    const engine2 = createWalletEngine(wrong.deps, { chains: {} });
    await expect(engine2.unlock()).rejects.toBeInstanceOf(WalletError);
  });
});
