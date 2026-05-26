# CURRENT — wdk-wallet-web

**Last touched:** 2026-05-26 23:45
**Status:** Phase 0/1/2/3 done. Phase 4: tron cleanup + dataSources module done (1/2). Engine/prices/page wiring next (2/2).

## Status
- [x] Deep audit done (findings folded into `docs/BOUNTY-IMPLEMENTATION-PLAN.md`)
- [x] Phase 0: Baseline Integrity — all working-tree work committed in 6 scoped commits + pushed; `origin/main == HEAD`; verify green (76 wallet-core + 13 svelte tests, 223 kB First Load)
- [x] Phase 1: Payment Request QR — Receive Address/Request switch, EIP-681/BIP-21 builders (`paymentRequest.ts`), 14 vitest tests in apps/next, QR+copy. Commit 0be4966.
- [x] Phase 2: Pre-Send Safety Panel — `safety.ts` (classify recipient, poisoning, official-token) + SafetyPanel in confirmation block + `addressExplorerUrl`; 12 tests. Commit 7d0da81.
- [x] Phase 3: Address Book v2 — note/favorite/last-used, edit, save-as-template, Send templates row; load hardening. Commits d7a3c75 (data) + 7c2aa30 (UI). 32 apps/next tests.
- [ ] Phase 4: Data Sources / Privacy Settings (+ audit: disclose/toggle CoinGecko; resolve `tron` dangling ChainId; this card's endpoints = CSP connect-src list)
- [ ] Phase 5: Watch-Only Mode
- [ ] Phase 6: E2E Smoke + SECURITY-REVIEW.md + **correct SECURITY.md** + **ship real CSP**

## Plan source of truth
`docs/BOUNTY-IMPLEMENTATION-PLAN.md` — read it fully before starting. Audit
blind-zones are marked "(Audit 2026-05-26)" inside the relevant phases + a new
"## Phase 0" + "## Cross-cutting cleanups" section. Do NOT remove existing
fixes — Yana wants a very strong product, so implement the WHOLE plan.

## Next step
Phase 4 (2/2) — wire the dataSources module into the app:
  - `engine.ts`: in chainOptionsFromEnv (rename → chainOptions), layer persisted
    overrides from loadDataSources() OVER env OVER public defaults; wire all four
    EVM rpc lists (ethereum/polygon/arbitrum/plasma) + btcElectrumWsUrl
    (buildChainRegistry already accepts polygon/arbitrum/plasmaRpcUrls). Add
    `resetWalletApp()` nulling the `app` singleton so a settings save rebuilds it.
  - `prices.ts`: gate fetchPrices + fetchSparkline on arePricesEnabled(); use
    priceBase() instead of the hardcoded host. Return {}/[] immediately when off
    (NO silent fetch).
  - `page.tsx`: add a "Data Sources" Card in settings (near Address Book ~1474):
    inputs for the 4 RPC lists, electrum-ws, indexer mode+url, price toggle+endpoint;
    privacy labels (public RPC sees queried addresses; local-only = no inbound fetch;
    price oracle sees IP+static asset set, never addresses; custom indexer changes
    privacy model). On save → saveDataSources + resetWalletApp + toast + reload view.
    Add i18n keys (EN+RU). Update BOUNTY-CHECKLIST (+row, test count 44).
  - `corepack pnpm verify` GREEN → commit → push. Then Phase 5.

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
