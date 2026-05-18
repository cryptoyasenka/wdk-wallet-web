import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // The monorepo lints with one ESLint flat config (root `pnpm lint`); don't
  // also run Next's bundled, deprecated `next lint` pass during `next build`.
  // TypeScript checking during build stays ON (extra safety net).
  eslint: { ignoreDuringBuilds: true },

  // wallet-core ships compiled ESM, but its lazy `@tetherto/*` adapter is
  // alpha and may reference Node core. Transpile the workspace package and
  // stub Node built-ins the browser does not have — the vault uses the
  // WebCrypto global, never Node `crypto`.
  //
  // As of ADR-004 the adapter spawns a Dedicated Web Worker
  // (`new Worker(new URL("./crypto.worker.js", import.meta.url), …)` inside
  // wallet-core/dist/wdk/adapter.js). webpack 5's native worker support emits
  // it as a separate chunk and — crucially — the `resolve.alias` /
  // `resolve.fallback` below apply to that worker chunk too, so the BTC stub
  // and sodium shim cover `@tetherto/*` wherever it is pulled. Net effect:
  // `@tetherto/*` moves entirely into the worker chunk and out of the main
  // First Load bundle (verified: First Load JS ≈ 111 kB, WDK in numbered
  // async chunks). transpilePackages is what lets webpack see and rewrite
  // the worker's `import.meta.url` URL inside the workspace package.
  transpilePackages: ["@wdk-web/wallet-core"],
  webpack: (config) => {
    config.resolve = config.resolve ?? {};

    // Phase-1 web build is EVM-only. @tetherto/wdk-wallet-btc pulls
    // sodium-native (Node native addon) + Bare-runtime modules that cannot
    // bundle for a browser, so it is aliased to a typed stub for THIS app's
    // bundle only. wallet-core itself is untouched — Node/RN consumers keep
    // real BTC. See src/lib/wdkBtcBrowserStub.ts and docs/RN-TO-WEB-MAP.md.
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@tetherto/wdk-wallet-btc": resolve(__dirname, "src/lib/wdkBtcBrowserStub.ts"),
      // WDK's memory-safe key modules import { sodium_memzero } from
      // 'sodium-universal' (CJS re-export of the Node-native sodium-native).
      // Back it with real pure-JS libsodium as proper ESM — no faked crypto.
      "sodium-universal": resolve(__dirname, "src/lib/sodiumUniversalShim.ts"),
    };

    // The vault uses the WebCrypto global, never Node `crypto`; stub the Node
    // built-ins the browser does not have so the EVM path bundles clean.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      crypto: false,
      stream: false,
      http: false,
      https: false,
      os: false,
      zlib: false,
      net: false,
      tls: false,
      fs: false,
    };
    return config;
  },
};

export default nextConfig;
