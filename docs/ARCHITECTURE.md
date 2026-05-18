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

## apps/svelte (portability proof — shipped)

`apps/svelte` (package `svelte-proof`; Svelte 5 + Vite) consumes the
**byte-unchanged** `@wdk-web/wallet-core` public surface through its full
Phase-1 state machine (onboarding → backup → locked → unlocked). It deliberately
stops at Phase-1 parity — no send/activity/passkey — because the seam is already
proven by onboarding+unlock+portfolio (same bar as Phase-1 Next); a second full
UI would be scope, not more proof. Its host ports (`storage`, `PassphraseUnlock`,
`crypto` stub) are **app-local by design**, not a shared package: ports are the
host-specific layer (see RN-TO-WEB-MAP.md); the portability claim is about the
*engine* — the hard part — reused bit-for-bit. **Two hosts, one core:**
apps/next and apps/svelte drive the same engine with no core change; `git diff`
on `packages/wallet-core/**` is empty across all of Phase 3 (a hard pass/fail
gate). The claim is also an executable assertion —
`apps/svelte/test/portability.test.ts` drives `createWallet → unlock →
getBalances` headlessly through in-memory ports (no DOM), so
"framework-agnostic" is a passing test, not a slogan. First Load: main entry
≈55.5 kB (≈21 kB gzip); WDK is code-split into a worker chunk off the main bundle.

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
- **P3** `apps/svelte` portability proof + headless portability test + CI
  extend/verify (node matrix, local-only honesty) + docs truth-up. S1+S2
  shipped; S3 finalises docs.

## ADR-001: P1 ships no Web Worker — seed isolation co-designs with signing (P2)

**Status:** accepted (P1). **Supersedes nothing.** **Amended by ADR-004** on
*where* the P2 isolation boundary lands (the seam turned out to be the WDK
adapter, not the `CryptoWorker` port). The P1 reasoning below — refuse to ship
a worker that isolates nothing — stands unchanged.

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

> **Correction (ADR-004, P2).** This ADR anticipated that P2 would "swap in the
> real Web-Worker `CryptoWorker`" behind `deps.crypto`. That prediction was
> wrong about the *location*: the engine's signing path runs through
> `WdkSigner` (the adapter), never through `deps.crypto`, so the load-bearing
> seam is the **WDK adapter**, not the `CryptoWorker` port. ADR-004 records the
> design as built. The instinct here — "P1 builds a seam, P2 fills it; don't
> ship a worker that isolates nothing" — held; only the seam's identity moved.

## ADR-002: the P1 web bundle is EVM-only (alpha-WDK native deps)

**Status:** accepted (P1). Bitcoin-on-web remained deferred through P2 and P3 (the upstream alpha-WDK packaging gap is unchanged); see RN-TO-WEB-MAP.md.

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

See `RN-TO-WEB-MAP.md` for the Bitcoin-on-web delta and why it stays deferred.

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

## ADR-004: seed isolation lives behind the WDK adapter, not `deps.crypto`

**Status:** accepted (P2). Amends ADR-001 on *where* the boundary lands.

P2 fills ADR-001's "seam" — but not where ADR-001 guessed. A **Dedicated Web
Worker** owns `openSeed` (vault decryption) plus the WDK manager and signer;
the main thread holds only an opaque postMessage proxy that *implements*
`WdkAdapter`. After the vault is sealed, the plaintext seed and the WDK signer
**never exist on the main thread again** in the operational steady state.

**Why the boundary is the WDK adapter and not `deps.crypto`.** The engine's
signing path goes through `WdkSigner` (the containment adapter) — it never
calls `deriveAddress`/`signTransaction` on the frozen `CryptoWorker` port. The
engine only ever calls `deps.crypto.lock()`. A Web Worker placed behind
`deps.crypto` would therefore isolate *nothing the engine drives* — exactly the
security theatre ADR-001 refused to ship in P1. So the worker sits where the
secret actually flows: behind `WdkAdapter`. `deps.crypto.lock()` is retained as
the engine-level lock signal — a defense-in-depth hook a host can wire to also
hard-stop any auxiliary worker — and `apps/next`'s `StubCryptoWorker` is
re-documented as intentional architecture, not a pending Phase-2 stub.

**Frozen-contract guarantee.** `src/types.ts` (public surface: `WalletEngine`,
`WalletEngineDeps`, `CryptoWorker`, `createWalletEngine(deps, config?)`) is
**unchanged**. Only the internal `src/wdk/` containment interface changed — it
was always internal and never re-exported as the public contract. The seam
moved entirely inside the alpha-churn containment module.

**Mechanism.** The non-extractable AES-GCM `CryptoKey` from
`UnlockProvider.unlock()` is structured-cloneable: it ships to the worker as a
*handle* while its raw bytes stay in the browser key store, unreadable even by
our own code. `openSeed(sealed, key)` therefore runs **inside the worker**; the
plaintext seed string only ever materialises there. Module layout under
`packages/wallet-core/src/wdk/` (the only `@tetherto/*` site):

- `wdk-core.ts` — the real WDK logic (`WdkSignerImpl`/`WdkBalanceReaderImpl`/
  `WdkCoreAdapter`); imports `@tetherto/*` + `secrets/openSeed`. Reused by the
  worker and by a Node/SSR in-process fallback (same behaviour, no isolation —
  stated, not faked).
- `worker-protocol.ts` — typed request/response union + error
  (de)serialisation (no `@tetherto/*`).
- `crypto.worker.ts` — Dedicated Worker entry: a `WdkCoreAdapter`, signer/
  reader registries keyed by handle, `self.onmessage` dispatch.
