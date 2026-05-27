# Security review

A structured walk through this wallet's security posture: the threat model, how
secrets live and die, the unlock design, the worker boundary, network privacy,
the CSP rationale line by line, the one residual audit advisory, how to verify
all of it locally, and the browser caveats. It is the companion to
[`SECURITY.md`](./SECURITY.md) (the honest model) and
[`ARCHITECTURE.md`](./ARCHITECTURE.md) (the ADRs cited below).

The guiding rule: **state the real model and its limits.** A wallet that
overstates its security is more dangerous than one that is candid about where
the web platform stops.

## 1. Threat model

| Adversary | Can they reach keys? | Mitigation / honest limit |
|---|---|---|
| **Remote network attacker** (no code on the page) | No. | Keys never leave the device; only AES-GCM ciphertext is stored. TLS to RPC/price endpoints; no key material is ever transmitted. |
| **Malicious/compromised dependency** on the page | Yes, in principle. | `script-src` allows no inline/eval and `connect-src` is pinned (§6), so exfiltration and remote-code injection are sharply constrained; pinned + lockfile-audited deps in CI. Not a *complete* defence — see XSS below. |
| **XSS / compromised main thread** | Yes — can ask the worker to sign. | The Web Worker is **defence-in-depth, not a boundary** against XSS. The CSP is the primary control here (no inline script, no eval, no remote script). RN's separate-runtime worklet is strictly stronger; we say so. |
| **Local attacker with the locked device** | Only the ciphertext. | Vault is AES-GCM-256; the wrapping key derives from a passkey PRF or a 600k-iteration PBKDF2 passphrase. No plaintext seed at rest. |
| **Local attacker after unlock** (warm session) | The decrypted seed lives in worker memory. | Sessions lock on tab-hide/idle; decrypted lifetime is minimised and buffers are zeroised. No HSM on the web — stated plainly. |
| **Phishing / malicious recipient** | N/A to keys; targets the user. | Pre-send safety panel: official-contract badge, recipient classification, address-poisoning warning, itemised confirmation from decoded tx data (not opaque hex). |
| **Passive network observer** (which addresses you hold) | Sees RPC/price traffic. | Privacy-preserving defaults: local-only activity, no indexer, price oracle is a disclosed opt-out. All endpoints are surfaced in the Data Sources card (§5). |

Out of scope: a compromised OS/browser binary, a malicious browser extension with
host permissions, and hardware side-channels — no web app can defend these, and
we do not claim to.

## 2. Secrets lifecycle

```
create:  entropy → mnemonic shown once (main thread, backup screen)
                 → AES-GCM seal (worker) → ciphertext → IndexedDB
import:  user types mnemonic (main thread) → seal (worker) → IndexedDB
unlock:  passkey PRF | passphrase → wrap key → openSeed (worker) → signer in worker
sign:    main thread sends an INTENT (amount/asset/chain/recipient) → worker signs
lock:    worker drops the decrypted seed + signer; zeroise buffers
delete:  IndexedDB record removed; no localStorage.clear() of unrelated host data
```

- **At rest:** only AES-GCM-256 ciphertext, in IndexedDB. Never localStorage,
  never component state.
- **Operational steady state** (unlock → derive → sign → lock): the decrypted
  seed and the WDK signer exist **only inside the Dedicated Web Worker**; the
  main thread holds an opaque postMessage proxy (ADR-004).
- **Honest exception:** at *create* (seed shown for backup) and *import* (seed
  typed) the phrase transits the main thread because the DOM is main-thread. No
  browser wallet avoids this; the RN starter has the identical property.
- **Vault decryption runs in the worker** — the AES-GCM key crosses as a
  non-extractable, structured-cloneable `CryptoKey` handle, never as raw bytes.
