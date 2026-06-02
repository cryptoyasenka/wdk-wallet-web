# Video plan — wdk-wallet-web (bounty submission)

Two clips. **Video A** is auto-recorded by this repo (no funds, no broadcast).
**Video B** is manual — it needs funded testnet keys, so only Yana can shoot it.

---

## Video A — Product walkthrough (auto-recorded)

**Recorder:** `node tools/demo/walkthrough.mjs` → `docs/walkthrough.mp4`
Silent screencast, ~90–150 s, 430×1180 "phone" frame. It builds the real
production Next app and drives the real client-side wallet in Chromium; the BTC
balance comes from the offline Electrum fixture (deterministic, no endpoint, no
secret). Captions are burned in as on-screen banners (English; re-run with
`LOCALE=ru` for a Russian cut — the app is fully localized). It **stops before any
broadcast** — and because the offline fixture exposes a balance but no spendable
UTXOs (`listunspent: []`), the send shot reaches the send **form** only; the
pre-send safety panel needs a real funded quote, so it is shown in Video B.

**Shot list** (caption — screen/action — what it proves):

| # | Caption (EN) | Screen / action | Proves |
|---|---|---|---|
| A1 | Self-custodial WDK wallet — keys never leave your device | Onboarding · Create tab; type + confirm passphrase; Create | client-side custody |
| A2 | Your recovery phrase — shown once, stored only on this device | Back up seed; reveal phrase; check "I saved it" | local seed, never transmitted |
| A3 | Verify the backup before you continue | Seed quiz; tap the asked words; Continue | backup integrity |
| A4 | Multi-chain: Bitcoin · USD₮ · XAU₮ across EVM + Solana | Portfolio; BTC row (fixture) + ETH/USD₮/XAU₮/SOL rows | multi-chain breadth |
| A5 | Receive addresses derived client-side — no server | Receive card · Address mode; show address + QR; copy | real on-device key derivation |
| A6 | Payment requests — EIP-681 / BIP-21, amount + memo | Receive card · Request tab; enter amount; show request | Phase 1 payment-request builder |
| A7 | Pre-send safety checks run before signing (funded send: Video B) | Send card; fill recipient + amount; the safety panel needs a funded quote, so this stops at the send form | anti-phishing entry point; STOPS before broadcast |
| A8 | Watch any address read-only — signing stays disabled | Fresh context · Watch tab; external address; read-only view + disabled-send notice | Phase 5 watch-only |
| A9 | Recovery Check re-verifies your passphrase — no seed re-exposure | Settings → Recovery Check; enter passphrase; "verified" | safe recovery |
| A10 | github.com/cryptoyasenka/wdk-wallet-web · live demo | Outro caption over the portfolio; live URL | submission pointer |

**Honesty:** the BTC row shows the offline fixture's canned demo balance
(0.01234567 BTC — not a real chain); every other asset is zero. The fixture answers
balance and fee reads but returns no UTXOs, so no send can be quoted and nothing is
broadcast — the funded send + live safety panel are Video B. The A4/A7 captions say
this on screen.

---

## Video B — Real testnet send, end-to-end (MANUAL — Yana)

**Why it can't be automated:** WDK couples sign + broadcast (no clean offline-sign
primitive), and faking a transaction is forbidden — the only honest proof is a
real on-chain send. The offline fixture used by Video A returns no spendable UTXOs,
so the send quote (and therefore the pre-send safety panel) can't render there.
This clip needs funded testnet keys + a live endpoint — and it's where the safety
panel skipped in A7 is actually shown.

**Steps (~60–90 s):**
1. Point the wallet at a funded testnet (set the BTC Electrum-WS, or an EVM/Solana
   testnet RPC, for a network where you hold test funds).
2. Create/import the funded wallet; unlock.
3. Portfolio shows the real test balance.
4. Send → recipient + amount → **Pre-send Safety Panel** → confirm → broadcast.
5. Capture the tx id; open it in the explorer (Blockstream / Etherscan-testnet /
   Solscan) **on camera**.
6. Show the updated balance after confirmation.

Drop the clip + tx link into `SUBMISSION.md` / `JUDGES.md` (send-proof section).
That closes finding F1 end-to-end and the submission is fully packaged.

---

## Runbook
- One-time: `corepack pnpm exec playwright install chromium` (already installed here).
- Record Video A: `node tools/demo/walkthrough.mjs` (ffmpeg must be on PATH — it is).
- Output: `docs/walkthrough.mp4`; QA frames in `tools/demo/frames/`.
- Russian cut: `LOCALE=ru node tools/demo/walkthrough.mjs`.
- The recorder is tooling: it lives outside the pnpm workspace and is never touched
  by lint / typecheck / test / build (same rule as `record.mjs` / `smoke.mjs`).
