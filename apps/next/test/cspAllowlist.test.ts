/**
 * Drift guard + behaviour for the CSP `connect-src` allowlist (re-audit Finding
 * 2). `src/lib/cspAllowlist.ts` is the SINGLE source the Edge middleware and the
 * Data Sources UI both read, but it cannot import `@wdk-web/wallet-core` (the
 * middleware runs in the Edge runtime, which can't load the compiled workspace
 * package). So the hand-listed `DEFAULT_RPC_ORIGINS` could silently drift from
 * wallet-core's real public RPCs. This test runs in Node, imports BOTH sides,
 * and fails if they disagree — the link the bundle can't enforce.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
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
  allowsWholesaleWss,
  envConnectSrcOrigins,
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

describe("envConnectSrcOrigins (NEXT_PUBLIC_CONNECT_SRC_ORIGINS)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is empty when the env var is unset/blank", () => {
    vi.stubEnv("NEXT_PUBLIC_CONNECT_SRC_ORIGINS", "");
    expect(envConnectSrcOrigins()).toEqual([]);
  });

  it("parses comma-separated values to origins, trims, and de-dupes", () => {
    vi.stubEnv(
      "NEXT_PUBLIC_CONNECT_SRC_ORIGINS",
      "https://indexer.example.com, https://indexer.example.com/v1/history , https://prices.example.com",
    );
    const origins = envConnectSrcOrigins();
    expect(origins).toContain("https://indexer.example.com");
    expect(origins).toContain("https://prices.example.com");
    expect(new Set(origins).size).toBe(origins.length);
  });

  it("flows into the allow-list so a self-hosted origin is permitted", () => {
    vi.stubEnv("NEXT_PUBLIC_CONNECT_SRC_ORIGINS", "https://indexer.example.com");
    expect(staticConnectSrcOrigins()).toContain("https://indexer.example.com");
    expect(isOriginAllowedByCsp("https://indexer.example.com")).toBe(true);
  });

  it("does NOT register the extra origin as an Ethereum RPC override", () => {
    // The dedicated knob must not bleed into NEXT_PUBLIC_ETHEREUM_RPC_URLS's
    // job — that separation is the whole point of the variable.
    vi.stubEnv("NEXT_PUBLIC_CONNECT_SRC_ORIGINS", "https://indexer.example.com");
    vi.stubEnv("NEXT_PUBLIC_ETHEREUM_RPC_URLS", "");
    expect(staticConnectSrcOrigins()).toContain("https://indexer.example.com");
  });
});

describe("wss: scheme is wholesale only until an Electrum origin is pinned", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("allows wss: wholesale by default (no Electrum origin pinned)", () => {
    vi.stubEnv("NEXT_PUBLIC_CONNECT_SRC_ORIGINS", "");
    expect(allowsWholesaleWss()).toBe(true);
    expect(isOriginAllowedByCsp("wss://anything.example.com:50002")).toBe(true);
  });

  it("drops wholesale wss: once an explicit wss:// origin is pinned", () => {
    vi.stubEnv("NEXT_PUBLIC_CONNECT_SRC_ORIGINS", "wss://electrum.mydomain.com:50004");
    expect(allowsWholesaleWss()).toBe(false);
    // The pinned endpoint still passes...
    expect(isOriginAllowedByCsp("wss://electrum.mydomain.com:50004")).toBe(true);
    // ...but an arbitrary secure socket no longer does — the pin is meaningful,
    // closing the wss: exfiltration channel a compromised dependency could use.
    expect(isOriginAllowedByCsp("wss://evil.example.com")).toBe(false);
  });
});
