/**
 * P1 step 6 — multi-wallet (N independent BIP-39 seeds, each its own vault).
 *
 * A "wallet" here is a DISCRETE seed/vault, distinct from a "account" (an HD
 * index within one seed — step 5). This proves: the default is wallet 0 with
 * the original un-suffixed key layout (zero migration — engine.test.ts stays
 * green untouched); `addWallet()` allocates the next empty slot and ends the
 * session; a populated wallet has its OWN seed (distinct addresses), its OWN
 * activity log and its OWN active-account selection (full isolation); the
 * active-wallet selection is non-secret and persists across a fresh locked
 * engine; switching wallets tears the unlocked session down (a different seed
 * must be unlocked on its own); an out-of-range index is a typed reject; and a
 * legacy lone-vault storage (no count key) still reports exactly one wallet.
 *
 * Driven through the internal `createWalletEngineWithAdapter` + `FakeWdkAdapter`
 * seam, so real `@tetherto/*` is never loaded. The fake's seed counter mints a
 * DISTINCT valid phrase per call (call 0 byte-identical to the old single-seed
 * fake — back-compat), so a distinct wallet yields distinct fake addresses.
 */
import { describe, expect, it } from "vitest";
import { createWalletEngineWithAdapter } from "../src/wallet/engine.js";
import { USDT_ETHEREUM } from "../src/chains/index.js";
import {
  InvalidWalletIndexError,
  WalletExistsError,
  WalletLockedError,
} from "../src/errors.js";
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

/**
 * Two populated wallets over one storage. Wallet 0 = fake seed call 0 (the
 * frozen original), wallet 1 = call 1 (a distinct valid phrase). Leaves the
 * engine active on wallet 1 and unlocked, with count = 2 persisted.
 */
async function twoWallets(): Promise<{
  engine: WalletEngine;
  adapter: FakeWdkAdapter;
  storage: MemoryStorage;
}> {
  const adapter = new FakeWdkAdapter();
  const { deps, storage } = makeDeps();
  const engine = createWalletEngineWithAdapter(adapter, deps);
  await engine.createWallet(); // wallet 0 (seed call 0)
  await engine.unlock();
  await engine.addWallet(); // active → empty slot 1, session torn down
  await engine.createWallet(); // populate wallet 1 (seed call 1) → count 2
  await engine.unlock();
  return { engine, adapter, storage };
}

