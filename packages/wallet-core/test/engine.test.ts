/**
 * Engine state-machine + phase-boundary tests. Driven through the internal
 * `createWalletEngineWithAdapter` factory with `FakeWdkAdapter`, so real
 * `@tetherto/*` is never loaded. The vault crypto underneath is real
 * (PassphraseUnlock derives an actual AES-GCM key).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWalletEngineWithAdapter } from "../src/wallet/engine.js";
import { DEFAULT_ASSETS, USDT_ETHEREUM, buildChainRegistry } from "../src/chains/index.js";
import {
  InvalidAddressError,
  InvalidSeedPhraseError,
  NoWalletError,
  UnsupportedChainError,
  VaultDecryptError,
  WalletExistsError,
  WalletLockedError,
} from "../src/errors.js";
import type { ActivityItem, WalletEngine, WalletEngineDeps } from "../src/types.js";
import type { ChainRegistry, WdkBalanceReader } from "../src/wdk/types.js";
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

  it("adds a passkey vault slot without breaking passphrase unlock", async () => {
    await engine.createWallet();
    await engine.unlock();
    const passphraseAddress = await engine.getAddress("ethereum");
    const passkeyKey = await new PassphraseUnlock("passkey credential").unlock();

    await engine.reencrypt(passkeyKey);
    await engine.lock();

    await storage.set(
      "wdk:unlock:active-vault:v1",
      new TextEncoder().encode("webauthn"),
    );
    const passkeyEngine = createWalletEngineWithAdapter(
      new FakeWdkAdapter(),
      makeDeps(storage, "passkey credential").deps,
    );
    await passkeyEngine.unlock();
    expect(await passkeyEngine.getAddress("ethereum")).toBe(passphraseAddress);
    await passkeyEngine.lock();

    await storage.set(
      "wdk:unlock:active-vault:v1",
      new TextEncoder().encode("passphrase"),
    );
    const reopened = createWalletEngineWithAdapter(
      new FakeWdkAdapter(),
      makeDeps(storage).deps,
    );
    await reopened.unlock();
    expect(await reopened.getAddress("ethereum")).toBe(passphraseAddress);
  });
});

describe("wallet engine — portfolio", () => {
  it("omits assets on chains this build did not configure", async () => {
    // DEFAULT registry = the four always-on EVM nets (keyless public RPC):
    // Ethereum, Polygon, Arbitrum, Plasma — plus Solana (keyless public RPC,
    // no chainId). BTC@bitcoin needs an explicit Electrum-WS URL, so it is
    // dropped from the portfolio — but an explicit getAddress('bitcoin') still
    // errors loud.
    const adapter = new FakeWdkAdapter();
    const { deps } = makeDeps();
    const engine = createWalletEngineWithAdapter(adapter, deps); // default chains/assets
    await engine.createWallet();
    await engine.unlock();

    const balances = await engine.getBalances();
    const symbols = balances.map((b) => b.asset.symbol).sort();
    // USDT on Ethereum/Polygon/Arbitrum/Plasma/Solana + XAU₮ on Ethereum.
    expect(symbols).toEqual(["USDT", "USDT", "USDT", "USDT", "USDT", "XAUT"]);
    const chains = new Set(balances.map((b) => b.asset.chain));
    expect([...chains].sort()).toEqual(["arbitrum", "ethereum", "plasma", "polygon", "solana"]);
    expect(chains.has("bitcoin")).toBe(false); // BTC chain not in default registry
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

  it("marks one chain unavailable instead of failing the whole portfolio when its reader throws", async () => {
    // One bad public RPC must not blank every balance: getBalances settles
    // per-asset — the failing chain is flagged unavailable (amount 0n), the
    // rest still load. The UI shows an honest marker, never a fake zero.
    class PartialFailAdapter extends FakeWdkAdapter {
      override async createBalanceReader(_chains: ChainRegistry): Promise<WdkBalanceReader> {
        return {
          async getNativeBalance(): Promise<bigint> {
            return 0n;
          },
          async getTokenBalance(chain): Promise<bigint> {
            if (chain === "polygon") throw new Error("RPC down");
            return 5_000_000n;
          },
          async getTransactionStatus(): Promise<"pending" | "confirmed" | "failed"> {
            return "confirmed";
          },
          dispose(): void {},
        };
      }
    }

    const { deps } = makeDeps();
    const engine = createWalletEngineWithAdapter(new PartialFailAdapter(), deps, {
      chains: buildChainRegistry(),
      assets: [
        { symbol: "USDT", chain: "ethereum", token: USDT_ETHEREUM, decimals: 6 },
        { symbol: "USDT", chain: "polygon", token: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6 },
      ],
    });
    await engine.createWallet();
    await engine.unlock();

    const balances = await engine.getBalances(); // must NOT reject
    const eth = balances.find((b) => b.asset.chain === "ethereum");
    const poly = balances.find((b) => b.asset.chain === "polygon");
    expect(eth?.amount).toBe(5_000_000n);
    expect(eth?.unavailable).toBeUndefined();
    expect(poly?.unavailable).toBe(true);
    expect(poly?.amount).toBe(0n);
  });
});

describe("wallet engine — watch-only reads (Phase 5)", () => {
  it("reads an external address with NO wallet, NO unlock, and NO signer", async () => {
    const adapter = new FakeWdkAdapter({
      token: { [`ethereum:${USDT_ETHEREUM}`]: 5_000_000n },
    });
    const { deps } = makeDeps();
    const engine = createWalletEngineWithAdapter(adapter, deps, {
      chains: buildChainRegistry(),
      assets: [{ symbol: "USDT", chain: "ethereum", token: USDT_ETHEREUM, decimals: 6 }],
    });

    // Deliberately no createWallet / unlock: watch-only is seedless.
    const balances = await engine.getBalancesForAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
    expect(balances).toHaveLength(1);
    expect(balances[0]?.asset.symbol).toBe("USDT");
    expect(balances[0]?.amount).toBe(5_000_000n);

    expect(await engine.hasWallet()).toBe(false); // never created a vault
    expect(adapter.signers).toHaveLength(0); // never built a seed-bound signer
    expect(adapter.readers).toHaveLength(1); // exactly one seedless reader
  });

  it("restricts to the requested chains via opts.chains", async () => {
    const adapter = new FakeWdkAdapter({
      native: { ethereum: 11n, polygon: 22n, arbitrum: 33n, plasma: 44n },
    });
    const { deps } = makeDeps();
    const engine = createWalletEngineWithAdapter(adapter, deps, {
      chains: buildChainRegistry(),
      assets: [
        { symbol: "ETH", chain: "ethereum", decimals: 18 },
        { symbol: "POL", chain: "polygon", decimals: 18 },
        { symbol: "ETH", chain: "arbitrum", decimals: 18 },
      ],
    });

    const balances = await engine.getBalancesForAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", {
      chains: ["polygon", "arbitrum"],
    });
    const chainsSeen = balances.map((b) => b.asset.chain).sort();
    expect(chainsSeen).toEqual(["arbitrum", "polygon"]);
    expect(balances.find((b) => b.asset.chain === "ethereum")).toBeUndefined();
  });

  it("reuses the unlocked reader when a session is live (no second reader)", async () => {
    const adapter = new FakeWdkAdapter({ token: { [`ethereum:${USDT_ETHEREUM}`]: 9n } });
    const { deps } = makeDeps();
    const engine = createWalletEngineWithAdapter(adapter, deps, {
      chains: buildChainRegistry(),
      assets: [{ symbol: "USDT", chain: "ethereum", token: USDT_ETHEREUM, decimals: 6 }],
    });
    await engine.createWallet();
    await engine.unlock();
    expect(adapter.readers).toHaveLength(1); // the unlock reader

    await engine.getBalancesForAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
    expect(adapter.readers).toHaveLength(1); // reused, not a second reader
  });

  it("rejects a malformed address before it reaches a balance reader (defense in depth)", async () => {
    const adapter = new FakeWdkAdapter({ token: { [`ethereum:${USDT_ETHEREUM}`]: 7n } });
    const { deps } = makeDeps();
    const engine = createWalletEngineWithAdapter(adapter, deps, {
      chains: buildChainRegistry(),
      assets: [{ symbol: "USDT", chain: "ethereum", token: USDT_ETHEREUM, decimals: 6 }],
    });

    // Not 0x + 40 hex → the core must throw, not query the reader with garbage.
    await expect(engine.getBalancesForAddress("0xWATCHED")).rejects.toBeInstanceOf(
      InvalidAddressError,
    );
    await expect(
      engine.getBalancesForAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA960"),
    ).rejects.toBeInstanceOf(InvalidAddressError);
    expect(adapter.readers).toHaveLength(0); // never built a reader for a bad address
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
    // Default registry = the always-on EVM nets; Bitcoin needs an explicit
    // Electrum-WS URL, so it is unconfigured here.
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

  it("keeps activity local-only unless a host injects a history provider", async () => {
    await engine.send({ asset: USDT, to: "0xrecipient", amount: 1n });
    const activity = await engine.getActivity();

    expect(activity).toHaveLength(1);
    expect(activity[0]?.direction).toBe("out");
  });

  it("merges injected history, preferring indexed chain state over local sends", async () => {
    const local = await engine.send({ asset: USDT, to: "0xrecipient", amount: 1n });
    const indexedSame: ActivityItem = {
      hash: local.hash,
      asset: USDT,
      amount: 1n,
      direction: "out",
      timestamp: Date.now() + 1000,
      status: "confirmed",
    };
    const indexedInbound: ActivityItem = {
      hash: "0xinbound",
      asset: USDT,
      amount: 9n,
      direction: "in",
      timestamp: Date.now() + 2000,
      status: "confirmed",
    };

    const withHistory = createWalletEngineWithAdapter(
      new FakeWdkAdapter({ txStatus }),
      makeDeps(storage).deps,
      {
        historyProvider: {
          async getTransactionHistory() {
            return [indexedSame, indexedInbound];
          },
        },
      },
    );
    await withHistory.unlock();

    const activity = await withHistory.getActivity();
    expect(activity).toHaveLength(2);
    expect(activity.map((item) => item.hash)).toEqual(["0xinbound", local.hash]);
    expect(activity.find((item) => item.hash === local.hash)?.status).toBe("confirmed");
  });

  it("keeps local activity when an injected history provider fails", async () => {
    const local = await engine.send({ asset: USDT, to: "0xrecipient", amount: 1n });
    const withFailingHistory = createWalletEngineWithAdapter(
      new FakeWdkAdapter({ txStatus }),
      makeDeps(storage).deps,
      {
        historyProvider: {
          async getTransactionHistory() {
            throw new Error("indexer down");
          },
        },
      },
    );
    await withFailingHistory.unlock();

    const activity = await withFailingHistory.getActivity();
    expect(activity).toHaveLength(1);
    expect(activity[0]?.hash).toBe(local.hash);
  });
});

/**
 * End-to-end send round-trip on the established fake-adapter seam. These cover
 * the paths the Phase-2 block above does not: pending→failed, a throwing
 * status lookup keeping the last-known status (never fabricated), newest-first
 * ordering, and that the internal `from` is dropped from the public shape.
 */
