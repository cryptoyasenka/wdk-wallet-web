# Architecture

## Principle

The RN starter already separates platform-agnostic logic (`services/`, `config/`,
`utils/`, WDK provider) from platform-specific code (UI, native storage, biometrics).
This repo makes that boundary a **hard package boundary**: `wallet-core` cannot import
a framework; apps cannot import WDK directly.

```
apps/next  ─┐
apps/svelte ┼─► @wdk-web/wallet-core ─► WDK adapter ─► @tetherto/wdk + wallet-*
            ┘        (headless)          (1 file)
```

## packages/wallet-core (the spine)

Headless, framework-free, fully typed, unit-tested. Public surface in `src/types.ts`.
Submodules:

- `wdk/` — **the only place that imports `@tetherto/*`**. Wraps WDK behind our own
  interface so an alpha breaking change touches one module ("alpha-churn
  containment"). All version pins live in `packages/wallet-core/package.json`.
- `secrets/` — WebCrypto AES-GCM vault; key from WebAuthn or passphrase; ciphertext
  to an injected `StorageAdapter` (IndexedDB in apps, in-memory in tests).
- `chains/` — networks, assets, RPC + `@tetherto/wdk-failover-provider` config.
  Ported as-is from the RN starter's `config/`.
- `wallet/` — create/import/derive, balances, send, receive, activity. Pure logic;
  takes a `CryptoWorker` and a `StorageAdapter` by injection (testable, no DOM).

## apps/next (the deliverable)

Next.js App Router. Screen parity with the RN starter. `src/lib/` provides the web
implementations injected into `wallet-core`: `IndexedDbStorage`, `WebCryptoWorker`
(Web Worker), `WebAuthnUnlock`, `getUserMedia` QR. UI = Tailwind + shadcn. **No
`@tetherto/*` import anywhere under `apps/`.**

## apps/svelte-proof (portability proof)

One screen (create wallet → show address → balance) wired to the same `wallet-core`
with the same injected adapters. Exists solely to prove the core is not Next-coupled.
First thing cut under time pressure; not required for bounty acceptance.

## Alpha-churn containment

WDK is alpha. Rule: `import` from `@tetherto/*` is allowed **only** in
`packages/wallet-core/src/wdk/`. Enforced by an ESLint `no-restricted-imports` rule
in CI. Versions pinned exactly (no `^`), upgraded deliberately with a changelog note.

## Build / polyfills

Browser needs `crypto`/`buffer`/`stream` polyfills for WDK. Configured once in
`apps/next/next.config.mjs` (and the Svelte/Vite equivalent), documented, not
scattered.

## Phasing (each phase independently submittable)

- **P1** wallet-core (wdk+secrets+chains+wallet create/import/balance/receive) +
  Next.js onboarding/unlock/portfolio/receive. Irreducible "real wallet".
- **P2** send + activity + WebAuthn unlock + tx confirmation UI + e2e send test.
- **P3** svelte-proof + full test/CI matrix + polish + docs finalisation.

## ADR-001: P1 ships no Web Worker — seed isolation co-designs with signing (P2)

**Status:** accepted (P1). **Supersedes nothing.** Revisited in P2.

The `CryptoWorker` port frozen in `packages/wallet-core/src/types.ts` is
`deriveAddress` / `signTransaction` / `lock` — and deliberately has **no
seed-provisioning method**. The engine never hands a decrypted seed across that
boundary; a real worker would have to *own* the seed and expose only derive/sign.

P1 delivers onboarding / unlock / portfolio / receive — **no signing path**, so no
private key is ever derived in the running app. Building a Web Worker in P1 whose
only live method is `lock()` would move *no secret* off the main thread: an
isolation boundary with nothing to isolate is security theatre, and theatre is
exactly what SECURITY.md forbids us from shipping.

So P1 is honest about its boundary instead of faking one:

- The vault is decrypted **in-process** (main thread) with the non-extractable
  WebCrypto AES-GCM key returned by `UnlockProvider.unlock()` (PBKDF2-over-passphrase
  in P1; WebAuthn-gated in P2). The key object is non-extractable; the plaintext
  seed exists only transiently inside the engine, never in React state or storage.
- `apps/next/src/lib/cryptoWorker.ts` is a `StubCryptoWorker`: `lock()` is a real
  resolve (a genuine no-op — there is no worker state to zero yet, and saying so is
  the honest description, not a silenced crypto primitive); `deriveAddress` /
  `signTransaction` **reject** with an explicit Phase-2 message and are never
  reached on any P1 screen.
- The engine still routes `lock()` through `deps.crypto.lock()`. That call is inert
  in P1 but the wiring is load-bearing: when P2 swaps in the real Web-Worker
  `CryptoWorker`, lock already flows into the worker — the contract does not change,
  only the implementation behind it does. **P1 builds the seam; P2 fills it.**

The real seed-isolation boundary (worker owns the decrypted seed; main thread holds
only opaque handles; derive/sign cross the postMessage edge) is introduced in P2
**together with** signing, because that is the first moment a secret actually exists
to isolate. The `RN-TO-WEB-MAP.md` "Crypto isolation" row already states the honest
ceiling: a Web Worker is defence-in-depth, not an XSS-proof separate runtime like
the RN starter's BareKit worklet.

## ADR-002: the P1 web bundle is EVM-only (alpha-WDK native deps)

**Status:** accepted (P1). Bitcoin-on-web is a P2 investigation.

`@tetherto/wdk-wallet-btc` (and the EVM package's memory-safe key modules) reach
`sodium-universal`, a CJS `module.exports = require('sodium-native')` — a Node
N-API native addon — plus Bare-runtime modules that cannot bundle for a browser.
Two webpack-level resolutions, both honest, both **scoped to this app's browser
bundle only** (`wallet-core` is untouched, so Node/RN consumers keep real BTC and
the real native sodium):

- `sodium-universal` → `apps/next/src/lib/sodiumUniversalShim.ts`, which re-exports
  the **real** pure-JS `sodium_memzero` from `sodium-javascript` (exactly what
  `sodium-universal`'s own `browser` field targets) as a proper static ESM named
  export webpack can analyse. No crypto behaviour is faked or no-op'd — private-key
  buffers are still genuinely zeroised in the browser.
- `@tetherto/wdk-wallet-btc` → `apps/next/src/lib/wdkBtcBrowserStub.ts`, a typed
  stub that **throws** on construction. P1's web scope is EVM (ETH + USDT/XAUT on
  Ethereum); the BTC path is unreachable in P1 screens, so a loud throwing stub is
  honest (it cannot silently pretend to be a wallet) and keeps the EVM bundle clean.

See `RN-TO-WEB-MAP.md` for the Bitcoin-on-web delta and the P2 plan.

## ADR-003: getActivity is a local outgoing send-log (alpha WDK has no history API)

**Status:** accepted (P2).

`getActivity()` is in the frozen contract, but alpha WDK exposes only
`getTransactionReceipt(hash)` — there is no list/history/indexer call to
enumerate a wallet's transactions (verified against the published `.d.ts`,
2026-05-17). Rather than fabricate history or silently return empty, the engine
records every send it performs into a versioned, storage-persisted log
(`wdk:activity:v1`, `src/wallet/activity-log.ts`) and refreshes each pending
entry's status from the on-chain receipt.

**Honest limit (the delta a reviewer must see):** this covers only sends made
*by this wallet through this app*. Inbound transfers, and sends made from
another client, are **not** visible until WDK ships an indexer/explorer API.
This is stated in the code header and `RN-TO-WEB-MAP.md`; it is a deliberate,
documented scope boundary, not a bug.

Status is **read from chain, never inferred**:

- EVM: ethers `receipt === null` → `pending` (not mined); `receipt.status === 0`
  → `failed` (an explicit on-chain revert flag — a real chain-reported failure,
  not a guess); otherwise → `confirmed` (`status === 1`, or pre-Byzantium
  `null` = mined without a status opcode).
- Bitcoin: no revert concept — `receipt === null` → `pending`, non-null
  (mined into a block) → `confirmed`, full stop.

`WdkBalanceReader.getTransactionStatus(chain, hash, address)` takes the sender
address because WDK's **Bitcoin** receipt lookup is address-scoped (it scans
that address's history, not a global hash index); an address-less sentinel
would dishonestly report a confirmed BTC tx as forever `pending`. EVM resolves
the receipt via the provider and ignores `address` — one signature, honest on
both chains. The address is stored internally on the log entry; the public
`ActivityItem` is unchanged (frozen) — `from` is projected away on read.

Related additive contract refinement: `Asset.symbol` was widened with `"ETH"`
so EVM gas is representable in `FeeQuote.feeAsset` (gas for a USDT/XAU₮ transfer
is paid in ETH, not the token). Grep proved no consumer does an exhaustive
switch on the union, so widening is backward-compatible with the P1 surface.

Full history (incl. inbound) is deferred to a later phase, gated on the WDK
Indexer; the contract does not change when it lands — only this backing does.
