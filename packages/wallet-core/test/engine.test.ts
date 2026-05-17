/**
 * Engine state-machine + phase-boundary tests. Driven through the internal
 * `createWalletEngineWithAdapter` factory with `FakeWdkAdapter`, so real
 * `@tetherto/*` is never loaded. The vault crypto underneath is real
 * (PassphraseUnlock derives an actual AES-GCM key).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createWalletEngineWithAdapter } from "../src/wallet/engine.js";
import { DEFAULT_ASSETS, USDT_ETHEREUM, buildChainRegistry } from "../src/chains/index.js";
import {
  InvalidSeedPhraseError,
  NoWalletError,
  UnsupportedChainError,
  VaultDecryptError,
  WalletExistsError,
  WalletLockedError,
} from "../src/errors.js";
import type { WalletEngine, WalletEngineDeps } from "../src/types.js";
import { FakeWdkAdapter, MemoryStorage, PassphraseUnlock, SpyCryptoWorker } from "./fakes.js";

function makeDeps(storage = new MemoryStorage(), passphrase = "correct horse"): {
  deps: WalletEngineDeps;
  storage: MemoryStorage;
  crypto: SpyCryptoWorker;
} {
  const crypto = new SpyCryptoWorker();
  const deps: WalletEngineDeps = {
    storage,
    crypto,
    unlock: new PassphraseUnlock(passphrase),
  };
  return { deps, storage, crypto };
}

describe("wallet engine — lifecycle", () => {
  let adapter: FakeWdkAdapter;
  let engine: WalletEngine;
  let storage: MemoryStorage;
  let crypto: SpyCryptoWorker;

  beforeEach(() => {
    adapter = new FakeWdkAdapter();
    const m = makeDeps();
    storage = m.storage;
    crypto = m.crypto;
    engine = createWalletEngineWithAdapter(adapter, m.deps);
  });

  it("creates a wallet, persists it, and stays locked", async () => {
    expect(await engine.hasWallet()).toBe(false);
    const { seedPhrase } = await engine.createWallet();
    expect(await adapter.isValidSeedPhrase(seedPhrase)).toBe(true);
    expect(await engine.hasWallet()).toBe(true);
    // Locked until an explicit unlock() (symmetric with importWallet).
    await expect(engine.getAddress("ethereum")).rejects.toBeInstanceOf(WalletLockedError);
  });

  it("refuses to clobber an existing wallet", async () => {
    await engine.createWallet();
    await expect(engine.createWallet()).rejects.toBeInstanceOf(WalletExistsError);
    await expect(engine.importWallet("abandon ".repeat(11) + "about")).rejects.toBeInstanceOf(
      WalletExistsError,
    );
  });

  it("rejects unlock before any wallet exists", async () => {
    await expect(engine.unlock()).rejects.toBeInstanceOf(NoWalletError);
  });

  it("validates the seed phrase on import", async () => {
    await expect(engine.importWallet("too few words")).rejects.toBeInstanceOf(
      InvalidSeedPhraseError,
    );
    expect(await engine.hasWallet()).toBe(false);
    await engine.importWallet(`${Array(12).fill("abandon").join(" ")}`);
    expect(await engine.hasWallet()).toBe(true);
  });

  it("unlocks, derives a deterministic seed-bound address", async () => {
    await engine.createWallet();
    await engine.unlock();
    const a0 = await engine.getAddress("ethereum", 0);
    const a0again = await engine.getAddress("ethereum", 0);
    const a1 = await engine.getAddress("ethereum", 1);
    expect(a0).toMatch(/^0x[0-9a-f]{8}$/);
    expect(a0again).toBe(a0);
    expect(a1).not.toBe(a0);
  });

  it("unlock() is idempotent (one signer built)", async () => {
    await engine.createWallet();
    await engine.unlock();
    await engine.unlock();
    expect(adapter.signers.length).toBe(1);
  });

  it("lock() disposes the signer, wipes the worker, and re-locks", async () => {
    await engine.createWallet();
    await engine.unlock();
    await engine.lock();
    expect(crypto.lockCalls).toBe(1);
    expect(adapter.signers[0]?.disposed).toBe(true);
    await expect(engine.getAddress("ethereum")).rejects.toBeInstanceOf(WalletLockedError);
    // Can unlock again after a lock.
    await engine.unlock();
    expect(await engine.getAddress("ethereum")).toMatch(/^0x[0-9a-f]{8}$/);
  });

  it("wrong passphrase fails the GCM auth tag → VaultDecryptError", async () => {
    await engine.createWallet();
    const wrong = createWalletEngineWithAdapter(
      new FakeWdkAdapter(),
      makeDeps(storage, "WRONG passphrase").deps,
    );
    await expect(wrong.unlock()).rejects.toBeInstanceOf(VaultDecryptError);
  });
});

describe("wallet engine — portfolio", () => {
  it("omits assets on chains this build did not configure", async () => {
    // DEFAULT registry = Ethereum only → BTC@bitcoin is dropped from the
    // portfolio, but an explicit getAddress('bitcoin') still errors loud.
    const adapter = new FakeWdkAdapter();
    const { deps } = makeDeps();
    const engine = createWalletEngineWithAdapter(adapter, deps); // default chains/assets
    await engine.createWallet();
    await engine.unlock();

    const balances = await engine.getBalances();
    const symbols = balances.map((b) => b.asset.symbol).sort();
    expect(symbols).toEqual(["USDT", "XAUT"]);
    expect(balances.every((b) => b.asset.chain === "ethereum")).toBe(true);
    expect(DEFAULT_ASSETS.some((a) => a.symbol === "BTC")).toBe(true); // BTC is in the set…
    expect(symbols).not.toContain("BTC"); // …but omitted when unconfigured.

    await expect(engine.getAddress("bitcoin")).rejects.toBeInstanceOf(UnsupportedChainError);
  });

  it("returns exact token balances in base units", async () => {
    const adapter = new FakeWdkAdapter({
      token: { [`ethereum:${USDT_ETHEREUM}`]: 1_234_567n },
    });
    const { deps } = makeDeps();
    const engine = createWalletEngineWithAdapter(adapter, deps, {
      chains: buildChainRegistry(),
      assets: [{ symbol: "USDT", chain: "ethereum", token: USDT_ETHEREUM, decimals: 6 }],
    });
    await engine.createWallet();
    await engine.unlock();

    const balances = await engine.getBalances();
    expect(balances).toHaveLength(1);
    expect(balances[0]?.asset.symbol).toBe("USDT");
    expect(balances[0]?.amount).toBe(1_234_567n);
  });
});

describe("wallet engine — send / quote / activity (Phase 2)", () => {
  const USDT = { symbol: "USDT", chain: "ethereum", token: USDT_ETHEREUM, decimals: 6 } as const;
  const XAUT = {
    symbol: "XAUT",
    chain: "ethereum",
    token: "0x68749665FF8D2d112Fa859AA293F07A622782F38",
    decimals: 6,
  } as const;
  const BTC = { symbol: "BTC", chain: "bitcoin", decimals: 8 } as const;

  let txStatus: Map<string, "pending" | "confirmed" | "failed">;
  let storage: MemoryStorage;
  let engine: WalletEngine;

  beforeEach(async () => {
    txStatus = new Map();
    const m = makeDeps();
    storage = m.storage;
    engine = createWalletEngineWithAdapter(new FakeWdkAdapter({ txStatus }), m.deps);
    await engine.createWallet();
    await engine.unlock();
  });

  it("quoteSend returns a fee labelled in the chain's native coin", async () => {
    const q = await engine.quoteSend({ asset: USDT, to: "0xrecipient", amount: 1_000n });
    expect(q.fee).toBe(21_000n);
    // Gas for an ERC-20 transfer is paid in ETH, not in USDT.
    expect(q.feeAsset.symbol).toBe("ETH");
    expect(q.feeAsset.chain).toBe("ethereum");
  });

  it("send broadcasts and records one pending outgoing entry", async () => {
    const res = await engine.send({ asset: USDT, to: "0xrecipient", amount: 1_000n });
    expect(res.hash).toMatch(/^0x[0-9a-f]{8}$/);
    expect(res.chain).toBe("ethereum");

    const activity = await engine.getActivity();
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({
      hash: res.hash,
      direction: "out",
      status: "pending",
      amount: 1_000n,
    });
    expect(activity[0]?.asset.symbol).toBe("USDT");
  });

  it("getActivity refreshes a pending entry to confirmed and persists it", async () => {
    const res = await engine.send({ asset: USDT, to: "0xrecipient", amount: 7n });
    expect((await engine.getActivity())[0]?.status).toBe("pending");

    // Simulate the tx being mined (same Map instance the reader holds).
    txStatus.set(res.hash, "confirmed");
    expect((await engine.getActivity())[0]?.status).toBe("confirmed");

    // Persisted: a fresh, still-locked engine over the same storage (no
    // status refresh path) must still see "confirmed" — proving it was
    // written back, not recomputed.
    const locked = createWalletEngineWithAdapter(
      new FakeWdkAdapter(),
      makeDeps(storage).deps,
    );
    const persisted = await locked.getActivity();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.status).toBe("confirmed");
  });

  it("getActivity filters by asset (symbol + chain + token)", async () => {
    await engine.send({ asset: USDT, to: "0xa", amount: 1n });
    await engine.send({ asset: XAUT, to: "0xb", amount: 2n });

    expect(await engine.getActivity()).toHaveLength(2);
    const usdtOnly = await engine.getActivity(USDT);
    expect(usdtOnly).toHaveLength(1);
    expect(usdtOnly[0]?.asset.symbol).toBe("USDT");
  });

  it("send/quoteSend on an unconfigured chain raise UnsupportedChainError", async () => {
    // Default registry is Ethereum-only → Bitcoin is unconfigured.
    await expect(
      engine.send({ asset: BTC, to: "bc1qrecipient", amount: 1n }),
    ).rejects.toBeInstanceOf(UnsupportedChainError);
    await expect(
      engine.quoteSend({ asset: BTC, to: "bc1qrecipient", amount: 1n }),
    ).rejects.toBeInstanceOf(UnsupportedChainError);
    // Nothing was logged for the rejected send.
    expect(await engine.getActivity()).toHaveLength(0);
  });

  it("send requires an unlocked wallet", async () => {
    const m = makeDeps();
    const fresh = createWalletEngineWithAdapter(new FakeWdkAdapter(), m.deps);
    await fresh.createWallet();
    await expect(
      fresh.send({ asset: USDT, to: "0xrecipient", amount: 1n }),
    ).rejects.toBeInstanceOf(WalletLockedError);
  });
});
