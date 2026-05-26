/**
 * Wallet wiring for the Next.js app — the one place host ports meet the core.
 *
 * The app depends ONLY on `@wdk-web/wallet-core`'s public surface; `@tetherto/*`
 * is never imported here (ESLint-enforced). We inject the browser host ports
 * (IndexedDB storage, passphrase unlock, crypto lock stub) and env-driven
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
  type WalletEngineConfig,
} from "@wdk-web/wallet-core";
import { IndexedDbStorage } from "./storage";
import { SelectingUnlockProvider } from "./webauthnUnlock";
import { StubCryptoWorker } from "./cryptoWorker";
import { loadDataSources, type DataSources } from "./dataSources";
import { createIndexerHistoryProvider } from "./historyProvider";

export interface WalletApp {
  readonly engine: WalletEngine;
  /** Feed the user's passphrase to the unlock provider before an unlock op. */
  setPassphrase(passphrase: string): void;
  /** Opt into a WebAuthn passkey (PRF). Preferred over passphrase once set. */
  enrollPasskey(): Promise<void>;
}

/**
 * Resolve chain config, layering persisted user data-source overrides OVER the
 * `NEXT_PUBLIC_*` deploy env OVER wallet-core's keyless public RPC defaults.
 * Keys are added only when present and non-empty so `exactOptionalPropertyTypes`
 * holds and `buildChainRegistry` falls back to its public RPC list / omits BTC
 * honestly. `loadDataSources` is storage-safe during SSR (returns defaults).
 */
function chainOptions(ds: DataSources): BuildChainsOptions {
  const opts: BuildChainsOptions = {};

  // Deploy-time env defaults (only Ethereum RPC + BTC Electrum are env-driven).
  const envEth = (process.env.NEXT_PUBLIC_ETHEREUM_RPC_URLS ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter((u) => u.length > 0);
  if (envEth.length > 0) opts.ethereumRpcUrls = envEth;

  const envBtc = process.env.NEXT_PUBLIC_BTC_ELECTRUM_WS_URL?.trim();
  if (envBtc) opts.btcElectrumWsUrl = envBtc;

  // Runtime user overrides win when set (the Data Sources settings card).
  if (ds.ethereumRpcUrls.length > 0) opts.ethereumRpcUrls = ds.ethereumRpcUrls;
  if (ds.polygonRpcUrls.length > 0) opts.polygonRpcUrls = ds.polygonRpcUrls;
  if (ds.arbitrumRpcUrls.length > 0) opts.arbitrumRpcUrls = ds.arbitrumRpcUrls;
  if (ds.plasmaRpcUrls.length > 0) opts.plasmaRpcUrls = ds.plasmaRpcUrls;
  if (ds.btcElectrumWsUrl) opts.btcElectrumWsUrl = ds.btcElectrumWsUrl;

  return opts;
}

let app: WalletApp | null = null;

/** The shared `WalletApp`. Client-side only (IndexedDB / WebCrypto globals). */
export function getWalletApp(): WalletApp {
  if (app) return app;

  const storage = new IndexedDbStorage();
  const unlock = new SelectingUnlockProvider(storage);
  const crypto = new StubCryptoWorker();

  // Read settings once: chain options + the optional remote history provider
  // both derive from the same persisted Data Sources snapshot.
  const ds = loadDataSources();
  // Opt-in remote history: only wired when the user chose "Use configured
  // indexer" AND supplied a URL. Otherwise activity stays local-log only and no
  // indexer request is ever made (the privacy-preserving default). The key is
  // added by conditional spread (not assigned) to satisfy the config's readonly
  // optional property under exactOptionalPropertyTypes.
  const historyProvider =
    ds.indexerMode === "indexer" && ds.indexerUrl
      ? createIndexerHistoryProvider(ds.indexerUrl)
      : undefined;
  const config: WalletEngineConfig = {
    chains: buildChainRegistry(chainOptions(ds)),
    ...(historyProvider ? { historyProvider } : {}),
  };

  const engine = createWalletEngine({ storage, crypto, unlock }, config);

  app = {
    engine,
    setPassphrase: (passphrase: string) => unlock.setPassphrase(passphrase),
    enrollPasskey: () => unlock.enrollPasskey(engine),
  };
  return app;
}

/**
 * Drop the memoised engine so the next `getWalletApp()` rebuilds it with fresh
 * chain options. Call after saving Data Sources settings; the caller must send
 * the user back through unlock, since the in-memory unlocked session is gone.
 */
export function resetWalletApp(): void {
  app = null;
}
