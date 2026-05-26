# CURRENT — wdk-wallet-web

**Last touched:** 2026-05-26 22:05
**Status:** Phase 0/1/2 done. Phase 3 data layer done (1/2). Phase 3 UI wiring (2/2) next.

## Status
- [x] Deep audit done (findings folded into `docs/BOUNTY-IMPLEMENTATION-PLAN.md`)
- [x] Phase 0: Baseline Integrity — all working-tree work committed in 6 scoped commits + pushed; `origin/main == HEAD`; verify green (76 wallet-core + 13 svelte tests, 223 kB First Load)
- [x] Phase 1: Payment Request QR — Receive Address/Request switch, EIP-681/BIP-21 builders (`paymentRequest.ts`), 14 vitest tests in apps/next, QR+copy. Commit 0be4966.
- [x] Phase 2: Pre-Send Safety Panel — `safety.ts` (classify recipient, poisoning, official-token) + SafetyPanel in confirmation block + `addressExplorerUrl`; 12 tests. Commit 7d0da81.
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
Phase 3 UI wiring (2/2) — data layer ALREADY DONE in commit (contacts.ts v2:
note/favorite/lastUsedAt/createdAt, PaymentTemplate, sanitize+sort+update/touch/
template helpers, validation audit-fix, 6 tests). Remaining = wire UI in page.tsx:
  - Settings → Address Book (grep `settings.contacts` / `contacts_add_title`):
    show favorites first (loadContacts already returns sorted), a note field, last-used,
    a favorite toggle (call `updateContact(addr, chain, {favorite})`), edit, and a
    "save as template" action (`addTemplate`). Keep glass UI compact.
  - Send card (grep `send.contacts` chips ~line 1028): show favorite contacts first;
    add a templates row that prefills recipient + asset (setSendAssetKey) + amount + memo.
  - On successful send call `touchContact(quote.intent.to, quote.intent.asset.chain)`
    in `onConfirmSend` (page.tsx ~line 533, after send resolves) so lastUsedAt updates.
  - Import the new helpers (updateContact, touchContact, loadTemplates, addTemplate,
    removeTemplate, type PaymentTemplate) in page.tsx; add i18n keys.
  - **Fix doc count:** apps/next has 32 tests (NOT 38 — the data-layer commit message
    overstated). Update BOUNTY-CHECKLIST.md "26 unit tests" → correct total after UI tests.
  - `corepack pnpm verify`, commit, push. Then Phase 4.

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
