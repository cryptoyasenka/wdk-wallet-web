// Live Bitcoin read — `pnpm btc:live`.
//
// Every other test in this repo is network-independent on purpose: `pnpm test`
// runs the engine against a hand-written FakeWdkAdapter, and `pnpm smoke`
// leaves Bitcoin unconfigured. That keeps CI deterministic, but it means the
// REAL WDK Bitcoin path — the @tetherto Electrum-over-WebSocket transport that
// only the browser worker / Node in-process adapter exercises — is never proven
// against a live server (see the note in packages/wallet-core/test/engine.test.ts,
// the "bitcoin" describe block).
//
// This harness closes that gap. It runs the real adapter (createWdkAdapter() in
// Node has no Worker global, so it loads WdkCoreAdapter and runs WDK in-process)
// and reads a real on-chain balance over a real Electrum-WS endpoint. Like the
// smoke and a11y harnesses it is TOOLING: it lives outside the pnpm workspace,
// so vitest never collects it and `pnpm test` / `pnpm verify` stay offline. It
// only runs when you invoke it explicitly.
//
// Default target is the Bitcoin genesis coinbase address on mainnet — chosen
// because it is the most stable funded address in existence: the genesis
// coinbase output is unspendable by consensus and people keep sending donations
// to it, so its balance only ever grows (>57 BTC today). Asserting "≥ 50 BTC"
// can therefore never flake on a balance change, and reading it exercises the
// exact mainnet transport the product ships. Everything is overridable so the
// same harness can point at testnet/signet or any address you fund:
//   BTC_LIVE_WS_URL   (default wss://blockstream.info/electrum-websocket/api)
//   BTC_LIVE_NETWORK  (default bitcoin; testnet | regtest also valid)
//   BTC_LIVE_ADDRESS  (default 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa, genesis)
//   BTC_LIVE_MIN_SATS (default 5000000000 = 50 BTC)
//
// Exit code 1 if it cannot connect or the balance is below the floor, else 0.

import { createWdkAdapter } from "../../packages/wallet-core/dist/wdk/index.js";

const WS_URL = process.env.BTC_LIVE_WS_URL ?? "wss://blockstream.info/electrum-websocket/api";
const NETWORK = process.env.BTC_LIVE_NETWORK ?? "bitcoin";
const ADDRESS = process.env.BTC_LIVE_ADDRESS ?? "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
const MIN_SATS = BigInt(process.env.BTC_LIVE_MIN_SATS ?? "5000000000");
const TIMEOUT_MS = Number(process.env.BTC_LIVE_TIMEOUT_MS ?? "60000");

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

async function main() {
  console.log(`[btc-live] network=${NETWORK} endpoint=${WS_URL}`);
  console.log(`[btc-live] reading native balance of ${ADDRESS} …`);

  const chains = {
    bitcoin: { kind: "btc", chain: "bitcoin", network: NETWORK, electrumWsUrl: WS_URL },
  };

  const adapter = await createWdkAdapter();
  const reader = await adapter.createBalanceReader(chains);
  try {
    const sats = await withTimeout(reader.getNativeBalance("bitcoin", ADDRESS), TIMEOUT_MS, "balance read");
    const btc = Number(sats) / 1e8;
    console.log(`[btc-live] balance = ${sats} sat (${btc} BTC)`);

    if (typeof sats !== "bigint") {
      console.log(`[btc-live] FAIL — expected a bigint satoshi balance, got ${typeof sats}.`);
      return 1;
    }
    if (sats < MIN_SATS) {
      console.log(`[btc-live] FAIL — balance ${sats} sat is below the ${MIN_SATS} sat floor.`);
      return 1;
    }
    console.log(`[btc-live] PASS — live Electrum-WS read returned ${sats} sat (≥ ${MIN_SATS}).`);
    return 0;
  } finally {
    await reader.dispose();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`[btc-live] ERROR: ${err?.message ?? err}`);
    process.exit(2);
  });
