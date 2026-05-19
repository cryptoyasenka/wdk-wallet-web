/**
 * Public contract for the headless WDK wallet engine.
 *
 * Design rules (enforced in CI):
 *  - This package never imports a UI framework.
 *  - `@tetherto/*` is imported ONLY under `src/wdk/` (alpha-churn containment).
 *  - All host capabilities (storage, crypto isolation, unlock) enter as injected
 *    ports, so the engine is unit-testable with in-memory fakes and reusable by
 *    the Next.js app, a browser extension, and an eCommerce checkout unchanged.
 */

export type ChainId =
  | "bitcoin"
  | "ethereum"
  | "polygon"
  | "arbitrum"
  | "plasma"
  | "tron";

export interface Asset {
  /**
   * Phase-2 contract refinement (additive, backward-compatible): `"ETH"` was
   * added so EVM gas is representable honestly in `FeeQuote.feeAsset` — gas
   * for a USDT/XAU₮ transfer is paid in ETH, not in the token. `"POL"`
   * (Polygon PoS) and `"XPL"` (Plasma) follow the same rule for the extra EVM
   * nets: each chain pays gas in its own native coin, never in the token. No
   * consumer does an exhaustive switch on this union, so widening it does not
   * break apps compiled against the Phase-1 surface.
   */
  readonly symbol: "BTC" | "USDT" | "XAUT" | "ETH" | "POL" | "XPL";
  readonly chain: ChainId;
  /** Contract address for tokens; undefined for native BTC. */
  readonly token?: string;
  readonly decimals: number;
}

/** Minor units (satoshi / token base units) as bigint — never float money. */
export type Amount = bigint;

export interface Balance {
  readonly asset: Asset;
  readonly amount: Amount;
}

export interface TxIntent {
  readonly asset: Asset;
  readonly to: string;
  readonly amount: Amount;
}

export interface FeeQuote {
  readonly fee: Amount;
  readonly feeAsset: Asset;
}

export interface TxResult {
  readonly hash: string;
  readonly chain: ChainId;
}

export interface ActivityItem {
  readonly hash: string;
  readonly asset: Asset;
  readonly amount: Amount;
  readonly direction: "in" | "out";
  readonly timestamp: number;
  readonly status: "pending" | "confirmed" | "failed";
}

/* ---- Injected host ports (the testability + reuse seam) ---------------- */

/** Opaque encrypted blob persistence. IndexedDB in apps, Map in tests. */
export interface StorageAdapter {
  get(key: string): Promise<Uint8Array | null>;
  set(key: string, value: Uint8Array): Promise<void>;
  remove(key: string): Promise<void>;
}

/**
 * Crypto isolation boundary. In apps this is a Web Worker; the seed never
 * crosses to the caller — only signing/derivation *intents* do.
 * See docs/SECURITY.md for the honest limits of this on the web.
 */
export interface CryptoWorker {
  deriveAddress(chain: ChainId, index: number): Promise<string>;
  signTransaction(chain: ChainId, unsignedTx: Uint8Array): Promise<Uint8Array>;
  /** Wipe decrypted key material from the worker. */
  lock(): Promise<void>;
}

/** WebAuthn/passkey (preferred) or passphrase. Returns the vault wrapping key. */
export interface UnlockProvider {
  unlock(): Promise<CryptoKey>;
  isEnrolled(): Promise<boolean>;
}

export interface WalletEngineDeps {
  storage: StorageAdapter;
  crypto: CryptoWorker;
  unlock: UnlockProvider;
}

/* ---- Engine surface consumed by every app ------------------------------ */

export interface WalletEngine {
  createWallet(): Promise<{ seedPhrase: string }>;
  importWallet(seedPhrase: string): Promise<void>;
  hasWallet(): Promise<boolean>;
  unlock(): Promise<void>;
  lock(): Promise<void>;

  /**
   * Multi-account over ONE seed. Every wallet derives unlimited accounts from
   * the single BIP-39 seed at distinct BIP-44 indices (`getAccount(chain, N)`
   * in WDK terms) — no extra seed, no extra vault. `setActiveAccount` selects
   * which account `getBalances` / `getActivity` / `quoteSend` / `send` act on;
   * the selection is non-secret and persists across lock/unlock and reload
   * (default `0`, so a Phase-1 single-account wallet keeps working unchanged).
   * `getAddress(chain, index?)` stays explicit-index for an account-LIST UI
   * ("show me account N's address") independent of the active selection.
   */
  setActiveAccount(index: number): Promise<void>;
  getActiveAccount(): Promise<number>;

  getAddress(chain: ChainId, index?: number): Promise<string>;
  getBalances(): Promise<readonly Balance[]>;
  getActivity(asset?: Asset): Promise<readonly ActivityItem[]>;

  quoteSend(intent: TxIntent): Promise<FeeQuote>;
  send(intent: TxIntent): Promise<TxResult>;
}

export type CreateWalletEngine = (deps: WalletEngineDeps) => WalletEngine;
