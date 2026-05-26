# Security model & threat model (honest)

This template is self-custodial: the user holds the keys, no server ever sees them.
The web platform cannot match a native wallet's security primitives one-for-one. We
state the real model and its limits rather than imply parity.

## What we do

- **Seed/keys never in component state, never in `localStorage`.** In the
  **operational steady state** (every unlock → derive address → quote → send →
  lock — the path that repeats in daily use) the decrypted seed and the WDK
  signer exist **only inside a Dedicated Web Worker**; the main thread holds an
  opaque postMessage proxy and passes intents (sign tx, derive address), not key
  material. Vault decryption (`openSeed`) runs inside the worker — the AES-GCM
  key crosses as a non-extractable, structured-cloneable handle, never as raw
  bytes (see ARCHITECTURE.md → ADR-004). **Honest exception:** at wallet
  *create* (seed shown on a backup screen) and *import* (seed typed by the
  user) the phrase unavoidably transits the main thread, because the DOM is
  main-thread — no browser wallet can avoid this and the RN starter has the
  same property. Sealing happens there too (the seed is already present); it is
  never written to component state or `localStorage`, only AES-GCM ciphertext
  reaches IndexedDB.
- **At rest:** seed encrypted with **AES-GCM-256 (WebCrypto)**. The wrapping
  key comes from one of two paths, preferred-when-enrolled, never both at once:
  a **WebAuthn passkey's PRF extension** (CTAP2 `hmac-secret`) → a 32-byte
  full-entropy secret → **HKDF-SHA256**; or a passphrase → **PBKDF2-SHA256,
  600k iterations** (the entropy difference is *why* the KDFs differ — HKDF is
  correct and PBKDF2 stretching would be pure cost for the high-entropy PRF
  input; see ARCHITECTURE.md → ADR-005). A passkey *signature* is never used as
  a key — it is non-deterministic. Only ciphertext is stored, in **IndexedDB**.
- **Unlock** uses the passkey when one has been enrolled in this wallet
  (hardware-backed where the authenticator supports it), otherwise the
  passphrase — selection is honest, not assumed: WebAuthn has no offline
  "PRF will work" probe, so enrolment is the real test and an assertion that
  yields no PRF result surfaces a typed error, not a silent failure. Session
  locks on tab hide/idle.
- **Every transaction requires explicit, itemised user confirmation** (amount, asset,
  chain, recipient, fee) rendered from decoded tx data, not opaque hex.
- No analytics, no telemetry, all data local. Open source for audit.

> **Not shipped: hardware-wallet signing.** This is a *software* web wallet. There
> is no Ledger/Trezor path — `ledger-bitcoin` is deliberately stubbed to `false`
> in both bundlers (see the Next/Vite build configs). The WDK adapter
> (`packages/wallet-core/src/wdk/`) is the clean extension point where a
> hardware-signer adapter *could* be added, but none ships today, and this
> document does not claim one. Use a dedicated hardware wallet for cold storage of
> large balances rather than expecting it from this app.

## What the web genuinely cannot guarantee (do not pretend otherwise)

- **A Web Worker is not a security boundary against XSS.** If the page is XSS'd,
  attacker script can ask the worker to sign. The worker limits *accidental* key
  leakage and shrinks the key-handling surface; it does **not** defeat a compromised
  main thread. RN's BareKit worklet (separate runtime) is strictly stronger here.
- **No default hardware-backed keystore.** WebAuthn provides hardware-backed *unlock*,
  but the decrypted seed still lives in (worker) memory to sign — it is not in an
  HSM. Mitigation: minimise decrypted lifetime, zeroise buffers, and keep large
  balances in a dedicated hardware wallet (which this software wallet does not
  replace — see "Not shipped" above).
- **Create / import unavoidably touch the main thread.** The seed is rendered on
  a backup screen (create) or typed by the user (import), and the DOM is
  main-thread, so the worker isolation does not cover those two one-off moments.
  This is a web-platform property, not a flaw we can engineer away — the RN
  starter has the identical property. Steady-state use (unlock → sign → lock) is
  worker-isolated; see ARCHITECTURE.md → ADR-004 for the precise boundary.
- **Supply chain.** A malicious dependency on the page can exfiltrate. Mitigations:
  pinned/locked deps, no remote code, audited lockfile in CI, and a strict
  Content-Security-Policy shipped as a real response header with a strict,
  per-request-nonce `script-src` (`'self' 'nonce-…' 'strict-dynamic'` — no
  inline/eval scripts), `connect-src` pinned to the wallet's RPC/price/Electrum
  endpoints, `object-src 'none'`, `frame-ancestors 'none'` (see
  `apps/next/middleware.ts` and the CSP section of `docs/SECURITY-REVIEW.md`).
  The allow-list is fixed at deploy time, so a user-supplied *custom* RPC origin
  set at runtime is not in it — an honest limit documented in the review.

## Hard rules enforced in this repo

- **No secrets committed.** `.env*` gitignored; only `.env.example` is tracked.
  CI fails if a key-shaped string lands in the tree.
- WDK is **alpha** — pinned versions; a breaking change is contained to the WDK
  adapter module (see ARCHITECTURE.md).
- Threat model is revisited every phase; this document is part of the deliverable,
  not an afterthought.

The pro signal here is the honesty: a wallet that overstates its security is more
dangerous than one that states its limits.
