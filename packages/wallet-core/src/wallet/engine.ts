/**
 * The wallet engine — the headless contract implementation.
 *
 * This file owns the state machine (no wallet → locked → unlocked) and the
 * persistence/crypto orchestration. It never imports `@tetherto/*`: it talks to
 * a `WdkAdapter` (the containment layer) and to the injected host ports
 * (`StorageAdapter`, `CryptoWorker`, `UnlockProvider`). That is what makes it
 * unit-testable with a hand-written fake adapter and reusable unchanged by the
 * Next.js app, a browser extension, and an eCommerce checkout.
 *
 * DI seam (see docs/ARCHITECTURE.md → Phasing):
 *  - `createWalletEngine(deps, config?)` is the public, frozen-signature factory.
 *    It lazy-imports the real `@tetherto/*` adapter, so merely constructing the
 *    engine does not pull alpha WDK into the bundle until a method runs.
 *  - `createWalletEngineWithAdapter(adapter, deps, config?)` is internal: tests
 *    pass a fake adapter and never load real WDK.
 *
 * Phase 1 surface: create / import / hasWallet / unlock / lock / getAddress /
 * getBalances. Phase 2 adds `quoteSend` / `send` / `getActivity`. Activity is
 * backed by a local outgoing send-log (see activity-log.ts → ADR-003): WDK has
 * no history API, so the engine records its own sends and refreshes their
 * status from the on-chain receipt rather than fabricating history.
 *
 * Honest crypto-worker note (P1 vs P2): the frozen `CryptoWorker` port has no
 * seed-provisioning method, so true Web-Worker seed isolation lands in Phase 2
 * paired with transaction signing. In Phase 1 `unlock()` decrypts the seed in
 * this process and builds an in-process signer; `lock()` still calls
 * `deps.crypto.lock()` so the forward-compatible contract holds. SECURITY.md
 * documents this as defense-in-depth, not faked native parity.
 */
import type {
  ActivityItem,
  Asset,
  Balance,
  ChainId,
  FeeQuote,
  StorageAdapter,
  TxIntent,
  TxResult,
  WalletEngine,
  WalletEngineDeps,
} from "../types.js";
import type { ChainRegistry, WdkAdapter, WdkBalanceReader, WdkSigner } from "../wdk/types.js";
import { DEFAULT_ASSETS, DEFAULT_CHAINS } from "../chains/index.js";
import { sealSeed } from "../secrets/index.js";
import { appendSend, readLog, writeLog } from "./activity-log.js";
import {
  InvalidAccountIndexError,
  InvalidSeedPhraseError,
  NoWalletError,
  UnsupportedChainError,
  WalletExistsError,
  WalletLockedError,
} from "../errors.js";

/**
 * Per-build chain + asset configuration. The public factory's frozen type is
 * `(deps) => WalletEngine`; this optional second argument is structurally
 * compatible with it (callers using the `CreateWalletEngine` type simply omit
 * it). The Next.js app passes env-driven RPC / Electrum-WS config here.
 */
export interface WalletEngineConfig {
  readonly chains?: ChainRegistry;
  readonly assets?: readonly Asset[];
}

/** Storage key for the sealed seed blob. Versioned so a format bump is a key bump. */
const VAULT_KEY = "wdk:vault:v1";

/**
 * Storage key for the active HD account index. Plaintext decimal — this is a
 * UI preference (which of the seed's accounts is selected), NOT secret
 * material, so it is deliberately not in the encrypted vault and survives
 * lock/unlock + reload. Absent ⇒ account 0, so a pre-multi-account wallet
 * reads back exactly as before.
 */
const ACTIVE_ACCOUNT_KEY = "wdk:active-account:v1";

