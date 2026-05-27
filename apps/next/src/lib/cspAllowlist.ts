/**
 * CSP `connect-src` allowlist — the SINGLE source of truth for which network
 * origins the wallet may talk to (Phase 6 hardening; re-audit Finding 2).
 *
 * Why this file exists at all: the per-request CSP is built in `middleware.ts`,
 * which runs in the Edge runtime and CANNOT import the compiled workspace
 * package (`@wdk-web/wallet-core`). The Data Sources settings UI, by contrast,
 * runs in the browser and CAN. They were therefore each keeping their own copy
 * of the default RPC origins, which is exactly the kind of pair that drifts.
 *
 * This module is plain data with no `@wdk-web/wallet-core` import, so it is safe
 * for BOTH to import: `middleware.ts` builds `connect-src` from it, and
 * `dataSources.ts` uses it to tell the user, in the Data Sources card, when a
 * custom origin they typed will be blocked by this deploy's CSP. The remaining
 * link — that these origins match wallet-core's public RPC lists — is enforced
 * by a vitest drift guard (`test/cspAllowlist.test.ts`), which runs in Node and
 * can import both sides; a direct import here would break the Edge bundle.
 */

/**
 * Origins of wallet-core's keyless public RPCs (ETHEREUM/POLYGON/ARBITRUM/
 * PLASMA_PUBLIC_RPCS). Origins, not full URLs — `connect-src` matches by origin.
 * `rpc.ankr.com` is shared by the eth/polygon/arbitrum Ankr endpoints, so it
 * appears once. Kept in sync with the lists in
 * `packages/wallet-core/src/chains/index.ts` by `test/cspAllowlist.test.ts`.
 */
export const DEFAULT_RPC_ORIGINS = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.llamarpc.com",
  "https://rpc.ankr.com",
  "https://polygon-rpc.com",
  "https://polygon-bor-rpc.publicnode.com",
  "https://arb1.arbitrum.io",
  "https://arbitrum-one-rpc.publicnode.com",
  "https://rpc.plasma.to",
] as const;

/** The CoinGecko price oracle — the one disclosed, opt-out third-party call. */
export const COINGECKO_ORIGIN = "https://api.coingecko.com";

/** `scheme://host[:port]` of a URL, or null if it does not parse. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Origins implied by the deploy's `NEXT_PUBLIC_ETHEREUM_RPC_URLS` override.
 * `NEXT_PUBLIC_*` is inlined into both the Edge and browser bundles, so this
 * resolves identically in `middleware.ts` and in the settings UI.
 */
export function envRpcOrigins(): string[] {
  const out: string[] = [];
  for (const raw of (process.env.NEXT_PUBLIC_ETHEREUM_RPC_URLS ?? "").split(",")) {
    const o = originOf(raw.trim());
    if (o && !out.includes(o)) out.push(o);
  }
  return out;
}

/**
 * The full static `connect-src` origin allowlist this deploy ships (minus
 * `'self'` and the wholesale `wss:` scheme-source, which `middleware.ts` adds):
 * the public-RPC defaults, the price oracle, and any deploy-env RPC override.
 */
export function staticConnectSrcOrigins(): string[] {
  const out = new Set<string>([...DEFAULT_RPC_ORIGINS, COINGECKO_ORIGIN, ...envRpcOrigins()]);
  return [...out];
}

/**
 * Will this deploy's CSP allow a connection to `origin`? A `wss://` origin is
 * always allowed (Bitcoin Electrum-WS is operator-supplied and `connect-src`
 * permits the `wss:` scheme wholesale — there is no public default to pin). Any
 * other origin (an `https:` RPC / indexer / price endpoint) must be in the
 * static allowlist; everything else is blocked. The settings UI uses this to
 * warn before a user saves an origin that will silently fail at fetch time.
 */
export function isOriginAllowedByCsp(origin: string): boolean {
  if (origin.startsWith("wss://")) return true;
  return staticConnectSrcOrigins().includes(origin);
}
