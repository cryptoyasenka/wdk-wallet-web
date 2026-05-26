# CURRENT — wdk-wallet-web

**Last touched:** 2026-05-27 00:25
**Status:** Phase 0/1/2/3/4 done + pushed (HEAD 3455308). Phase 5 (Watch-Only Mode) in progress.

## Status
- [x] Deep audit done (findings folded into `docs/BOUNTY-IMPLEMENTATION-PLAN.md`)
- [x] Phase 0: Baseline Integrity — all working-tree work committed in 6 scoped commits + pushed; `origin/main == HEAD`; verify green (76 wallet-core + 13 svelte tests, 223 kB First Load)
- [x] Phase 1: Payment Request QR — Receive Address/Request switch, EIP-681/BIP-21 builders (`paymentRequest.ts`), 14 vitest tests in apps/next, QR+copy. Commit 0be4966.
- [x] Phase 2: Pre-Send Safety Panel — `safety.ts` (classify recipient, poisoning, official-token) + SafetyPanel in confirmation block + `addressExplorerUrl`; 12 tests. Commit 7d0da81.
- [x] Phase 3: Address Book v2 — note/favorite/last-used, edit, save-as-template, Send templates row; load hardening. Commits d7a3c75 (data) + 7c2aa30 (UI). 32 apps/next tests.
- [x] Phase 4: Data Sources / Privacy Settings — dataSources.ts module + 12 tests, engine layering (persisted>env>defaults), CoinGecko gated+disclosed, `tron` ChainId removed everywhere, Settings card w/ 4 privacy labels. Commits 2810a37/15dea6f/283a7a1/3455308. 44 apps/next tests.
- [ ] Phase 5: Watch-Only Mode
- [ ] Phase 6: E2E Smoke + SECURITY-REVIEW.md + **correct SECURITY.md** + **ship real CSP**

## Plan source of truth
`docs/BOUNTY-IMPLEMENTATION-PLAN.md` — read it fully before starting. Audit
blind-zones are marked "(Audit 2026-05-26)" inside the relevant phases + a new
"## Phase 0" + "## Cross-cutting cleanups" section. Do NOT remove existing
fixes — Yana wants a very strong product, so implement the WHOLE plan.

## Next step
Phase 5 — Watch-Only Mode (plan §341-405). Host-level first, avoid touching seed vault:
  - NEW `apps/next/src/lib/watchOnly.ts`: pure module. Type WatchedWallet
    { id, chain: ChainId, address, label?, createdAt }. localStorage key
    `wdk-watch-wallets`. Helpers: sanitize/load/save/add/remove, isValidEvmAddress.
    Unit-test it (target ~10 tests; pure, imports only types from wallet-core).
  - `page.tsx`: onboarding gets a 3rd path "Watch" (Create/Import/Watch). Watch flow:
    chain selector + address input + optional label → read-only portfolio.
    Read-only constraints: send disabled w/ copy "Watch-only wallets cannot sign";
    NO seed quiz / passkey enrollment / Recovery Check; receive can show watched addr;
    portfolio queries balances. Visually distinct badge but still glass-beautiful.
  - i18n keys EN+RU (watch.*). Update BOUNTY-CHECKLIST (+row, test count).
  - `corepack pnpm verify` GREEN → commit → push. Then Phase 6.

Decide before coding: does wallet-core expose a read-only balance path that works
without a seed/signer? Check engine API — if balances need a wallet instance, the
host watch-only mode may query the chain registry / RPC directly for balances, or
add a minimal explicit wallet-core read-only method (plan §382 allows explicit
methods, NOT overloading seed wallets). Read engine.test.ts + wallet/engine.ts first.

## Remaining after Phase 3
- Phase 4: Data Sources/Privacy Settings (+ disclose/toggle CoinGecko in `prices.ts`;
  resolve `tron` dangling ChainId — now also in `explorer.ts` EXPLORERS map; endpoints = CSP connect-src list).
- Phase 5: Watch-Only Mode (EVM address watch, disabled signing).
- Phase 6: E2E smoke (`tools/e2e/smoke.mjs` + `smoke` script) + SECURITY-REVIEW.md
  + CORRECT SECURITY.md (remove phantom hardware-wallet path; make "strict CSP" real)
  + SHIP real CSP header via `next.config.mjs headers()`.

## Decisions / constraints
- Honesty is the product's whole pitch — fixing SECURITY.md's false claims
  (phantom hardware-wallet path; "strict CSP" with no CSP deployed) is as
  important as any feature. Both live in Phase 6.
- Non-negotiables (from plan): keep glass UI, no landing page, no hardcoded
  public history fetch in wallet-core, no seed re-exposure, don't weaken
  passphrase unlock, no `localStorage.clear()`, test-backed core changes.
- No Claude/AI traces in commits/PRs/docs; Yana = sole author.
- CoinGecko fetch (`prices.ts`) is allowed (host layer, address-free) but must
  be disclosed + toggleable in Phase 4 and listed in CSP connect-src.

## Audit verdict recap (already in chat)
Crypto core strong (PBKDF2-600k / HKDF-for-PRF / non-extractable keys / real
Web Worker seed isolation / ESLint WDK containment). Green lint+typecheck+build.
Top gaps were: uncommitted baseline (FIXED), no CSP, false SECURITY.md claims,
undisclosed CoinGecko, `tron` dangling — all now tracked in the plan.
