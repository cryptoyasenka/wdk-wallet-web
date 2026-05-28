# WDK Wallet Bounty Implementation Plan

> **STATUS — historical roadmap, not a to-do list.** Every phase below (Phases
> 0–6 + the audit follow-ups) is **shipped**. This document is kept for the
> design rationale and the audit trail; it does **not** describe outstanding
> work. For the current, authoritative state of the project read
> [`.planning/CURRENT.md`](../.planning/CURRENT.md) (live working state) and
> [`BOUNTY-CHECKLIST.md`](./BOUNTY-CHECKLIST.md) (what's implemented + how to
> verify it). The wallet is a complete, green baseline; remaining items are
> optional milestone-scope extensions, not gaps.

This plan is written for future agents working in this repository. Follow it in
order unless the user explicitly changes priorities. Preserve the current
premium glass UI; do not replace it with a generic dashboard or landing page.

Current date when this plan was written: 2026-05-26.

## Current Baseline

The wallet already ships:

- Next.js reference wallet with create/import, seed backup quiz, lock/unlock,
  portfolio, receive, send, itemized confirmation, settings, contacts, auto-lock,
  QR receive, QR scan, passkey unlock, multi-wallet, and multi-account.
- Framework-agnostic `@wdk-web/wallet-core`.
- Svelte portability proof.
- WDK BTC/EVM integration through worker/bundler shims.
- Privacy-preserving activity default: local outgoing send log only, optional
  `historyProvider` for indexed history.
- Bounty docs and demo GIF.

Known residual:

- Full `pnpm audit` reports one low upstream advisory in
  `@tetherto/wdk-wallet-btc -> bitcoinjs-message -> secp256k1 -> elliptic`.
  There is no patched range at time of writing. `pnpm audit --audit-level
  moderate` passes.

Always start by running:

```powershell
corepack pnpm verify
corepack pnpm audit --audit-level moderate
```

## Target Outcome

Make the project feel like a polished WDK web payment wallet, not just a starter:

1. Payment requests for USDt/XAUt/BTC.
2. Safer sends with a pre-send safety panel.
3. Address book v2 for repeat payments.
4. Data source and privacy settings.
5. Watch-only portfolio mode.
6. Permanent e2e smoke script and security review docs.

These are selected from open-source wallet research:

- Rabby / Wallet Guard: transaction clarity and pre-sign safety checks.
- Cake Wallet: address book, notes, templates, payment request ergonomics.
- BlueWallet / Sparrow: watch-only and privacy-oriented node configuration.
- MetaMask / Trust Wallet Core: engineering/reviewer posture and docs.

## Non-Negotiables

- Keep design quality. Use the current glass-card, emerald accent, compact
  wallet-tool layout.
- Do not add a marketing landing page.
- Do not hardcode public explorer/indexer history calls into wallet-core.
- Do not expose seed after onboarding. Keep Settings as Recovery Check.
- Do not weaken passphrase unlock while adding passkey-related changes.
- Do not use `localStorage.clear()`.
- Keep changes test-backed where they touch wallet-core or shared behavior.
- Use `apply_patch` for manual file edits.

## Phase 0: Baseline Integrity (do first)

Surfaced by the 2026-05-26 deep audit. The Phase 1-3 work described as "already
ships" above currently lives ONLY in the working tree — uncommitted, unpushed,
saved nowhere. `origin/main == HEAD`, so a reviewer cloning origin sees a STALE
baseline (no bounty docs, pre-Phase-1 UI, "72 tests / 169 kB"). Before any
feature work, make the baseline real.

### Scope

- Commit the working tree in meaningful, scoped commits (core / unlock + passkey
  / Next UI + new libs / Svelte / docs) and push to origin. WIP is acceptable
  per commit, but the baseline must exist in history.
- Reconcile committed doc numbers with reality: test count (72 → 76), Next First
  Load JS (stale "169" → 223 kB), and any past-tense phase framing — so the
  numbers a reviewer reads match what `corepack pnpm build` + test output print.
- Forward commits only. Do NOT `git rebase -i` published history.

### Acceptance Criteria

- `git status` clean; `git log origin/main..HEAD` empty (all pushed).
- README / BOUNTY-CHECKLIST numbers match `corepack pnpm build` + test output.
- `corepack pnpm verify` green on the freshly-committed tree.

## Phase 1: Payment Request QR

Goal: make Receive useful for real payment collection.

### User Flow

In the Receive card, add a mode switch:

- `Address`
- `Request`

Request mode lets the user choose:

- asset/network from configured receive/send assets;
- amount;
- optional memo/reference;
- generated payment URI;
- QR for the payment URI;
- copy button for the URI.

### URI Rules

EVM token request:

