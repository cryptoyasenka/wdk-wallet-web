/**
 * P1 step 5 — multi-account over ONE seed (HD account index).
 *
 * Proves the engine derives unlimited accounts from the single BIP-39 seed at
 * distinct BIP-44 indices, that the active selection drives
 * getBalances/getActivity/quoteSend/send, that each account's activity is
 * isolated, that the selection is persisted (non-secret, survives a fresh
 * locked engine), and that the default is account 0 (a pre-multi-account
 * wallet keeps working unchanged — engine.test.ts stays green untouched).
 *
 * Driven through the internal `createWalletEngineWithAdapter` + `FakeWdkAdapter`
 * seam, so real `@tetherto/*` is never loaded. The fake folds the HD index
 * into its address (always did) and now into the broadcast tx hash, mirroring
 * real WDK `getAccount(chain, index)` at the honest test boundary.
 */
import { describe, expect, it } from "vitest";
import { createWalletEngineWithAdapter } from "../src/wallet/engine.js";
import { USDT_ETHEREUM } from "../src/chains/index.js";
import { InvalidAccountIndexError } from "../src/errors.js";
import type { WalletEngine, WalletEngineDeps } from "../src/types.js";
import { FakeWdkAdapter, MemoryStorage, PassphraseUnlock, SpyCryptoWorker } from "./fakes.js";

function makeDeps(storage = new MemoryStorage(), passphrase = "correct horse"): {
  deps: WalletEngineDeps;
  storage: MemoryStorage;
} {
  const deps: WalletEngineDeps = {
    storage,
    crypto: new SpyCryptoWorker(),
    unlock: new PassphraseUnlock(passphrase),
  };
  return { deps, storage };
}

const USDT = { symbol: "USDT", chain: "ethereum", token: USDT_ETHEREUM, decimals: 6 } as const;

async function freshUnlocked(adapter = new FakeWdkAdapter()): Promise<{
  engine: WalletEngine;
  adapter: FakeWdkAdapter;
  storage: MemoryStorage;
}> {
  const { deps, storage } = makeDeps();
  const engine = createWalletEngineWithAdapter(adapter, deps); // default chains/assets
  await engine.createWallet();
  await engine.unlock();
  return { engine, adapter, storage };
}

describe("wallet engine — multi-account (HD index)", () => {
  it("defaults to account 0 with no stored selection (back-compat)", async () => {
    const { deps } = makeDeps();
    const engine = createWalletEngineWithAdapter(new FakeWdkAdapter(), deps);
    expect(await engine.getActiveAccount()).toBe(0);
  });

  it("derives ≥2 distinct addresses from one seed at distinct indices", async () => {
    const { engine } = await freshUnlocked();
    const a0 = await engine.getAddress("ethereum", 0);
    const a1 = await engine.getAddress("ethereum", 1);
    const a2 = await engine.getAddress("ethereum", 2);
    for (const a of [a0, a1, a2]) expect(a).toMatch(/^0x[0-9a-f]{8}$/);
    expect(new Set([a0, a1, a2]).size).toBe(3); // all distinct
  });

  it("setActiveAccount / getActiveAccount round-trip", async () => {
    const { engine } = await freshUnlocked();
    expect(await engine.getActiveAccount()).toBe(0);
    await engine.setActiveAccount(3);
    expect(await engine.getActiveAccount()).toBe(3);
  });

  it("rejects a non-negative-integer index with InvalidAccountIndexError", async () => {
    const { deps } = makeDeps();
    const engine = createWalletEngineWithAdapter(new FakeWdkAdapter(), deps);
    for (const bad of [-1, 1.5, Number.NaN, Infinity]) {
      await expect(engine.setActiveAccount(bad)).rejects.toBeInstanceOf(
        InvalidAccountIndexError,
      );
    }
    expect(await engine.getActiveAccount()).toBe(0); // unchanged after rejects
  });

  it("getAddress(chain, index) is explicit-index, independent of the active selection", async () => {
    const { engine } = await freshUnlocked();
    const acct0Addr = await engine.getAddress("ethereum", 0);
    await engine.setActiveAccount(1);
    // Account-LIST UI still resolves account 0's address while active = 1.
    expect(await engine.getAddress("ethereum", 0)).toBe(acct0Addr);
    expect(await engine.getAddress("ethereum", 1)).not.toBe(acct0Addr);
  });

  it("getBalances derives the ACTIVE account's address (not a hardcoded 0)", async () => {
    const adapter = new FakeWdkAdapter();
    const { engine } = await freshUnlocked(adapter);
    await engine.setActiveAccount(1);
    await engine.getBalances();
    const signer = adapter.signers[0]!;
    const fromBalances = signer.deriveCalls.filter((c) => c.chain !== "bitcoin");
    expect(fromBalances.length).toBeGreaterThan(0);
    // Every portfolio derivation used the active index, never literal 0.
    expect(fromBalances.every((c) => c.index === 1)).toBe(true);
  });

  it("send origin differs per account (same intent ⇒ distinct broadcast)", async () => {
    const { engine } = await freshUnlocked();
    const intent = { asset: USDT, to: "0xrecipient", amount: 1_000n };

    const r0 = await engine.send(intent);
    await engine.setActiveAccount(1);
    const r1 = await engine.send(intent);

    expect(r0.hash).toMatch(/^0x[0-9a-f]{8}$/);
    expect(r1.hash).toMatch(/^0x[0-9a-f]{8}$/);
    expect(r1.hash).not.toBe(r0.hash); // account 1 signs from account 1's key
  });

  it("activity is isolated per account (switching shows only that account's log)", async () => {
    const { engine } = await freshUnlocked();
    await engine.send({ asset: USDT, to: "0xa", amount: 1n });
    expect(await engine.getActivity()).toHaveLength(1); // account 0

    await engine.setActiveAccount(1);
    expect(await engine.getActivity()).toHaveLength(0); // account 1 is empty
    await engine.send({ asset: USDT, to: "0xb", amount: 2n });
    expect(await engine.getActivity()).toHaveLength(1); // only account 1's send

    await engine.setActiveAccount(0);
    const acct0 = await engine.getActivity();
    expect(acct0).toHaveLength(1); // account 0's original send, not merged
    expect(acct0[0]?.amount).toBe(1n);
  });

  it("the active selection persists across a fresh, still-locked engine", async () => {
    const { deps, storage } = makeDeps();
    const engine = createWalletEngineWithAdapter(new FakeWdkAdapter(), deps);
    await engine.createWallet();
    await engine.setActiveAccount(2);

    // A brand-new engine over the SAME storage, never unlocked: it must read
    // back account 2 (selection is plaintext storage, not in-memory only).
    const reopened = createWalletEngineWithAdapter(
      new FakeWdkAdapter(),
      makeDeps(storage).deps,
    );
    expect(await reopened.getActiveAccount()).toBe(2);
  });

  it("lock() does not reset the active selection", async () => {
    const { engine } = await freshUnlocked();
    await engine.setActiveAccount(4);
    await engine.lock();
    expect(await engine.getActiveAccount()).toBe(4);
    await engine.unlock();
    expect(await engine.getActiveAccount()).toBe(4);
  });
});
