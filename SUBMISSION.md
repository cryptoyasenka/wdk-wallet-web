# Submission — WDK Web Wallet (Tether WDK Bounty)

**In one line:** a self-custodial, multi-chain **web** wallet built on Tether's
Wallet Development Kit — create or import a seed, unlock with a passkey or
passphrase, then send and receive **BTC and USD₮** entirely client-side. It is the
production-grade **web** counterpart to Tether's `wdk-starter-react-native`, which
Tether ships only for React Native.

- **Live demo (no build):** https://wdk-wallet-web-production.up.railway.app
- **Reviewer guide / verify each claim yourself:** [`JUDGES.md`](JUDGES.md)
- **Requirement → implementation → verification map:** [`docs/BOUNTY-CHECKLIST.md`](docs/BOUNTY-CHECKLIST.md)

## What the bounty asked, and what this delivers

The ask was **BTC + USD₮ send/receive on the web, self-custodial.** Both ship — plus
more, each scoped honestly:

- **USD₮** on Ethereum, Polygon, Arbitrum & Plasma (WDK EVM manager) **+ Solana**
  (WDK Solana manager) **+ XAU₮** on Ethereum.
- **BTC** via the pure-JS WDK BTC manager + an injected Electrum-over-WebSocket
  client, running in a Web Worker.
- **Self-custodial:** AES-GCM seed vault; the WDK signer runs in a dedicated worker;
  nothing custodial in between.
- **Unlock:** WebAuthn passkey (PRF) with a PBKDF2 passphrase fallback.
- **Multi-wallet / multi-account**, **QR receive + QR-scan send**, **payment requests**
  (EIP-681 / BIP-21 / Solana Pay), a **pre-send safety panel** (official-contract
  badge, recipient status, address-poisoning warning), an **address book + templates**,
  **data-source privacy** controls, and a **watch-only** mode.

The complete requirement-by-requirement table, with the file and test that proves
each, is in [`docs/BOUNTY-CHECKLIST.md`](docs/BOUNTY-CHECKLIST.md).

## Why this is more than "create-next-app + the WDK quickstart"

It mirrors the architecture of Tether's own RN starter — platform-agnostic wallet
logic cleanly separated from platform-specific UI / storage:

- **`packages/wallet-core`** — a headless, fully-typed, tested WDK engine
  (orchestration, encrypted vault, chains/failover, balances, send, receive,
  activity). Zero UI, zero framework lock-in. `@tetherto/*` is quarantined here and
  ESLint-enforced, so an upstream break stays one-file localized.
- **`apps/next`** — the reference web wallet, at full screen parity with the RN
  starter.
- **`apps/svelte`** — the **same byte-unchanged core** driven by a second framework:
  the portability proof.

That same headless core is reusable verbatim for the other two Tether WDK bounties
(a browser-extension wallet and an eCommerce checkout).

## Evaluate in five minutes

1. **No build:** open the live demo and walk create → back up seed → portfolio →
   receive (payment-request URI + QR) → send (pre-send safety panel).
2. **Local gates:** `corepack pnpm install && corepack pnpm verify` — lint, typecheck,
   **246 unit tests**, and build across all three packages.
3. **Prove the real chains:** `corepack pnpm btc:live` / `corepack pnpm sol:live` run
   the genuine WDK adapters in-process against live endpoints and read real on-chain
   balances — actual transport, not a mock.
4. **Prove the UI under production CSP + accessibility:** `corepack pnpm smoke`
   (real-browser walkthrough under the live strict CSP; a pass also proves zero CSP
   violations) and `corepack pnpm a11y` (axe-core, WCAG 2.0/2.1 A+AA).

A step-by-step tour and a full "verify each claim yourself" command table live in
[`JUDGES.md`](JUDGES.md).

## Honest limits (stated, not hidden)

- The end-to-end **"money actually moved" broadcast** needs funded testnet keys. WDK
  couples sign-and-broadcast in `account.sendTransaction` / `account.transfer` (there
  is no offline sign-without-broadcast primitive to assert against, so it is **not**
  fabricated); that final proof should be attached in the bounty form as a short
  **recorded send video**, while the send orchestration, signing intent, and fee
  quotes are unit-tested in-repo.
- **BTC needs a public Electrum-WS endpoint** — a browser cannot open a raw Electrum
  TCP socket. That is a deployment input, not a missing feature.
- **Lightning / Spark** are not shipped: same adapter shape, left as documented
  extension points, not claimed as done.
- **Not for production use with real funds yet** — the web has no exact equivalent of
  the RN starter's BareKit worklet + native Keychain + biometrics; the threat model
  and residual XSS risk are stated plainly in [`docs/SECURITY.md`](docs/SECURITY.md).

Honest limits over false parity.
