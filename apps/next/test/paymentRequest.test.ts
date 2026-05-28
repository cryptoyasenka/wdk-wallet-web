/**
 * Unit tests for the Phase-1 payment-request URI builders. Pure functions, no
 * DOM, no network — they are the contract the Receive → Request card renders, so
 * the invariants a payer relies on (right chain id, right minor-units, amount
 * validation, the bare-address fallback) are pinned here, not just clicked once.
 */
import { describe, expect, it } from "vitest";
import type { Asset } from "@wdk-web/wallet-core";
import {
  buildPaymentRequestUri,
  canBuildRequest,
  decimalToMinorUnits,
  InvalidAddressError,
  InvalidAmountError,
} from "../src/lib/paymentRequest";

const usdtEth: Asset = { symbol: "USDT", chain: "ethereum", token: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 };
const usdtPolygon: Asset = { symbol: "USDT", chain: "polygon", token: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6 };
const ethNative: Asset = { symbol: "ETH", chain: "ethereum", decimals: 18 };
const btc: Asset = { symbol: "BTC", chain: "bitcoin", decimals: 8 };
const usdtSol: Asset = { symbol: "USDT", chain: "solana", token: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6 };
const solNative: Asset = { symbol: "SOL", chain: "solana", decimals: 9 };
const solOwner = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";

describe("decimalToMinorUnits", () => {
  it("converts whole and fractional decimals without float error", () => {
    expect(decimalToMinorUnits("1", 6)).toBe(1_000_000n);
    expect(decimalToMinorUnits("1.5", 6)).toBe(1_500_000n);
    expect(decimalToMinorUnits("0.000001", 6)).toBe(1n);
    expect(decimalToMinorUnits("0.1", 18)).toBe(100_000_000_000_000_000n);
  });

  it("rejects empty, non-numeric, negative, or zero amounts", () => {
    for (const bad of ["", "  ", "abc", "-1", "1.2.3", "0", "0.0"]) {
      expect(() => decimalToMinorUnits(bad, 6)).toThrow(InvalidAmountError);
    }
  });

  it("rejects more fractional digits than the asset supports", () => {
    expect(() => decimalToMinorUnits("0.0000001", 6)).toThrow(InvalidAmountError);
  });
});

describe("canBuildRequest", () => {
  it("is true for BTC, configured EVM chains, and Solana", () => {
    expect(canBuildRequest(btc)).toBe(true);
    expect(canBuildRequest(usdtEth)).toBe(true);
    expect(canBuildRequest(usdtPolygon)).toBe(true);
    expect(canBuildRequest(usdtSol)).toBe(true);
    expect(canBuildRequest(solNative)).toBe(true);
  });

  it("is false for a chain outside the wallet scope", () => {
    // `tron` was purged from ChainId; the cast simulates malformed/foreign input.
    expect(canBuildRequest({ symbol: "USDT", chain: "tron", decimals: 6 } as unknown as Asset)).toBe(false);
  });
});

describe("buildPaymentRequestUri — EVM token (EIP-681 transfer)", () => {
  it("encodes contract@chainId/transfer with recipient and minor-unit amount", () => {
    const uri = buildPaymentRequestUri(usdtEth, "0x1111111111111111111111111111111111111111", "10");
    expect(uri).toBe("ethereum:0xdAC17F958D2ee523a2206206994597C13D831ec7@1/transfer?address=0x1111111111111111111111111111111111111111&uint256=10000000");
  });

  it("uses the chain's own EIP-155 id (polygon = 137)", () => {
    const uri = buildPaymentRequestUri(usdtPolygon, "0x1111111111111111111111111111111111111111", "1");
    expect(uri).toContain("@137/transfer");
    expect(uri).toContain("uint256=1000000");
  });

  it("omits uint256 when no amount is given (bare token request)", () => {
    const uri = buildPaymentRequestUri(usdtEth, "0x1111111111111111111111111111111111111111");
    expect(uri).toBe("ethereum:0xdAC17F958D2ee523a2206206994597C13D831ec7@1/transfer?address=0x1111111111111111111111111111111111111111");
  });
});

