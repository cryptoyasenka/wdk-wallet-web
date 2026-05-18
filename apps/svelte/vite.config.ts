/**
 * Vite build for the Svelte portability proof.
 *
 * This MIRRORS apps/next/next.config.mjs's EVM-only aliasing, deliberately, in
 * the other bundler (D-04). The two tiny shim sources are duplicated per-app on
 * purpose: wiring its own bundler is exactly the host-specific layer the
 * portability claim is NOT about — the *engine* (`@wdk-web/wallet-core`) is
 * reused byte-for-byte; the bundler glue is expected to differ per host. That
 * duplication is the honest story, not a smell (see docs/RN-TO-WEB-MAP.md).
 *
 *  - `@tetherto/wdk-wallet-btc` → app-local typed stub that throws loudly.
 *    The Phase-1/2 web build is EVM-only (alpha WDK's BTC package needs
 *    sodium-native + Bare-runtime modules that cannot bundle for a browser).
 *  - `sodium-universal` → app-local shim re-exporting the REAL pure-JS
 *    `sodium_memzero` from `sodium-javascript` (exactly what sodium-universal's
 *    own `browser` field targets). No faked crypto — keys are genuinely
 *    zeroised.
 *  - Node built-ins the browser lacks → an empty module (Vite's analogue of
 *    webpack's `resolve.fallback: { …: false }`). The vault uses the WebCrypto
 *    global, never Node `crypto`, so the EVM path bundles clean.
 *
 * `defineConfig` is imported from `vitest/config` so the headless portability
 * test config (D-07) is type-checked together with the build config.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const here = dirname(fileURLToPath(import.meta.url));
const appLocal = (p: string): string => resolve(here, p);
const EMPTY = appLocal("src/lib/empty.ts");

// The browser does not have these Node core modules; alpha WDK's adapter may
// reference them on code paths the EVM build never executes. Map both the bare
// and `node:`-prefixed specifiers to an empty module so the bundle is clean.
const NODE_BUILTINS = ["crypto", "stream", "http", "https", "os", "zlib", "net", "tls", "fs"];
const nodeBuiltinAliases = Object.fromEntries(
  NODE_BUILTINS.flatMap((name) => [
    [name, EMPTY],
    [`node:${name}`, EMPTY],
  ]),
);

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      "@tetherto/wdk-wallet-btc": appLocal("src/lib/wdkBtcBrowserStub.ts"),
      "sodium-universal": appLocal("src/lib/sodiumUniversalShim.ts"),
      ...nodeBuiltinAliases,
    },
  },
  test: {
    // D-07: a headless assertion of the framework-agnostic claim — no DOM,
    // no component harness. Imports the public surface and drives the engine
    // through in-memory ports.
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