describe("wallet engine — send e2e (mocked provider)", () => {
  const USDT = { symbol: "USDT", chain: "ethereum", token: USDT_ETHEREUM, decimals: 6 } as const;
  const XAUT = {
    symbol: "XAUT",
    chain: "ethereum",
    token: "0x68749665FF8D2d112Fa859AA293F07A622782F38",
    decimals: 6,
  } as const;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("round-trips quote → send → activity, persists status, drops internal `from`", async () => {
    const txStatus = new Map<string, "pending" | "confirmed" | "failed">();
    const m = makeDeps();
    const storage = m.storage;
    const engine = createWalletEngineWithAdapter(new FakeWdkAdapter({ txStatus }), m.deps);
    await engine.createWallet();
    await engine.unlock();

    const quote = await engine.quoteSend({ asset: USDT, to: "0xrecipient", amount: 250_000n });
    expect(quote.fee).toBe(21_000n);
    expect(quote.feeAsset.symbol).toBe("ETH");
    expect(quote.feeAsset.chain).toBe("ethereum");

    const res = await engine.send({ asset: USDT, to: "0xrecipient", amount: 250_000n });
    expect(res.hash).toMatch(/^0x[0-9a-f]{8}$/);
    expect(res.chain).toBe("ethereum");

    const pending = await engine.getActivity();
    expect(pending).toHaveLength(1);
    const item = pending[0]!;
    expect(item).toMatchObject({
      hash: res.hash,
      direction: "out",
      status: "pending",
      amount: 250_000n,
    });
    expect(item.asset).toEqual(USDT); // symbol+chain+token+decimals survive serialize
    // Internal sender address must NOT leak into the public shape.
    expect("from" in item).toBe(false);

    txStatus.set(res.hash, "confirmed"); // mine it
    expect((await engine.getActivity())[0]?.status).toBe("confirmed");

    // A fresh, still-locked engine over the SAME storage (no refresh path)
    // still reads "confirmed" → it was written back, not recomputed.
    const reopened = createWalletEngineWithAdapter(new FakeWdkAdapter(), makeDeps(storage).deps);
    const persisted = await reopened.getActivity();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.status).toBe("confirmed");
  });

  it("refreshes a pending entry to failed when the chain reports an explicit failure", async () => {
    const txStatus = new Map<string, "pending" | "confirmed" | "failed">();
    const m = makeDeps();
    const engine = createWalletEngineWithAdapter(new FakeWdkAdapter({ txStatus }), m.deps);
    await engine.createWallet();
    await engine.unlock();

    const res = await engine.send({ asset: USDT, to: "0xrecipient", amount: 5n });
    expect((await engine.getActivity())[0]?.status).toBe("pending");

    txStatus.set(res.hash, "failed");
    expect((await engine.getActivity())[0]?.status).toBe("failed");
  });

  it("keeps the last-known status (never fabricates) when the status lookup throws", async () => {
    class ThrowingStatusAdapter extends FakeWdkAdapter {
      override async createBalanceReader(_chains: ChainRegistry): Promise<WdkBalanceReader> {
        return {
          async getNativeBalance(): Promise<bigint> {
            return 0n;
          },
          async getTokenBalance(): Promise<bigint> {
            return 0n;
          },
          async getTransactionStatus(): Promise<"pending" | "confirmed" | "failed"> {
            throw new Error("RPC down");
          },
          dispose(): void {},
        };
      }
    }

    const m = makeDeps();
    const engine = createWalletEngineWithAdapter(new ThrowingStatusAdapter(), m.deps);
    await engine.createWallet();
    await engine.unlock();

    await engine.send({ asset: USDT, to: "0xrecipient", amount: 9n });
    const activity = await engine.getActivity();
    // The refresh threw; the engine must keep the last-known status, not
    // silently invent "confirmed"/"failed".
    expect(activity).toHaveLength(1);
    expect(activity[0]?.status).toBe("pending");
  });

  it("orders activity newest-first", async () => {
    let t = 0;
    vi.spyOn(Date, "now").mockImplementation(() => (t += 1_000));

    const m = makeDeps();
    const engine = createWalletEngineWithAdapter(new FakeWdkAdapter(), m.deps);
    await engine.createWallet();
    await engine.unlock();

    await engine.send({ asset: USDT, to: "0xfirst", amount: 1n });
    await engine.send({ asset: XAUT, to: "0xsecond", amount: 2n });
    await engine.send({ asset: USDT, to: "0xthird", amount: 3n });

    const activity = await engine.getActivity();
    expect(activity).toHaveLength(3);
    const ts = activity.map((a) => a.timestamp);
    expect(ts).toEqual([...ts].sort((a, b) => b - a)); // strictly descending
    expect(activity[0]?.amount).toBe(3n); // newest send first
    expect(activity[2]?.amount).toBe(1n);
  });
});

