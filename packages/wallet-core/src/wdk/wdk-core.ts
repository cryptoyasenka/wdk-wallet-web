/**
 * The real WDK logic — the ONLY module (with crypto.worker.ts, which just
 * hosts it) that imports `@tetherto/*`.
 *
 * WDK is alpha. Everything else depends on the interfaces in `./types.js`; a
 * breaking WDK change is contained here. Keep it thin: translate our
 * vocabulary (ChainId, ChainConfig) into WDK calls and back, no engine logic.
 *
 * This module is host-agnostic: it runs unchanged inside the Dedicated Web
 * Worker (the browser isolation, ADR-004) and in-process on Node/SSR (no
 * worker concept there — same behaviour, no isolation, stated not faked). It
 * also owns `openSeed`: `createSigner` is handed the *sealed* vault + key and
 * decrypts internally, so the plaintext seed only ever materialises where this
 * code runs (worker-side in the browser).
 *
 * eslint-disable is intentional and scoped: src/wdk/ is the sanctioned import
 * site for @tetherto/* (see docs/ARCHITECTURE.md → Alpha-churn containment).
 */
import WDK from "@tetherto/wdk";
import WalletManagerEvm, { WalletAccountReadOnlyEvm } from "@tetherto/wdk-wallet-evm";
import WalletManagerBtc, { WalletAccountReadOnlyBtc } from "@tetherto/wdk-wallet-btc";
import WalletManagerSolana, {
  WalletAccountReadOnlySolana,
} from "@tetherto/wdk-wallet-solana";

import type { ChainId, FeePreference, FeeQuote, TxIntent, TxResult } from "../types.js";
import { UnsupportedAssetError, UnsupportedChainError, WalletLockedError } from "../errors.js";
import {
  BTC_NATIVE,
  ETH_NATIVE,
  POL_NATIVE,
  SOL_NATIVE,
  XPL_NATIVE,
} from "../chains/index.js";
import { openSeed, sealSeed } from "../secrets/index.js";
import type {
  BtcChainConfig,
  ChainRegistry,
  EvmChainConfig,
  SolanaChainConfig,
  WdkAdapter,
  WdkBalanceReader,
  WdkSigner,
} from "./types.js";

/** Look a chain up in the registry or fail with our typed error. */
function requireChain(chains: ChainRegistry, chain: ChainId) {
  const cfg = chains[chain];
  if (!cfg) throw new UnsupportedChainError(chain);
  return cfg;
}

/**
 * Native coin that pays the fee on a given chain. EVM gas (incl. for an ERC-20
 * USDT/XAU₮ transfer) is paid in that chain's own native coin: ETH on Ethereum
 * AND on Arbitrum One (Arbitrum settles gas in ETH), POL on Polygon PoS, XPL
 * on Plasma. A Bitcoin tx fee is paid in BTC. On Plasma a *simple* USD₮
 * transfer can be sponsored gasless by the protocol paymaster, but the fee
 * asset for anything quoted/charged is still XPL — labelling it XPL is the
 * honest answer, not a guess. Only the chains this build models are
 * answerable; any chain outside the modelled set is an honest typed error
 * rather than a mislabelled fee asset.
 */
function feeAssetFor(chain: ChainId) {
  if (chain === "ethereum" || chain === "arbitrum") return ETH_NATIVE;
  if (chain === "polygon") return POL_NATIVE;
  if (chain === "plasma") return XPL_NATIVE;
  if (chain === "bitcoin") return BTC_NATIVE;
  // A Solana fee (incl. an SPL USD₮ transfer) is paid in SOL — same rule as
  // EVM gas: the native coin pays, never the token.
  if (chain === "solana") return SOL_NATIVE;
  throw new UnsupportedChainError(chain);
}

/** WDK's BTC client descriptor for a browser-safe Electrum-over-WebSocket link. */
function btcClientDescriptor(cfg: BtcChainConfig) {
  return { type: "electrum-ws" as const, clientConfig: { url: cfg.electrumWsUrl } };
}

