# Project Summary

**In one line:** a self-custodial, multi-chain **web** wallet built on
Tether's Wallet Development Kit. Create or import a seed, unlock with a
passkey or passphrase, then send and receive **BTC and USDв‚®** entirely
client-side. It is the production-grade **web** counterpart to Tether's
`wdk-starter-react-native`, which Tether ships only for React Native.

- **Live demo (no build):** https://wdk-wallet-web-production.up.railway.app
- **Walkthrough video (~90 s, silent):** [`walkthrough.mp4`](walkthrough.mp4),
  create -> back up -> portfolio -> receive -> send form
- **Reviewer guide:** [`Review guide`](REVIEW.md)
- **Requirement -> implementation -> verification map:**
  [`Verification checklist`](VERIFICATION-CHECKLIST.md)

## Current submission position

This repository is best read as an **M1-complete, M2-strong web template
submission**. It does **not** claim that every M3 item is already closed.

| Milestone | Status here | Notes |
|---|---|---|
| M1: Proposal & Architecture Review | Delivered | Framework choice, architecture, security model, and integration notes are public in this repo. |
| M2: Core Integration & Wallet Flows | Delivered for the core web template | WDK integration, onboarding, balances, send / receive, multi-wallet, multi-account, QR, payment requests, and status monitoring all run today. |
| M3: Final Delivery | Next milestone | Spark / Lightning, official Indexer API alignment for external history, the upstream PR into Tether's templates/examples area, and the expanded 2-5 minute reviewer demo package remain next-step items. |

## What is already working today

- **USDв‚®** on Ethereum, Polygon, Arbitrum, and Plasma through the WDK EVM
  manager, plus **Solana** through the WDK Solana manager, plus **XAUв‚®** on
  Ethereum.
- **BTC** through the pure-JS WDK BTC manager and an injected
  Electrum-over-WebSocket client, running in a Dedicated Web Worker.
- **Self-custodial key handling:** AES-GCM seed vault, worker-owned signer, no
  custodial backend in the middle.
- **Unlock:** WebAuthn passkey (PRF) with a PBKDF2 passphrase fallback.
- **Multi-wallet / multi-account**, **QR receive + QR-scan send**, and
  **payment requests** for EIP-681, BIP-21, and Solana Pay.
- **Transaction status monitoring** ships today through local activity plus
  on-chain receipt refresh.
- **External/public history** is deliberately opt-in and provider-injected
  today. Official Tether Indexer API alignment is planned as the next
  milestone, not quietly claimed as already done.
- **Address book + templates**, **pre-send safety checks**, **data-source
  privacy controls**, and a **watch-only** mode are all included in the Next.js
  reference app.

The complete requirement-by-requirement map, with the file and test that prove
each claim, lives in
[`Verification checklist`](VERIFICATION-CHECKLIST.md).

## Why this repo matters

It mirrors the shape of Tether's RN starter: platform-agnostic wallet logic is
kept separate from platform-specific UI and storage.

- **`packages/wallet-core`**: a headless, fully-typed, tested WDK engine for
  orchestration, encrypted vault handling, chain configuration, balances, send,
  receive, and activity. Zero UI, zero framework lock-in.
- **`apps/next`**: the reference web wallet and the main submission target.
- **`apps/svelte`**: the same byte-shared core driven by a second framework, as
  the portability proof.

That same headless core is reusable for adjacent hosts such as a browser
extension or an eCommerce checkout flow.

## Evaluate in five minutes

1. **No build:** open the live demo and walk create -> back up seed ->
   portfolio -> receive -> send.
2. **Local gates:** `corepack pnpm install && corepack pnpm verify` runs lint,
   typecheck, **253 unit tests**, and build across all three packages.
3. **Real chain reads:** `corepack pnpm btc:live` and `corepack pnpm sol:live`
   run the genuine WDK adapters in-process against live endpoints and read real
   on-chain balances.
4. **UI under production CSP + accessibility:** `corepack pnpm smoke` drives a
   real-browser walkthrough under the live strict CSP, and
   `corepack pnpm a11y` runs axe-core against the key screens.

A step-by-step tour and the "verify each claim yourself" command table live in
[`Review guide`](REVIEW.md).

## Honest limits

- The end-to-end **"money actually moved" broadcast** needs funded testnet
  keys. WDK couples sign-and-broadcast in `account.sendTransaction` /
  `account.transfer`, so the clean proof is a short recorded funded-send clip
  that travels with the submission package.
- **BTC needs a public Electrum-WS endpoint.** A browser cannot open a raw
  Electrum TCP socket, so this is a real deployment input, not a hidden bug.
- **Spark / Lightning are not shipped in this repo.** They are kept as the next
  milestone extension path and are not claimed as done.
- **Web Worker is the web platform mapping for the secure execution layer.**
  It is the right browser-side isolation pattern here, but it is not marketed
  as a literal copy of the RN worklet runtime.
- **Not for production use with real funds yet.** The threat model and residual
  XSS risk are stated plainly in [`SECURITY.md`](SECURITY.md).

Honest limits over false parity.
