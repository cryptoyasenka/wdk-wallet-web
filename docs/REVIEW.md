# Review Guide

A fast orientation for reviewers. Depth lives in the linked docs. This page is
meant to set expectations cleanly, point to the right proof, and separate what
is already reproducible from what belongs to the next milestone.

This repo is best reviewed as an **M1-delivered, M2-strong web template**. It
does **not** claim that every final-delivery checkbox is already closed.

## Current scope against the Template Wallet milestones

- **M1 is delivered:** framework choice, architecture, security notes, and the
  integration plan are all present in the repo.
- **M2 is delivered for the core web template:** WDK integration, onboarding,
  balances, send / receive, multi-wallet, multi-account, QR flows, and status
  monitoring all run today.
- **M3 is the next milestone:** Spark / Lightning, official Indexer API
  alignment for external history, the upstream PR into Tether's
  templates/examples area, and the expanded 2-5 minute reviewer demo package.

## Live demo, no build required

**https://wdk-wallet-web-production.up.railway.app**

This is the real built app, served under the same strict per-request-nonce CSP
and security headers as production. It runs all six currently shipped chains:
the five keyless defaults (Ethereum, Polygon, Arbitrum, Plasma, and Solana)
plus **Bitcoin**, enabled through a public Blockstream Electrum-WS endpoint.

Your seed is generated and encrypted in your own browser. The deploy holds no
keys and nothing custodial.

If you run the app locally with no BTC endpoint configured, Bitcoin shows an
honest unsupported-chain state instead. A browser cannot open a raw Electrum
TCP socket, so BTC needs an Electrum-WS endpoint to point at.

**Prefer to watch first?** A silent ~90 s
**[walkthrough video](walkthrough.mp4)** shows create -> back up -> portfolio
-> receive -> send form. The funded on-chain send proof is a separate clip.

## 60-second tour on the live demo

1. Open the URL and choose **Create wallet**.
2. Set a passphrase, then **back up the seed** and pass the seed quiz.
3. Land on the **portfolio**. You can inspect USDв‚® across Ethereum, Polygon,
   Arbitrum, Plasma, and Solana, plus XAUв‚® on Ethereum. **Bitcoin is live on
   this deploy** through a public Electrum-WS endpoint.
4. Open **Receive**, switch between Address and Request, choose asset and
   amount, and get a scannable EIP-681, BIP-21, or Solana Pay URI and QR.
5. Open **Send**, enter a recipient, and review the pre-send safety panel:
   official-contract badge, recipient status, poisoning warning, gas note, and
   explorer link.
6. Open **Settings -> Data Sources** to see every endpoint the wallet can talk
   to and the privacy label for each one.

## Verify the claims yourself

```bash
corepack pnpm install
```

| To check | Run |
|---|---|
| lint + typecheck + **253 unit tests** + build, across all 3 packages | `corepack pnpm verify` |
| real-browser walkthrough under the **live strict CSP** | `corepack pnpm smoke` |
| accessibility, axe-core, WCAG 2.0/2.1 A+AA, key screens | `corepack pnpm a11y` |
| **real** BTC transport over a live Electrum-over-WebSocket endpoint | `corepack pnpm btc:live` |
| **real** Solana transport over a live mainnet-beta RPC | `corepack pnpm sol:live` |
| dependency advisories, with one accepted upstream `low` | `corepack pnpm audit --audit-level moderate` |

`btc:live` and `sol:live` run the genuine WDK adapters in-process against live
chains and read real on-chain balances. They prove the real transport path, not
a mock.

## What is automated vs. what stays manual

**Proven and runnable right now:**

- create / import / unlock, vault encryption, passkey PRF and passphrase slots;
- send orchestration, signing intent, fee quotes, and validation logic;
- live BTC and Solana transport reads against real endpoints;
- the main UI flow under the production CSP;
- accessibility checks for the key screens.

**Manual proof or next-milestone proof:**

- A real **funded on-chain send** still needs funded keys and a recorded send
  clip. WDK couples sign-and-broadcast in `account.sendTransaction` /
  `account.transfer`, so this is not faked as an offline unit test.
- The current repo already includes the product walkthrough
  ([`walkthrough.mp4`](walkthrough.mp4)). The longer 2-5 minute final reviewer
  package belongs to the next milestone.
- **Spark / Lightning** are not in this repo yet.
- **Official Indexer API alignment** for external history is the next milestone.
- The **upstream PR into Tether's templates/examples area** is also a next-step
  deliverable, not a hidden missing artifact.

## Where the depth lives

- **Requirement -> implementation -> verification map:**
  [`VERIFICATION-CHECKLIST.md`](VERIFICATION-CHECKLIST.md)
- **Security model, CSP rationale, honest limits:**
  [`SECURITY-REVIEW.md`](SECURITY-REVIEW.md)
- **Architecture and ADRs** for the worker boundary, activity model, and unlock
  design: [`ARCHITECTURE.md`](ARCHITECTURE.md)
- **RN starter -> web mapping:** [`RN-TO-WEB-MAP.md`](RN-TO-WEB-MAP.md)
