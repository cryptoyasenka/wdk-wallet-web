# CURRENT — wdk-wallet-web

**Last touched:** 2026-05-27 (independent re-audit fixes — 2 of 3 done)
**Status:** LIVE on Railway + /cso clean. Now fixing 3 independent-audit findings. Findings 3 (watch-only label clear) + 1 (indexer historyProvider wiring) DONE & green & committed (40d4795, eb7fe41). Finding 2 (CSP vs Data Sources fork) = ASKING Yana which resolution. URL: https://wdk-wallet-web-production.up.railway.app. Green: next 74 tests (was 63, +2 watch +9 indexer), typecheck+lint clean.

## Independent re-audit fixes (2026-05-27)
- [x] Finding 3 [P3] — watch-only label could not be cleared back to unnamed. `watchOnly.ts addWatchWallet` now distinguishes explicit blank set (clears) from omitted (keeps); page.tsx onStartWatch passes label unconditionally. +2 tests (17 watchOnly). Commit 40d4795.
- [x] Finding 1 [P1] — Data Sources indexer was dead (persisted but never wired). New `historyProvider.ts` HTTP client + injected into createWalletEngine when indexerMode=indexer && indexerUrl. Hardened untrusted JSON, [] on any failure → core falls back to local log. +9 tests. Commit eb7fe41.
- [ ] Finding 2 [P1] — runtime custom RPC/price/indexer origins are user settings but the static per-request-nonce CSP (middleware.ts) blocks any origin not hardcoded. middleware (Edge) can't read localStorage. FORK: (A) make it work end-to-end via a cookie middleware reads + unions into connect-src (delivers feature, slight XSS-widens-CSP residual); (B) keep strict CSP, dedupe RPC allowlist into ONE shared module both middleware+UI import, validate custom origins in UI + warn when CSP will block, narrow http:→https:. ASKING Yana. Leaning B (keeps the security pitch; honest-limits philosophy). Auditor extra note: dataSources.ts:81 HTTP_SCHEMES allows http: — narrow to https except dev.

## Status
- [x] Deep audit done (findings folded into `docs/BOUNTY-IMPLEMENTATION-PLAN.md`)
- [x] Phase 0: Baseline Integrity — all working-tree work committed in 6 scoped commits + pushed; `origin/main == HEAD`; verify green (76 wallet-core + 13 svelte tests, 223 kB First Load)
- [x] Phase 1: Payment Request QR — Receive Address/Request switch, EIP-681/BIP-21 builders (`paymentRequest.ts`), 14 vitest tests in apps/next, QR+copy. Commit 0be4966.
- [x] Phase 2: Pre-Send Safety Panel — `safety.ts` (classify recipient, poisoning, official-token) + SafetyPanel in confirmation block + `addressExplorerUrl`; 12 tests. Commit 7d0da81.
- [x] Phase 3: Address Book v2 — note/favorite/last-used, edit, save-as-template, Send templates row; load hardening. Commits d7a3c75 (data) + 7c2aa30 (UI). 32 apps/next tests.
- [x] Phase 4: Data Sources / Privacy Settings — dataSources.ts module + 12 tests, engine layering (persisted>env>defaults), CoinGecko gated+disclosed, `tron` ChainId removed everywhere, Settings card w/ 4 privacy labels. Commits 2810a37/15dea6f/283a7a1/3455308. 44 apps/next tests.
- [x] Phase 5: Watch-Only Mode — seedless `getBalancesForAddress` in wallet-core (+3 tests), `watchOnly.ts` host module (+15 tests), onboarding Watch tab + read-only portfolio + disabled-send notice + receive. wallet-core 79 / apps/next 59 tests. Commits: core (1/2), module (2/2a), UI (2/2b).
- [x] Phase 6: nonce CSP (middleware.ts) + smoke.mjs + SECURITY-REVIEW.md + corrected SECURITY.md. Commits 1653c59/00be987/0e0e248. Cross-cutting `tron` cleanup confirmed done (absent from ChainId union, test asserts it).

## Plan source of truth
`docs/BOUNTY-IMPLEMENTATION-PLAN.md` — read it fully before starting. Audit
blind-zones are marked "(Audit 2026-05-26)" inside the relevant phases + a new
"## Phase 0" + "## Cross-cutting cleanups" section. Do NOT remove existing
fixes — Yana wants a very strong product, so implement the WHOLE plan.

