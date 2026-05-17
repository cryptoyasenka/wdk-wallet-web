# WDK Wallet — Web Starter (Next.js)

A self-custodial, multi-chain wallet **starter template** built on Tether's
[Wallet Development Kit](https://github.com/tetherto/wdk-core). Fills the gap left by
the official [`wdk-starter-react-native`](https://github.com/tetherto/wdk-starter-react-native):
WDK ships starter templates **only for React Native** — this is the production-grade
**web** counterpart.

> Status: scaffold. Built in phases (see `../../.planning/BUILD-DECISION.md`).
> Not for production use with real funds yet.

## Why this is structured the way it is

This is not "create-next-app + paste the WDK quickstart". It mirrors the architecture
of Tether's own RN starter, which cleanly separates **platform-agnostic wallet logic**
from **platform-specific UI/storage**:

- **`packages/wallet-core`** — a headless, fully-typed, tested WDK wallet engine
  (orchestration, encrypted key vault, chains/failover config, balances, send,
  receive, activity). Zero UI. Zero framework lock-in.
- **`apps/next`** — the reference Next.js app: full screen parity with the RN starter
  (onboarding → wallet-setup → unlock → portfolio → token detail → send → receive →
  activity → settings).
- **`apps/svelte-proof`** — a deliberately minimal Svelte app whose only job is to
  prove `wallet-core` is genuinely framework-agnostic, not Next-coupled.

The headless core is reusable verbatim for a browser-extension wallet and an
eCommerce checkout (the other two Tether WDK bounties).

## Security posture (read `docs/SECURITY.md`)

The RN starter isolates crypto in a BareKit worklet + native Keychain + biometrics.
The web has **no exact equivalent**. We do not pretend it does. We document the real
threat model, isolate crypto in a Web Worker for defense-in-depth, gate unlock with
WebAuthn/passkeys, offer an optional hardware-wallet path, and state the residual XSS
risk plainly. Honest limits over false parity.

## Layout

```
packages/wallet-core/   headless WDK engine (the spine)
apps/next/              reference web wallet (the deliverable)
apps/svelte-proof/      portability proof
docs/
  ARCHITECTURE.md       module boundaries & data flow
  SECURITY.md           threat model & honest limits
  RN-TO-WEB-MAP.md      every RN platform API → its web replacement
.github/workflows/ci.yml  lint · typecheck · test · build
```

## Develop

```bash
pnpm install
cp apps/next/.env.example apps/next/.env.local   # fill WDK Indexer keys
pnpm --filter wallet-core test
pnpm --filter next dev
```

WDK is alpha; package versions are pinned (see `docs/ARCHITECTURE.md` → Alpha-churn
containment). Never commit `.env*`.
