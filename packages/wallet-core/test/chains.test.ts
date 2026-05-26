/**
 * Step-4 config surface: the extra EVM nets (Polygon / Arbitrum / Plasma)
 * are reachable purely as data — `buildChainRegistry()` wiring, `DEFAULT_ASSETS`
 * rows, and the native fee-asset consts.
 *
 * Boundary note (honest, deliberate): `feeAssetFor` is module-private to
 * `src/wdk/wdk-core.ts`, the sole sanctioned `@tetherto/*` import site. Unit
 * tests never load real WDK (that is the whole reason `FakeWdkAdapter` exists,
 * and `engine.test.ts`'s fake signer hardcodes its own ETH/BTC fee label, so it
 * cannot exercise the real POL/XPL branches). `feeAssetFor` is a pure 1:1
 * lookup over exactly the chain set this file's config defines, so the honest
 * CI boundary is: (a) the native fee-asset consts it returns have the right
 * shape, and (b) the three nets are modelled while an unmodelled `ChainId`
 * member (`tron`) is absent from the registry and asset set — the exact
 * precondition that makes `feeAssetFor`'s typed `UnsupportedChainError` (and
 * the symmetric `requireChain`) reachable and honest. No live RPC is hit:
 * registering a keyless public RPC is a config fact, not a network call.
 */
import { describe, expect, it } from "vitest";
import {
  ARBITRUM_PUBLIC_RPCS,
  BTC_NATIVE,
  DEFAULT_ASSETS,
  DEFAULT_CHAINS,
  ETHEREUM_PUBLIC_RPCS,
  ETH_NATIVE,
  PLASMA_PUBLIC_RPCS,
  POLYGON_PUBLIC_RPCS,
  POL_NATIVE,
  USDT_ARBITRUM,
  USDT_PLASMA,
  USDT_POLYGON,
  XPL_NATIVE,
  buildChainRegistry,
} from "../src/chains/index.js";
import type { EvmChainConfig } from "../src/wdk/types.js";

/** Narrow a registry slot to its EVM config or fail loudly (never silent). */
function evm(
  registry: ReturnType<typeof buildChainRegistry>,
  chain: "ethereum" | "polygon" | "arbitrum" | "plasma",
): EvmChainConfig {
  const cfg = registry[chain];
  expect(cfg, `${chain} must be registered`).toBeDefined();
  expect(cfg?.kind).toBe("evm");
  return cfg as EvmChainConfig;
}

describe("chain registry — extra EVM nets are always-on", () => {
  it("registers Polygon / Arbitrum / Plasma with the canonical chainId", () => {
    const r = buildChainRegistry();
    expect(evm(r, "polygon").chainId).toBe(137);
    expect(evm(r, "arbitrum").chainId).toBe(42161);
    expect(evm(r, "plasma").chainId).toBe(9745);
    // Ethereum is still there; the new nets are additive, not a replacement.
    expect(evm(r, "ethereum").chainId).toBe(1);
  });

  it("wires each net to its keyless public RPC failover list by default", () => {
    const r = buildChainRegistry();
    expect(evm(r, "polygon").rpcUrls).toEqual(POLYGON_PUBLIC_RPCS);
    expect(evm(r, "arbitrum").rpcUrls).toEqual(ARBITRUM_PUBLIC_RPCS);
    expect(evm(r, "plasma").rpcUrls).toEqual(PLASMA_PUBLIC_RPCS);
    expect(evm(r, "ethereum").rpcUrls).toEqual(ETHEREUM_PUBLIC_RPCS);
    // Plasma's one official public endpoint — assert it exactly, not just
    // "non-empty", so a silent drop of the only RPC fails the build.
    expect(PLASMA_PUBLIC_RPCS).toEqual(["https://rpc.plasma.to"]);
  });

  it("lets the host override each RPC list without touching the others", () => {
    const r = buildChainRegistry({
      polygonRpcUrls: ["https://my-polygon.example"],
      arbitrumRpcUrls: ["https://my-arb.example"],
      plasmaRpcUrls: ["https://my-plasma.example"],
    });
    expect(evm(r, "polygon").rpcUrls).toEqual(["https://my-polygon.example"]);
    expect(evm(r, "arbitrum").rpcUrls).toEqual(["https://my-arb.example"]);
    expect(evm(r, "plasma").rpcUrls).toEqual(["https://my-plasma.example"]);
    // Untouched net keeps its public default.
    expect(evm(r, "ethereum").rpcUrls).toEqual(ETHEREUM_PUBLIC_RPCS);
  });

  it("does NOT register Bitcoin without an Electrum-WS URL (unchanged contract)", () => {
    // The new EVM nets are always-on (keyless public RPC); BTC still needs an
    // explicit socket URL — adding three EVM nets must not regress that.
    expect(buildChainRegistry().bitcoin).toBeUndefined();
    expect(DEFAULT_CHAINS.bitcoin).toBeUndefined();
    expect(evm(DEFAULT_CHAINS as ReturnType<typeof buildChainRegistry>, "plasma").chainId).toBe(
      9745,
    );
  });
});