## Cold review findings 2026-05-27 (3 fresh-context adversarial subagents)
Subagents VERIFIED core crypto is genuinely correct + honestly documented: PBKDF2-600k, HKDF-SHA256, AES-GCM-256, non-extractable keys, fresh salt/IV, worker spawn (adapter.ts:21), nonce CSP (all 11 directives match docs byte-for-byte), tron fully purged. sodium_memzero is REAL (not no-op). No faked crypto, no predictable nonces.

Fixes to apply (priority order):
- [x] [P0] safety.ts isOfficialToken was chain-blind → official-Tether badge spoofable across chains. FIXED: officialTokenContracts keys by `chain:token`; isOfficialToken checks `asset.chain:token`. + detectPoisoning now includes ownAddresses (was missing send-to-self trap). + regression test. NOT yet committed/verified.
- [x] [P1] contacts.ts:123/129/138 — case-SENSITIVE dedupe/match, desyncs from case-insensitive classifier; breaks touchContact + recent-sort. FIXED: normalize EVM addr lowercase in add/remove/update/touch (BTC case-sensitive). Commit b5f12cd.
- [x] [P1] paymentRequest.ts — recipient addr emitted verbatim, no validation. FIXED: assertValidRecipient + InvalidAddressError, runs before URI build; EVM 0x+40hex, BTC delimiter-free. +3 tests (17). Commit 0d0a396.
- [x] [P2] engine.ts getBalancesForAddress — no addr validation in core (only UI). FIXED: isWellFormedAddress + core InvalidAddressError, validates every in-scope chain BEFORE building reader. +1 test (80). Commit 191c3d1. (NOTE: hit a 1-byte NUL corruption in engine.ts mid-edit; found via python byte-scan, fixed, all committed blobs verified 0 nulls.)
- [x] [DOC] DONE. README.md drop "ETH" from send/receive (both line 11 + line 29: "ETH only as the gas token"). next.config.mjs:39 stripped unused fullscreen=(self)→fullscreen=() (verified unused in app; aligns w/ honest "only camera" prose, no test asserts it). SECURITY-REVIEW.md:115 NEXT_PUBLIC_*→NEXT_PUBLIC_ETHEREUM_RPC_URLS (only var middleware.ts:53 folds into connect-src). §2 added unzeroable-seed-string caveat (buffers memzero'd, phrase=immutable string → drop-for-GC, matches wdk-core dispose). §6 added "apps/svelte ships WITHOUT CSP/headers" scope note. ARCHITECTURE.md 76→80 (line 351), 223→232 kB (lines 61/179/290). BOUNTY-CHECKLIST 79→80 / 59→63 / 228→232. RN-TO-WEB-MAP 223→232. Authoritative from fresh verify: 80 wallet-core + 63 next + 13 svelte tests, 232 kB First Load. Commit pending.
- [x] [P1 verify] unlock.ts passphrase lingered for module-singleton lifetime. VERIFIED real: resetSecrets() cleared only LOCAL passphrase, not the provider's #passphrase. FIXED: resetSecrets() now also calls getWalletApp().setPassphrase("") in BOTH apps (next page.tsx:576, svelte App.svelte:263). Could NOT clear inside provider.unlock() — create/import call unlock() internally via persistSeed, and flows do a 2nd unlock relying on persistence. verify green, 232 kB First Load. Commit pending.
- [x] [P1 verify] wdk-core.ts:105-110 #seedPhrase not nulled on dispose. FIXED: field now `string | null`; dispose() nulls it (drops ref for GC, immutable strings can't be wiped — documented honestly); reencrypt() throws WalletLockedError once disposed. typecheck clean, 0 NULs. Commit eec535a.
- NOT fixing: connect-src `wss:` wholesale (by design, Electrum operator-supplied, can't pin server-side; already documented).

## Optional polish (all 3 done this session, after Yana picked "Всё три")
- [x] HSTS + Permissions-Policy headers in next.config.mjs headers() + documented in SECURITY-REVIEW.md §6. Commit 5466e6b.
- [x] Run E2E smoke in CI — new `smoke` job in .github/workflows/ci.yml (only job proving nonce-CSP/hydration at runtime). Commit a38ba84.
- [x] Expand smoke to cover Phase 1 (payment-request panel) + Phase 5 (watch-only signing-disabled), via walletFlow()/watchOnlyFlow(). 6 assertions PASS. Commit 15845c1.

## Product depth (Yana picked #1 BTC testnet e2e + #3 a11y)
- [x] #3 A11y pass — DONE. New `tools/e2e/a11y.mjs` (axe-core WCAG 2.0/2.1 A+AA,
  8 screens, `pnpm a11y`, threshold gate A11Y_FAIL_ON default serious, bypassCSP
  in audit browser only). Fixed: aria-label on all bare selects; unified the 3
  Data Sources/settings selects (one-off `bg-[#111] text-white` → canonical
  `bg-[--color-bg]`; native control was scored dark-on-dark by axe); added
  `color-scheme: dark` to globals.css. 0 violations across all 8 screens.
  verify + smoke + a11y all green. Commit 4458dc7, pushed.
- [x] #1 BTC live e2e — DONE (commit 0d79470). New `tools/e2e/btc-live.mjs` +
  `pnpm btc:live`. Runs the REAL WDK adapter (createWdkAdapter() on Node →
  WdkCoreAdapter in-process, no Worker) and reads a live on-chain balance over a
  real Electrum-WS endpoint — the genuine @tetherto transport that FakeWdkAdapter
  (pnpm test) and BTC-unconfigured smoke never exercised (gap was called out in
  engine.test.ts bitcoin block). Outside the workspace → vitest never collects it,
  verify stays offline; opt-in only. Default = genesis coinbase on mainnet over
  Blockstream `wss://blockstream.info/electrum-websocket/api`, assert ≥ 50 BTC
  (genesis balance only grows → never flakes). Env-overridable
  (BTC_LIVE_WS_URL/NETWORK/ADDRESS/MIN_SATS) for testnet/signet. Verified live:
  read 57.2 BTC, PASS. NOTE for Yana: she said "testnet"; I used mainnet-genesis
  read-only as a STRONGER proof (same network the product ships, immutable
  balance, zero risk) — testnet endpoint plugs into the same harness via env.

## Next step
ALL THREE FOCUS ITEMS DONE (cold review → product depth → live deploy).
Live deploy SHIPPED on **Railway** (NOT Vercel): project `wdk-wallet-web`
(id ea62a935-9782-444a-bbef-72797484bee8), service `wdk-wallet-web`
(id 90c1dc50-75f4-4ea2-abbe-021201628391), env `production`. Deploy config =
committed `railway.json` (NIXPACKS; build = pnpm install + wallet-core build +
next build; start = `next start -p $PORT`). Public URL:
https://wdk-wallet-web-production.up.railway.app — verified HTTP 200, live
per-request CSP nonce (`strict-dynamic`), HSTS/X-Frame-Options DENY/nosniff/
Referrer-Policy/Permissions-Policy all present. App boots with NO mandatory env
vars (public RPC defaults; indexer/BTC optional). Created two duplicate projects
during `railway init` (response timed out but created); deleted the dupe, kept one.

Remaining-optional (NOT blocking, Yana's call):
- `/cso` full multi-agent pass before broad public sharing (п.4). Headers/CSP
  already strong; surface is small (client-side self-custodial, no server secrets).
- Optional: add live URL to README demo section for the bounty submission.

Final green this session (HEAD 0d79470):
  - `corepack pnpm verify`: lint+typecheck+build OK, 80 (wallet-core) + 63 (next) + 13 (svelte) tests.
  - `corepack pnpm smoke`: PASS under live nonce CSP, 6 assertions (zero blocking CSP violations).
  - `corepack pnpm a11y`: PASS, 0 violations across 8 screens (WCAG 2.0/2.1 A+AA, threshold serious).
  - `corepack pnpm btc:live`: PASS, live Blockstream read 57.2 BTC ≥ 50 BTC floor.

## CSP rework note (important for any future toucher)
The first CSP attempt (static header in next.config) was WRONG — `script-src 'self'`
blocks Next's inline RSC-bootstrap scripts, so the app never mounts. Correct design
NOW shipped: per-request nonce in `apps/next/middleware.ts` (`'self' 'nonce-…'
'strict-dynamic'`), and `app/layout.tsx` is `async` + `await headers()` to force
per-request (dynamic) rendering so the nonce reaches the inline scripts. Do NOT
revert to a static CSP. Non-CSP headers (nosniff/Referrer-Policy/X-Frame-Options)
stay in next.config headers().

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
