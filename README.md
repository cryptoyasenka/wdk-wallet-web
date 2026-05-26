# WDK Wallet — Web Starter

A self-custodial, multi-chain web wallet built on Tether's
[Wallet Development Kit](https://github.com/tetherto/wdk-core). It is the
production-grade **web** counterpart to the official
[`wdk-starter-react-native`](https://github.com/tetherto/wdk-starter-react-native),
which Tether ships **only for React Native**.

**Bitcoin and USD₮ both work, on the web, client-side.** Create or import a
seed, unlock with a passkey or passphrase, then send and receive real BTC and
USD₮ (plus ETH / XAUT). Key material never leaves the browser, the WDK signer
runs in a dedicated Web Worker, and there is nothing custodial in between.

![Wallet demo: create → back up seed → portfolio (BTC + USD₮) → receive (real client-derived addresses)](docs/demo.gif)

> Recorded end-to-end against the real built app. The BTC row is served by a
> local, offline Electrum-WS fixture (no endpoint, no secret); the addresses
> and keys are real client-side derivation. Regenerate locally:
> `corepack pnpm demo` (one-time `corepack pnpm exec playwright install
> chromium`, plus `ffmpeg` on PATH).

## Run it in two minutes

```bash
pnpm install
pnpm --filter next dev          # → http://localhost:3000
```

That boots the full wallet on Ethereum (ETH + USD₮ / XAUT) with zero config. To
enable Bitcoin, point it at an Electrum-over-WebSocket endpoint:

```bash
cp apps/next/.env.example apps/next/.env.local
# set NEXT_PUBLIC_BTC_ELECTRUM_WS_URL=wss://<your-electrum-host>:50004
pnpm --filter next dev
```

No endpoint set → the wallet runs EVM-only (Ethereum, Polygon, Arbitrum,
Plasma) and BTC surfaces a typed, honest "unsupported chain" error instead
of failing silently.

## Scope: the bounty asked for BTC + USD₮ — both ship

| Bounty ask | Status |
|---|---|
| Send / receive **USD₮** on web | ✅ shipped — USDT on Ethereum, Polygon, Arbitrum & Plasma + XAU₮ on Ethereum, via the WDK EVM manager |
| Send / receive **BTC** on web | ✅ shipped — pure-JS WDK BTC manager + injected Electrum-WS client, in the worker |
| Self-custodial, keys client-side | ✅ WebCrypto vault + Web Worker signer (ADR-004) |
| Unlock | ✅ WebAuthn passkey (PRF) with a PBKDF2 passphrase fallback (ADR-005) |
| Multi-wallet / multi-account | ✅ N independent BIP-39 seeds, each with HD accounts; zero-migration back-compat |
| QR | ✅ scan a BIP-21/EIP-681 payment URI into the recipient field; render the receive address as a QR |
| Reusable across hosts | ✅ headless core consumed byte-unchanged by a second app (Svelte) |

Beyond the BTC + USD₮ ask, the EVM manager is wired for **four EVM
networks** (Ethereum, Polygon, Arbitrum, Plasma) plus BTC. Solana and
Lightning/Spark are **not** shipped — they are reachable on the same
adapter shape but deliberately left as documented extension points, not
claimed as done.

The one honest operational dependency: a browser cannot open a raw Electrum TCP
socket, so BTC needs a **public Electrum-WS endpoint** to point at (env-driven,
failover via `@tetherto/wdk-failover-provider`). That is a real deployment
input, not a missing feature — see `docs/RN-TO-WEB-MAP.md` →
"Bitcoin on web (shipped)".

## Why this is structured the way it is

This is not "create-next-app + paste the WDK quickstart". It mirrors the
architecture of Tether's own RN starter, which cleanly separates
**platform-agnostic wallet logic** from **platform-specific UI / storage**:

- **`packages/wallet-core`** — a headless, fully-typed, tested WDK wallet engine
  (orchestration, encrypted key vault, chains / failover config, balances, send,
  receive, activity). Zero UI. Zero framework lock-in.
- **`apps/next`** — the reference Next.js app: full screen parity with the RN
  starter (onboarding → wallet-setup → unlock → portfolio → token detail → send
  → receive → activity → settings).
- **`apps/svelte`** (package `svelte-proof`) — a Svelte 5 + Vite app that runs
  the core's state machine against the **byte-unchanged** engine, proving
  `wallet-core` is genuinely framework-agnostic, not Next-coupled. Ships with a
  headless portability test (`test/portability.test.ts`).

The headless core is reusable verbatim for a browser-extension wallet and an
eCommerce checkout (the other two Tether WDK bounties).

## Layout

```
packages/wallet-core/   headless WDK engine (the spine)
apps/next/              reference web wallet (the deliverable)
apps/svelte/            portability proof (Svelte 5 + Vite; pkg svelte-proof)
docs/
  ARCHITECTURE.md       module boundaries, data flow, ADRs
  BOUNTY-CHECKLIST.md   reviewer map for the Tether WDK bounty
  BOUNTY-IMPLEMENTATION-PLAN.md
                        ordered roadmap for future bounty polish agents
  SECURITY.md           threat model & honest limits
  SECURITY-REVIEW.md    structured review: CSP rationale, secrets lifecycle, audit advisory
  RN-TO-WEB-MAP.md      every RN platform API → its web replacement
.github/workflows/ci.yml  lint · typecheck · test · build
```

## Develop

```bash
pnpm install
corepack pnpm verify                      # lint, typecheck, test, build (all 3 packages)
corepack pnpm smoke                       # E2E: create → seed quiz → portfolio → receive a11y → Recovery Check
corepack pnpm demo                        # records docs/demo.gif (one-time: playwright install chromium)
corepack pnpm audit --audit-level moderate  # one accepted low advisory (docs/SECURITY-REVIEW.md §7)
corepack pnpm --filter next dev
```

`corepack pnpm smoke` builds the production app, serves it on a free port, and
drives a real browser through the reviewer walkthrough under the live strict
CSP — a passing run is also proof of zero CSP violations.

CI (`.github/workflows/ci.yml`) runs the same bar on every push and PR —
`lint · typecheck · test · build` across **both** apps on a Node 20 + 22
matrix, plus a committed-secret scan. The same quartet runs locally via
`corepack pnpm verify`; the caveat at the top of `ci.yml` explains why a local green
and a CI green mean the same thing. WDK is alpha; package versions are pinned
(see `docs/ARCHITECTURE.md` → Alpha-churn containment). Never commit `.env*`.

## Status & honest limits

- **Shipped:** onboarding · unlock (passkey / passphrase) · multi-wallet ·
  multi-account · portfolio · receive (+ QR) · send (+ QR scan) · tx-confirm ·
  activity, for **USD₮ on Ethereum / Polygon / Arbitrum / Plasma + XAU₮ on
  Ethereum + BTC**, in `apps/next`; `apps/svelte` runs that same byte-unchanged
  core at full parity (the one delta is passphrase-only unlock) as the
  portability proof. Built in phases.
- **Not shipped (honest):** Solana and Lightning/Spark — same adapter shape,
  left as documented extension points, not claimed as done. Token-detail and
  settings screens are folded into the single page rather than separate routes.
- **BTC operational dependency:** needs a public Electrum-WS endpoint
  (env-driven, failover-capable). Unset → EVM-only (the four EVM networks) and
  a typed error for BTC. Detail in `docs/RN-TO-WEB-MAP.md`.
- **WDK is alpha:** `@tetherto/*` versions are pinned exact and quarantined
  behind `packages/wallet-core/src/wdk/` (ESLint-enforced), so an upstream break
  is one-file localized.
- **Repo is local-only** in the working tree; the public deliverable is a
  scoped mirror.
- **Not for production use with real funds yet.** The web has no exact
  equivalent of the RN starter's BareKit worklet + native Keychain +
  biometrics; we do not pretend it does. The real threat model and the residual
  XSS risk are stated plainly in `docs/SECURITY.md`. Honest limits over false
  parity.
