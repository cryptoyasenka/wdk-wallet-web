/**
 * Wallet wiring for the Svelte app — the one place host ports meet the core.
 *
 * The app depends ONLY on `@wdk-web/wallet-core`'s public surface; `@tetherto/*`
 * is never imported here (ESLint-enforced, covers .svelte too). We inject the
 * browser host ports (IndexedDB storage, passphrase unlock, crypto lock stub)
 * and env-driven chain config into the public `createWalletEngine` factory.
 *
 * Two honest, host-specific deltas vs apps/next/src/lib/engine.ts — both are
 * exactly the per-host glue the portability claim is NOT about (the engine is
 * byte-identical; the wiring differs per host, as designed):
 *   1. Env: Vite exposes public config as `import.meta.env.VITE_*`, not
 *      Next's `process.env.NEXT_PUBLIC_*`. Same semantics, different bundler
 *      convention.
 *   2. Unlock: `PassphraseUnlock` only — WebAuthn/PRF is already proven by
 *      apps/next; the minimal proof deliberately omits it (P3-CONTEXT D-03).
 *      Hence no `enrollPasskey` on `WalletApp`.
 *
 * Memoised module singleton: the engine, its IndexedDB handle, and the session
 * passphrase must be shared across every render. Construction is inert (no
 * IndexedDB / network until an engine method runs), but the ports touch
 * browser-only globals, so this is used from the client only.
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
 * Read chain config from Vite `VITE_*` env. Keys are added only when present
 * and non-empty so `exactOptionalPropertyTypes` holds and `buildChainRegistry`
 * falls back to its keyless public RPC list / omits BTC honestly.
 */
function chainOptionsFromEnv(): BuildChainsOptions {
  const opts: BuildChainsOptions = {};

  const rpcRaw = import.meta.env.VITE_ETHEREUM_RPC_URLS as string | undefined;
  if (rpcRaw) {
    const urls = rpcRaw
      .split(",")
      .map((u) => u.trim())
      .filter((u) => u.length > 0);
    if (urls.length > 0) opts.ethereumRpcUrls = urls;
  }

  const btcWs = (import.meta.env.VITE_BTC_ELECTRUM_WS_URL as string | undefined)?.trim();
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
