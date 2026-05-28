# Tether WDK Bounty Checklist

This file is a reviewer map: what the bounty asks for, where it is implemented,
and how to verify it locally.

## Verification

```bash
corepack pnpm install
corepack pnpm verify                          # lint · typecheck · test · build (all 3 packages)
corepack pnpm smoke                            # E2E walkthrough under the live CSP (see below)
corepack pnpm demo                             # records docs/demo.gif
corepack pnpm audit --audit-level moderate     # one accepted low advisory
```

Current local bar:

- `lint`, `typecheck`, `test`, and `build` pass across `wallet-core`, `apps/next`,
  and `apps/svelte`.
- `corepack pnpm audit --audit-level moderate` passes. The remaining `low`
  advisory is upstream in the pinned alpha BTC WDK dependency chain
  (`bitcoinjs-message -> secp256k1 -> elliptic`) and has no patched range in the
  advisory.
- `wallet-core`: 92 unit tests.
- `apps/next`: 106 unit tests (payment-request URI builders + recipient-address validation + pre-send safety heuristics + address-book/template load hardening + data-source/privacy validation + watch-only storage validation + QR-scan URI unwrapping + CSP connect-src env allow-list + unlock-provider passphrase-fallback selection).
- `apps/svelte`: 16 headless portability tests.
- Next First Load JS: about 238 kB; the WDK/BTC graph stays in the worker chunk,
  not the main First Load path.
- `corepack pnpm demo` records `docs/demo.gif` against the production Next build
  and the offline Electrum-WS fixture.
- `corepack pnpm smoke` (`tools/e2e/smoke.mjs`) builds + serves the production
  app and drives a real browser through create → seed quiz → portfolio → receive
  copy accessible name → Recovery Check, under the live strict CSP — a passing
  run also proves zero CSP violations.
- A strict, per-request-nonce **Content-Security-Policy** ships from
  `apps/next/middleware.ts`; every directive is justified in
  `docs/SECURITY-REVIEW.md` → "CSP".

## Bounty Requirements

| Requirement | Implementation | Verification |
|---|---|---|
| Web wallet built on Tether WDK | `packages/wallet-core/src/wdk/` is the only WDK containment layer; apps consume `@wdk-web/wallet-core` only. | `corepack pnpm lint` enforces no `@tetherto/*` imports outside the containment folder. |
| Self-custodial keys | Seed vault is AES-GCM encrypted; operational signer lives behind the WDK adapter worker in browser builds. | `docs/SECURITY.md`, `docs/ARCHITECTURE.md` ADR-004, `packages/wallet-core/test/vault.test.ts`. |
| USDt send/receive on web | USDT assets configured for Ethereum, Polygon, Arbitrum, and Plasma through the WDK EVM manager. | `packages/wallet-core/src/chains/index.ts`, send/quote tests in `packages/wallet-core/test/engine.test.ts`. |
| BTC send/receive on web | BTC manager is bundled through browser shims and uses an injected Electrum-over-WebSocket endpoint. | `apps/next/.env.example`, `docs/RN-TO-WEB-MAP.md`, demo fixture under `tools/demo/`. |
| Passphrase and passkey unlock | Passphrase remains the recovery slot; passkey enrollment adds a separate passkey-encrypted vault slot. | `packages/wallet-core/test/engine.test.ts` covers both slots after passkey enrollment. |
| Multi-wallet and multi-account | Independent vaults for wallets; HD indices for accounts. | `packages/wallet-core/test/multi-wallet.test.ts`, `packages/wallet-core/test/multi-account.test.ts`. |
| QR receive and QR scan send | QR render and QR scan are implemented in both app hosts. | `apps/next/app/page.tsx`, `apps/svelte/src/App.svelte`, `apps/svelte/test/extract-address.test.ts`. |
| Payment requests (EIP-681 / BIP-21) | Receive has an Address/Request switch: pick asset + amount (+ memo for BTC), get a scannable payment-request URI and QR, not just a bare address. | `apps/next/src/lib/paymentRequest.ts`, `apps/next/test/paymentRequest.test.ts`, Receive card in `apps/next/app/page.tsx`. |
| Pre-send safety panel | Confirmation screen shows official-contract badge, recipient status (own/saved/recent/new), address-poisoning warning, gas-paid-separately note, and a recipient explorer link. | `apps/next/src/lib/safety.ts`, `apps/next/test/safety.test.ts`, confirmation block in `apps/next/app/page.tsx`. |
| Address book v2 + payment templates | Contacts carry a note, favorite flag, and last-used stamp (favorites and recent payees sort first); reusable payment templates prefill recipient+asset+amount on Send. Persisted JSON is shape-validated on load — corrupt rows are dropped, never thrown on. | `apps/next/src/lib/contacts.ts`, `apps/next/test/contacts.test.ts`, Settings address book + Send templates row in `apps/next/app/page.tsx`. |
| Data sources / privacy | A Settings card exposes every endpoint the wallet uses (EVM RPCs, Electrum-WS, optional indexer, CoinGecko price oracle) with privacy labels. Defaults are privacy-preserving; the price call is a disclosed opt-out toggle. Overrides are validated, stored on-device only, and rebuild the engine on save — never threaded into wallet-core. | `apps/next/src/lib/dataSources.ts`, `apps/next/test/dataSources.test.ts`, `apps/next/src/lib/engine.ts`, `apps/next/src/lib/prices.ts`, Data Sources card in `apps/next/app/page.tsx`. |
| Watch-only mode | Onboarding offers a third path — Watch — that monitors any EVM address read-only with no seed: a seedless engine read (`getBalancesForAddress`) shows the portfolio, signing is disabled with clear copy, and no seed-quiz/passkey/recovery is shown. Watched addresses are validated and stored on-device only. | `packages/wallet-core/src/wallet/engine.ts` (`getBalancesForAddress`), `apps/next/src/lib/watchOnly.ts`, `apps/next/test/watchOnly.test.ts`, watch view in `apps/next/app/page.tsx`. |
| Framework portability | Svelte app consumes the byte-shared core with its own host ports. | `apps/svelte/test/portability.test.ts`. |
| Honest activity model | Local outgoing send log is default. External/public history is an optional injected provider, not hardcoded in WDK core. | `packages/wallet-core/src/wallet/engine.ts`, `docs/ARCHITECTURE.md` ADR-003, history merge/failure tests in `packages/wallet-core/test/engine.test.ts`. |
| Production honesty | Web Worker is defense-in-depth, not an XSS boundary; BTC needs an Electrum-WS endpoint. | `docs/SECURITY.md`, `README.md`. |

## Reviewer Demo Path

1. Start `apps/next`.
2. Create a wallet with a passphrase.
3. Back up the seed phrase and pass the seed quiz.
4. Unlock and inspect portfolio, receive addresses, QR, send confirmation, and
   activity.
5. Run the Svelte portability proof to show the same core outside Next.js.

## Known Honest Limits

- The browser cannot open raw Electrum TCP, so BTC requires an Electrum-over-
  WebSocket endpoint.
- A Web Worker reduces accidental key exposure but cannot stop a compromised
  main thread from requesting signatures.
- Inbound/external transaction history is not silently fetched by default because
  that leaks addresses to public indexers. Hosts can add an explicit indexer
  provider with user-facing privacy copy.
