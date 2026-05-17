/**
 * @wdk-web/wallet-core — headless WDK wallet engine.
 *
 * Phase 1 implements `createWalletEngine` in `src/wallet/` against the
 * `@tetherto/*` adapter in `src/wdk/`. The public contract is frozen here so
 * apps can be built against it before the implementation lands.
 */
export type * from "./types.js";

// Implemented in Phase 1 (see ../../docs/ARCHITECTURE.md → Phasing):
//   export { createWalletEngine } from "./wallet/engine.js";