/**
 * WDK's `registerWallet<W extends typeof WalletManager>` types `config` as
 * `ConstructorParameters<W>[1]`, but the public signature widens `W` back to
 * the abstract base, so a concrete manager whose config is narrowed
 * (`EvmWalletConfig`/`BtcWalletConfig`) is rejected against the base
 * `WalletConfig`. This is an alpha typing quirk in `@tetherto/wdk`, not a
 * usage error — the runtime accepts these exactly. We contain it here, in the
 * one file allowed to know about WDK, with a single typed boundary instead of
 * leaking `any` through the adapter.
 */
type RegisterWallet = (
  blockchain: string,
  Manager:
    | typeof WalletManagerEvm
    | typeof WalletManagerBtc
    | typeof WalletManagerSolana,
  config: object,
) => unknown;

/** Register every configured chain on a seeded WdkManager instance. */
function registerAll(wdk: WDK, chains: ChainRegistry): void {
  const register = wdk.registerWallet.bind(wdk) as unknown as RegisterWallet;
  for (const cfg of Object.values(chains)) {
    if (!cfg) continue;
    if (cfg.kind === "evm") {
      register(cfg.chain, WalletManagerEvm, {
        provider: [...cfg.rpcUrls],
        chainId: cfg.chainId,
      });
    } else if (cfg.kind === "solana") {
      // WalletManagerSolana takes the same array-as-failover `provider` as the
      // EVM manager; no chainId (Solana has none). `commitment` is only passed
      // when set, so WDK keeps its own default ("confirmed").
      register(cfg.chain, WalletManagerSolana, {
        provider: [...cfg.rpcUrls],
        ...(cfg.commitment ? { commitment: cfg.commitment } : {}),
      });
    } else {
      register(cfg.chain, WalletManagerBtc, {
        client: btcClientDescriptor(cfg),
        network: cfg.network,
      });
    }
  }
}

/**
 * Bitcoin confirmation target (in blocks) per speed tier — fewer blocks ⇒
 * sooner inclusion ⇒ higher fee. WDK derives the sat/vByte feeRate from this
 * target. Bitcoin is the ONLY chain this build can tier: its native send is the
 * one WDK path that takes a fee knob, ERC-20 transfers (USDT/XAU₮) expose none,
 * and this wallet sends no native EVM coin. An absent preference keeps WDK's own
 * estimate, so behavior is unchanged unless a tier is explicitly requested.
 */
const BTC_CONFIRMATION_TARGET: Record<FeePreference, number> = {
  slow: 6,
  normal: 3,
  fast: 1,
};

/**
 * Args for a native (no-token) quote/send. Bitcoin gets a `confirmationTarget`
 * when a tier is chosen; otherwise — and for any non-BTC native path — the bare
 * `{ to, value }` is returned, byte-for-byte the prior behavior. Returned as a
 * variable (not an inline literal at the call site) so the extra BTC-only field
 * never trips an excess-property check against the EVM transaction shape.
 */
function nativeTxArgs(intent: TxIntent, feePreference: FeePreference | undefined) {
  const args: { to: string; value: bigint; confirmationTarget?: number } = {
    to: intent.to,
    value: intent.amount,
  };
  if (intent.asset.chain === "bitcoin" && feePreference) {
    args.confirmationTarget = BTC_CONFIRMATION_TARGET[feePreference];
  }
  return args;
}

class WdkSignerImpl implements WdkSigner {
  readonly #wdk: WDK;
  readonly #chains: ChainRegistry;
  // Held only so `reencrypt` can re-seal the seed under a new key (passkey
  // enrollment). Dropped on dispose() so it does not outlive the unlocked
  // session. NOT readonly for exactly that reason.
  #seedPhrase: string | null;

