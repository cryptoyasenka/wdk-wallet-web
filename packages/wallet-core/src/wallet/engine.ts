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
  InvalidAddressError,
  InvalidSeedPhraseError,
  InvalidWalletIndexError,
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
  readonly historyProvider?: {
    getTransactionHistory(
      chain: ChainId,
      address: string,
      tokenAddress?: string,
    ): Promise<readonly ActivityItem[]>;
  };
}

/** Storage key for the sealed seed blob. Versioned so a format bump is a key bump. */
const VAULT_KEY = "wdk:vault:v1";
const ACTIVE_VAULT_CREDENTIAL_KEY = "wdk:unlock:active-vault:v1";
const PASSKEY_VAULT_SUFFIX = ":webauthn";

/**
 * Storage key for the active HD account index. Plaintext decimal — this is a
 * UI preference (which of the seed's accounts is selected), NOT secret
 * material, so it is deliberately not in the encrypted vault and survives
 * lock/unlock + reload. Absent ⇒ account 0, so a pre-multi-account wallet
 * reads back exactly as before. This selection is PER WALLET (each wallet
 * gets its own keyed copy).
 */
const ACTIVE_ACCOUNT_KEY = "wdk:active-account:v1";

/**
 * Active wallet index + how many wallets exist. Both plaintext decimal,
 * non-secret (which vault is selected / how many vaults), survive reload.
 * Absent active-wallet ⇒ wallet 0; absent wallet-count ⇒ derived from whether
 * the lone original vault exists (pre-multi-wallet back-compat).
 */
const ACTIVE_WALLET_KEY = "wdk:active-wallet:v1";
const WALLET_COUNT_KEY = "wdk:wallet-count:v1";

/**
 * Wallet 0 keeps the ORIGINAL un-suffixed keys (zero migration); wallet W>0
 * appends `:wW`. Symmetric with the activity log's wallet/account suffixing.
 */
function walletSuffix(walletIndex: number): string {
  return walletIndex === 0 ? "" : `:w${walletIndex}`;
}
function vaultKey(walletIndex: number): string {
  return `${VAULT_KEY}${walletSuffix(walletIndex)}`;
}
function passkeyVaultKey(walletIndex: number): string {
  return `${vaultKey(walletIndex)}${PASSKEY_VAULT_SUFFIX}`;
}
function activeVaultCredentialKey(walletIndex: number): string {
  return `${ACTIVE_VAULT_CREDENTIAL_KEY}${walletSuffix(walletIndex)}`;
}
function activeAccountKey(walletIndex: number): string {
  return `${ACTIVE_ACCOUNT_KEY}${walletSuffix(walletIndex)}`;
}

/**
 * Cheap well-formedness check for an externally-supplied address, keyed on the
 * chain's kind (not a full checksum/bech32 validation — that is the WDK
 * adapter's job). EVM addresses must be `0x` + 40 hex; BTC and Solana
 * addresses must be a non-empty run of base58/bech32 characters (alphanumeric
 * only: no whitespace, control, or punctuation) — Solana base58 pubkeys fall in
 * the same class as BTC here. Used by `getBalancesForAddress` so a malformed
 * string never reaches a balance reader.
 */
function isWellFormedAddress(kind: "evm" | "btc" | "solana", address: string): boolean {
  const a = address.trim();
  if (a === "") return false;
  if (kind === "evm") return /^0x[0-9a-fA-F]{40}$/.test(a);
  return /^[a-zA-Z0-9]+$/.test(a);
}

async function activeVaultKey(storage: StorageAdapter, walletIndex: number): Promise<string> {
  const raw = await storage.get(activeVaultCredentialKey(walletIndex));
  const credential = raw === null ? "passphrase" : new TextDecoder().decode(raw);
  return credential === "webauthn" ? passkeyVaultKey(walletIndex) : vaultKey(walletIndex);
}

