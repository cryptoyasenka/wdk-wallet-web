import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Static, request-independent security headers for EVERY route (incl. static
  // assets). The Content-Security-Policy is NOT here: a strict `script-src`
  // needs a per-request nonce to allow Next's inline RSC-bootstrap scripts
  // without `'unsafe-inline'`, so the CSP is emitted by `middleware.ts`. See
  // docs/SECURITY-REVIEW.md → "CSP".
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },

  // The monorepo lints with one ESLint flat config (root `pnpm lint`); don't
  // also run Next's bundled, deprecated `next lint` pass during `next build`.
  // TypeScript checking during build stays ON (extra safety net).
  eslint: { ignoreDuringBuilds: true },

  // wallet-core ships compiled ESM; its lazy `@tetherto/*` adapter runs in a
  // Dedicated Web Worker. Transpile the workspace package and stub the Node
  // built-ins the browser does not have — the vault uses the WebCrypto
  // global, never Node `crypto`.
  //
  // As of ADR-004 the adapter spawns the worker
  // (`new Worker(new URL("./crypto.worker.js", import.meta.url), …)` inside
  // wallet-core/dist/wdk/adapter.js). webpack 5's native worker support emits
  // it as a separate chunk and — crucially — the `resolve.alias` /
  // `resolve.fallback` below apply to that worker chunk too, so the sodium
  // shim and Buffer global cover `@tetherto/*` wherever it is pulled. Net
  // effect: `@tetherto/*` (now incl. real BTC) moves entirely into the worker
  // chunk and out of the main First Load bundle. transpilePackages is what
  // lets webpack see and rewrite the worker's `import.meta.url` URL inside
  // the workspace package.
  transpilePackages: ["@wdk-web/wallet-core"],
  webpack: (config, { webpack }) => {
    config.resolve = config.resolve ?? {};
    config.plugins = config.plugins ?? [];

    // BTC ships on web. @tetherto/wdk-wallet-btc's browser `default` entry is
    // pure-JS (bitcoinjs-lib, bip32/39, @bitcoinerlab/secp256k1) and talks to
    // an injected Electrum-WS client over the native WebSocket. Two narrow
    // host shims make it bundle:
    //   - `sodium-universal`: WDK's memory-safe key modules import
    //     { sodium_memzero } from it (a CJS re-export of the Node-native
    //     sodium-native). Backed by real pure-JS libsodium as proper ESM —
    //     no faked crypto, keys are genuinely zeroised.
    //   - `buffer`: bitcoinjs-lib uses a bare global `Buffer`; provide the
    //     pure-JS npm shim as a real module + a ProvidePlugin global.
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "sodium-universal": resolve(__dirname, "src/lib/sodiumUniversalShim.ts"),
      buffer: require.resolve("buffer/"),
    };

    config.plugins.push(
      new webpack.ProvidePlugin({ Buffer: ["buffer", "Buffer"] }),
    );

    // The vault uses the WebCrypto global, never Node `crypto`; the BTC
    // package's default browser entry never executes its Node-only branches.
    // Stub the Node built-ins the browser lacks so the bundle stays clean.
    //   - `ws`: only dynamically imported in a dead `isNodeOrBare` branch
    //     (the browser uses `globalThis.WebSocket`).
    //   - `ledger-bitcoin`: an OPTIONAL peer of @bitcoinerlab/descriptors,
    //     require()d behind try/catch solely for Ledger hardware-wallet
    //     signing. This software web wallet has no Ledger path, so it stays
    //     genuinely absent (the lib is designed for this — it throws a
    //     helpful message only if Ledger functionality is actually invoked).
    config.resolve.fallback = {
      ...config.resolve.fallback,
      crypto: false,
      stream: false,
      http: false,
      https: false,
      os: false,
      zlib: false,
      events: false,
      net: false,
      tls: false,
      fs: false,
      ws: false,
      "ledger-bitcoin": false,
    };
    return config;
  },
};

export default nextConfig;
