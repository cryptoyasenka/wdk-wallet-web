/**
 * Empty-module stand-in for Node core built-ins the browser does not have
 * (aliased in vite.config.ts). This is Vite's analogue of webpack's
 * `resolve.fallback: { crypto: false, … }` used in apps/next/next.config.mjs.
 *
 * Nothing here is a faked crypto primitive: the vault uses the WebCrypto
 * global (`crypto.subtle` / `crypto.getRandomValues`), never a Node `crypto`
 * import, and the EVM path never executes the alpha-WDK code that would touch
 * these modules. A module with no real exports is the honest representation of
 * "this Node API is intentionally absent in the browser build" — anything that
 * actually reached for it would fail loudly rather than silently degrade.
 */
export {};