- **What "zeroise" can and cannot cover (honest limit):** the binary key
  buffers (`Uint8Array`) are wiped in place via libsodium's `sodium_memzero`.
  The seed *phrase* itself, though, is a JS `string` — immutable, so it can only
  be dropped for garbage collection, never overwritten in place. We minimise its
  lifetime (decrypt → bind straight into the WDK manager → drop the local
  reference and the signer's copy on `dispose()`) rather than claiming a wipe the
  platform cannot deliver. This is a property of every JS wallet, RN starter
  included; we state it instead of implying the string is scrubbed.

## 3. Passphrase / passkey design

Two wrapping-key paths, **preferred-when-enrolled, never both at once** (ADR-005):

- **Passkey (WebAuthn PRF / CTAP2 `hmac-secret`):** the PRF yields a 32-byte
  full-entropy secret → **HKDF-SHA256** → wrap key. HKDF (not PBKDF2) is correct
  here precisely *because* the input is already full-entropy; stretching it would
  be pure cost. A passkey **signature** is never used as a key — it is
  non-deterministic.
- **Passphrase:** **PBKDF2-SHA256, 600,000 iterations** → wrap key. The
  iteration count stretches a low-entropy human secret.

Unlock selection is honest: WebAuthn has no offline "PRF will work" probe, so
*enrolment* is the real test. An assertion that yields no PRF result surfaces a
typed error rather than failing silently. Passphrase remains the recovery slot;
enrolling a passkey adds a separate passkey-encrypted vault slot (it does not
remove the passphrase slot).

## 4. Worker boundary

- The WDK adapter (`packages/wallet-core/src/wdk/`) spawns a **Dedicated Web
  Worker** (`new Worker(new URL("./crypto.worker.js", import.meta.url), …)`).
  The seed and signer live there; the main thread passes intents, not key
  material (ADR-004).
- **What it buys:** shrinks the key-handling surface, prevents *accidental* leaks
  into logs/DOM/state, keeps the WDK/BTC graph off the main First Load path.
- **What it does NOT buy:** it is **not a security boundary against XSS**. A
  compromised main thread can still post a "sign" intent to the worker. We do not
  pretend otherwise; the CSP (§6) is the control that actually targets XSS.

## 5. Data-source privacy

Every endpoint the wallet can talk to is explicit and user-owned, surfaced in the
**Data Sources** settings card (`apps/next/src/lib/dataSources.ts`):

- **EVM RPCs** (Ethereum/Polygon/Arbitrum/Plasma): keyless public RPC defaults;
  overridable per chain.
- **Bitcoin Electrum-WS**: operator-supplied; empty = BTC stays unregistered
  (honest `UnsupportedChainError`, no silent failure).
- **History**: `local` (outgoing send log only) by default; `indexer` is opt-in
  and queries only the configured indexer (ADR-003 — no hardcoded public-history
  fetch in core).
- **Price oracle (CoinGecko)**: the one third-party call; a **disclosed, opt-out
  toggle**. When off, no CoinGecko request is made at all.

Overrides are shape-validated, stored **on-device only** (localStorage), and
rebuild the engine on save — they are **never threaded into wallet-core**, which
stays env/option-driven and storage-agnostic.

## 6. CSP rationale (per directive)

Shipped from [`apps/next/middleware.ts`](../apps/next/middleware.ts) as a
per-request header; the root layout reads request headers to force per-request
rendering so the nonce reaches Next's inline bootstrap scripts.

| Directive | Value | Why |
|---|---|---|
| `default-src` | `'self'` | Deny-by-default for anything not named below. |
| `script-src` | `'self' 'nonce-…' 'strict-dynamic'` | **The primary XSS control.** No `'unsafe-inline'`, no `eval`. A fresh per-request nonce admits Next's inline RSC-bootstrap scripts; `'strict-dynamic'` lets those nonce'd scripts load the webpack chunks. An injected `<script>` without the nonce cannot run. |
| `style-src` | `'self' 'unsafe-inline'` | Next/Tailwind inject inline `<style>`. Inline *style* is not a script-execution vector the way inline script is; nonce-ing every style block is not worth the breakage. |
| `img-src` | `'self' blob: data:` | App icons/QR; `data:`/`blob:` for client-generated images. |
| `font-src` | `'self'` | Self-hosted Outfit font. |
| `connect-src` | `'self'` + default RPC origins + `https://api.coingecko.com` + `NEXT_PUBLIC_ETHEREUM_RPC_URLS` origins + `wss:` | Pins network egress. The allowed origins come from one shared module, [`src/lib/cspAllowlist.ts`](../apps/next/src/lib/cspAllowlist.ts) — `middleware.ts` builds `connect-src` from it and the Data Sources UI reads the same list to warn the user (see honest limit below), so the two cannot drift. The default RPC origins mirror `chains/index.ts` public lists; that link is itself drift-guarded by [`test/cspAllowlist.test.ts`](../apps/next/test/cspAllowlist.test.ts) (it runs in Node and can import both, where the Edge bundle cannot). The only deploy-env origin folded in is `NEXT_PUBLIC_ETHEREUM_RPC_URLS` (the same var `engine.ts` reads). CoinGecko is the disclosed price oracle. `wss:` is allowed wholesale because the Electrum endpoint is always operator-supplied (no public default to pin). |
| `worker-src` | `'self' blob:` | The WDK crypto worker is spawned from a bundler URL/blob. |
| `object-src` | `'none'` | No plugins/embeds. |
| `base-uri` | `'self'` | Blocks `<base>` tag hijacking of relative URLs. |
| `frame-ancestors` | `'none'` | Clickjacking defence (no embedding). |
| `form-action` | `'self'` | Forms cannot post off-origin. |

Plus request-independent headers from `next.config.mjs` (every route): `X-Content-Type-Options:
nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`,
`Strict-Transport-Security: max-age=63072000; includeSubDomains` (HSTS — `preload`
omitted so the template makes no irrevocable list commitment on a deployer's
behalf; ignored over plain http, safe in local dev), and `Permissions-Policy`
denying every powerful feature except same-origin `camera` (the QR scanner is the
only one the wallet uses).

**Honest limit (surfaced in the UI, not hidden):** the allow-list is fixed at
deploy time. The Edge middleware cannot read localStorage, so a user who points
the wallet at a *custom* RPC/indexer/price origin via the Data Sources card sets
a value that is **not** in `connect-src`, and that fetch is CSP-blocked. Rather
than let that fail silently or widen `connect-src` to `https:` (which would gut
the egress pin), the Data Sources card validates each entered origin against the
same `cspAllowlist.ts` (`cspBlockedOrigins()`) and **warns inline** which origins
this deploy will block. The shipped defaults + `NEXT_PUBLIC_*` deploy env cover
the out-of-the-box configuration; a self-hoster who needs a custom origin widens
the allow-list via that env (or their own CSP). In a **production** build the
settings layer also rejects plaintext `http:`/`ws:` overrides outright (only
`https:`/`wss:` are stored), since a cleartext endpoint both leaks queried
addresses and is mixed-content-blocked on the https-served app anyway; dev keeps
the insecure schemes so a `http://localhost:8545` node stays testable.

**Scope — `apps/next` only.** This CSP and the static headers above ship from the
Next app, which is the deployable surface. `apps/svelte` is the portability proof
(ADR-005): a Vite SPA that exercises the same wallet-core engine to show the seam
is framework-agnostic, and it ships **without** these headers. It is not a
hardened deploy target — if a Svelte build were ever shipped to users, its host
would have to supply an equivalent nonce-CSP and header set. We say so rather than
let the Svelte app imply parity it does not carry.

## 7. Residual audit advisory

`corepack pnpm audit --audit-level moderate` passes. One **low** advisory remains
and is accepted, not silently ignored:

- **`bitcoinjs-message → secp256k1 → elliptic`** — upstream in the pinned **alpha
  BTC WDK** dependency chain. There is **no patched range** in the advisory, so it
  cannot be resolved by a version bump today. It is `low` severity and confined to
  the BTC path. WDK is alpha and version-pinned; a fix lands when upstream
  publishes one, and the WDK adapter module is where any such change is contained.

## 8. Verification commands

```bash
corepack pnpm install
corepack pnpm verify                          # lint + typecheck + test + build (all 3 packages)
corepack pnpm smoke                            # E2E: create → seed quiz → portfolio → receive a11y → Recovery Check
corepack pnpm demo                             # records docs/demo.gif against the offline Electrum-WS fixture
corepack pnpm audit --audit-level moderate     # one accepted low advisory (see §7)
```

To eyeball the live CSP header:

```bash
corepack pnpm --filter next build
corepack pnpm --filter next start -p 4000 &
curl -sI http://127.0.0.1:4000/ | grep -i content-security-policy
```

The `smoke` run is itself a CSP assertion: the app is created, hydrated, and
driven through signing-gated flows **under the live nonce CSP**, so a passing
smoke proves there are no CSP violations that break the app.

## 9. Browser support caveats

- **WebAuthn PRF** is not universal. Where it is unavailable, the wallet falls
  back to the passphrase slot — selection is by real enrolment, not assumption.
- **The browser cannot open raw Electrum TCP**, so BTC requires an
  Electrum-over-WebSocket endpoint (hence `wss:` in `connect-src`).
- **IndexedDB + WebCrypto + Dedicated Workers** are required; all are baseline in
  current evergreen browsers. Private-mode storage eviction can drop the vault —
  the offline seed backup is the recovery path.
- **`'strict-dynamic'`** is honoured by CSP-Level-3 browsers; older engines fall
  back to the `'self'` source, which still covers the same-origin chunks.
