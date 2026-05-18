/**
 * Vite build for the Svelte portability proof.
 *
 * This MIRRORS apps/next/next.config.mjs's browser aliasing, deliberately, in
 * the other bundler (D-04). The two tiny shim sources are duplicated per-app on
 * purpose: wiring its own bundler is exactly the host-specific layer the
 * portability claim is NOT about — the *engine* (`@wdk-web/wallet-core`) is
 * reused byte-for-byte; the bundler glue is expected to differ per host. That
 * duplication is the honest story, not a smell (see docs/RN-TO-WEB-MAP.md).
 *
 * BTC ships on web here too. `@tetherto/wdk-wallet-btc`'s browser `default`
 * entry is pure-JS (bitcoinjs-lib, bip32/39, @bitcoinerlab/secp256k1) and
 * talks to an injected Electrum-WS client over the native WebSocket. The
 * `@tetherto/*` graph runs inside the WDK adapter's Dedicated Web Worker
 * (ADR-004), which Vite bundles as its own chunk; the `resolve.alias` below
 * applies to that worker chunk too. Only three narrow host shims are needed:
 *
 *  - `sodium-universal` → app-local shim re-exporting the REAL pure-JS
 *    `sodium_memzero` from `sodium-javascript` (exactly what sodium-universal's
 *    own `browser` field targets). No faked crypto — keys are genuinely
 *    zeroised.
 *  - `buffer` → the pure-JS npm shim, since bitcoinjs-lib reads a bare global
 *    `Buffer` (and a few files `require('buffer')`). The global is injected
 *    via `@rollup/plugin-inject`, applied to the worker chunk as well — the
 *    Vite-native analogue of webpack's `ProvidePlugin`.
 *  - `ws` / `ledger-bitcoin` → an empty module. `ws` is only dynamically
 *    imported in a dead `isNodeOrBare` branch (the browser uses
 *    `globalThis.WebSocket`); `ledger-bitcoin` is an OPTIONAL peer of
 *    @bitcoinerlab/descriptors require()d behind try/catch solely for Ledger
 *    hardware-wallet signing, which this software web wallet never does.
 *  - Node built-ins the browser lacks → an empty module (Vite's analogue of
 *    webpack's `resolve.fallback: { …: false }`). The vault uses the WebCrypto
 *    global, never Node `crypto`, and the BTC default entry never executes its
 *    Node-only branches, so the bundle stays clean.
 *
 * `defineConfig` is imported from `vitest/config` so the headless portability
 * test config (D-07) is type-checked together with the build config.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import inject from "@rollup/plugin-inject";

const here = dirname(fileURLToPath(import.meta.url));
const appLocal = (p: string): string => resolve(here, p);
const require = createRequire(import.meta.url);
const EMPTY = appLocal("src/lib/empty.ts");
// Resolve the npm `buffer` package (trailing slash forces the package, not the
// Node core module) to a stable absolute path the alias + inject both use.
const BUFFER = require.resolve("buffer/");

// The browser does not have these Node core modules; alpha WDK's adapter may
// reference them on code paths the browser build never executes. Map both the
// bare and `node:`-prefixed specifiers to an empty module so the bundle is
// clean. `ws`/`ledger-bitcoin` get the same treatment (dead/optional paths).
const NODE_BUILTINS = ["crypto", "stream", "http", "https", "os", "zlib", "net", "tls", "fs"];
const nodeBuiltinAliases = Object.fromEntries(
  NODE_BUILTINS.flatMap((name) => [
    [name, EMPTY],
    [`node:${name}`, EMPTY],
  ]),
);

// Inject a global `Buffer` (backed by the pure-JS npm shim) into every chunk.
// `worker.plugins` re-applies it to the WDK adapter worker chunk, where the
// bitcoinjs-lib graph actually evaluates — the symmetric counterpart of the
// webpack `ProvidePlugin({ Buffer: ["buffer", "Buffer"] })` used by apps/next.
const bufferInject = (): ReturnType<typeof inject> =>
  inject({ Buffer: [BUFFER, "Buffer"] });

export default defineConfig({
  plugins: [svelte()],
  define: {
    // bitcoinjs-lib / WDK reference a bare `global`; map it to the browser's
    // `globalThis` (the BTC code never executes a real Node `global` path).
    global: "globalThis",
  },
  resolve: {
    alias: {
      "sodium-universal": appLocal("src/lib/sodiumUniversalShim.ts"),
      buffer: BUFFER,
      ws: EMPTY,
      "ledger-bitcoin": EMPTY,
      ...nodeBuiltinAliases,
    },
  },
  build: {
    rollupOptions: {
      plugins: [bufferInject()],
    },
  },
  // Vite types `worker.rollupOptions` as Omit<…, "plugins">; the supported
  // way to add plugins to the worker graph is `worker.plugins` (a factory).
  worker: {
    plugins: () => [bufferInject()],
  },
  test: {
    // D-07: a headless assertion of the framework-agnostic claim — no DOM,
    // no component harness. Imports the public surface and drives the engine
    // through in-memory ports.
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
