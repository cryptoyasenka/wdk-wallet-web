# Architecture

## Principle

The RN starter already separates platform-agnostic logic (`services/`, `config/`,
`utils/`, WDK provider) from platform-specific code (UI, native storage, biometrics).
This repo makes that boundary a **hard package boundary**: `wallet-core` cannot import
a framework; apps cannot import WDK directly.

```
apps/next  ─┐
apps/svelte ┼─► @wdk-web/wallet-core ─► WDK adapter ─► @tetherto/wdk + wallet-*
            ┘        (headless)          (1 file)
```

## packages/wallet-core (the spine)

Headless, framework-free, fully typed, unit-tested. Public surface in `src/types.ts`.
Submodules:

- `wdk/` — **the only place that imports `@tetherto/*`**. Wraps WDK behind our own
  interface so an alpha breaking change touches one module ("alpha-churn
  containment"). All version pins live in `packages/wallet-core/package.json`.
- `secrets/` — WebCrypto AES-GCM vault; key from WebAuthn or passphrase; ciphertext
  to an injected `StorageAdapter` (IndexedDB in apps, in-memory in tests).
- `chains/` — networks, assets, RPC + `@tetherto/wdk-failover-provider` config.
  Ported as-is from the RN starter's `config/`.
- `wallet/` — create/import/derive, balances, send, receive, activity. Pure logic;
  takes a `CryptoWorker` and a `StorageAdapter` by injection (testable, no DOM).

## apps/next (the deliverable)

Next.js App Router. Screen parity with the RN starter. `src/lib/` provides the web
implementations injected into `wallet-core`: `IndexedDbStorage`, `WebCryptoWorker`
(Web Worker), `WebAuthnUnlock`, `getUserMedia` QR. UI = Tailwind + shadcn. **No
`@tetherto/*` import anywhere under `apps/`.**

## apps/svelte-proof (portability proof)

One screen (create wallet → show address → balance) wired to the same `wallet-core`
with the same injected adapters. Exists solely to prove the core is not Next-coupled.
First thing cut under time pressure; not required for bounty acceptance.

## Alpha-churn containment

WDK is alpha. Rule: `import` from `@tetherto/*` is allowed **only** in
`packages/wallet-core/src/wdk/`. Enforced by an ESLint `no-restricted-imports` rule
in CI. Versions pinned exactly (no `^`), upgraded deliberately with a changelog note.

## Build / polyfills

Browser needs `crypto`/`buffer`/`stream` polyfills for WDK. Configured once in
`apps/next/next.config.mjs` (and the Svelte/Vite equivalent), documented, not
scattered.

## Phasing (each phase independently submittable)

- **P1** wallet-core (wdk+secrets+chains+wallet create/import/balance/receive) +
  Next.js onboarding/unlock/portfolio/receive. Irreducible "real wallet".
- **P2** send + activity + WebAuthn unlock + tx confirmation UI + e2e send test.
- **P3** svelte-proof + full test/CI matrix + polish + docs finalisation.
