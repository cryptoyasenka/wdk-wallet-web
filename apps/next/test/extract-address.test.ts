import { describe, it, expect } from "vitest";
import { extractAddress } from "../src/lib/extract-address";

/**
 * Pins the Next copy of the QR-scan URI unwrapper. `extractAddress` is pure and
 * byte-identical in apps/next/src/lib and apps/svelte/src/lib; both copies are
 * tested so the shared logic cannot drift on one side unnoticed.
 *
 * Honest limit: the camera path (getUserMedia → <video> → canvas → jsQR rAF
 * loop in page.tsx) is browser-only and cannot run under vitest's node
 * environment, so it is verified by hand. Only the deterministic
 * string-unwrapping — the branching part worth pinning — is unit-tested here.
 */
const BTC = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const EVM = "0x52908400098527886E0F7030069857D2E4169EE7";
/** Real Tether USDT contract — the leading target of an EIP-681 transfer URI. */
const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
/** A base58 Solana owner — the recipient of a Solana Pay request. */
const SOL = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
/** Real Solana USD₮ SPL mint — the spl-token param of a Solana Pay transfer. */
const SOL_USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

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

  it("strips a bare solana: scheme down to the owner", () => {
    expect(extractAddress(`solana:${SOL}`)).toBe(SOL);
  });

  // The Receive card now generates Solana Pay request QRs; scanning one back
  // into Send must yield the owner, not the whole solana:…?spl-token=… URI.
  it("returns the owner of a Solana Pay transfer, dropping amount/spl-token/message", () => {
    expect(
      extractAddress(`solana:${SOL}?amount=1&spl-token=${SOL_USDT_MINT}&message=Invoice%20A1`),
    ).toBe(SOL);
  });

  it("leaves an unknown scheme untouched (no false unwrap)", () => {
    expect(extractAddress(`tron:${EVM}`)).toBe(`tron:${EVM}`);
  });

  it("leaves a bare base58 string (no scheme) unchanged", () => {
    expect(extractAddress(SOL)).toBe(SOL);
  });

  // Regression: the EIP-681 ERC-20 `transfer` form (which the Receive card
  // itself generates for USDT/XAU₮) carries the real recipient in `address=`,
  // while the leading target is the TOKEN contract. The unwrapper must return
  // the recipient, never the token — otherwise a scanned USDT request would
  // pay the token contract.
  it("returns the recipient of an EIP-681 transfer, not the token contract", () => {
    expect(extractAddress(`ethereum:${USDT}@1/transfer?address=${EVM}&uint256=1000000`)).toBe(EVM);
  });

  it("handles an EIP-681 transfer with no @chainId", () => {
    expect(extractAddress(`ethereum:${USDT}/transfer?address=${EVM}`)).toBe(EVM);
  });

  it("keeps the target for a native value form, ignoring a stray address param", () => {
    expect(extractAddress(`ethereum:${EVM}@1?value=1000000`)).toBe(EVM);
    expect(extractAddress(`ethereum:${EVM}@1?address=${USDT}`)).toBe(EVM);
  });
});