/**
 * Bitcoin happy path. The rest of the suite only proves BTC is *omitted* when
 * unconfigured (no Electrum-WS URL in the default registry); this proves the *positive*
 * path now that real BTC ships on web: a BTC chain registered from an
 * Electrum-over-WebSocket URL — the exact `ChainRegistry` shape the browser
 * build produces from `NEXT_PUBLIC_/VITE_ BTC_ELECTRUM_WS_URL`. `FakeWdkAdapter`
 * stands in for real WDK + the injected `ElectrumWs` client (the real
 * `ElectrumWs` lives behind `src/wdk/wdk-core.ts`, the sole sanctioned WDK
 * import site — unit tests never open a socket), so this asserts the engine's
 * BTC behaviour without any network.
 */
describe("wallet engine — bitcoin (Electrum-WS chain configured)", () => {
  const BTC = { symbol: "BTC", chain: "bitcoin", decimals: 8 } as const;
  const USDT = { symbol: "USDT", chain: "ethereum", token: USDT_ETHEREUM, decimals: 6 } as const;
  const WSS = "wss://electrum.example.invalid:50004";
  const chains = buildChainRegistry({ btcElectrumWsUrl: WSS });
  const assets = [BTC, USDT];

  it("buildChainRegistry registers bitcoin when an Electrum-WS URL is set", () => {
    expect(chains.bitcoin).toMatchObject({
      kind: "btc",
      chain: "bitcoin",
      network: "bitcoin",
      electrumWsUrl: WSS,
    });
  });

  it("derives a BTC address and lists native (no-token) BTC in the portfolio", async () => {
    const adapter = new FakeWdkAdapter({ native: { bitcoin: 150_000n } });
    const { deps } = makeDeps();
    const engine = createWalletEngineWithAdapter(adapter, deps, { chains, assets });
    await engine.createWallet();
    await engine.unlock();

    // Shape is the fake's (seed-bound hex); the real WDK ElectrumWs path yields
    // a bech32 address — covered by the wdk/ adapter, not this engine unit test.
    expect(await engine.getAddress("bitcoin", 0)).toMatch(/^0x[0-9a-f]{8}$/);

    const balances = await engine.getBalances();
    const btc = balances.find((b) => b.asset.symbol === "BTC");
    expect(btc?.asset.chain).toBe("bitcoin");
    expect(btc?.asset.token).toBeUndefined(); // BTC is native — no ERC-20 token
    expect(btc?.amount).toBe(150_000n); // satoshis (8 decimals)
  });

  it("quotes a BTC send with the fee labelled in BTC, not ETH", async () => {
    const { deps } = makeDeps();
    const engine = createWalletEngineWithAdapter(new FakeWdkAdapter(), deps, { chains, assets });
    await engine.createWallet();
    await engine.unlock();

    const q = await engine.quoteSend({ asset: BTC, to: "bc1qexamplerecipient", amount: 50_000n });
    // A Bitcoin tx fee is paid in BTC, never in ETH (distinct from EVM gas).
    expect(q.feeAsset.symbol).toBe("BTC");
    expect(q.feeAsset.chain).toBe("bitcoin");
  });

  it("sends BTC and records one pending outgoing entry on the bitcoin chain", async () => {
    const { deps } = makeDeps();
    const engine = createWalletEngineWithAdapter(new FakeWdkAdapter(), deps, { chains, assets });
    await engine.createWallet();
    await engine.unlock();

    const res = await engine.send({ asset: BTC, to: "bc1qexamplerecipient", amount: 50_000n });
    expect(res.chain).toBe("bitcoin");
    expect(res.hash).toMatch(/^0x[0-9a-f]{8}$/);

    const activity = await engine.getActivity();
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({
      hash: res.hash,
      direction: "out",
      status: "pending",
      amount: 50_000n,
    });
    expect(activity[0]?.asset.symbol).toBe("BTC");
    expect(activity[0]?.asset.chain).toBe("bitcoin");
  });
});
