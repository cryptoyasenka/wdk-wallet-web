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
