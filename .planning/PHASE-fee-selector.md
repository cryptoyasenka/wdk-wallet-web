# PHASE — BTC fee speed selector

**Status:** ✅ DONE 2026-05-29 (option A). Shipped: core `5f8e760`, UI `ea8b487`.
Live end-to-end (funded BTC + Electrum) NOT run; core flow unit-tested (`fee-preference.test.ts`), UI type-checked, smoke+a11y green (no regression).

## Goal (honest, SDK-bounded)
Let the user pick a **Bitcoin** transaction speed — slow / normal / fast — which
maps to WDK's `confirmationTarget`. Re-quote the fee per tier and show it. Handle
"Send entire balance" on BTC honestly (BTC is the only native sendable asset).

## Why BTC-only (verified in @tetherto/wdk-wallet-evm@1.0.0-beta.12 + btc beta.9)
- `EvmTransaction` (native send) accepts maxFeePerGas/maxPriorityFeePerGas — BUT
  this wallet has **no native EVM sendable assets** (ETH/POL/XPL are fee assets
  only; not in DEFAULT_ASSETS).
- `EvmTransferOptions` (ERC-20 transfer = USDT/XAU₮) accepts ONLY
  `{token, recipient, amount}` — **no gas fields**. So token speed control is
  impossible without hand-rolling calldata (rejected: against thin containment).
- Solana: no priority-fee field in SDK types; fee ~fixed → no tiers.
- BTC `BtcTransaction` = `{ to, value, feeRate?, confirmationTarget? }`;
  `quoteSendTransaction`/`sendTransaction` accept `confirmationTarget` (blocks).
  ⇒ **BTC is the only chain where a speed selector is real + SDK-supported.**

## Design
- New type `FeePreference = "slow" | "normal" | "fast"` in `types.ts`.
- Thread an OPTIONAL `feePreference?` through (undefined = today's behavior, so
  every existing caller/test is unchanged):
  - `wdk/types.ts` `WdkSigner.quoteSend(intent, accountIndex, feePreference?)` + `send(...)`.
  - `worker-protocol.ts` `signer.quoteSend` / `signer.send` messages gain `feePreference?`.
  - `worker-proxy.ts` `WorkerSigner` passes it.
  - `wdk-core.ts` `WdkSignerImpl.quoteSend/send`: for chain==="bitcoin" map
    pref→confirmationTarget `{ slow:6, normal:3, fast:1 }` and pass it into the
    BTC native quote/send args (`{ to, value, confirmationTarget }`). Non-BTC or
    undefined pref → unchanged args. Native EVM path doesn't exist here, so no
    EVM branch needed; if pref given on a token send, it's ignored (token can't
    set gas — documented).
  - `engine.ts` `quoteSend(intent, feePreference?)` / `send(intent, feePreference?)`
    pass through. Engine still ignores pref for non-BTC (signer decides).
- `test/fakes.ts` `FakeWdkAdapter` signer: capture `feePreference` so tests assert
  the mapping; quote can vary fee by pref for UI-ish assertions.

## UI (page.tsx) — BTC only
- When the selected send asset.chain === "bitcoin": show a 3-way control
  (slow / normal / fast), default "normal". Changing it re-runs the quote
  (state already holds `quote`). Show each tier's fee (already rendered at line
  ~1425 via quote.fee).
- For non-BTC assets: no selector (current single auto-estimate).
- "Send entire balance" (Max) on BTC: **warn** "leave room for the network fee"
  (BTC sweep = amount-minus-fee is not cleanly exposed by WDK; auto-reserve would
  need a sweep/drain API we don't have — so warn honestly rather than guess).
  Token Max stays fine (gas paid separately). VERIFY during impl whether WDK BTC
  exposes a sweep; if yes, prefer reserve; else warn.
- i18n: new keys `fee.speed`, `fee.slow`, `fee.normal`, `fee.fast`,
  `fee.slow_hint`(~1h), `fee.normal_hint`(~30m), `fee.fast_hint`(~10m),
  `send.max_btc_fee_warn` — all en+ru+uk.

## Tests
- wallet-core: feePreference→confirmationTarget mapping for BTC (FakeWdkAdapter
  records the arg); undefined pref → no confirmationTarget; non-BTC ignores pref.
  engine passes pref through.
- Keep all existing green. Then `pnpm verify` + `pnpm smoke` (BTC unconfigured in
  smoke, so selector won't show there — fine) + `pnpm a11y`.

## Commits (atomic)
- B1: core plumbing + BTC mapping + fakes + wallet-core tests.
- B2: page.tsx selector + i18n + (smoke note). 
- Update BOUNTY-CHECKLIST counts after.

## Constraints
- Don't change behavior when feePreference is undefined (back-compat).
- Honest: no fake tiers for token/Solana. Russian report at the end.
