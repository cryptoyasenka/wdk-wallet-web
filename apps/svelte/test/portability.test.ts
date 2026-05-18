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
  UnsupportedChainError,
  WalletError,
  WalletLockedError,
  type Asset,
  type StorageAdapter,
  type TxIntent,
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

describe("D-07: the send + activity surfaces are framework-agnostic too", () => {
  it("typed-throws UnsupportedChainError on quoteSend/send for an unconfigured chain", async () => {
    const { deps, unlock } = makeDeps();
    const engine = createWalletEngine(deps, { chains: {} });
    unlock.setPassphrase("a-passphrase-of-at-least-8");
    await engine.createWallet();
    await engine.unlock(); // past ensureUnlocked() → the chain check is what fails

    // A fabricated USDT-on-Ethereum asset: the empty registry configures no
    // chain, so the public send surface must reject with the *typed* error a
    // second framework switches on — not a bare Error, not a silent skip. No
    // RPC is reached: the throw is before any adapter call, so it stays hermetic.
    const asset: Asset = {
      symbol: "USDT",
      chain: "ethereum",
      token: "0x0000000000000000000000000000000000000001",
      decimals: 6,
    };
    const intent: TxIntent = {
      asset,
      to: "0x000000000000000000000000000000000000dEaD",
      amount: 1_000_000n,
    };

    await expect(engine.quoteSend(intent)).rejects.toBeInstanceOf(UnsupportedChainError);
    await expect(engine.send(intent)).rejects.toBeInstanceOf(UnsupportedChainError);
    // It is a WalletError too — apps catch the whole typed family at one seam.
    await expect(engine.send(intent)).rejects.toBeInstanceOf(WalletError);
  });

  it("getActivity round-trips a seeded log through the injected StorageAdapter", async () => {
    const { deps, storage } = makeDeps();

    // Seed one *terminal* (confirmed) outgoing entry straight into the host
    // port — the exact on-disk envelope a second consumer must read back
    // (`wdk:activity:v1`, the internal storage contract). A confirmed entry is
    // never refreshed (the engine only re-checks `pending`) and the engine is
    // left locked, so this needs no wallet, no unlock, no network.
    const envelope = {
      v: 1,
      items: [
        {
          hash: "0xfeed",
          symbol: "USDT",
          chain: "ethereum",
          token: "0x0000000000000000000000000000000000000002",
          decimals: 6,
          amount: "1500000",
          direction: "out",
          timestamp: 1_737_000_000_000,
          status: "confirmed",
          from: "0x00000000000000000000000000000000000000a1",
        },
      ],
    };
    storage.map.set("wdk:activity:v1", new TextEncoder().encode(JSON.stringify(envelope)));

    const engine = createWalletEngine(deps, { chains: {} });
    const activity = await engine.getActivity();

    // bigint reconstructed from the decimal string, asset rebuilt, and the
    // internal `from` projected away (the frozen public ActivityItem shape).
    expect(activity).toEqual([
      {
        hash: "0xfeed",
        asset: {
          symbol: "USDT",
          chain: "ethereum",
          token: "0x0000000000000000000000000000000000000002",
          decimals: 6,
        },
        amount: 1_500_000n,
        direction: "out",
        timestamp: 1_737_000_000_000,
        status: "confirmed",
      },
    ]);
    const item = activity[0];
    if (item === undefined) throw new Error("unreachable: activity asserted above");
    expect("from" in (item as object)).toBe(false);
    // Money stays bigint across the boundary — never a JSON number/string.
    expect(typeof item.amount).toBe("bigint");
  });
});
