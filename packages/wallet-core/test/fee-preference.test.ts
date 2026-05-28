import { describe, it, expect } from "vitest";
import { createWalletEngineWithAdapter } from "../src/wallet/engine.js";
import { buildChainRegistry } from "../src/chains/index.js";
import type { Asset, TxIntent } from "../src/types.js";
import { FakeWdkAdapter, MemoryStorage, PassphraseUnlock, SpyCryptoWorker } from "./fakes.js";

/**
 * The fee-speed preference must travel intact from the engine, across the
 * signer boundary, to the WDK adapter — and only tier the fee where the chain
 * supports it. Bitcoin is that chain (WDK `confirmationTarget`); ERC-20 token
 * transfers have no fee knob, so the preference must be a no-op there. The fake
 * signer scales the BTC fee by tier and records the preference on send, so this
 * exercises the whole plumbing without loading real WDK. The exact
 * block-target numbers (slow=6/normal=3/fast=1) live in `wdk-core.nativeTxArgs`
 * and are only meaningful against the real BTC transport (see `pnpm btc:live`).
 */
const BTC: Asset = { symbol: "BTC", chain: "bitcoin", decimals: 8 };
const USDT_ETH: Asset = {
  symbol: "USDT",
  chain: "ethereum",
  token: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  decimals: 6,
};
const BTC_TO = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const EVM_TO = "0x52908400098527886E0F7030069857D2E4169EE7";

async function unlockedEngine() {
  const storage = new MemoryStorage();
  const adapter = new FakeWdkAdapter();
  // Bitcoin must be configured (it needs an Electrum-WS URL) or the engine
  // raises UnsupportedChainError before the intent ever reaches the signer.
  const engine = createWalletEngineWithAdapter(
    adapter,
    { storage, crypto: new SpyCryptoWorker(), unlock: new PassphraseUnlock("correct horse battery") },
    { chains: buildChainRegistry({ btcElectrumWsUrl: "wss://electrum.example/api" }) },
  );
  await engine.createWallet();
  await engine.unlock();
  return { engine, adapter };
}

describe("fee preference (BTC speed tiers)", () => {
  it("flows the preference to the signer; a faster tier quotes a higher BTC fee", async () => {
    const { engine } = await unlockedEngine();
    const intent: TxIntent = { asset: BTC, to: BTC_TO, amount: 100_000n };
    const slow = await engine.quoteSend(intent, "slow");
    const normal = await engine.quoteSend(intent, "normal");
    const fast = await engine.quoteSend(intent, "fast");
    expect(slow.fee).toBeLessThan(normal.fee);
    expect(normal.fee).toBeLessThan(fast.fee);
    expect(slow.feeAsset.symbol).toBe("BTC");
  });

  it("records the chosen preference on send", async () => {
    const { engine, adapter } = await unlockedEngine();
    const intent: TxIntent = { asset: BTC, to: BTC_TO, amount: 50_000n };
    await engine.send(intent, "fast");
    const signer = adapter.signers.at(-1);
    expect(signer?.sent).toHaveLength(1);
    expect(signer?.sent[0]?.feePreference).toBe("fast");
  });

  it("leaves the quote unchanged when no preference is given (back-compat)", async () => {
    const { engine } = await unlockedEngine();
    const intent: TxIntent = { asset: BTC, to: BTC_TO, amount: 100_000n };
    const noPref = await engine.quoteSend(intent);
    expect(noPref.fee).toBe(21_000n);
  });

  it("ignores the preference for an ERC-20 token (no SDK fee knob)", async () => {
    const { engine } = await unlockedEngine();
    const intent: TxIntent = { asset: USDT_ETH, to: EVM_TO, amount: 1_000_000n };
    const slow = await engine.quoteSend(intent, "slow");
    const fast = await engine.quoteSend(intent, "fast");
    expect(slow.fee).toBe(fast.fee); // token fee is not tiered
  });
});
