/**
 * Browser-build replacement for `sodium-universal` (aliased in next.config.mjs).
 *
 * WHY: alpha WDK's memory-safe key modules
 * (`@tetherto/wdk-wallet-evm|btc/src/memory-safe/*`) do
 * `import { sodium_memzero } from 'sodium-universal'`. But `sodium-universal@5`
 * is CJS `module.exports = require('sodium-native')` — a Node N-API native
 * addon — with a `browser` field pointing at `sodium-javascript` (which the
 * dependency tree does NOT install). Under webpack that yields both
 * "Can't resolve 'sodium-native'" and "'sodium_memzero' is not exported"
 * (named ESM import from a `module.exports=require()` CJS module).
 *
 * This shim fixes BOTH cleanly and HONESTLY: it backs `sodium_memzero` with
 * the real pure-JS libsodium implementation (`sodium-javascript` — exactly
 * what `sodium-universal`'s own `browser` field targets), re-exported as a
 * proper static ESM named export webpack can analyse. No crypto behaviour is
 * faked or no-op'd: private-key buffers are still genuinely zeroised in the
 * browser. wallet-core / Node / RN consumers are untouched (alias is this
 * app's browser bundle only). The full `sodium-universal` surface is not
 * reproduced — only `sodium_memzero`, the single symbol WDK imports
 * (verified by grepping @tetherto/wdk-wallet-{evm,btc}/src).
 */
import sodium from "sodium-javascript";

export const sodium_memzero = (buffer: Uint8Array): void => {
  sodium.sodium_memzero(buffer);
};