/** Read the persisted active account; any failure or absence ⇒ 0 (back-compat). */
async function loadActiveAccount(storage: StorageAdapter): Promise<number> {
  let bytes: Uint8Array | null;
  try {
    bytes = await storage.get(ACTIVE_ACCOUNT_KEY);
  } catch {
    return 0;
  }
  if (bytes === null) return 0;
  const n = Number.parseInt(new TextDecoder().decode(bytes), 10);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

/** Persist the active account index as plaintext decimal bytes. */
async function saveActiveAccount(storage: StorageAdapter, index: number): Promise<void> {
  await storage.set(ACTIVE_ACCOUNT_KEY, new TextEncoder().encode(String(index)));
}

/**
 * Shared engine body. `adapterReady` defers adapter acquisition: the public
 * factory passes a lazy dynamic import, the internal factory a resolved fake.
 */
function buildEngine(
  adapterReady: () => Promise<WdkAdapter>,
  deps: WalletEngineDeps,
  config: WalletEngineConfig | undefined,
): WalletEngine {
  const chains: ChainRegistry = config?.chains ?? DEFAULT_CHAINS;
  const assets: readonly Asset[] = config?.assets ?? DEFAULT_ASSETS;

  let signer: WdkSigner | null = null;
  let balanceReader: WdkBalanceReader | null = null;

  // Active HD account, lazily hydrated from storage on first use so a reopened
  // engine resumes the last selection. Not reset by lock() — the selection is
  // a non-secret UI preference, symmetric with the vault staying in storage.
  let activeAccount = 0;
  let activeAccountLoaded = false;

  async function currentAccount(): Promise<number> {
    if (!activeAccountLoaded) {
      activeAccount = await loadActiveAccount(deps.storage);
      activeAccountLoaded = true;
    }
    return activeAccount;
  }

  function ensureUnlocked(): { signer: WdkSigner; balanceReader: WdkBalanceReader } {
    if (!signer || !balanceReader) throw new WalletLockedError();
    return { signer, balanceReader };
  }

  async function persistSeed(seedPhrase: string): Promise<void> {
    const key = await deps.unlock.unlock();
    const blob = await sealSeed(seedPhrase, key);
    await deps.storage.set(VAULT_KEY, blob);
  }

  return {
    async createWallet(): Promise<{ seedPhrase: string }> {
      if (await this.hasWallet()) throw new WalletExistsError();
      const adapter = await adapterReady();
      const seedPhrase = await adapter.generateSeedPhrase();
      await persistSeed(seedPhrase);
      // Stays locked: the app shows a backup screen, then calls unlock().
      return { seedPhrase };
    },

    async importWallet(seedPhrase: string): Promise<void> {
      if (await this.hasWallet()) throw new WalletExistsError();
      const adapter = await adapterReady();
      if (!(await adapter.isValidSeedPhrase(seedPhrase))) throw new InvalidSeedPhraseError();
      await persistSeed(seedPhrase);
    },

    async hasWallet(): Promise<boolean> {
      return (await deps.storage.get(VAULT_KEY)) !== null;
    },

    async unlock(): Promise<void> {
      if (signer && balanceReader) return; // idempotent
      const blob = await deps.storage.get(VAULT_KEY);
      if (blob === null) throw new NoWalletError();
      const adapter = await adapterReady();
      const key = await deps.unlock.unlock();
      // The adapter decrypts the sealed vault itself — worker-side for the
      // real impl (ADR-004), so the plaintext seed never materialises on this
      // thread. Only the opaque blob + the non-extractable CryptoKey handle
      // cross the postMessage edge. createSigner rejects with
      // VaultFormatError / VaultDecryptError on a bad key/blob.
      const nextSigner = await adapter.createSigner(blob, key, chains);
      const nextReader = await adapter.createBalanceReader(chains);
      signer = nextSigner;
      balanceReader = nextReader;
    },

    async lock(): Promise<void> {
      // Await disposal: for the worker-backed proxy this resolves only after
      // the worker has zeroised the seed + WDK manager, so reporting "locked"
      // is truthful, not optimistic.
      await signer?.dispose();
      await balanceReader?.dispose();
      signer = null;
      balanceReader = null;
      // deps.crypto is the engine-level lock signal, not the seed boundary
      // (the WDK adapter worker is — ADR-004). Kept as a defense-in-depth
      // hook the host can wire to also hard-stop any auxiliary worker.
      await deps.crypto.lock();
      // activeAccount is intentionally NOT reset: it is a non-secret UI
      // preference that must survive lock/unlock (symmetric with the vault).
    },

    async setActiveAccount(index: number): Promise<void> {
      if (!Number.isSafeInteger(index) || index < 0) {
        throw new InvalidAccountIndexError(index);
      }
      await saveActiveAccount(deps.storage, index);
      activeAccount = index;
      activeAccountLoaded = true;
    },

    async getActiveAccount(): Promise<number> {
      return currentAccount();
    },

    async getAddress(chain: ChainId, index = 0): Promise<string> {
      const { signer: s } = ensureUnlocked();
      if (!chains[chain]) throw new UnsupportedChainError(chain);
      return s.deriveAddress(chain, index);
    },

    async getBalances(): Promise<readonly Balance[]> {
      const { signer: s, balanceReader: r } = ensureUnlocked();
      const acct = await currentAccount();
      const addressByChain = new Map<ChainId, string>();
      const balances: Balance[] = [];
      for (const asset of assets) {
        // Assets on chains this build did not configure are omitted from the
        // portfolio (an explicit getAddress/send on that chain still raises a
        // typed UnsupportedChainError — failing loud only when asked directly).
        if (!chains[asset.chain]) continue;
        let address = addressByChain.get(asset.chain);
        if (address === undefined) {
          address = await s.deriveAddress(asset.chain, acct);
          addressByChain.set(asset.chain, address);
        }
        const amount = asset.token
          ? await r.getTokenBalance(asset.chain, asset.token, address)
          : await r.getNativeBalance(asset.chain, address);
        balances.push({ asset, amount });
      }
      return balances;
    },

    async getActivity(asset?: Asset): Promise<readonly ActivityItem[]> {
      const acct = await currentAccount();
      const items = await readLog(deps.storage, acct);
      // Refresh pending entries only when unlocked (the seedless reader is
      // built at unlock). Locked → return last-known statuses, never guessed;
      // a flaky RPC on one entry must not fail the whole activity read.
      if (balanceReader) {
        const r = balanceReader;
        let changed = false;
        await Promise.all(
          items.map(async (it, i) => {
            if (it.status !== "pending") return;
            try {
              const next = await r.getTransactionStatus(it.asset.chain, it.hash, it.from);
              if (next !== it.status) {
                items[i] = { ...it, status: next };
                changed = true;
              }
            } catch {
              /* keep last-known status */
            }
          }),
        );
        if (changed) await writeLog(deps.storage, items, acct);
      }
      const filtered =
        asset === undefined
          ? items
          : items.filter(
              (it) =>
                it.asset.symbol === asset.symbol &&
                it.asset.chain === asset.chain &&
                it.asset.token === asset.token,
            );
      // Newest first; project to the frozen public shape (drop internal `from`).
      return filtered
        .slice()
        .sort((a, b) => b.timestamp - a.timestamp)
        .map(
          (it): ActivityItem => ({
            hash: it.hash,
            asset: it.asset,
            amount: it.amount,
            direction: it.direction,
            timestamp: it.timestamp,
            status: it.status,
          }),
        );
    },

    async quoteSend(intent: TxIntent): Promise<FeeQuote> {
      const { signer: s } = ensureUnlocked();
      if (!chains[intent.asset.chain]) throw new UnsupportedChainError(intent.asset.chain);
      return s.quoteSend(intent, await currentAccount());
    },

    async send(intent: TxIntent): Promise<TxResult> {
      const { signer: s } = ensureUnlocked();
      if (!chains[intent.asset.chain]) throw new UnsupportedChainError(intent.asset.chain);
      const acct = await currentAccount();
      // The sender address is recorded so a Bitcoin tx's status can later be
      // refreshed (WDK's BTC receipt lookup is address-scoped, not global) —
      // derived for the ACTIVE account so a switch changes the send origin.
      const from = await s.deriveAddress(intent.asset.chain, acct);
      const result = await s.send(intent, acct);
      await appendSend(
        deps.storage,
        {
          hash: result.hash,
          asset: intent.asset,
          amount: intent.amount,
          direction: "out",
          timestamp: Date.now(),
          status: "pending",
          from,
        },
        acct,
      );
      return result;
    },
  };
}

/**
 * Internal factory for unit tests: inject a fake `WdkAdapter` so the engine is
 * exercised without ever loading alpha `@tetherto/*`. Not re-exported from the
 * package root — tests import it from `wallet-core/src/wallet/engine.js`.
 */
export function createWalletEngineWithAdapter(
  adapter: WdkAdapter,
  deps: WalletEngineDeps,
  config?: WalletEngineConfig,
): WalletEngine {
  return buildEngine(() => Promise.resolve(adapter), deps, config);
}

/**
 * Public factory. Frozen signature is `(deps) => WalletEngine`; the optional
 * `config` is structurally compatible. The real `@tetherto/*` adapter is
 * lazy-imported on first use (memoised) so constructing the engine does not
 * eagerly bundle alpha WDK.
 */
export function createWalletEngine(
  deps: WalletEngineDeps,
  config?: WalletEngineConfig,
): WalletEngine {
  let adapterPromise: Promise<WdkAdapter> | null = null;
  const adapterReady = (): Promise<WdkAdapter> => {
    adapterPromise ??= import("../wdk/index.js").then((m) => m.createWdkAdapter());
    return adapterPromise;
  };
  return buildEngine(adapterReady, deps, config);
}