- Prefer EIP-681 style:
  `ethereum:<tokenContract>@<chainId>/transfer?address=<recipient>&uint256=<amountMinorUnits>`
- Include memo/reference only as a query parameter when safe and documented.
- If EIP-681 is too risky for current scope, use a clearly documented
  app-local request URI format and label it as a shareable request, not a
  universal wallet deep link.

BTC request:

- Use BIP-21:
  `bitcoin:<address>?amount=<btcDecimal>&message=<encodedMemo>`

### Suggested Files

- `apps/next/app/page.tsx`
- `apps/next/src/lib/paymentRequest.ts` (new)
- `apps/next/src/lib/i18n.ts`
- `apps/svelte/src/App.svelte` if parity is feasible in the same pass
- `apps/svelte/test/*` for pure URI helpers
- `docs/RN-TO-WEB-MAP.md`
- `docs/BOUNTY-CHECKLIST.md`

### Acceptance Criteria

- User can generate a USDt request on each configured EVM network.
- User can generate an XAUt request on Ethereum.
- User can generate a BTC request when BTC address is available.
- QR renders the request URI, not just the raw address.
- Copy button has an accessible name.
- Invalid amount is rejected before URI generation.
- Request mode does not break the existing raw address receive flow.

### Tests

- Unit-test URI builders.
- Browser smoke: create wallet -> receive -> request -> QR/link visible.
- `corepack pnpm verify`

## Phase 2: Pre-Send Safety Panel

Goal: make sends more reviewer-friendly and harder to misuse.

### Add To Confirmation Screen

Before the final send button, show a compact safety panel:

- Official token badge for known USDt/XAUt contracts.
- Network clarity: "Sending USDt on Ethereum", "Sending USDt on Polygon", etc.
- Recipient status:
  - saved contact;
  - new recipient;
  - recently used;
  - own receive address if detected.
- Address poisoning warning:
  - compare first/last 4-6 chars against saved contacts/recent recipients;
  - warn if similar but not exact.
- Gas requirement:
  - token sends need native gas asset;
  - show fee asset already returned by quote.
- Explorer link preview where possible.

### Suggested Files

- `apps/next/app/page.tsx`
- `apps/next/src/lib/safety.ts` (new)
- `apps/next/src/lib/contacts.ts`
- `apps/next/src/lib/i18n.ts`
- `packages/wallet-core/src/chains/index.ts` if official token metadata is not
  already sufficient
- `docs/SECURITY.md`

### Acceptance Criteria

- Confirmation screen clearly distinguishes token amount from network fee.
- Unsaved recipients get a visible but non-blocking warning.
- Similar-address warning appears for likely address poisoning cases.
- Known token contracts show an official badge.
- Warnings are not noisy for saved exact contacts.

### Tests

- Unit-test similarity/safety helpers.
- Browser smoke: saved contact vs unsaved recipient confirmation.
- `corepack pnpm verify`

## Phase 3: Address Book v2

Goal: turn contacts into repeat-payment infrastructure.

### Data Model

Extend contact records:

```ts
interface Contact {
  name: string;
  address: string;
  chain: string;
  note?: string;
  favorite?: boolean;
  lastUsedAt?: number;
  createdAt?: number;
}
```

Add payment templates:

```ts
interface PaymentTemplate {
  id: string;
  name: string;
  contactAddress: string;
  chain: string;
  assetKey: string;
  amount?: string;
  memo?: string;
  createdAt: number;
}
```

Keep backward compatibility with existing contacts in `localStorage`.

### UI

In Settings -> Address Book:

- favorites first;
- note field;
- last used;
- edit contact;
- save template;
- use template from Send.

In Send:

- contacts list should show favorite contacts first;
- templates should fill recipient, asset, amount, memo when available.

### Suggested Files

- `apps/next/src/lib/contacts.ts`
- `apps/next/app/page.tsx`
- `apps/next/src/lib/i18n.ts`
- Optional: `apps/next/src/lib/templates.ts`

### Acceptance Criteria

- Old contacts still load.
- New contacts can include note/favorite.
- Sending to a contact updates `lastUsedAt`.
- Template can prefill send form.
- UI remains compact and visually consistent.
- (Audit 2026-05-26) A corrupt or pre-v2 `localStorage` entry never throws: the
  load helper validates each record's shape and drops malformed ones, instead
  of the current bare `JSON.parse` cast to `Contact[]`.

### Tests

- Unit-test migration/load/save helpers if extracted.
- Browser smoke for add/edit/favorite/template.
- `corepack pnpm verify`

## Phase 4: Data Sources / Privacy Settings

Goal: make privacy and infrastructure choices explicit.

### Settings Section

Add `Data Sources` card:

- EVM RPC URLs input per supported EVM chain or global comma-separated override.
- BTC Electrum WS URL input.
- Optional history/indexer URL or mode toggle:
  - `Local activity only` (default)
  - `Use configured indexer`
- (Audit 2026-05-26) Price oracle (CoinGecko) row. `apps/next/src/lib/prices.ts`
  already fetches `api.coingecko.com` unconditionally on load — an undisclosed
  third-party call that contradicts SECURITY.md's "all data local". Surface it
  here as a real data source: a `Fetch USD prices` toggle (default on) and an
  optional endpoint override, so the privacy posture is honest and opt-out.
- Privacy labels:
  - public RPC can see queried addresses;
  - local-only activity does not fetch inbound/external transfers;
  - the price oracle sees your IP + the (static) asset set, never addresses;
  - custom indexer improves completeness but changes privacy model.
- (Audit 2026-05-26) Resolve the "no hardcoded public fetching" non-negotiable
  against the existing CoinGecko fetch: it stays allowed because it is host-app
  layer (not wallet-core) and address-free, but it must be disclosed + toggleable
  here rather than silent.
- (Audit 2026-05-26) Every endpoint configured in this card (EVM RPC, Electrum
  WS, indexer, CoinGecko, block explorers) is the authoritative `connect-src`
  allowlist for the CSP shipped in Phase 6 — keep the two lists in sync.

### Architecture Constraint

The current engine reads chain options from env at construction. If runtime
settings are added, implement one of:

1. Store settings and require reload/recreate engine after save.
2. Add a controlled engine reset helper in `apps/next/src/lib/engine.ts`.

Do not thread browser localStorage directly into wallet-core.

### Suggested Files

- `apps/next/src/lib/dataSources.ts` (new)
- `apps/next/src/lib/engine.ts`
- `apps/next/app/page.tsx`
- `apps/next/src/lib/i18n.ts`
- `docs/ARCHITECTURE.md`
- `docs/BOUNTY-CHECKLIST.md`

### Acceptance Criteria

- User can see current env/default data-source state.
- User can save custom data-source settings.
- UI explains privacy implications.
- Default remains privacy-preserving and works without custom URLs.
- No hardcoded public history fetching is reintroduced.

### Tests

- Unit-test parse/validate settings.
- Browser smoke for save settings and reload.
- `corepack pnpm verify`

## Phase 5: Watch-Only Mode

Goal: allow read-only monitoring without creating/importing a hot seed.

### Scope

Implement EVM address watch-only first. BTC address watch-only is optional if it
fits cleanly.

### User Flow

On onboarding:

- `Create`
- `Import`
- `Watch`

Watch mode:

- chain selector;
- address input;
- optional label;
- enters read-only portfolio.

Read-only constraints:

- receive address can show watched address;
- portfolio can query balances;
- send is disabled with clear copy: "Watch-only wallets cannot sign";
- no seed backup quiz;
- no passkey enrollment;
- no Recovery Check.

### Core Design Options

Prefer a host-level watch-only mode first:

- Store watched addresses in app-local storage.
- Use wallet-core read-only adapter paths where available.
- Avoid changing seed vault logic unless necessary.

If wallet-core API changes are needed, add explicit methods rather than
overloading seed wallets.

### Suggested Files

- `apps/next/src/lib/watchOnly.ts` (new)
- `apps/next/app/page.tsx`
- `packages/wallet-core/src/types.ts` only if a clean public API is needed
- `packages/wallet-core/test/*` if wallet-core changes
- `docs/ARCHITECTURE.md`

### Acceptance Criteria

- User can add an EVM watch address.
- Watch-only portfolio shows configured supported token balances.
- Send/signing actions are disabled.
- Watch-only state is visually distinct but still beautiful.
- Seed/passkey controls are hidden in watch-only mode.

### Tests

- Unit-test watch-only storage helpers.
- Browser smoke for add watch address and disabled send.
- `corepack pnpm verify`

## Phase 6: Permanent E2E Smoke + Security Review Docs

Goal: make reviewer verification boring and repeatable.

### E2E Script

Add a script that runs the same smoke currently done manually:

- builds wallet-core and Next;
- starts production Next server on an available port;
- creates wallet;
- completes seed quiz;
- checks portfolio;
- checks receive copy button accessible name;
- checks Recovery Check;
- stops server.

Suggested files:

- `tools/e2e/smoke.mjs` (new)
- `package.json` script: `smoke`
- `README.md`
- `docs/BOUNTY-CHECKLIST.md`

### Security Review Doc

Add `docs/SECURITY-REVIEW.md`:

- threat model;
- secrets lifecycle;
- passphrase/passkey design;
- worker boundary;
- data source privacy;
- known residual audit issue;
- verification commands;
- browser support caveats.