describe("buildPaymentRequestUri — EVM native (EIP-681 value)", () => {
  it("encodes recipient@chainId?value=<wei>", () => {
    expect(buildPaymentRequestUri(ethNative, "0x1111111111111111111111111111111111111111", "0.5")).toBe("ethereum:0x1111111111111111111111111111111111111111@1?value=500000000000000000");
  });

  it("omits value when no amount is given", () => {
    expect(buildPaymentRequestUri(ethNative, "0x1111111111111111111111111111111111111111")).toBe("ethereum:0x1111111111111111111111111111111111111111@1");
  });
});

describe("buildPaymentRequestUri — BTC (BIP-21)", () => {
  it("keeps a BTC-denominated amount and url-encodes the memo", () => {
    const uri = buildPaymentRequestUri(btc, "bc1qexample", "0.01", "invoice #42");
    expect(uri).toBe("bitcoin:bc1qexample?amount=0.01&message=invoice+%2342");
  });

  it("returns a bare bitcoin: URI when nothing optional is set", () => {
    expect(buildPaymentRequestUri(btc, "bc1qexample")).toBe("bitcoin:bc1qexample");
  });

  it("validates the amount before producing any URI", () => {
    expect(() => buildPaymentRequestUri(btc, "bc1qexample", "-1")).toThrow(InvalidAmountError);
  });
});

describe("buildPaymentRequestUri — Solana Pay (transfer request)", () => {
  it("encodes solana:<owner>?amount=<decimal>&spl-token=<mint> for SPL USD₮", () => {
    expect(buildPaymentRequestUri(usdtSol, solOwner, "10.5")).toBe(
      `solana:${solOwner}?amount=10.5&spl-token=Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`,
    );
  });

  it("keeps the amount as decimal UI units, not minor units (per Solana Pay)", () => {
    const uri = buildPaymentRequestUri(usdtSol, solOwner, "1");
    expect(uri).toContain("amount=1");
    expect(uri).not.toContain("1000000");
  });

  it("returns a bare spl-token request when no amount is given", () => {
    expect(buildPaymentRequestUri(usdtSol, solOwner)).toBe(
      `solana:${solOwner}?spl-token=Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`,
    );
  });

  it("encodes a native SOL request with no spl-token", () => {
    expect(buildPaymentRequestUri(solNative, solOwner, "0.25")).toBe(`solana:${solOwner}?amount=0.25`);
  });

  it("url-encodes the Solana Pay message from the memo field", () => {
    expect(buildPaymentRequestUri(usdtSol, solOwner, "5", "invoice #42")).toContain("message=invoice+%2342");
  });

  it("rejects more fractional digits than the mint supports (6)", () => {
    expect(() => buildPaymentRequestUri(usdtSol, solOwner, "0.0000001")).toThrow(InvalidAmountError);
  });

  it("rejects a non-base58 or URI-injecting solana recipient", () => {
    expect(() => buildPaymentRequestUri(usdtSol, "0OIl")).toThrow(InvalidAddressError);
    expect(() => buildPaymentRequestUri(usdtSol, `${solOwner}?amount=1`)).toThrow(InvalidAddressError);
  });
});

describe("buildPaymentRequestUri — invalid amount is rejected before output", () => {
  it("throws for a malformed EVM amount", () => {
    expect(() => buildPaymentRequestUri(usdtEth, "0x1111111111111111111111111111111111111111", "1.2.3")).toThrow(InvalidAmountError);
  });
});

describe("buildPaymentRequestUri — invalid recipient is rejected before output", () => {
  it("throws for an empty or short EVM address", () => {
    expect(() => buildPaymentRequestUri(usdtEth, "")).toThrow(InvalidAddressError);
    expect(() => buildPaymentRequestUri(ethNative, "0xabc")).toThrow(InvalidAddressError);
  });

  it("throws when an EVM address carries URI-injecting characters", () => {
    // Without validation this would smuggle an extra query part into the URI.
    expect(() => buildPaymentRequestUri(ethNative, "0x1111111111111111111111111111111111111111?value=1")).toThrow(InvalidAddressError);
  });

  it("rejects a BTC address containing URI delimiters or whitespace", () => {
    expect(() => buildPaymentRequestUri(btc, "bc1q example")).toThrow(InvalidAddressError);
    expect(() => buildPaymentRequestUri(btc, "bc1q?amount=1")).toThrow(InvalidAddressError);
  });
});
