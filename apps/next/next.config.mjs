import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Content-Security-Policy (Phase 6).
//
// The real XSS mitigation is `script-src 'self'`: no inline scripts, no remote
// code, no eval. `connect-src` is then pinned to exactly the network endpoints
// the wallet can talk to, so a compromised dependency cannot beacon out to an
// arbitrary host.
//
// HONEST LIMIT: this header is emitted at BUILD time and is therefore static.
// The Data Sources settings card lets a user point the wallet at a *custom* RPC
// or indexer origin at RUNTIME (stored in localStorage) — such an origin is NOT
// in this allow-list and its fetch would be CSP-blocked. We accept that: the
// default origins below + `NEXT_PUBLIC_*` deploy env cover the shipped
// configuration, and `wss:` is allowed wholesale because the Bitcoin
// Electrum-WS endpoint is *always* operator-supplied (there is no public
// default) and pinning one host would defeat the point. This trade-off is
// documented in docs/SECURITY-REVIEW.md → "CSP".
//
// The default RPC origins MUST stay in sync with the public RPC lists in
// packages/wallet-core/src/chains/index.ts (ETHEREUM/POLYGON/ARBITRUM/PLASMA_
// PUBLIC_RPCS). They are duplicated here rather than imported because next.config
// loads before the workspace package is built.
const DEFAULT_RPC_ORIGINS = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.llamarpc.com",
  "https://rpc.ankr.com", // eth + polygon + arbitrum share this origin
  "https://polygon-rpc.com",
  "https://polygon-bor-rpc.publicnode.com",
  "https://arb1.arbitrum.io",
  "https://arbitrum-one-rpc.publicnode.com",
  "https://rpc.plasma.to",
];
const COINGECKO_ORIGIN = "https://api.coingecko.com";

/** `scheme://host[:port]` of a URL, or null if it does not parse. */
function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Build the CSP string from the default origins + deploy env overrides. */
function buildCsp() {
  const connect = new Set(["'self'", ...DEFAULT_RPC_ORIGINS, COINGECKO_ORIGIN]);

  // Deploy-time env RPC overrides (same source engine.ts reads).
  for (const raw of (process.env.NEXT_PUBLIC_ETHEREUM_RPC_URLS ?? "").split(",")) {
    const o = originOf(raw.trim());
    if (o) connect.add(o);
  }
  // Bitcoin Electrum-WS is always operator-supplied; allow secure WebSockets.
  connect.add("wss:");

  const directives = {
    "default-src": ["'self'"],
    "script-src": ["'self'"],
    // Next.js injects inline <style> for its CSS; 'unsafe-inline' for styles is
    // not an XSS vector the way script 'unsafe-inline' is.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:"],
    "font-src": ["'self'"],
    "connect-src": [...connect],
    // The WDK adapter spawns a Dedicated Worker from a blob/bundle URL.
    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "frame-ancestors": ["'none'"],
    "form-action": ["'self'"],
  };

  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(" ")}`)
    .join("; ");
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: buildCsp() },
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
