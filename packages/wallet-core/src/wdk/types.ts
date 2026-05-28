/**
 * The WDK containment interface.
 *
 * `src/wdk/` is the ONLY place allowed to import `@tetherto/*` (ESLint-enforced).
 * Everything outside this folder — the engine, the apps, the tests — depends on
 * these interfaces, never on WDK directly. WDK is alpha; when it makes a
 * breaking change, the blast radius is `adapter.ts` and nothing else.
 *
 * This file itself imports no `@tetherto/*`, so the engine can be unit-tested
 * against a hand-written fake `WdkAdapter`.
 */

import type { ChainId, FeePreference, FeeQuote, TxIntent, TxResult } from "../types.js";

/** EVM chains share one WDK manager; they differ only by chainId + RPC list. */
export interface EvmChainConfig {
  readonly kind: "evm";
  readonly chain: ChainId;
  /** EIP-155 chain id (1 = Ethereum mainnet). */
  readonly chainId: number;
  /**
   * One or more RPC URLs. WDK's EVM manager treats an array as a native
   * failover list, so we do not ship `@tetherto/wdk-failover-provider`.
   */
  readonly rpcUrls: readonly string[];
}

/** Bitcoin uses an Electrum-over-WebSocket transport (browser-safe). */
export interface BtcChainConfig {
  readonly kind: "btc";
  readonly chain: "bitcoin";
  readonly network: "bitcoin" | "testnet" | "regtest";
  /** `wss://…` Electrum endpoint. The browser cannot open raw Electrum TCP. */
  readonly electrumWsUrl: string;
}

/**
 * Solana has neither an EVM chainId nor an Electrum socket: it speaks plain
 * HTTP JSON-RPC. `WalletManagerSolana` takes the same array-as-failover
 * convention as the EVM manager (an array of RPC URLs → it falls back to the
 * next on a connection error), so we still do not ship
 * `@tetherto/wdk-failover-provider`. The commitment is the Solana finality
 * level for reads/receipts; the literal union is restated here (not imported
 * from `@solana/*`) to keep this interface file dependency-free — only
 * `src/wdk/` may touch `@tetherto/*`/`@solana/*`.
 */
export interface SolanaChainConfig {
  readonly kind: "solana";
  readonly chain: "solana";
  /** One or more Solana JSON-RPC URLs (array ⇒ native failover list). */
  readonly rpcUrls: readonly string[];
  /** Finality for reads/receipts (WDK default is `"confirmed"`). */
  readonly commitment?: "processed" | "confirmed" | "finalized";
}

export type ChainConfig = EvmChainConfig | BtcChainConfig | SolanaChainConfig;

/** Only the chains a given build configures appear here. */
export type ChainRegistry = Partial<Record<ChainId, ChainConfig>>;

/**
 * Holds a decrypted seed and derives addresses / signs from it.
 *
 * Phase 2 (ADR-004): for the real adapter this object lives **inside a
 * Dedicated Web Worker** — the main thread holds only a postMessage proxy, so
 * every method is async (it always was) and `dispose()` may resolve
 * asynchronously once the worker has zeroised the seed + WDK manager. Awaiting
 * disposal is what lets the engine report "locked" only after the worker has
 * actually wiped.
 */
export interface WdkSigner {
  deriveAddress(chain: ChainId, index: number): Promise<string>;
  /**
   * Estimate the fee for `intent` without broadcasting, from the HD account
   * at `accountIndex` (the multi-account dimension; the engine passes the
   * active account, never a hardcoded 0).
   */
  quoteSend(
    intent: TxIntent,
    accountIndex: number,
    feePreference?: FeePreference,
  ): Promise<FeeQuote>;
  /**
   * Sign and broadcast `intent` from the HD account at `accountIndex`;
   * resolves once accepted by the network. `feePreference` tiers the fee where
   * the chain supports it (Bitcoin only in this build).
   */
  send(
    intent: TxIntent,
    accountIndex: number,
    feePreference?: FeePreference,
  ): Promise<TxResult>;
  /** Re-encrypt the underlying seed phrase under a new key. */
  reencrypt(newKey: CryptoKey): Promise<Uint8Array>;
  /** Zeroise the seed + WDK manager. Async for the worker-backed proxy. */
  dispose(): void | Promise<void>;
}

/**
 * Read-only, seedless balance reads. Balances are address-derived public data,
 * so this never touches the seed — the engine can read a portfolio while the
 * signer stays locked/disposed.
 */
export interface WdkBalanceReader {
  /** Native-coin balance (wei / satoshi) in minor units. */
  getNativeBalance(chain: ChainId, address: string): Promise<bigint>;
  /** ERC-20-style token balance in the token's base units. */
  getTokenBalance(chain: ChainId, token: string, address: string): Promise<bigint>;
  /**
   * Status of a previously-broadcast transaction. `"pending"` until mined;
   * `"confirmed"` once it has a receipt. `"failed"` only when the chain
   * reports an explicit failure — never inferred (e.g. EVM reads ethers'
   * `receipt.status === 0`, an explicit on-chain revert flag; we never
   * fabricate a failure we cannot verify, and Bitcoin has no revert concept
   * so a mined tx is `"confirmed"`, full stop).
   *
   * `address` is the sender's address. It is required because WDK's Bitcoin
   * `getTransactionReceipt` is address-scoped (it scans that address's
   * history), so an address-less lookup would dishonestly report a confirmed
   * BTC tx as forever `"pending"`. EVM resolves the receipt via the provider
   * and ignores `address`; passing it is harmless and keeps one signature.
   */
  getTransactionStatus(
    chain: ChainId,
    hash: string,
    address: string,
  ): Promise<"pending" | "confirmed" | "failed">;
  /** Close any sockets (BTC Electrum). Async for the worker-backed proxy. */
  dispose(): void | Promise<void>;
}

/**
 * The whole WDK surface this codebase is allowed to know about.
 *
 * Every method is async because the real adapter (ADR-004) is a postMessage
 * proxy in front of a Dedicated Web Worker that owns the seed + WDK manager.
 * Crucially `createSigner` takes the **sealed vault blob + the AES-GCM
 * CryptoKey**, not a plaintext seed: the adapter decrypts internally
 * (worker-side for the real impl), so the decrypted seed never materialises on
 * the main thread during the operational unlock→sign path. A non-extractable
 * `CryptoKey` is structured-cloneable, so only an opaque handle crosses the
 * postMessage edge — the raw key bytes stay in the browser key store.
 */
export interface WdkAdapter {
  /** BIP-39 phrase generation (defaults to 12 words). */
  generateSeedPhrase(words?: 12 | 24): Promise<string>;
  isValidSeedPhrase(seedPhrase: string): Promise<boolean>;
  /**
   * Build a seed-bound signer by decrypting the sealed vault inside the
   * adapter. `sealed` is the blob from storage; `key` the AES-GCM wrapping key
   * from the `UnlockProvider`. The plaintext seed is never returned and (real
   * adapter) never leaves the Web Worker.
   */
  createSigner(
    sealed: Uint8Array,
    key: CryptoKey,
    chains: ChainRegistry,
  ): Promise<WdkSigner>;
  /** Build a seedless balance reader for the given chain registry. */
  createBalanceReader(chains: ChainRegistry): Promise<WdkBalanceReader>;
}
