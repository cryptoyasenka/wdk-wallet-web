/**
 * Drift guard + behaviour for the CSP `connect-src` allowlist (re-audit Finding
 * 2). `src/lib/cspAllowlist.ts` is the SINGLE source the Edge middleware and the
 * Data Sources UI both read, but it cannot import `@wdk-web/wallet-core` (the
 * middleware runs in the Edge runtime, which can't load the compiled workspace
 * package). So the hand-listed `DEFAULT_RPC_ORIGINS` could silently drift from
 * wallet-core's real public RPCs. This test runs in Node, imports BOTH sides,
 * and fails if they disagree — the link the bundle can't enforce.
 */
import { describe, expect, it } from "vitest";
import {
  ETHEREUM_PUBLIC_RPCS,
  POLYGON_PUBLIC_RPCS,
  ARBITRUM_PUBLIC_RPCS,
  PLASMA_PUBLIC_RPCS,
  SOLANA_PUBLIC_RPCS,
} from "@wdk-web/wallet-core";
import {
  DEFAULT_RPC_ORIGINS,
  COINGECKO_ORIGIN,
  staticConnectSrcOrigins,
  isOriginAllowedByCsp,
} from "../src/lib/cspAllowlist";

const walletCoreOrigins = [
  ...ETHEREUM_PUBLIC_RPCS,
  ...POLYGON_PUBLIC_RPCS,
  ...ARBITRUM_PUBLIC_RPCS,
  ...PLASMA_PUBLIC_RPCS,
  ...SOLANA_PUBLIC_RPCS,
].map((url) => new URL(url).origin);

describe("cspAllowlist drift guard", () => {
  it("covers every wallet-core public RPC origin", () => {
    for (const origin of walletCoreOrigins) {
      expect(DEFAULT_RPC_ORIGINS).toContain(origin);
    }
  });

  it("has no stale origins absent from wallet-core", () => {
    const fromCore = new Set(walletCoreOrigins);
    for (const origin of DEFAULT_RPC_ORIGINS) {
      expect(fromCore.has(origin)).toBe(true);
    }
  });
});

describe("staticConnectSrcOrigins", () => {
  it("includes the price oracle and every default RPC origin", () => {
    const origins = staticConnectSrcOrigins();
    expect(origins).toContain(COINGECKO_ORIGIN);
    for (const o of DEFAULT_RPC_ORIGINS) expect(origins).toContain(o);
  });

  it("is de-duplicated (rpc.ankr.com appears once)", () => {
    const origins = staticConnectSrcOrigins();
    expect(new Set(origins).size).toBe(origins.length);
  });
});

describe("isOriginAllowedByCsp", () => {
  it("allows any wss:// origin wholesale (operator-supplied Electrum)", () => {
    expect(isOriginAllowedByCsp("wss://electrum.example.com:50004")).toBe(true);
  });

  it("allows the CoinGecko price oracle", () => {
    expect(isOriginAllowedByCsp(COINGECKO_ORIGIN)).toBe(true);
  });

  it("allows a shipped default RPC origin", () => {
    expect(isOriginAllowedByCsp("https://eth.llamarpc.com")).toBe(true);
  });

  it("blocks an arbitrary https origin not in the allowlist", () => {
    expect(isOriginAllowedByCsp("https://evil.example.com")).toBe(false);
  });

  it("blocks a plaintext ws:// origin (only wss: is wholesale-allowed)", () => {
    expect(isOriginAllowedByCsp("ws://insecure.example.com")).toBe(false);
  });
});
