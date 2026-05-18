/**
 * Browser-build replacement for `sodium-universal` (aliased in vite.config.ts).
 *
 * WHY: alpha WDK's memory-safe key modules
 * (`@tetherto/wdk-wallet-evm|btc/src/memory-safe/*`) do
 * `import { sodium_memzero } from 'sodium-universal'`. But `sodium-universal@5`
 * is CJS `module.exports = require('sodium-native')` — a Node N-API native
 * addon — with a `browser` field pointing at `sodium-javascript` (which the
 * dependency tree does NOT install). In a browser bundle that yields both
 * "Can't resolve 'sodium-native'" and "'sodium_memzero' is not exported"
 * (named ESM import from a `module.exports=require()` CJS module).
 *
 * This shim fixes BOTH cleanly and HONESTLY: it backs `sodium_memzero` with
 * the real pure-JS libsodium implementation (`sodium-javascript` — exactly
 * what `sodium-universal`'s own `browser` field targets), re-exported as a
 * proper static ESM named export the bundler can analyse. No crypto behaviour
 * is faked or no-op'd: private-key buffers are still genuinely zeroised in the
 * browser. wallet-core / Node / RN consumers are untouched (alias is this
 * app's browser bundle only). Duplicated verbatim from apps/next — each host
 * wires its own bundler; that per-bundler duplication is the expected story.
 */
import sodium from "sodium-javascript";

export const sodium_memzero = (buffer: Uint8Array): void => {
  sodium.sodium_memzero(buffer);
};
