import { NextResponse, type NextRequest } from "next/server";
import { allowsWholesaleWss, staticConnectSrcOrigins } from "./src/lib/cspAllowlist";

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
 * compromised dependency cannot beacon to an arbitrary host. The allowed origins
 * come from `src/lib/cspAllowlist.ts` — the SINGLE source shared with the Data
 * Sources settings UI (re-audit Finding 2), so the two cannot drift. That module
 * also stays in sync with wallet-core's public RPC lists via a vitest guard.
 *
 * HONEST LIMIT: a user can type a CUSTOM RPC/indexer/price origin at runtime
 * (Data Sources card, stored in localStorage). The Edge middleware cannot read
 * localStorage, so such an origin is not in this allow-list and its fetch is
 * CSP-blocked. We keep the CSP strict on purpose (it is the product's pitch) and
 * instead make the surface HONEST: the settings card validates each entered
 * origin against this same allowlist and warns the user when it will be blocked.
 * The defaults + `NEXT_PUBLIC_*` deploy env cover the shipped config; a
 * self-hoster widens the allowlist via env. `wss:` is allowed wholesale because
 * the Bitcoin Electrum-WS endpoint is operator-supplied with no public default —
 * but only until the operator PINS that endpoint via NEXT_PUBLIC_CONNECT_SRC_ORIGINS,
 * at which point the wholesale scheme is dropped and connect-src permits just the
 * pinned wss:// origin (see `allowsWholesaleWss`). Documented in
 * docs/SECURITY-REVIEW.md → "CSP".
 */

function connectSrc(): string[] {
  // 'self' + the shared static allowlist, plus the wholesale `wss:` scheme — but
  // the scheme ONLY when no explicit Electrum-WS origin is pinned. If the
  // operator has pinned their wss:// endpoint (via NEXT_PUBLIC_CONNECT_SRC_ORIGINS),
  // it is already in the allowlist and we keep connect-src tight rather than
  // leaving any secure socket reachable. See allowsWholesaleWss.
  const base = ["'self'", ...staticConnectSrcOrigins()];
  if (allowsWholesaleWss()) base.push("wss:");
  return [...new Set(base)];
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
