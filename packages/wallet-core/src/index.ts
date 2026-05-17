/**
 * @wdk-web/wallet-core — headless WDK wallet engine.
 *
 * The public contract lives in `./types.js` (frozen — apps compile against it).
 * Phase 1 ships `createWalletEngine`, the typed error surface, and the pure
 * chain/asset config helpers an app needs to wire env-driven RPC / Electrum-WS.
 * `@tetherto/*` is reached only through `src/wdk/` and is lazy-loaded by the
 * engine, so importing this package does not eagerly bundle alpha WDK.
 */
export type * from "./types.js";

export { createWalletEngine } from "./wallet/engine.js";
export type { WalletEngineConfig } from "./wallet/engine.js";

// Pure-data config (no @tetherto import): lets the app build a ChainRegistry
// from env without reaching into deep paths.
export {
  DEFAULT_ASSETS,
  DEFAULT_CHAINS,
  buildChainRegistry,
  USDT_ETHEREUM,
  XAUT_ETHEREUM,
  ETHEREUM_PUBLIC_RPCS,
  ETH_NATIVE,
  BTC_NATIVE,
} from "./chains/index.js";
export type { BuildChainsOptions } from "./chains/index.js";

// Passphrase key-derivation (pure WebCrypto, no @tetherto): the building
// blocks for an app's Phase-1 passphrase `UnlockProvider`. seal/open stay
// engine-internal — an app never touches the raw vault blob.
export { deriveAesGcmKey, generateSalt } from "./secrets/index.js";

// Typed error surface — apps switch on these (e.g. show the unlock UI on
// WalletLockedError, a phase banner on PhaseNotImplementedError).
export {
  WalletError,
  WalletExistsError,
  NoWalletError,
  WalletLockedError,
  InvalidSeedPhraseError,
  UnsupportedChainError,
  UnsupportedAssetError,
  VaultDecryptError,
  VaultFormatError,
  PhaseNotImplementedError,
} from "./errors.js";