describe("DEFAULT_ASSETS — USDT on the new nets, no fake XAU₮", () => {
  const rows = DEFAULT_ASSETS.filter(
    (a) => a.chain === "polygon" || a.chain === "arbitrum" || a.chain === "plasma",
  );

  it("adds exactly one USDT row per new net with the verified contract + 6 decimals", () => {
    const byChain = (chain: string) => rows.filter((a) => a.chain === chain);

    for (const chain of ["polygon", "arbitrum", "plasma"] as const) {
      const r = byChain(chain);
      expect(r, `${chain} should have a single asset row`).toHaveLength(1);
      expect(r[0]?.symbol).toBe("USDT");
      expect(r[0]?.decimals).toBe(6); // USDT / USD₮0 is universally 6-dec
    }
    expect(byChain("polygon")[0]?.token).toBe(USDT_POLYGON);
    expect(byChain("arbitrum")[0]?.token).toBe(USDT_ARBITRUM);
    expect(byChain("plasma")[0]?.token).toBe(USDT_PLASMA);
  });

  it("uses the EIP-55 checksummed contract addresses from each explorer", () => {
    // Pinned literals: a checksum/typo regression on a token address would
    // silently read the wrong contract's balance — assert the exact strings.
    expect(USDT_POLYGON).toBe("0xc2132D05D31c914a87C6611C10748AEb04B58e8F");
    expect(USDT_ARBITRUM).toBe("0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9");
    expect(USDT_PLASMA).toBe("0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb");
  });

  it("ships NO XAU₮ on Polygon/Arbitrum/Plasma (not a canonical Tether deploy there)", () => {
    // Honest: a balance the wallet could never truthfully show must not exist.
    expect(rows.some((a) => a.symbol === "XAUT")).toBe(false);
    // …while XAU₮ is still present where it is real (Ethereum).
    expect(
      DEFAULT_ASSETS.some((a) => a.symbol === "XAUT" && a.chain === "ethereum"),
    ).toBe(true);
  });
});

describe("native fee-asset consts — the values feeAssetFor returns", () => {
  it("labels EVM gas in the chain's own native coin at the 18-dec wei invariant", () => {
    expect(POL_NATIVE).toEqual({ symbol: "POL", chain: "polygon", decimals: 18 });
    expect(XPL_NATIVE).toEqual({ symbol: "XPL", chain: "plasma", decimals: 18 });
    // Arbitrum One settles gas in ETH → feeAssetFor reuses ETH_NATIVE; assert
    // it is the ETH 18-dec asset (so reuse stays honest, not a stale label).
    expect(ETH_NATIVE).toEqual({ symbol: "ETH", chain: "ethereum", decimals: 18 });
  });

  it("keeps BTC's fee asset distinct (paid in BTC, 8-dec, never in ETH)", () => {
    expect(BTC_NATIVE).toEqual({ symbol: "BTC", chain: "bitcoin", decimals: 8 });
  });

  it("models exactly 4 EVM chains + BTC — the precise wallet scope", () => {
    // feeAssetFor branches on ethereum/arbitrum/polygon/plasma/bitcoin and
    // throws otherwise. The ChainId union is exactly these five, so the scope
    // claim "4 EVM + BTC" is exact — no dangling, unwired members.
    const r = buildChainRegistry({ btcElectrumWsUrl: "wss://e.example:50004" });
    const modelled = Object.keys(r).sort();
    expect(modelled).toEqual(["arbitrum", "bitcoin", "ethereum", "plasma", "polygon"]);
    // Every default asset sits on a modelled chain.
    expect(DEFAULT_ASSETS.every((a) => modelled.includes(a.chain))).toBe(true);
  });
});
