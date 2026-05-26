# CURRENT — wdk-wallet-web

**Last touched:** 2026-05-26 21:52
**Status:** Phase 0 + Phase 1 done (committed + pushed). Phase 2 (Pre-Send Safety Panel) next.

## Status
- [x] Deep audit done (findings folded into `docs/BOUNTY-IMPLEMENTATION-PLAN.md`)
- [x] Phase 0: Baseline Integrity — all working-tree work committed in 6 scoped commits + pushed; `origin/main == HEAD`; verify green (76 wallet-core + 13 svelte tests, 223 kB First Load)
- [x] Phase 1: Payment Request QR — Receive Address/Request switch, EIP-681/BIP-21 builders (`paymentRequest.ts`), 14 vitest tests in apps/next, QR+copy. Commit 0be4966.
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
Phase 2 — Pre-Send Safety Panel (plan lines 153-198). On the send CONFIRMATION
screen (after "Review transaction" builds `quote`, before "Confirm & send"), add
a compact safety panel:
  - Official token badge for known USDt/XAUt contracts (compare quote asset.token
    against `chains/index.ts` DEFAULT_ASSETS contracts).
  - Network clarity line: "Sending <SYMBOL> on <chain>".
  - Recipient status: saved contact / new recipient / recently used / own receive
    address (compare `sendTo` against `contacts` + `addresses`).
  - Address-poisoning warning: first/last 4-6 chars match a known contact/recent
    but full address differs → visible non-blocking warn.
  - Gas/fee clarity: token sends pay gas in native asset — surface `quote.fee.feeAsset`
    distinctly from the token amount (confirmation already shows fee; make the
    token-vs-fee distinction explicit).
  - Explorer link preview for the recipient where possible (`explorerUrl`).
New pure helper `apps/next/src/lib/safety.ts` (similarity + classification) +
vitest. Files: page.tsx confirmation block, safety.ts, contacts.ts, i18n.ts,
maybe chains/index.ts metadata, SECURITY.md. Then `corepack pnpm verify`, commit, push.
Find confirmation block: grep `send.confirm_btn` / `quote &&` in page.tsx (~line 1044+).

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