- `worker-proxy.ts` — `WorkerWdkAdapter implements WdkAdapter`: correlation-id
  RPC; rehydrates typed errors by `name` so callers' `instanceof` branches
  survive the postMessage edge.
- `adapter.ts` — `createWdkAdapter()`: browser → spawn the worker +
  `WorkerWdkAdapter`; Node/SSR/vitest-of-the-real-adapter → in-process
  `WdkCoreAdapter`.

**Bundling (verified empirically, not assumed).** The adapter spawns the
worker with `new Worker(new URL("./crypto.worker.js", import.meta.url),
{ type: "module" })` from inside the compiled workspace package. With
`transpilePackages: ["@wdk-web/wallet-core"]`, webpack 5's native worker
support emits it as a **separate chunk**, and `next.config.mjs`'s
`resolve.alias`/`resolve.fallback` (BTC stub + sodium shim, see ADR-002) apply
to that worker chunk too. `next build` was inspected: the worker chunk carries
the WDK manager *and* the seed-owning `onmessage` dispatch, while the main
First Load chunks contain **zero** `@tetherto/*` (First Load JS ≈ 111 kB as shipped through P2).
Net effect: WDK moved entirely out of the main bundle into the worker chunk.

**Honest scope (the delta a reviewer must see).** At **create / import** the
seed phrase *necessarily* transits the main thread — it is shown on a backup
screen (create) or typed by the user (import), and the DOM is main-thread. No
browser wallet can avoid this; the RN starter has the same property, and
sealing happens main-thread-side here too (the seed is already there). The
real, repeated win is the **operational steady state** (every unlock → derive
→ quote → send → lock): there the seed plaintext and the WDK signer exist
**only inside the worker**. And a Web Worker is **defense-in-depth, not an XSS
boundary** (unlike RN BareKit's separate runtime) — reinforced in SECURITY.md
and the RN-TO-WEB-MAP "Crypto isolation" row.

## ADR-005: WebAuthn-PRF unlock is a host port (apps/next), HKDF not PBKDF2

**Status:** accepted (P2). Realises the frozen contract's *preferred*
`UnlockProvider`; does not amend an earlier ADR.

`UnlockProvider` is an **injected host port**, so the WebAuthn implementation
belongs in `apps/next/src/lib/` next to `PassphraseUnlock` and
`IndexedDbStorage` — **not** in `wallet-core`. Keeping it out of the core is
what lets the core stay host-agnostic (a Node/CLI/extension consumer brings its
own provider). The earlier scope note that read "wallet-core: WebAuthnUnlock"
is superseded by this: wallet-core contributes only a **reusable, host-neutral
KDF primitive**, never the browser ceremony.

**A passkey signature cannot be a key — PRF is the mechanism.** WebAuthn
assertions are non-deterministic, so `WebAuthnUnlock` uses the **PRF extension**
(the WebAuthn surfacing of CTAP2 `hmac-secret`): the authenticator HMACs a
fixed app salt under a key sealed in the secure element, yielding a stable,
32-byte, full-entropy secret. The two-ceremony split is **required, not
redundant**: PRF is guaranteed only at *assertion* time, so we enrol at
`create()` (persisting only the public credential id + the non-secret salt — we
refuse enrolment if the authenticator reports `prf.enabled === false`, so
selection keeps falling back honestly) and *derive* at `get()`.

**KDF = HKDF, deliberately not the passphrase path's PBKDF2.** The PRF output
is already full-entropy, so `wallet-core/secrets` gained an **additive**
`deriveAesGcmKeyFromEntropy` (HKDF-SHA256 → non-extractable AES-GCM-256). Iter-
ation stretching a 256-bit secret is pure cost with zero security gain; the
passphrase path keeps its 600k-iter PBKDF2 because *that* input is low-entropy.
The frozen `src/types.ts` is **untouched** — the change is one new function plus
its public re-export; the `UnlockProvider` shape (`unlock()`/`isEnrolled()`) is
unchanged, and both providers yield the same `CryptoKey` the vault expects, so
the seal/open roundtrip is identical regardless of credential.

**Wiring keeps `getWalletApp()` synchronous.** `SelectingUnlockProvider` (the
engine-injected provider) holds *persistent* passphrase + WebAuthn instances
and routes each `unlock()` to the passkey when one is enrolled here, else to
the unchanged Phase-1 passphrase path. The Phase-1 flow
(`setPassphrase` → `engine.unlock()`) is **byte-for-byte unchanged** when no
passkey is enrolled, so the existing UI state machine did not move. The
documented stateless `chooseUnlockProvider(storage)` selector exists alongside
it for one-shot selection and reasoning. If an assertion succeeds but yields no
PRF result, `unlock()` throws a *typed* error the UI can surface ("use your
passphrase") — it never silently no-ops.

**Honest test scope.** The deterministic core — HKDF: same IKM+salt
round-trips a real seal/open, different salt/IKM/info fails the GCM tag — is
unit-tested in `packages/wallet-core/test/vault.test.ts` (part of the 33-green wallet-core suite). The
`navigator.credentials` create/get ceremony is browser-only and verified
manually; it is **never** exercised with a faked assertion, and `apps/next`
has no unit harness, so the selection/fallback wiring is covered by
typecheck + lint + production build only. The PRF extension types are not yet
in TS 5.6.3's `lib.dom`; we declare the used slice as **subtypes** of the DOM
extension types (no `any`/`unknown` escape hatch), so type-checking on the
`prf` shape is retained.
