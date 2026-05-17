/**
 * Minimal ambient types for `sodium-javascript` (no published @types).
 *
 * We only consume `sodium_memzero` (the single symbol WDK's memory-safe key
 * modules import from `sodium-universal`). `sodium-javascript` is CJS, so it is
 * modelled as a default export object; `esModuleInterop` makes the default
 * import work.
 */
declare module "sodium-javascript" {
  interface SodiumJavascript {
    /** Overwrite the buffer's contents with zeros (libsodium `sodium_memzero`). */
    sodium_memzero(buffer: Uint8Array): void;
  }
  const sodium: SodiumJavascript;
  export default sodium;
}
