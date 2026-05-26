/**
 * Unit tests for the Phase-5 watch-only storage layer. These helpers are pure
 * or localStorage-resilient (the persist step is wrapped so it no-ops under the
 * node test env), so they pin the behaviour the onboarding "Watch" flow and the
 * read-only portfolio depend on: EVM address validation, untrusted-JSON
 * hardening (bad rows dropped, never thrown on), dedupe, and idempotent add.
 */
import { describe, expect, it } from "vitest";
import {
  WATCH_CHAINS,
  addWatchWallet,
  isValidEvmAddress,
  normalizeEvmAddress,
  removeWatchWallet,
  sanitizeWatchWallets,
  watchChainToChainId,
  type WatchedWallet,
} from "../src/lib/watchOnly";

const ADDR = "0x" + "a".repeat(40);
const ADDR2 = "0x" + "b".repeat(40);

describe("isValidEvmAddress", () => {
  it("accepts a 0x-prefixed 40-hex address, case-insensitively", () => {
    expect(isValidEvmAddress(ADDR)).toBe(true);
    expect(isValidEvmAddress("0x" + "A".repeat(40))).toBe(true);
    expect(isValidEvmAddress("  " + ADDR + "  ")).toBe(true); // trimmed
  });

  it("rejects wrong length, missing prefix, and non-hex", () => {
    expect(isValidEvmAddress("0x" + "a".repeat(39))).toBe(false);
    expect(isValidEvmAddress("0x" + "a".repeat(41))).toBe(false);
    expect(isValidEvmAddress("a".repeat(40))).toBe(false);
    expect(isValidEvmAddress("0x" + "z".repeat(40))).toBe(false);
    expect(isValidEvmAddress("")).toBe(false);
  });
});

describe("normalizeEvmAddress", () => {
  it("trims and lowercases", () => {
    expect(normalizeEvmAddress("  0x" + "A".repeat(40) + " ")).toBe(ADDR);
  });
});

describe("sanitizeWatchWallets", () => {
  it("returns [] for non-array input", () => {
    expect(sanitizeWatchWallets(null)).toEqual([]);
    expect(sanitizeWatchWallets({})).toEqual([]);
    expect(sanitizeWatchWallets("nope")).toEqual([]);
  });

  it("drops rows with a bad chain or address", () => {
    const out = sanitizeWatchWallets([
      { chain: "solana", address: ADDR, createdAt: 1 },
      { chain: "ethereum", address: "not-an-address", createdAt: 1 },
      { chain: "ethereum", address: ADDR, createdAt: 1 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.chain).toBe("ethereum");
    expect(out[0]?.address).toBe(ADDR);
  });

  it("lowercases the address and derives a stable id", () => {
    const out = sanitizeWatchWallets([
      { chain: "polygon", address: "0x" + "A".repeat(40), createdAt: 5 },
    ]);
    expect(out[0]?.address).toBe(ADDR);
    expect(out[0]?.id).toBe(`${ADDR}|polygon`);
  });

  it("dedupes the same (address, chain) pair, first wins", () => {
    const out = sanitizeWatchWallets([
      { chain: "ethereum", address: ADDR, label: "first", createdAt: 1 },
      { chain: "ethereum", address: ADDR, label: "second", createdAt: 2 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.label).toBe("first");
  });

  it("keeps the same address on different chains as distinct entries", () => {
    const out = sanitizeWatchWallets([
      { chain: "ethereum", address: ADDR, createdAt: 1 },
      { chain: "polygon", address: ADDR, createdAt: 1 },
    ]);
    expect(out).toHaveLength(2);
  });

  it("drops a blank label rather than storing an empty string", () => {
    const out = sanitizeWatchWallets([
      { chain: "ethereum", address: ADDR, label: "   ", createdAt: 1 },
    ]);
    expect(out[0]).not.toHaveProperty("label");
  });
});

describe("addWatchWallet", () => {
  it("returns null for an invalid address", () => {
    expect(addWatchWallet([], { chain: "ethereum", address: "bad" })).toBeNull();
  });

  it("prepends a new entry and normalises the address", () => {
    const out = addWatchWallet([], {
      chain: "arbitrum",
      address: "0x" + "C".repeat(40),
      label: "cold",
    });
    expect(out).toHaveLength(1);
    expect(out?.[0]?.address).toBe("0x" + "c".repeat(40));
    expect(out?.[0]?.label).toBe("cold");
    expect(out?.[0]?.chain).toBe("arbitrum");
  });

  it("is idempotent on the (address, chain) pair and refreshes the label", () => {
    const first = addWatchWallet([], { chain: "ethereum", address: ADDR, label: "a" })!;
    const second = addWatchWallet(first, { chain: "ethereum", address: ADDR, label: "b" })!;
    expect(second).toHaveLength(1);
    expect(second[0]?.label).toBe("b");
  });

  it("adds a second distinct address without dropping the first", () => {
    const first = addWatchWallet([], { chain: "ethereum", address: ADDR })!;
    const second = addWatchWallet(first, { chain: "ethereum", address: ADDR2 })!;
    expect(second).toHaveLength(2);
  });
});

describe("removeWatchWallet", () => {
  it("removes by id and leaves the rest", () => {
    const list: WatchedWallet[] = [
      { id: `${ADDR}|ethereum`, chain: "ethereum", address: ADDR, createdAt: 1 },
      { id: `${ADDR2}|polygon`, chain: "polygon", address: ADDR2, createdAt: 2 },
    ];
    const out = removeWatchWallet(list, `${ADDR}|ethereum`);
    expect(out).toHaveLength(1);
    expect(out[0]?.address).toBe(ADDR2);
  });
});

describe("watchChainToChainId / WATCH_CHAINS", () => {
  it("covers exactly the four EVM chains and maps through unchanged", () => {
    expect([...WATCH_CHAINS]).toEqual(["ethereum", "polygon", "arbitrum", "plasma"]);
    expect(watchChainToChainId("plasma")).toBe("plasma");
  });
});
