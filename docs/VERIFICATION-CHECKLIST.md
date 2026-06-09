# Verification Checklist

This file maps the Template Wallet brief to what is implemented today, where it
lives in the repo, and how to verify it.

## Current local bar

```bash
corepack pnpm install
corepack pnpm verify
corepack pnpm smoke
corepack pnpm demo
corepack pnpm audit --audit-level moderate
```

Current checked state:

- `lint`, `typecheck`, `test`, and `build` pass across `wallet-core`,
  `apps/next`, and `apps/svelte`.
- `wallet-core`: 95 unit tests.
- `apps/next`: 139 unit tests.
- `apps/svelte`: 19 portability tests.
- Total test count: **253**.
- Next First Load JS: about **240 kB**. The WDK/BTC graph stays in the worker
  chunk, not the main first-load path.
- `corepack pnpm demo` records `docs/demo.gif` against the production Next
  build and the offline Electrum-WS fixture.
- `corepack pnpm smoke` builds and serves the production app and drives a real
  browser through the main reviewer path under the live strict CSP.
- `corepack pnpm audit --audit-level moderate` passes with one accepted
  upstream `low`.

## Submission scope

This repo should currently be read as **M1 delivered** and **M2 delivered for
the core web template**. It does **not** claim M3 completion yet.

| Milestone | Status | Notes |
|---|---|---|
| M1: Proposal & Architecture Review | Delivered | Framework choice, architecture, security notes, and integration guidance are public in the repo. |
| M2: Core Integration & Wallet Flows | Delivered for the core web template | WDK integration, onboarding, balances, send / receive, multi-wallet, multi-account, QR flows, and status monitoring are runnable today. |
| M3: Final Delivery | Next milestone | Spark / Lightning, official Indexer API alignment for external history, the upstream PR into Tether's templates/examples area, and the expanded 2-5 minute reviewer demo package remain open. |

## Brief mapping

| Brief item | Current status | Proof / notes |
|---|---|---|
| Web wallet built on Tether WDK | Shipped | `packages/wallet-core/src/wdk/` is the only WDK containment layer; lint prevents `@tetherto/*` imports elsewhere. |
| Self-custodial keys | Shipped | AES-GCM vault, worker-owned signer, documented in `docs/SECURITY.md` and `docs/ARCHITECTURE.md`; covered by `packages/wallet-core/test/vault.test.ts`. |
| Seed generation, recovery, validation | Shipped | Create, import, backup quiz, recovery check, and unlock flows are present in `apps/next/app/page.tsx` and covered by unit tests plus `corepack pnpm smoke`. |
| Multiple wallets per user | Shipped | `packages/wallet-core/test/multi-wallet.test.ts`. |
| Multiple accounts within each wallet | Shipped | `packages/wallet-core/test/multi-account.test.ts`. |
| BTC, USDt, XAUt support | Shipped | Asset configuration in `packages/wallet-core/src/chains/index.ts`; send / quote coverage in `packages/wallet-core/test/engine.test.ts`. |
| Bitcoin, Ethereum, Polygon, Arbitrum, Plasma, Solana | Shipped | Working chain registry in `packages/wallet-core/src/chains/index.ts`; Next app surfaces these in portfolio, send, and receive. |
| Lightning / Spark | Next milestone | Not shipped in this repo. Left as a documented extension path and not claimed as done. |
| Onboarding, balances, send / receive | Shipped | Live demo, `apps/next/app/page.tsx`, `corepack pnpm smoke`, and the engine tests. |
| Recipient entry by typing, paste, or QR scan | Shipped | Send flow in `apps/next/app/page.tsx`, QR parsing tests in `apps/next/test/qrScan.test.ts` and related receive/send tests. |
| Automatic address validation | Shipped | Recipient validation in `apps/next/test/recipientValidation.test.ts` and send logic in `apps/next/app/page.tsx`. |
| Transaction status monitoring | Shipped | Local activity plus on-chain receipt refresh in `packages/wallet-core/src/wallet/engine.ts` and engine tests. |
| Transaction history with filtering | Partial today, next milestone for the full brief | Local outgoing activity ships by default. External/public history is provider-injected today; official Indexer API alignment and fuller external-history coverage are planned next. |
| Indexer API integration | Partial today, next milestone for the official path | History is host-injected through `apps/next/src/lib/historyProvider.ts` and wired in `apps/next/src/lib/engine.ts`. Official Tether Indexer API alignment is not claimed as complete yet. |
| Worklet as secure execution layer | Web platform mapping, documented honestly | The secure execution layer on web is a Dedicated Web Worker. See `docs/RN-TO-WEB-MAP.md` and `docs/SECURITY.md` for the exact mapping and the stated limits. |
| Documentation: setup, architecture, framework-specific notes | Shipped | `README.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/RN-TO-WEB-MAP.md`, `docs/PROJECT-SUMMARY.md`, `docs/REVIEW.md`. |
| Demo video | Shipped in short form, expanded package next | `docs/walkthrough.mp4` covers the current product flow. The longer 2-5 minute final reviewer package is a next-milestone item. |
| Upstream PR into Tether templates/examples | Next milestone | Not yet part of this repo snapshot. Planned as the final-delivery step after the remaining template-alignment work. |

## Reviewer demo path

1. Open the live demo or run `apps/next`.
2. Create a wallet and set a passphrase.
3. Back up the seed phrase and pass the seed quiz.
4. Unlock and inspect portfolio, receive, QR, send confirmation, and activity.
5. Optionally open the Svelte app to show the same core outside Next.js.

## Known honest limits

- The browser cannot open raw Electrum TCP, so BTC requires an
  Electrum-over-WebSocket endpoint.
- A Web Worker reduces accidental key exposure but cannot stop a compromised
  main thread from requesting signatures.
- Inbound and external transaction history is not silently fetched by default,
  because that leaks addresses to public indexers.
- The `@tetherto/*` packages are pinned to exact pre-1.0 betas on purpose. The
  containment seam in `packages/wallet-core/src/wdk/` exists so future WDK
  upgrades stay isolated and separately verifiable.
