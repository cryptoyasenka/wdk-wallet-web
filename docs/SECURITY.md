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
- **At rest:** seed encrypted with **AES-GCM (WebCrypto)**; the wrapping key is
  derived from a **WebAuthn/passkey** assertion (preferred) or a strong passphrase
  (PBKDF2/Argon2 fallback). Only ciphertext is stored, in **IndexedDB**.
- **Unlock** is gated by WebAuthn (hardware-backed where the authenticator supports
  it). Session locks on tab hide/idle.
- **Every transaction requires explicit, itemised user confirmation** (amount, asset,
  chain, recipient, fee) rendered from decoded tx data, not opaque hex.
- **Optional hardware-wallet path** for users who want keys off the browser entirely.
- No analytics, no telemetry, all data local. Open source for audit.

## What the web genuinely cannot guarantee (do not pretend otherwise)

- **A Web Worker is not a security boundary against XSS.** If the page is XSS'd,
  attacker script can ask the worker to sign. The worker limits *accidental* key
  leakage and shrinks the key-handling surface; it does **not** defeat a compromised
  main thread. RN's BareKit worklet (separate runtime) is strictly stronger here.
- **No default hardware-backed keystore.** WebAuthn provides hardware-backed *unlock*,
  but the decrypted seed still lives in (worker) memory to sign — it is not in an
  HSM. Mitigation: minimise decrypted lifetime, zeroise buffers, prefer the
  hardware-wallet path for large balances.
- **Create / import unavoidably touch the main thread.** The seed is rendered on
  a backup screen (create) or typed by the user (import), and the DOM is
  main-thread, so the worker isolation does not cover those two one-off moments.
  This is a web-platform property, not a flaw we can engineer away — the RN
  starter has the identical property. Steady-state use (unlock → sign → lock) is
  worker-isolated; see ARCHITECTURE.md → ADR-004 for the precise boundary.
- **Supply chain.** A malicious dependency on the page can exfiltrate. Mitigations:
  pinned/locked deps, Subresource Integrity where applicable, strict CSP, no remote
  code, audited lockfile in CI.

## Hard rules enforced in this repo

- **No secrets committed.** `.env*` gitignored; only `.env.example` is tracked.
  CI fails if a key-shaped string lands in the tree.
- WDK is **alpha** — pinned versions; a breaking change is contained to the WDK
  adapter module (see ARCHITECTURE.md).
- Threat model is revisited every phase; this document is part of the deliverable,
  not an afterthought.

The pro signal here is the honesty: a wallet that overstates its security is more
dangerous than one that states its limits.
