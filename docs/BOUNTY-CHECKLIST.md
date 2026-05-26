# Tether WDK Bounty Checklist

This file is a reviewer map: what the bounty asks for, where it is implemented,
and how to verify it locally.

## Verification

```bash
corepack pnpm install
corepack pnpm verify
corepack pnpm demo
```

Current local bar:

- `lint`, `typecheck`, `test`, and `build` pass across `wallet-core`, `apps/next`,
  and `apps/svelte`.
- `corepack pnpm audit --audit-level moderate` passes. The remaining `low`
  advisory is upstream in the pinned alpha BTC WDK dependency chain
  (`bitcoinjs-message -> secp256k1 -> elliptic`) and has no patched range in the
  advisory.
- `wallet-core`: 76 unit tests.
- `apps/svelte`: 13 headless portability tests.
- Next First Load JS: about 223 kB; the WDK/BTC graph stays in the worker chunk,
  not the main First Load path.
- `corepack pnpm demo` records `docs/demo.gif` against the production Next build
  and the offline Electrum-WS fixture.

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
