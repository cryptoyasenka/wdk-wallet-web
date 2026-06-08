# Review Guide

A fast orientation for reviewers. Depth lives in the linked docs - this page
gets you to the right place and separates what is already reproducible from what
still requires a manual proof step.

## Live demo - no build required

**https://wdk-wallet-web-production.up.railway.app**

The real built app, served under the same strict per-request-nonce CSP and
security headers as production. It runs all six chains - the five keyless defaults
(Ethereum, Polygon, Arbitrum, Plasma + Solana) **plus Bitcoin**, enabled via a
public Blockstream Electrum-WS endpoint the deploy points at. **Your seed is
generated and encrypted in your own browser; the deploy holds no keys and nothing
custodial.** (Run it locally with no endpoint configured and Bitcoin instead shows
an honest "unsupported chain" notice - a browser cannot open a raw Electrum TCP
socket, so BTC needs an Electrum-WS endpoint to point at. See the README.)

**Prefer to watch?** A silent ~90 s **[walkthrough video](walkthrough.mp4)**
screencasts the whole flow (create → back up → portfolio → receive → send form);
the funded on-chain send is a separate clip - see "Manual proof" below.

## 60-second tour (on the live demo)

1. Open the URL → **Create wallet** → set a passphrase.
2. **Back up the seed** and pass the seed quiz (the backup gate is enforced).
3. Land on the **portfolio**: USD₮ across Ethereum / Polygon / Arbitrum /
   Plasma + Solana (+ XAU₮ on Ethereum), with opt-out live prices. **Bitcoin is
   live on this demo** - the deploy points at a public Blockstream Electrum-WS
   endpoint; run it locally with no endpoint and BTC shows the honest
   unsupported-chain state instead. `corepack pnpm btc:live` proves the real BTC
   transport path either way.
4. **Receive** → toggle Address ⇄ Request → pick asset + amount → get a scannable
   EIP-681 / BIP-21 / Solana Pay URI and QR, not just a bare address.
5. **Send** → enter a recipient → see the pre-send **safety panel**
   (official-contract badge, recipient status own/saved/recent/new,
   address-poisoning warning, gas-paid-separately note, explorer link).
6. **Settings → Data Sources**: every endpoint the wallet can talk to, each with a
   privacy label; the one third-party call (price oracle) is a disclosed opt-out.

## Verify the claims yourself (local)

```bash
corepack pnpm install
```

| To check… | Run |
|---|---|
| lint + typecheck + **249 unit tests** + build, across all 3 packages | `corepack pnpm verify` |
| real-browser E2E walkthrough under the **live strict CSP** | `corepack pnpm smoke` |
| accessibility - axe-core, WCAG 2.0/2.1 A+AA, every key screen | `corepack pnpm a11y` |
| **real** BTC transport over a live Electrum-over-WebSocket endpoint | `corepack pnpm btc:live` |
| **real** Solana transport over a live mainnet-beta RPC | `corepack pnpm sol:live` |
| dependency advisories (one accepted upstream `low`) | `corepack pnpm audit --audit-level moderate` |

`btc:live` and `sol:live` run the **genuine WDK adapters in-process** against live
chains and read real on-chain balances - proving the actual transport, not a
mock. They are opt-in and live outside the workspace, so the default `verify`
stays offline and deterministic.

## What is automated vs. what stays manual

**Proven and runnable right now:**

- create / import / unlock, AES-GCM vault encryption, passkey-PRF + passphrase
  slots - unit-tested (`corepack pnpm test`, see `packages/wallet-core/test/`);
- send **orchestration, signing intent, and fee quotes** - unit-tested against the
  adapter seam (`packages/wallet-core/test/engine.test.ts`);
- **live BTC + Solana transport reads** - `btc:live` / `sol:live` against real
  endpoints;
- the **full UI flow under the production CSP** - `smoke`; accessibility - `a11y`.

**Manual proof (cannot be a headless CI artifact):**

- An actual **on-chain broadcast** of a send requires funded testnet keys. WDK
  couples sign-and-broadcast in `account.sendTransaction` / `account.transfer`
  (there is no offline sign-without-broadcast primitive to assert against, so we
  do **not** fabricate one). The end-to-end "money actually moved" proof should
  therefore be supplied as a short **recorded send video** alongside the
  submission rather than as a script in this repo.
- The **walkthrough video** now ships in the repo
  ([`walkthrough.mp4`](walkthrough.mp4), linked above); what remains manual is
  the funded **send** clip and a **two-tab Delete-Wallet** check
  (a browser-lifecycle behaviour that is not unit-testable).

This is the one honest gap the live-read harnesses and unit tests cannot close on
their own - everything up to the final broadcast is runnable above.

## Where the depth lives

- **Requirement → implementation → verification map:** [`VERIFICATION-CHECKLIST.md`](VERIFICATION-CHECKLIST.md)
- **Security model, CSP rationale, honest limits:** [`SECURITY-REVIEW.md`](SECURITY-REVIEW.md)
- **Architecture & ADRs** (worker boundary, activity model, unlock design): [`ARCHITECTURE.md`](ARCHITECTURE.md)
- **RN-starter → web mapping:** [`RN-TO-WEB-MAP.md`](RN-TO-WEB-MAP.md)
- **WDK dependency pin posture:** [`VERIFICATION-CHECKLIST.md`](VERIFICATION-CHECKLIST.md) → "Known Honest Limits"
