import { describe, it, expect } from "vitest";
import { extractAddress } from "../src/lib/extract-address";

/**
 * Real coverage for the QR-scan URI unwrapper (P1 step 3, anti-degradation
 * п.1 — a real test, not "should work"). `extractAddress` is pure and
 * byte-identical in apps/next/src/lib and apps/svelte/src/lib; exercising
 * this copy exercises that shared logic.
 *
 * Honest limit: the camera path (getUserMedia → <video> → canvas → jsQR
 * rAF loop) is browser-only and cannot run under vitest's node environment,
 * so it is verified by hand, not here. Only the deterministic
 * string-unwrapping is unit-tested — which is exactly the branching part
 * worth pinning.
 */
const BTC = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const EVM = "0x52908400098527886E0F7030069857D2E4169EE7";

describe("extractAddress", () => {
  it("returns a bare address unchanged", () => {
    expect(extractAddress(BTC)).toBe(BTC);
    expect(extractAddress(EVM)).toBe(EVM);
  });

  it("trims surrounding whitespace", () => {
    expect(extractAddress(`  ${EVM}\n`)).toBe(EVM);
  });

  it("strips a BIP-21 bitcoin: scheme and drops query params", () => {
    expect(extractAddress(`bitcoin:${BTC}?amount=1`)).toBe(BTC);
  });

  it("strips a bare ethereum: scheme", () => {
    expect(extractAddress(`ethereum:${EVM}`)).toBe(EVM);
  });

  it("strips the EIP-681 pay- prefix and @chainId suffix", () => {
    expect(extractAddress(`ethereum:pay-${EVM}@1`)).toBe(EVM);
  });

  it("matches the scheme case-insensitively, keeping address case", () => {
    expect(extractAddress(`BITCOIN:${BTC}?amount=0.5`)).toBe(BTC);
    expect(extractAddress(`Ethereum:${EVM}`)).toBe(EVM);
  });

  it("leaves an unknown scheme untouched (no false unwrap)", () => {
    expect(extractAddress(`solana:${EVM}`)).toBe(`solana:${EVM}`);
  });
});
