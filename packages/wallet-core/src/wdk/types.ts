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

import type { ChainId, FeeQuote, TxIntent, TxResult } from "../types.js";

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

export type ChainConfig = EvmChainConfig | BtcChainConfig;

/** Only the chains a given build configures appear here. */
export type ChainRegistry = Partial<Record<ChainId, ChainConfig>>;

/**
 * Holds a decrypted seed and derives addresses from it. Disposing erases the
 * seed from memory (WDK zeroises on `dispose()`).
 *
 * Phase 2 adds transaction quoting + signing/broadcast here, together with the
 * Web-Worker isolation of this object (see ARCHITECTURE.md).
 */
export interface WdkSigner {
  deriveAddress(chain: ChainId, index: number): Promise<string>;
  /** Estimate the fee for `intent` without broadcasting. */
  quoteSend(intent: TxIntent): Promise<FeeQuote>;
  /** Sign and broadcast `intent`; resolves once accepted by the network. */
  send(intent: TxIntent): Promise<TxResult>;
  dispose(): void;
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
  dispose(): void;
}

/** The whole WDK surface this codebase is allowed to know about. */
export interface WdkAdapter {
  /** BIP-39 phrase generation (defaults to 12 words). */
  generateSeedPhrase(words?: 12 | 24): string;
  isValidSeedPhrase(seedPhrase: string): boolean;
  /** Build a seed-bound signer for the given chain registry. */
  createSigner(seedPhrase: string, chains: ChainRegistry): WdkSigner;
  /** Build a seedless balance reader for the given chain registry. */
  createBalanceReader(chains: ChainRegistry): WdkBalanceReader;
}
