/**
 * Wallet wiring for the Next.js app — the one place host ports meet the core.
 *
 * The app depends ONLY on `@wdk-web/wallet-core`'s public surface; `@tetherto/*`
 * is never imported here (ESLint-enforced). We inject the browser host ports
 * (IndexedDB storage, passphrase unlock, Phase-1 crypto stub) and env-driven
 * chain config into the public `createWalletEngine` factory.
 *
 * Memoised module singleton: the engine, its IndexedDB handle, and the session
 * passphrase must be shared across every React render/route. Construction is
 * inert (no IndexedDB / network until an engine method runs), but the ports
 * touch browser-only globals, so this is called from client components only.
 */
import {
  buildChainRegistry,
  createWalletEngine,
  type BuildChainsOptions,
  type WalletEngine,
} from "@wdk-web/wallet-core";
import { IndexedDbStorage } from "./storage";
import { PassphraseUnlock } from "./unlock";
import { StubCryptoWorker } from "./cryptoWorker";

export interface WalletApp {
  readonly engine: WalletEngine;
  /** Feed the user's passphrase to the unlock provider before an unlock op. */
  setPassphrase(passphrase: string): void;
}

/**
 * Read chain config from `NEXT_PUBLIC_*` env. Keys are added only when present
 * and non-empty so `exactOptionalPropertyTypes` holds and `buildChainRegistry`
 * falls back to its keyless public RPC list / omits BTC honestly.
 */
function chainOptionsFromEnv(): BuildChainsOptions {
  const opts: BuildChainsOptions = {};

  const rpcRaw = process.env.NEXT_PUBLIC_ETHEREUM_RPC_URLS;
  if (rpcRaw) {
    const urls = rpcRaw
      .split(",")
      .map((u) => u.trim())
      .filter((u) => u.length > 0);
    if (urls.length > 0) opts.ethereumRpcUrls = urls;
  }

  const btcWs = process.env.NEXT_PUBLIC_BTC_ELECTRUM_WS_URL?.trim();
  if (btcWs) opts.btcElectrumWsUrl = btcWs;

  return opts;
}

let app: WalletApp | null = null;

/** The shared `WalletApp`. Client-side only (IndexedDB / WebCrypto globals). */
export function getWalletApp(): WalletApp {
  if (app) return app;

  const storage = new IndexedDbStorage();
  const unlock = new PassphraseUnlock(storage);
  const crypto = new StubCryptoWorker();

  const engine = createWalletEngine(
    { storage, crypto, unlock },
    { chains: buildChainRegistry(chainOptionsFromEnv()) },
  );

  app = {
    engine,
    setPassphrase: (passphrase: string) => unlock.setPassphrase(passphrase),
  };
  return app;
}
