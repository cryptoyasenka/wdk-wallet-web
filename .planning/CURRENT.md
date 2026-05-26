# CURRENT — wdk-wallet-web

**Last touched:** 2026-05-26 21:40
**Status:** Phase 0 done (baseline committed + pushed). Implementing full BOUNTY-IMPLEMENTATION-PLAN next.

## Status
- [x] Deep audit done (findings folded into `docs/BOUNTY-IMPLEMENTATION-PLAN.md`)
- [x] Phase 0: Baseline Integrity — all working-tree work committed in 6 scoped commits + pushed; `origin/main == HEAD`; verify green (76 wallet-core + 13 svelte tests, 223 kB First Load)
- [ ] Phase 1: Payment Request QR
- [ ] Phase 2: Pre-Send Safety Panel
- [ ] Phase 3: Address Book v2 (+ audit: validate contacts shape on load)
- [ ] Phase 4: Data Sources / Privacy Settings (+ audit: disclose/toggle CoinGecko; resolve `tron` dangling ChainId; this card's endpoints = CSP connect-src list)
- [ ] Phase 5: Watch-Only Mode
- [ ] Phase 6: E2E Smoke + SECURITY-REVIEW.md + **correct SECURITY.md** + **ship real CSP**

## Plan source of truth
`docs/BOUNTY-IMPLEMENTATION-PLAN.md` — read it fully before starting. Audit
blind-zones are marked "(Audit 2026-05-26)" inside the relevant phases + a new
"## Phase 0" + "## Cross-cutting cleanups" section. Do NOT remove existing
fixes — Yana wants a very strong product, so implement the WHOLE plan.

## Next step
Start Phase 1 (Payment Request QR). New file `apps/next/src/lib/paymentRequest.ts`
(EIP-681 for EVM tokens, BIP-21 for BTC), add Address/Request mode switch to the
Receive card in `apps/next/app/page.tsx`, unit-test the URI builders (Svelte
side has the test harness: `apps/svelte/test/*`). Run `corepack pnpm verify`
after. Commit per phase (Yana's autocommit rule — power-outage zone).

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
