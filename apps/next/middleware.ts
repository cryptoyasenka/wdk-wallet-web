import { NextResponse, type NextRequest } from "next/server";

/**
 * Content-Security-Policy (Phase 6) — emitted per request so it can carry a
 * fresh nonce.
 *
 * The real XSS mitigation is a strict `script-src`: no `'unsafe-inline'`, no
 * remote code, no eval. Next.js ships its hydration/RSC bootstrap as INLINE
 * `<script>` tags, so a static `script-src 'self'` would block them and the app
 * would never mount. The standard fix is a per-request nonce: middleware mints
 * one, puts it in the CSP, and Next reads it back from the request's
 * `Content-Security-Policy` header and stamps every script it renders with it.
 * `'strict-dynamic'` then lets those nonce'd scripts pull the webpack chunks.
 *
 * `connect-src` is pinned to exactly the endpoints the wallet talks to, so a
 * compromised dependency cannot beacon to an arbitrary host. The default RPC
 * origins MUST stay in sync with the public RPC lists in
 * packages/wallet-core/src/chains/index.ts (ETHEREUM/POLYGON/ARBITRUM/PLASMA_
 * PUBLIC_RPCS); they are duplicated here because middleware runs in the Edge
 * runtime and cannot import the workspace package's compiled output.
 *
 * HONEST LIMIT: a user can point the wallet at a CUSTOM RPC/indexer origin at
 * runtime (Data Sources card, stored in localStorage). That origin is not in
 * this allow-list and its fetch is CSP-blocked. We accept it: the defaults +
 * `NEXT_PUBLIC_*` deploy env cover the shipped config, and `wss:` is allowed
 * wholesale because the Bitcoin Electrum-WS endpoint is always operator-supplied
 * (no public default). Documented in docs/SECURITY-REVIEW.md → "CSP".
 */

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

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function connectSrc(): string[] {
  const out = new Set(["'self'", ...DEFAULT_RPC_ORIGINS, COINGECKO_ORIGIN]);
  // Deploy-time env RPC overrides (same source engine.ts reads).
  for (const raw of (process.env.NEXT_PUBLIC_ETHEREUM_RPC_URLS ?? "").split(",")) {
    const o = originOf(raw.trim());
    if (o) out.add(o);
  }
  // Bitcoin Electrum-WS is always operator-supplied; allow secure WebSockets.
  out.add("wss:");
  return [...out];
}

export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"],
    // Next/Tailwind inject inline <style>; inline style is not a script-exec
    // vector the way inline script is.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "blob:", "data:"],
    "font-src": ["'self'"],
    "connect-src": connectSrc(),
    // The WDK adapter spawns a Dedicated Worker from a blob/bundle URL.
    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "frame-ancestors": ["'none'"],
    "form-action": ["'self'"],
  };

  const csp = Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(" ")}`)
    .join("; ");

  // Next reads the nonce from the request's CSP header and applies it to the
  // scripts it renders; `x-nonce` is exposed for any app code that needs it.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Run on documents only — static assets and images are same-origin files that
  // need no nonce. (The non-CSP security headers are applied to every route in
  // next.config.mjs.)
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
