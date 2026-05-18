# WDK Wallet — Web Starter (Next.js)

A self-custodial, multi-chain wallet **starter template** built on Tether's
[Wallet Development Kit](https://github.com/tetherto/wdk-core). Fills the gap left by
the official [`wdk-starter-react-native`](https://github.com/tetherto/wdk-starter-react-native):
WDK ships starter templates **only for React Native** — this is the production-grade
**web** counterpart.

> Status: Phase 1–2 shipped (onboarding · unlock · portfolio · receive · send ·
> tx-confirm · activity, EVM-only), Phase 3 = the Svelte portability proof +
> CI/docs finalisation. Built in phases (see `../../.planning/BUILD-DECISION.md`).
> EVM-only by an honest alpha-WDK constraint (no BTC-on-web — see
> `docs/RN-TO-WEB-MAP.md`); repo is local-only (no remote); **not for production
> use with real funds yet**. No fake native-parity.

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
- **`apps/svelte`** (package `svelte-proof`) — a thin Svelte 5 + Vite app that
  runs the full Phase-1 state machine against the **byte-unchanged** core,
  proving `wallet-core` is genuinely framework-agnostic, not Next-coupled. Ships
  with a headless portability test (`test/portability.test.ts`).

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
apps/svelte/            portability proof (Svelte 5 + Vite; pkg svelte-proof)
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
pnpm --filter @wdk-web/wallet-core test           # 33 unit tests
pnpm --filter svelte-proof test                   # headless portability proof
pnpm --filter next dev
```

WDK is alpha; package versions are pinned (see `docs/ARCHITECTURE.md` → Alpha-churn
containment). Never commit `.env*`. The repo is **local-only (no git remote)**:
`.github/workflows/ci.yml` is a repo-correct definition never executed by a hosted
runner here, so there is deliberately **no "build passing" badge** — the bar is the
quartet green locally exactly as CI would invoke it (see the caveat at the top of
`ci.yml`).
