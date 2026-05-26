# CURRENT — wdk-wallet-web

**Last touched:** 2026-05-27 01:05
**Status:** Phase 0/1/2/3/4/5 done + pushed. Phase 6 (E2E smoke + SECURITY docs + real CSP) next.

## Status
- [x] Deep audit done (findings folded into `docs/BOUNTY-IMPLEMENTATION-PLAN.md`)
- [x] Phase 0: Baseline Integrity — all working-tree work committed in 6 scoped commits + pushed; `origin/main == HEAD`; verify green (76 wallet-core + 13 svelte tests, 223 kB First Load)
- [x] Phase 1: Payment Request QR — Receive Address/Request switch, EIP-681/BIP-21 builders (`paymentRequest.ts`), 14 vitest tests in apps/next, QR+copy. Commit 0be4966.
- [x] Phase 2: Pre-Send Safety Panel — `safety.ts` (classify recipient, poisoning, official-token) + SafetyPanel in confirmation block + `addressExplorerUrl`; 12 tests. Commit 7d0da81.
- [x] Phase 3: Address Book v2 — note/favorite/last-used, edit, save-as-template, Send templates row; load hardening. Commits d7a3c75 (data) + 7c2aa30 (UI). 32 apps/next tests.
- [x] Phase 4: Data Sources / Privacy Settings — dataSources.ts module + 12 tests, engine layering (persisted>env>defaults), CoinGecko gated+disclosed, `tron` ChainId removed everywhere, Settings card w/ 4 privacy labels. Commits 2810a37/15dea6f/283a7a1/3455308. 44 apps/next tests.
- [x] Phase 5: Watch-Only Mode — seedless `getBalancesForAddress` in wallet-core (+3 tests), `watchOnly.ts` host module (+15 tests), onboarding Watch tab + read-only portfolio + disabled-send notice + receive. wallet-core 79 / apps/next 59 tests. Commits: core (1/2), module (2/2a), UI (2/2b).
- [ ] Phase 6: E2E Smoke + SECURITY-REVIEW.md + **correct SECURITY.md** + **ship real CSP**

## Plan source of truth
`docs/BOUNTY-IMPLEMENTATION-PLAN.md` — read it fully before starting. Audit
blind-zones are marked "(Audit 2026-05-26)" inside the relevant phases + a new
"## Phase 0" + "## Cross-cutting cleanups" section. Do NOT remove existing
fixes — Yana wants a very strong product, so implement the WHOLE plan.

## Next step
Phase 6 — E2E smoke + security docs + real CSP (plan §407-491). Order:
  1. `docs/SECURITY.md` correction: remove/reclassify the phantom hardware-wallet
     path (lines ~37/39/51 — `ledger-bitcoin` is stubbed false in both bundlers);
     stop claiming "strict CSP" until the CSP below actually ships.
  2. Ship real CSP via `apps/next/next.config.mjs` `headers()`: script-src 'self';
     connect-src = connectSrcOrigins() (from dataSources.ts) UNIONED with the public
     RPC default origins + https://api.coingecko.com + 'self'; object-src 'none';
     base-uri 'self'; frame-ancestors 'none'; img-src 'self' data:; style-src 'self'
     'unsafe-inline'; worker-src 'self' blob:; default-src 'self'. NOTE: only
     ETHEREUM_PUBLIC_RPCS is exported from wallet-core — the polygon/arbitrum/plasma
     public RPC origins are NOT exported; either widen wallet-core exports or hardcode
     the known default origins in next.config (cross-check buildChainRegistry source).
  3. `docs/SECURITY-REVIEW.md`: threat model, secrets lifecycle, passphrase/passkey,
     worker boundary, data-source privacy, CSP rationale (each connect-src entry),
     residual audit issue, verification commands, browser caveats.
  4. `tools/e2e/smoke.mjs` + `smoke` script in root package.json: build, start prod
     Next on a free port, create wallet, seed quiz, portfolio, receive copy a11y name,
     Recovery Check, stop. Update README (verify/demo/smoke/audit) + BOUNTY-CHECKLIST.
  5. `corepack pnpm verify` GREEN (+ smoke if feasible on Windows) → commit → push.

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
