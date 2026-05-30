/**
 * Unit tests for the Phase-2 pre-send safety heuristics. These are the signals
 * the confirmation panel relies on to warn about poisoning and unknown
 * recipients, so the boundaries (case-insensitive EVM vs case-sensitive BTC,
 * head+tail poisoning match, exact-match-is-not-poisoning) are pinned here.
 */
import { describe, expect, it } from "vitest";
import type { Asset } from "@wdk-web/wallet-core";
import type { Contact } from "../src/lib/contacts";
import {
  classifyRecipient,
  detectPoisoning,
  isOfficialToken,
  officialTokenContracts,
  type RecipientContext,
} from "../src/lib/safety";

const ALICE = "0x1111111111111111111111111111111111111111";
const BOB = "0x2222222222222222222222222222222222222222";
const OWN_ETH = "0x9999999999999999999999999999999999999999";
const contacts: Contact[] = [{ name: "Alice", address: ALICE, chain: "ethereum" }];
const ownAddresses = [["ethereum", OWN_ETH], ["bitcoin", "bc1qself"]] as const;

function ctx(over: Partial<RecipientContext>): RecipientContext {
  return { to: BOB, chain: "ethereum", contacts, ownAddresses, ...over };
}

describe("classifyRecipient", () => {
  it("flags one of the wallet's own receive addresses as self", () => {
    expect(classifyRecipient(ctx({ to: OWN_ETH }))).toEqual({ kind: "self" });
  });

  it("matches a saved contact case-insensitively on EVM", () => {
    expect(classifyRecipient(ctx({ to: ALICE.toUpperCase() }))).toEqual({ kind: "saved", name: "Alice" });
  });

  it("flags a recently-used recipient", () => {
    expect(classifyRecipient(ctx({ to: BOB, recentRecipient: BOB, recentChain: "ethereum" }))).toEqual({ kind: "recent" });
  });

  it("falls back to new for an unknown address", () => {
    expect(classifyRecipient(ctx({ to: BOB }))).toEqual({ kind: "new" });
  });

  it("does not cross chains: a contact on another chain is not a match", () => {
    expect(classifyRecipient(ctx({ to: ALICE, chain: "polygon" }))).toEqual({ kind: "new" });
  });

  // Solana addresses are base58 — case is significant, so a case-flipped
  // variant is a DIFFERENT address and must not be classified as self / saved /
  // recent. Lower-casing it (the old EVM rule) would misclassify it.
  it("treats Solana addresses as case-significant (self/saved/recent)", () => {
    const SOL = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
    const flipped = SOL.toLowerCase();
    const solCtx: RecipientContext = {
      to: flipped,
      chain: "solana",
      contacts: [{ name: "Sol Friend", address: SOL, chain: "solana" }],
      ownAddresses: [["solana", SOL]],
      recentRecipient: SOL,
      recentChain: "solana",
    };
    // Same bytes, only case differs → none of self/saved/recent should fire.
    expect(classifyRecipient(solCtx)).toEqual({ kind: "new" });
    // Exact-case Solana address still matches self (sanity: not over-rejecting).
    expect(classifyRecipient({ ...solCtx, to: SOL })).toEqual({ kind: "self" });
  });
});

describe("detectPoisoning", () => {
  it("flags a head+tail lookalike of a saved contact", () => {
    // same first 6 (0x1111) and last 6 (111111) as ALICE, different middle
    const lookalike = "0x1111000000000000000000000000000000111111";
    const hit = detectPoisoning(ctx({ to: lookalike }));
    expect(hit?.address).toBe(ALICE);
    expect(hit?.name).toBe("Alice");
  });

  it("returns null for an unrelated address", () => {
    expect(detectPoisoning(ctx({ to: BOB }))).toBeNull();
  });

  it("does not flag the exact saved address as poisoning", () => {
    expect(detectPoisoning(ctx({ to: ALICE }))).toBeNull();
  });

  it("considers the recent recipient as a poisoning reference too", () => {
    const recent = "0xabcdef0000000000000000000000000000abcdef";
    const lookalike = "0xabcdef1111111111111111111111111111abcdef";
    const hit = detectPoisoning(ctx({ to: lookalike, contacts: [], recentRecipient: recent, recentChain: "ethereum" }));
    expect(hit?.address).toBe(recent);
  });
});

describe("official token contracts", () => {
  // Real Solana USD₮ SPL mint — base58, so its case is part of its identity.
  const USDT_SOLANA_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
  const assets: Asset[] = [
    { symbol: "BTC", chain: "bitcoin", decimals: 8 },
    { symbol: "USDT", chain: "ethereum", token: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
    { symbol: "USDT", chain: "solana", token: USDT_SOLANA_MINT, decimals: 6 },
  ];
  const official = officialTokenContracts(assets);

  it("recognises a bundled token contract regardless of case", () => {
    const usdt: Asset = { symbol: "USDT", chain: "ethereum", token: "0xDAC17F958D2EE523A2206206994597C13D831EC7", decimals: 6 };
    expect(isOfficialToken(usdt, official)).toBe(true);
  });

  it("rejects an unknown contract", () => {
    const fake: Asset = { symbol: "USDT", chain: "ethereum", token: "0xbadc0ffee0000000000000000000000000000000", decimals: 6 };
    expect(isOfficialToken(fake, official)).toBe(false);
  });

  it("treats a native (token-less) asset as not an official-token badge case", () => {
    expect(isOfficialToken({ symbol: "ETH", chain: "ethereum", decimals: 18 }, official)).toBe(false);
  });

  it("does NOT badge a token whose contract is official on a DIFFERENT chain", () => {
    // Same bytes as the Ethereum USDT contract, but presented as an Arbitrum
    // token. The official-Tether checkmark must not cross chains, or it spoofs.
    const spoof: Asset = { symbol: "USDT", chain: "arbitrum", token: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 };
    expect(isOfficialToken(spoof, official)).toBe(false);
  });

  it("badges the exact-case Solana mint but NOT a case-flipped one", () => {
    // EVM mints fold case (above); Solana mints are base58 = case-significant.
    // Lower-casing a Solana mint must therefore lose the badge, not keep it.
    const real: Asset = { symbol: "USDT", chain: "solana", token: USDT_SOLANA_MINT, decimals: 6 };
    const flipped: Asset = { symbol: "USDT", chain: "solana", token: USDT_SOLANA_MINT.toLowerCase(), decimals: 6 };
    expect(isOfficialToken(real, official)).toBe(true);
    expect(isOfficialToken(flipped, official)).toBe(false);
  });
});
