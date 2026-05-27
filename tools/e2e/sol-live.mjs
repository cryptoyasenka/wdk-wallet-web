// Live Solana read — `pnpm sol:live`.
//
// The Solana port shipped a real @tetherto/wdk-wallet-solana manager, but like
// the other non-BTC managers its live-RPC path is never exercised by `pnpm test`
// (FakeWdkAdapter) or `pnpm smoke` (Solana balances read 0 against no funded
// account). PR #2 proved this gap bites: the deployed wallet silently CSP-blocked
// every SPL USD₮ fetch and no test caught it, because nothing read Solana over a
// real RPC. This harness closes that gap for Solana the way btc-live.mjs does for
// Bitcoin: it runs the REAL adapter (createWdkAdapter() in Node has no Worker, so
// it loads WdkCoreAdapter and runs WDK in-process) and reads a real on-chain SPL
// USD₮ balance over a real Solana mainnet-beta RPC.
//
// Like the smoke / a11y / btc-live harnesses it is TOOLING: it lives outside the
// pnpm workspace, so vitest never collects it and `pnpm test` / `pnpm verify`
// stay offline. It only runs when you invoke it explicitly.
//
// Default target reads the SPL USD₮ balance of a large, long-lived holder and
// asserts a conservative floor — the point is to prove the real Solana transport
// returns a sane bigint balance over a live RPC, not to pin an exact amount.
// Everything is overridable so the same harness can point at any owner/mint/RPC:
//   SOL_LIVE_RPC_URL  (default https://solana-rpc.publicnode.com)
//   SOL_LIVE_ADDRESS  (default a funded USD₮ holder; owner wallet pubkey, ATA derived by WDK)
//   SOL_LIVE_TOKEN    (default Es9vMFr… canonical USD₮ SPL mint, 6 decimals)
//   SOL_LIVE_MIN      (default 1000000 base units = 1 USD₮; assert balance ≥ this)
//   SOL_LIVE_TIMEOUT_MS (default 60000)
//
// Exit code 1 if the balance is below the floor / wrong type, 2 if it cannot
// connect, else 0.

import { createWdkAdapter } from "../../packages/wallet-core/dist/wdk/index.js";

const RPC_URL = process.env.SOL_LIVE_RPC_URL ?? "https://solana-rpc.publicnode.com";
const ADDRESS = process.env.SOL_LIVE_ADDRESS ?? "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const TOKEN = process.env.SOL_LIVE_TOKEN ?? "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const MIN = BigInt(process.env.SOL_LIVE_MIN ?? "1000000");
const TIMEOUT_MS = Number(process.env.SOL_LIVE_TIMEOUT_MS ?? "60000");

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

async function main() {
  console.log(`[sol-live] network=solana endpoint=${RPC_URL}`);
  console.log(`[sol-live] reading SPL USD₮ (${TOKEN}) balance of ${ADDRESS} …`);

  const chains = {
    solana: { kind: "solana", chain: "solana", rpcUrls: [RPC_URL] },
  };

  const adapter = await createWdkAdapter();
  const reader = await adapter.createBalanceReader(chains);
  try {
    const raw = await withTimeout(reader.getTokenBalance("solana", TOKEN, ADDRESS), TIMEOUT_MS, "token balance read");
    const usdt = Number(raw) / 1e6;
    console.log(`[sol-live] balance = ${raw} base units (${usdt} USD₮)`);

    if (typeof raw !== "bigint") {
      console.log(`[sol-live] FAIL — expected a bigint token balance, got ${typeof raw}.`);
      return 1;
    }
    if (raw < MIN) {
      console.log(`[sol-live] FAIL — balance ${raw} is below the ${MIN} base-unit floor.`);
      return 1;
    }
    console.log(`[sol-live] PASS — live Solana RPC read returned ${raw} base units (≥ ${MIN}).`);
    return 0;
  } finally {
    await reader.dispose();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`[sol-live] ERROR: ${err?.message ?? err}`);
    process.exit(2);
  });
