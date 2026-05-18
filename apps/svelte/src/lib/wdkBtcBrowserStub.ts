/**
 * Browser-build stand-in for `@tetherto/wdk-wallet-btc`.
 *
 * WHY THIS EXISTS: the real `@tetherto/wdk-wallet-btc` (alpha) depends on
 * `sodium-native` — a Node N-API native addon — and Bare-runtime modules
 * (`bare-*`). None of that runs in, or bundles for, a browser. The web app is
 * EVM-only by design (BTC needs an opt-in Electrum-WS URL and is a documented
 * upstream-blocked deferral — see docs/RN-TO-WEB-MAP.md and docs/SECURITY.md).
 * So vite.config.ts aliases the BTC package to this stub for the browser
 * bundle ONLY.
 *
 * This does NOT weaken wallet-core: the engine and its `wdk/` containment layer
 * still import the real package, so Node / React-Native consumers keep full
 * BTC. The substitution is purely a property of *this app's browser build*.
 *
 * Shape: it mirrors only the surface `wdk/adapter.ts` touches — a default
 * manager class and a named `WalletAccountReadOnlyBtc`. In the default
 * Ethereum-only build neither is ever constructed (no BTC chain is registered),
 * and `instanceof WalletAccountReadOnlyBtc` simply stays false on EVM accounts.
 * If a host force-configures BTC on the web, construction fails loudly with
 * this explanation instead of a cryptic missing-native-module error. Copied
 * verbatim from apps/next — same honest EVM-only delta in the other bundler.
 */
const UNSUPPORTED =
  "Bitcoin is not available in the web build: @tetherto/wdk-wallet-btc " +
  "requires sodium-native (a Node native addon) and Bare-runtime modules that " +
  "cannot run in a browser. BTC on the web is an upstream-blocked deferral " +
  "(see docs/RN-TO-WEB-MAP.md → Bitcoin).";

export default class WalletManagerBtc {
  constructor() {
    throw new Error(UNSUPPORTED);
  }
}

export class WalletAccountReadOnlyBtc {
  constructor() {
    throw new Error(UNSUPPORTED);
  }

  dispose(): void {
    /* never reached: this class is never constructed in the web build */
  }
}