/** Read a plaintext-decimal non-negative integer at `key`; absent/bad ⇒ `fallback`. */
async function loadCounter(
  storage: StorageAdapter,
  key: string,
  fallback: number,
): Promise<number> {
  let bytes: Uint8Array | null;
  try {
    bytes = await storage.get(key);
  } catch {
    return fallback;
  }
  if (bytes === null) return fallback;
  const n = Number.parseInt(new TextDecoder().decode(bytes), 10);
  return Number.isSafeInteger(n) && n >= 0 ? n : fallback;
}

/** Persist a non-negative integer as plaintext decimal bytes. */
async function saveCounter(
  storage: StorageAdapter,
  key: string,
  value: number,
): Promise<void> {
  await storage.set(key, new TextEncoder().encode(String(value)));
}

/** Active HD account for a given wallet; absence ⇒ 0 (back-compat). */
async function loadActiveAccount(storage: StorageAdapter, walletIndex: number): Promise<number> {
  return loadCounter(storage, activeAccountKey(walletIndex), 0);
}
async function saveActiveAccount(
  storage: StorageAdapter,
  walletIndex: number,
  index: number,
): Promise<void> {
  await saveCounter(storage, activeAccountKey(walletIndex), index);
}

/** Active wallet index; absence ⇒ 0. */
async function loadActiveWallet(storage: StorageAdapter): Promise<number> {
  return loadCounter(storage, ACTIVE_WALLET_KEY, 0);
}
async function saveActiveWallet(storage: StorageAdapter, index: number): Promise<void> {
  await saveCounter(storage, ACTIVE_WALLET_KEY, index);
}

/**
 * How many wallets exist. Explicit persisted count when present; otherwise
 * back-compat: a pre-multi-wallet user has exactly the lone un-suffixed vault,
 * so report 1 if it exists, else 0 (no wallet yet).
 */