### (Audit 2026-05-26) Correct existing SECURITY.md — do NOT only add the new doc

The current `docs/SECURITY.md` makes two claims the code does not back. This is
the most damaging kind of issue for a project whose whole pitch is honesty, so
fix the source doc, not just append a new one:

- Remove / reclassify the **hardware-wallet path** (lines ~37/39/51, listed
  under "What we do"). There is no Ledger/Trezor path — `ledger-bitcoin` is
  stubbed to `false` in both bundlers and the vite config comment states this
  software web wallet never does Ledger signing. Move it to an explicit
  "extension point, not shipped" note or delete it.
- The "strict CSP" mitigation (line ~60) must become true via the CSP below,
  not stay an aspirational claim.

### (Audit 2026-05-26) Ship a real Content-Security-Policy

SECURITY.md names XSS as the #1 residual risk ("if the page is XSS'd, attacker
script can ask the worker to sign") yet no CSP is deployed. A CSP is the single
highest-value hardening for exactly that vector.

- Add response headers via `next.config.mjs` `headers()` (or middleware):
  - `script-src 'self'` (no inline/eval; verify the build needs no `'unsafe-inline'`);
  - `connect-src` = the Phase-4 endpoint allowlist (EVM RPCs, Electrum WS,
    indexer if set, `https://api.coingecko.com`, block explorers) + `'self'`;
  - `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`,
    `img-src 'self' data:`, `style-src 'self' 'unsafe-inline'` (Tailwind),
    `worker-src 'self' blob:` (the crypto worker), `default-src 'self'`.
- Document the policy and each `connect-src` entry's reason in SECURITY-REVIEW.md.

### Acceptance Criteria (added 2026-05-26)

- SECURITY.md contains no claim the code cannot back (no phantom hardware-wallet
  path; "strict CSP" is now real).
- A CSP header is served by the production Next build; the app loads with zero
  CSP violations in the console; `connect-src` matches the configured data sources.

### Acceptance Criteria

- `corepack pnpm smoke` passes locally.
- README lists `verify`, `demo`, `smoke`, and `audit --audit-level moderate`.
- Bounty checklist points reviewers to the exact commands.

### Tests

- `corepack pnpm smoke`
- `corepack pnpm verify`
- `corepack pnpm demo`
- `corepack pnpm audit --audit-level moderate`

## Cross-cutting cleanups (Audit 2026-05-26)

Small, do opportunistically inside the phase that touches the area:

- **`tron` dangling `ChainId`.** `tron` is a member of the `ChainId` union and is
  referenced in `explorer.ts` and root `.env.example` (`TRON_API_KEY`), but is
  in no chain registry, asset, or `buildChainRegistry` branch. Either wire it as
  a real extension point or remove it from the type/env so the "4 EVM + BTC"
  scope claim is exact. (Touch during Phase 4's data-source work.)

## Recommended Execution Order

0. Phase 0: Baseline Integrity (commit + push the working tree) — do first
1. Phase 1: Payment Request QR
2. Phase 2: Pre-Send Safety Panel
3. Phase 3: Address Book v2
4. Phase 4: Data Sources / Privacy Settings
5. Phase 5: Watch-Only Mode
6. Phase 6: E2E Smoke + Security Review Docs + SECURITY.md correction + CSP

Rationale:

- Phases 1 and 2 create the most visible Tether/payment value.
- Phase 3 makes those flows useful for repeat payments.
- Phase 4 supports the privacy-first architecture already in the code.
- Phase 5 is valuable but has the most product-state complexity.
- Phase 6 should be updated throughout, then finalized last.

## Suggested Submission Strategy

The official Tether bounty pages currently show active `Apply for Bounty` forms
and `Date Posted: 24/03/2026` for WDK-related tasks. They do not expose a clear
deadline in the crawled page content. Because today is 2026-05-26, apply as soon
as possible with the current working baseline, then continue these phases as
milestone work.

Relevant listings:

- Template Wallet: 2,000 USDt
- WDK in eCommerce: 3,000 USDt
- Browser Extension Starter: 4,000 USDt

This project currently best matches Template Wallet and WDK in eCommerce. The
Payment Request phase strengthens the eCommerce angle the most.

## Final Verification Checklist

Before declaring the plan complete, run:

```powershell
corepack pnpm verify
corepack pnpm demo
corepack pnpm audit --audit-level moderate
```

If Phase 6 has been implemented, also run:

```powershell
corepack pnpm smoke
```

Manual/browser smoke:

- create wallet;
- complete seed quiz;
- view portfolio;
- generate payment request;
- copy receive/request link;
- add contact/template;
- send review shows safety panel;
- settings privacy/data source UI loads;
- watch-only mode cannot sign;
- lock/unlock still works;
- no console errors.
