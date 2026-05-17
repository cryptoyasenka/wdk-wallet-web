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

export type ChainId = "bitcoin" | "ethereum" | "polygon" | "arbitrum" | "tron";

export interface Asset {
  readonly symbol: "BTC" | "USDT" | "XAUT";
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

  getAddress(chain: ChainId, index?: number): Promise<string>;
  getBalances(): Promise<readonly Balance[]>;
  getActivity(asset?: Asset): Promise<readonly ActivityItem[]>;

  quoteSend(intent: TxIntent): Promise<FeeQuote>;
  send(intent: TxIntent): Promise<TxResult>;
}

export type CreateWalletEngine = (deps: WalletEngineDeps) => WalletEngine;