  constructor(seedPhrase: string, chains: ChainRegistry) {
    this.#chains = chains;
    this.#seedPhrase = seedPhrase;
    this.#wdk = new WDK(seedPhrase);
    registerAll(this.#wdk, chains);
  }

  async deriveAddress(chain: ChainId, index: number): Promise<string> {
    requireChain(this.#chains, chain); // typed error instead of WDK's generic one
    const account = await this.#wdk.getAccount(chain, index);
    return account.getAddress();
  }

  async quoteSend(
    intent: TxIntent,
    accountIndex: number,
    feePreference?: FeePreference,
  ): Promise<FeeQuote> {
    requireChain(this.#chains, intent.asset.chain);
    const account = await this.#wdk.getAccount(intent.asset.chain, accountIndex);
    // A token send pays gas in the chain's native coin, not in the token —
    // feeAsset reflects that. ERC-20 ⇒ transfer/quoteTransfer (no fee knob in
    // the SDK, so feePreference is ignored there); native ⇒
    // sendTransaction/quoteSendTransaction, where Bitcoin honors the tier.
    const { fee } = intent.asset.token
      ? await account.quoteTransfer({
          token: intent.asset.token,
          recipient: intent.to,
          amount: intent.amount,
        })
      : await account.quoteSendTransaction(nativeTxArgs(intent, feePreference));
    return { fee, feeAsset: feeAssetFor(intent.asset.chain) };
  }

  async send(
    intent: TxIntent,
    accountIndex: number,
    feePreference?: FeePreference,
  ): Promise<TxResult> {
    requireChain(this.#chains, intent.asset.chain);
    const account = await this.#wdk.getAccount(intent.asset.chain, accountIndex);
    const { hash } = intent.asset.token
      ? await account.transfer({
          token: intent.asset.token,
          recipient: intent.to,
          amount: intent.amount,
        })
      : await account.sendTransaction(nativeTxArgs(intent, feePreference));
    return { hash, chain: intent.asset.chain };
  }

  async reencrypt(newKey: CryptoKey): Promise<Uint8Array> {
    // After dispose() our seed reference is gone, so re-sealing is impossible —
    // surface the same typed "locked" state the engine uses elsewhere rather
    // than re-sealing a null/stale value.
    if (this.#seedPhrase === null) throw new WalletLockedError();
    return sealSeed(this.#seedPhrase, newKey);
  }

  dispose(): void {
    // WDK zeroises its own internal seed/key material on dispose(). We also drop
    // our seed-phrase reference so it does not outlive the unlocked session.
    // JS strings are immutable, so this releases the reference for GC rather
    // than wiping the bytes in place (see docs/SECURITY.md).
    this.#seedPhrase = null;
    this.#wdk.dispose();
  }
}

type ReadOnlyAccount =
  | WalletAccountReadOnlyEvm
  | WalletAccountReadOnlyBtc
  | WalletAccountReadOnlySolana;

class WdkBalanceReaderImpl implements WdkBalanceReader {
  readonly #chains: ChainRegistry;
  /** Cache by chain+address so a BTC Electrum socket is opened at most once. */
  readonly #cache = new Map<string, ReadOnlyAccount>();

  constructor(chains: ChainRegistry) {
    this.#chains = chains;
  }

  #account(chain: ChainId, address: string): ReadOnlyAccount {
    const key = `${chain}:${address}`;
    const cached = this.#cache.get(key);
    if (cached) return cached;

    const cfg = requireChain(this.#chains, chain);
    let account: ReadOnlyAccount;
    if (cfg.kind === "evm") {
      account = new WalletAccountReadOnlyEvm(address, {
        provider: [...(cfg as EvmChainConfig).rpcUrls],
        chainId: (cfg as EvmChainConfig).chainId,
      });
    } else if (cfg.kind === "solana") {
      const sol = cfg as SolanaChainConfig;
      account = new WalletAccountReadOnlySolana(address, {
        provider: [...sol.rpcUrls],
        ...(sol.commitment ? { commitment: sol.commitment } : {}),
      });
    } else {
      account = new WalletAccountReadOnlyBtc(address, {
        client: btcClientDescriptor(cfg as BtcChainConfig),
        network: (cfg as BtcChainConfig).network,
      });
    }
    this.#cache.set(key, account);
    return account;
  }

  getNativeBalance(chain: ChainId, address: string): Promise<bigint> {
    return this.#account(chain, address).getBalance();
  }

  getTokenBalance(chain: ChainId, token: string, address: string): Promise<bigint> {
    const account = this.#account(chain, address);
    if (account instanceof WalletAccountReadOnlyBtc) {
      throw new UnsupportedAssetError("Bitcoin has no token balances");
    }
    return account.getTokenBalance(token);
  }

  async getTransactionStatus(
    chain: ChainId,
    hash: string,
    address: string,
  ): Promise<"pending" | "confirmed" | "failed"> {
    const account = this.#account(chain, address);
    if (account instanceof WalletAccountReadOnlyBtc) {
      // Bitcoin has no revert concept: a tx is either mined or not. WDK's BTC
      // receipt is null until the tx is in a block, so this is exact.
      const receipt = await account.getTransactionReceipt(hash);
      return receipt === null ? "pending" : "confirmed";
    }
    if (account instanceof WalletAccountReadOnlySolana) {
      // Solana, unlike Bitcoin, has an explicit failure flag: the RPC
      // getTransaction receipt carries `meta.err` (null ⇒ executed OK; a
      // TransactionError object ⇒ the chain itself reported the tx failed).
      // A null receipt = not yet confirmed at our commitment level ⇒ pending.
      // chain-reported, never inferred — the same honesty rule as EVM's
      // receipt.status. Narrowed locally: the WDK alias is
      // ReturnType<SolanaRpcApi['getTransaction']>, and this containment file
      // is the sanctioned place to translate that into our vocabulary.
      const receipt = (await account.getTransactionReceipt(hash)) as
        | { meta: { err: unknown } | null }
        | null;
      if (receipt === null) return "pending";
      return receipt.meta?.err != null ? "failed" : "confirmed";
    }
    const receipt = await account.getTransactionReceipt(hash);
    if (receipt === null) return "pending"; // not mined yet
    // ethers' receipt.status is the explicit on-chain outcome flag: 0 = the
    // EVM reverted (a real, chain-reported failure — not inferred), 1 = ok.
    // null is pre-Byzantium (mined, no status opcode) → treat as confirmed.
    return receipt.status === 0 ? "failed" : "confirmed";
  }

  dispose(): void {
    for (const account of this.#cache.values()) {
      // Only the BTC read-only account holds a socket to close.
      if (account instanceof WalletAccountReadOnlyBtc) account.dispose();
    }
    this.#cache.clear();
  }
}

/**
 * The in-process WDK adapter. Decrypts the sealed vault itself (so the seed
 * never crosses a boundary it does not have to). Hosted by the worker for the
 * browser isolation, or used directly on Node/SSR.
 */
export class WdkCoreAdapter implements WdkAdapter {
  async generateSeedPhrase(words: 12 | 24 = 12): Promise<string> {
    return WDK.getRandomSeedPhrase(words);
  }

  async isValidSeedPhrase(seedPhrase: string): Promise<boolean> {
    return WDK.isValidSeed(seedPhrase);
  }

  async createSigner(
    sealed: Uint8Array,
    key: CryptoKey,
    chains: ChainRegistry,
  ): Promise<WdkSigner> {
    // openSeed throws VaultFormatError / VaultDecryptError on bad blob/key.
    // The decrypted phrase is bound straight into the WDK manager and the
    // local `string` goes out of scope immediately (cannot be zeroised — see
    // docs/SECURITY.md — so its lifetime is kept minimal here, worker-side).
    const seedPhrase = await openSeed(sealed, key);
    return new WdkSignerImpl(seedPhrase, chains);
  }

  async createBalanceReader(chains: ChainRegistry): Promise<WdkBalanceReader> {
    return new WdkBalanceReaderImpl(chains);
  }
}