describe("wallet engine — multi-wallet (independent vaults)", () => {
  it("defaults to wallet 0; count is 0 before create, 1 after", async () => {
    const { deps } = makeDeps();
    const engine = createWalletEngineWithAdapter(new FakeWdkAdapter(), deps);
    expect(await engine.getActiveWallet()).toBe(0);
    expect(await engine.getWalletCount()).toBe(0); // no vault yet
    await engine.createWallet();
    expect(await engine.getWalletCount()).toBe(1); // wallet 0 now populated
    expect(await engine.getActiveWallet()).toBe(0);
  });

  it("addWallet allocates the next empty slot; populating it yields a distinct wallet", async () => {
    const adapter = new FakeWdkAdapter();
    const { deps } = makeDeps();
    const engine = createWalletEngineWithAdapter(adapter, deps);
    await engine.createWallet();
    await engine.unlock();
    const w0Addr = await engine.getAddress("ethereum", 0);

    const newIdx = await engine.addWallet();
    expect(newIdx).toBe(1);
    expect(await engine.getActiveWallet()).toBe(1);
    // Slot allocated but NOT yet populated → count still 1.
    expect(await engine.getWalletCount()).toBe(1);
    // The switch tore the session down (a different seed must be unlocked).
    await expect(engine.getAddress("ethereum", 0)).rejects.toBeInstanceOf(
      WalletLockedError,
    );

    await engine.createWallet(); // populates slot 1 with a DISTINCT seed
    expect(await engine.getWalletCount()).toBe(2);
    await engine.unlock();
    const w1Addr = await engine.getAddress("ethereum", 0);
    expect(w1Addr).toMatch(/^0x[0-9a-f]{8}$/);
    expect(w1Addr).not.toBe(w0Addr); // independent seed ⇒ independent address
  });

  it("setActiveWallet round-trips between existing wallets", async () => {
    const { engine } = await twoWallets();
    expect(await engine.getActiveWallet()).toBe(1);
    await engine.setActiveWallet(0);
    expect(await engine.getActiveWallet()).toBe(0);
    await engine.setActiveWallet(1);
    expect(await engine.getActiveWallet()).toBe(1);
  });

  it("setActiveWallet rejects a non-existent index with InvalidWalletIndexError", async () => {
    const { engine } = await twoWallets(); // count = 2, active = 1
    for (const bad of [-1, 1.5, Number.NaN, Infinity, 2]) {
      await expect(engine.setActiveWallet(bad)).rejects.toBeInstanceOf(
        InvalidWalletIndexError,
      );
    }
    expect(await engine.getActiveWallet()).toBe(1); // unchanged after rejects
  });

  it("activity is isolated per wallet (a switch shows only that wallet's log)", async () => {
    const { engine } = await twoWallets();
    await engine.setActiveWallet(0);
    await engine.unlock(); // the switch tore the session down
    await engine.send({ asset: USDT, to: "0xa", amount: 1n });
    expect(await engine.getActivity()).toHaveLength(1); // wallet 0

    await engine.setActiveWallet(1);
    await engine.unlock();
    expect(await engine.getActivity()).toHaveLength(0); // wallet 1 is empty
    await engine.send({ asset: USDT, to: "0xb", amount: 2n });
    expect(await engine.getActivity()).toHaveLength(1); // only wallet 1's send

    await engine.setActiveWallet(0);
    await engine.unlock();
    const w0 = await engine.getActivity();
    expect(w0).toHaveLength(1); // wallet 0's original send, not merged
    expect(w0[0]?.amount).toBe(1n);
  });

  it("each wallet keeps its own active-account selection", async () => {
    const { engine } = await twoWallets();
    await engine.setActiveWallet(0);
    await engine.setActiveAccount(3);
    expect(await engine.getActiveAccount()).toBe(3);

    await engine.setActiveWallet(1);
    expect(await engine.getActiveAccount()).toBe(0); // wallet 1 untouched

    await engine.setActiveWallet(0);
    expect(await engine.getActiveAccount()).toBe(3); // wallet 0 remembered
  });

  it("the active wallet persists across a fresh, still-locked engine", async () => {
    const { storage } = await twoWallets(); // active = 1, count = 2 persisted
    const reopened = createWalletEngineWithAdapter(
      new FakeWdkAdapter(),
      makeDeps(storage).deps,
    );
    expect(await reopened.getActiveWallet()).toBe(1);
    expect(await reopened.getWalletCount()).toBe(2);
  });

  it("switching wallet ends the unlocked session (re-unlock required)", async () => {
    const { engine } = await twoWallets(); // active 1, unlocked
    await expect(engine.getAddress("ethereum", 0)).resolves.toMatch(
      /^0x[0-9a-f]{8}$/,
    );
    await engine.setActiveWallet(0);
    // Different seed ⇒ the wallet-1 signer must be gone.
    await expect(engine.getAddress("ethereum", 0)).rejects.toBeInstanceOf(
      WalletLockedError,
    );
    await engine.unlock(); // unlock the now-active wallet 0
    await expect(engine.getAddress("ethereum", 0)).resolves.toMatch(
      /^0x[0-9a-f]{8}$/,
    );
  });

  it("legacy single-vault storage (no count key) reports exactly one wallet", async () => {
    const { deps, storage } = makeDeps();
    const engine = createWalletEngineWithAdapter(new FakeWdkAdapter(), deps);
    await engine.createWallet();
    // A single-wallet create writes ONLY the original un-suffixed vault key
    // and NO wallet-count key — byte-identical to a pre-multi-wallet wallet.
    expect([...storage.map.keys()]).toContain("wdk:vault:v1");
    expect([...storage.map.keys()]).not.toContain("wdk:wallet-count:v1");
    expect(await engine.getWalletCount()).toBe(1); // derived from the lone vault
    expect(await engine.getActiveWallet()).toBe(0);
    // create→create still rejects (slot 0 occupied) — back-compat clobber guard.
    await expect(engine.createWallet()).rejects.toBeInstanceOf(WalletExistsError);
    expect(await engine.getWalletCount()).toBe(1);
  });

  it("two wallets imported from different seeds are isolated", async () => {
    const { deps } = makeDeps();
    const engine = createWalletEngineWithAdapter(new FakeWdkAdapter(), deps);
    const seedA =
      "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima";
    const seedB =
      "mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray";
    await engine.importWallet(seedA);
    await engine.unlock();
    const aAddr = await engine.getAddress("ethereum", 0);

    await engine.addWallet();
    await engine.importWallet(seedB);
    await engine.unlock();
    const bAddr = await engine.getAddress("ethereum", 0);

    expect(bAddr).not.toBe(aAddr); // independent imported seeds
    expect(await engine.getWalletCount()).toBe(2);
  });
});
