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

import type { ChainId, FeeQuote, TxIntent, TxResult } from "../types.js";
import { UnsupportedAssetError, UnsupportedChainError } from "../errors.js";
import { BTC_NATIVE, ETH_NATIVE } from "../chains/index.js";
import { openSeed } from "../secrets/index.js";
import type {
  BtcChainConfig,
  ChainRegistry,
  EvmChainConfig,
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
 * USDT/XAU₮ transfer) is paid in ETH; a Bitcoin tx fee is paid in BTC. Only the
 * chains this build models are answerable — anything else is an honest typed
 * error rather than a mislabelled fee asset.
 */
function feeAssetFor(chain: ChainId) {
  if (chain === "ethereum") return ETH_NATIVE;
  if (chain === "bitcoin") return BTC_NATIVE;
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
  Manager: typeof WalletManagerEvm | typeof WalletManagerBtc,
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
    } else {
      register(cfg.chain, WalletManagerBtc, {
        client: btcClientDescriptor(cfg),
        network: cfg.network,
      });
    }
  }
}

class WdkSignerImpl implements WdkSigner {
  readonly #wdk: WDK;
  readonly #chains: ChainRegistry;

  constructor(seedPhrase: string, chains: ChainRegistry) {
    this.#chains = chains;
    this.#wdk = new WDK(seedPhrase);
    registerAll(this.#wdk, chains);
  }

  async deriveAddress(chain: ChainId, index: number): Promise<string> {
    requireChain(this.#chains, chain); // typed error instead of WDK's generic one
    const account = await this.#wdk.getAccount(chain, index);
    return account.getAddress();
  }

  async quoteSend(intent: TxIntent): Promise<FeeQuote> {
    requireChain(this.#chains, intent.asset.chain);
    const account = await this.#wdk.getAccount(intent.asset.chain, 0);
    // A token send pays gas in the chain's native coin, not in the token —
    // feeAsset reflects that. ERC-20 ⇒ transfer/quoteTransfer; native ⇒
    // sendTransaction/quoteSendTransaction (WDK's two distinct code paths).
    const { fee } = intent.asset.token
      ? await account.quoteTransfer({
          token: intent.asset.token,
          recipient: intent.to,
          amount: intent.amount,
        })
      : await account.quoteSendTransaction({ to: intent.to, value: intent.amount });
    return { fee, feeAsset: feeAssetFor(intent.asset.chain) };
  }

  async send(intent: TxIntent): Promise<TxResult> {
    requireChain(this.#chains, intent.asset.chain);
    const account = await this.#wdk.getAccount(intent.asset.chain, 0);
    const { hash } = intent.asset.token
      ? await account.transfer({
          token: intent.asset.token,
          recipient: intent.to,
          amount: intent.amount,
        })
      : await account.sendTransaction({ to: intent.to, value: intent.amount });
    return { hash, chain: intent.asset.chain };
  }

  dispose(): void {
    // WDK zeroises seed/key material on dispose().
    this.#wdk.dispose();
  }
}

type ReadOnlyAccount = WalletAccountReadOnlyEvm | WalletAccountReadOnlyBtc;

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
    const account: ReadOnlyAccount =
      cfg.kind === "evm"
        ? new WalletAccountReadOnlyEvm(address, {
            provider: [...(cfg as EvmChainConfig).rpcUrls],
            chainId: (cfg as EvmChainConfig).chainId,
          })
        : new WalletAccountReadOnlyBtc(address, {
            client: btcClientDescriptor(cfg as BtcChainConfig),
            network: (cfg as BtcChainConfig).network,
          });
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
