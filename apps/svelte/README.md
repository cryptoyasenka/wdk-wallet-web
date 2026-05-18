# apps/svelte — portability proof

A *thin* second app (plain **Svelte 5 + Vite**, deliberately not SvelteKit)
that consumes the **byte-unchanged** `@wdk-web/wallet-core` public surface.

**Why it exists:** to prove the headless engine is genuinely
framework-agnostic. One core, two different-framework hosts (Next.js +
Svelte), engine reused bit-for-bit — `git diff packages/wallet-core/**` is
empty across this whole app's history. That is the pro-vs-vibecoder signal
and the strategic reuse argument for the downstream bounties.

**Boundary rule (ESLint-enforced):** no `@tetherto/*` import anywhere under
`apps/`. The proof literally cannot reach alpha WDK directly and still works —
it only provides web implementations of the injected ports and renders UI.

**Host ports are app-local by design**, not shared-packaged: each host wires
its own bundler + minimal `storage` / `passphrase-unlock` / `crypto` ports
(mirroring `apps/next/src/lib` shapes). The portability claim is about the
*engine* — the hard part — reused verbatim; the port glue is the
host-specific layer and is expected to differ per host (see
`../../docs/RN-TO-WEB-MAP.md`). A shared port package is reuse-positive but
belongs to the later Extension / eCommerce bounties, not this thin proof.

**EVM-only, same honest delta as Next:** `vite.config.ts` mirrors
`apps/next/next.config.mjs` — `@tetherto/wdk-wallet-btc` aliased to a typed
throwing stub, `sodium-universal` aliased to a shim re-exporting the *real*
pure-JS `sodium_memzero`, Node built-ins emptied. No faked crypto. BTC on web
stays a documented upstream-blocked deferral.

**Unlock = passphrase only.** WebAuthn/PRF is already proven by `apps/next`;
re-adding it to the *minimal* proof would be scope creep. The seam is proven
by onboarding + unlock + portfolio (same bar as Phase-1 Next).

Screens: `loading → (onboarding | locked)`; onboarding → create →
backup(seed) → unlocked, or import → unlock → unlocked; locked → unlock →
unlocked; unlocked = balances + receive addresses + lock. Core methods used:
`hasWallet, createWallet, importWallet, unlock, lock, getAddress,
getBalances`. No send / activity / passkey here (out of scope for the proof).

`test` is a **headless portability assertion** (no DOM): it imports the
public surface and drives `createWallet → unlock → getBalances` through
in-memory ports — the "core is framework-agnostic" claim as a passing test.