async function loadWalletCount(storage: StorageAdapter): Promise<number> {
  let bytes: Uint8Array | null;
  try {
    bytes = await storage.get(WALLET_COUNT_KEY);
  } catch {
    bytes = null;
  }
  if (bytes !== null) {
    const n = Number.parseInt(new TextDecoder().decode(bytes), 10);
    if (Number.isSafeInteger(n) && n >= 0) return n;
  }
  return (await storage.get(VAULT_KEY)) !== null ? 1 : 0;
}
async function saveWalletCount(storage: StorageAdapter, n: number): Promise<void> {
  await saveCounter(storage, WALLET_COUNT_KEY, n);
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

  // Seedless balance reader for Watch-Only reads. Independent of the unlocked
  // session (it reads address-derived public data, never the seed), so it is
  // built lazily on the first watch read and kept for the engine's lifetime —
  // resetting the engine (host-side) drops it. Reused only when no unlocked
  // reader exists, so a normal unlocked session never spins up a second reader.
  let watchReader: WdkBalanceReader | null = null;

  // Active wallet (which independent vault is selected), lazily hydrated like
  // the account selection. A different wallet is a different seed, so changing
  // it tears the unlocked session down (the caller must unlock the new one).
  let activeWallet = 0;
  let activeWalletLoaded = false;

  // Active HD account, lazily hydrated from storage on first use so a reopened
  // engine resumes the last selection. Not reset by lock() — the selection is
  // a non-secret UI preference, symmetric with the vault staying in storage.
  // It is PER WALLET, so a wallet switch invalidates the cache.
  let activeAccount = 0;
  let activeAccountLoaded = false;

  async function currentWallet(): Promise<number> {
    if (!activeWalletLoaded) {
      activeWallet = await loadActiveWallet(deps.storage);
      activeWalletLoaded = true;
    }
    return activeWallet;
  }

  async function currentAccount(): Promise<number> {
    if (!activeAccountLoaded) {
      activeAccount = await loadActiveAccount(deps.storage, await currentWallet());
      activeAccountLoaded = true;
    }
    return activeAccount;
  }

  function ensureUnlocked(): { signer: WdkSigner; balanceReader: WdkBalanceReader } {
    if (!signer || !balanceReader) throw new WalletLockedError();
    return { signer, balanceReader };
  }

  /**
   * A balance reader for seedless reads: the unlocked one if a session is live
   * (no need for two), otherwise a lazily-built watch-only reader. Never builds
   * a signer, so it is safe with no wallet/unlock.
   */
  async function readerForReads(): Promise<WdkBalanceReader> {
    if (balanceReader) return balanceReader;
    if (!watchReader) {
      const adapter = await adapterReady();
      watchReader = await adapter.createBalanceReader(chains);
    }
    return watchReader;
  }

  /**
   * End the unlocked session: dispose the seed-bound signer/reader and signal
   * the engine-level crypto lock. Shared by lock() and any wallet switch (a
   * different seed must not keep the previous wallet's signer alive).
   */
  async function tearDownSession(): Promise<void> {
    await signer?.dispose();
    await balanceReader?.dispose();
    signer = null;
    balanceReader = null;
    await deps.crypto.lock();
  }

  /** Re-point caches at `index` and forget the per-wallet account selection. */
  function selectWallet(index: number): void {
    activeWallet = index;
    activeWalletLoaded = true;
    activeAccount = 0;
    activeAccountLoaded = false;
  }

  async function persistSeed(seedPhrase: string): Promise<void> {
    const key = await deps.unlock.unlock();
    const blob = await sealSeed(seedPhrase, key);
    const w = await currentWallet();
    await deps.storage.set(vaultKey(w), blob);
    // First population of a brand-new slot grows the persisted wallet count
    // (addWallet() points active at `count` without writing a vault; the
    // vault landing here is what makes the wallet real).
    const count = await loadWalletCount(deps.storage);
    if (w >= count) await saveWalletCount(deps.storage, w + 1);
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
      return (await deps.storage.get(vaultKey(await currentWallet()))) !== null;
    },

    async unlock(): Promise<void> {
      if (signer && balanceReader) return; // idempotent
      const w = await currentWallet();
      if ((await deps.storage.get(vaultKey(w))) === null) throw new NoWalletError();
      const adapter = await adapterReady();
      const key = await deps.unlock.unlock();
      const blob = await deps.storage.get(await activeVaultKey(deps.storage, w));
      if (blob === null) throw new NoWalletError();
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
      // tearDownSession awaits disposal: for the worker-backed proxy it
      // resolves only after the worker has zeroised the seed + WDK manager,
      // so reporting "locked" is truthful, not optimistic. It also fires
      // deps.crypto.lock() (the engine-level lock signal, not the seed
      // boundary — the WDK adapter worker is, ADR-004 — kept as a
      // defense-in-depth hook the host can wire to hard-stop an aux worker).
      await tearDownSession();
      // activeWallet / activeAccount are intentionally NOT reset: both are
      // non-secret UI selections that must survive lock/unlock (symmetric
      // with the vault staying in storage).
    },

    async setActiveAccount(index: number): Promise<void> {
      if (!Number.isSafeInteger(index) || index < 0) {
        throw new InvalidAccountIndexError(index);
      }
      await saveActiveAccount(deps.storage, await currentWallet(), index);
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

    async getBalancesForAddress(
      address: string,
      opts?: { readonly chains?: readonly ChainId[] },
    ): Promise<readonly Balance[]> {
      const want = opts?.chains;
      // The assets actually in scope: configured chain, and (if given) requested.
      const inScope = assets.filter((a) => {
        if (!chains[a.chain]) return false; // unconfigured ⇒ omitted, like getBalances
        return !want || want.includes(a.chain);
      });
      // Defense in depth: validate the address against every chain in scope
      // BEFORE building a reader or making any network call, so a malformed
      // string never reaches a balance reader (the watch-only UI validates too).
      for (const asset of inScope) {
        const cfg = chains[asset.chain]!;
        if (!isWellFormedAddress(cfg.kind, address)) {
          throw new InvalidAddressError(asset.chain, address);
        }
      }
      const reader = await readerForReads();
      const balances: Balance[] = [];
      for (const asset of inScope) {
        const amount = asset.token
          ? await reader.getTokenBalance(asset.chain, asset.token, address)
          : await reader.getNativeBalance(asset.chain, address);
        balances.push({ asset, amount });
      }
      return balances;
    },

    async getActivity(asset?: Asset): Promise<readonly ActivityItem[]> {
      const w = await currentWallet();
      const acct = await currentAccount();
      const items = await readLog(deps.storage, w, acct);
      
      // Refresh pending entries from receipt status when unlocked.
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
        if (changed) await writeLog(deps.storage, items, w, acct);
      }

      let mergedItems: ActivityItem[] = [...items];
      if (balanceReader && signer && config?.historyProvider) {
        const s = signer;
        const historyProvider = config.historyProvider;
        const indexerItems: ActivityItem[] = [];

        await Promise.all(
          assets.map(async (ast) => {
            if (!chains[ast.chain]) return;
            try {
              const address = await s.deriveAddress(ast.chain, acct);
              const txs = await historyProvider.getTransactionHistory(
                ast.chain,
                address,
                ast.token,
              );
              indexerItems.push(...txs);
            } catch {
              // ignore fetch failure for a specific chain
            }
          }),
        );

        const seen = new Set<string>();
        const merged: ActivityItem[] = [];
        const itemKey = (item: ActivityItem) =>
          `${item.asset.chain}:${item.hash.toLowerCase()}`;

        // Prefer indexer items (actual on-chain state)
        for (const it of indexerItems) {
          const key = itemKey(it);
          if (!seen.has(key)) {
            seen.add(key);
            merged.push(it);
          }
        }

        // Merge local sends not yet shown in indexer (e.g. pending ones)
        for (const it of items) {
          const key = itemKey(it);
          if (!seen.has(key)) {
            seen.add(key);
            merged.push(it);
          }
        }
        mergedItems = merged;
      }

      const filtered =
        asset === undefined
          ? mergedItems
          : mergedItems.filter(
              (it) =>
                it.asset.symbol === asset.symbol &&
                it.asset.chain === asset.chain &&
                it.asset.token === asset.token,
            );

      // Newest first; project to the public shape.
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
      const w = await currentWallet();
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
        w,
        acct,
      );
      return result;
    },

    async getWalletCount(): Promise<number> {
      return loadWalletCount(deps.storage);
    },

    async getActiveWallet(): Promise<number> {
      return currentWallet();
    },

    async setActiveWallet(index: number): Promise<void> {
      // A wallet is a discrete vault, so the index must address an EXISTING
      // one (unlike an HD account, which is unbounded). Reject anything that
      // is not a safe integer in [0, count) with a typed error the switcher
      // UI can guard on.
      const count = await loadWalletCount(deps.storage);
      if (!Number.isSafeInteger(index) || index < 0 || index >= count) {
        throw new InvalidWalletIndexError(index);
      }
      if (index === (await currentWallet())) return; // no-op, keep session
      // A different wallet is a different seed: the current unlocked signer
      // must not survive the switch. The caller re-unlocks the new wallet.
      await tearDownSession();
      await saveActiveWallet(deps.storage, index);
      selectWallet(index);
    },

    async addWallet(): Promise<number> {
      // The next empty slot is index === current count. We point the active
      // wallet at it and end the session, but do NOT write a vault or bump
      // the count yet — the slot becomes a real wallet only once the caller
      // populates it via createWallet()/importWallet() (persistSeed() grows
      // the count then). This keeps "count" = number of POPULATED wallets.
      const newIndex = await loadWalletCount(deps.storage);
      await tearDownSession();
      await saveActiveWallet(deps.storage, newIndex);
      selectWallet(newIndex);
      return newIndex;
    },

    async reencrypt(newKey: CryptoKey): Promise<void> {
      const { signer: s } = ensureUnlocked();
      const blob = await s.reencrypt(newKey);
      await deps.storage.set(passkeyVaultKey(await currentWallet()), blob);
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
