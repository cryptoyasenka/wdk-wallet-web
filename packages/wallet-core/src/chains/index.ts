/**
 * Chain & asset configuration.
 *
 * This is the web port of the RN starter's `config/` — the platform-agnostic
 * layer Tether already factored out. It is pure data: no WDK import, no
 * framework. The `wdk/` adapter consumes a `ChainRegistry`; the engine consumes
 * `DEFAULT_ASSETS`. The asset set (BTC / USDT / XAU₮) mirrors the RN starter
 * exactly, so screen-for-screen parity is a config decision, not a rewrite.
 *
 * Contract addresses verified against Etherscan token pages on 2026-05-17.
 * They are checksummed (EIP-55). Re-verify on any token migration.
 */
import type { Asset } from "../types.js";
import type { ChainRegistry } from "../wdk/types.js";

/* ---- Token contracts (Ethereum mainnet, verified 2026-05-17) ----------- */

/** Tether USD (USDT), ERC-20, 6 decimals. etherscan.io/token/0xdAC17F95… */
export const USDT_ETHEREUM = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
/**
 * Tether Gold (XAU₮), ERC-20, 6 decimals — the CURRENT contract. An older
 * deployment (0x4922a015…) is deprecated; do not use it.
 * etherscan.io/token/0x68749665FF8D2d112Fa859AA293F07A622782F38
 */
export const XAUT_ETHEREUM = "0x68749665FF8D2d112Fa859AA293F07A622782F38";

/* ---- Token contracts (Polygon / Arbitrum / Plasma, verified 2026-05-19) -
 *
 * Tether is not deployed as XAU₮ on these networks (XAU₮ is Ethereum +
 * Tron/BNB/Avalanche; XAUt0 on TON/Conflux), so only USDT is modelled here —
 * adding a non-existent XAU₮ row would be a balance the wallet could never
 * honestly show. Addresses are EIP-55 checksummed, taken from each chain's
 * canonical block-explorer token page. On Arbitrum/Plasma the canonical
 * Tether deployment is the omnichain USD₮0 (1:1 USDT, 6 decimals); it is the
 * USDT a wallet on those chains is expected to hold.
 */

/** USDT, ERC-20, 6 decimals. polygonscan.com token page. */
export const USDT_POLYGON = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
/** USDT (USD₮0) on Arbitrum One, 6 decimals. arbiscan.io token page. */
export const USDT_ARBITRUM = "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9";
/** USDT (USD₮0) on Plasma mainnet, 6 decimals. plasmascan.to token page. */
export const USDT_PLASMA = "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb";

/* ---- RPC / network defaults -------------------------------------------- */

/**
 * Keyless public Ethereum RPCs. Passed as an array → WDK's EVM manager uses
 * them as a native failover list (one reason we don't ship
 * @tetherto/wdk-failover-provider). Public nodes are rate-limited; production
 * should override with a keyed RPC or the WDK Indexer (see .env.example).
 */
export const ETHEREUM_PUBLIC_RPCS: readonly string[] = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.llamarpc.com",
  "https://rpc.ankr.com/eth",
];

const ETHEREUM_CHAIN_ID = 1;

/**
 * Keyless public RPCs for the extra EVM networks — same failover-array
 * convention as Ethereum (WDK's EVM manager treats the array as a native
 * failover list). Public nodes are rate-limited; production should override
 * via `BuildChainsOptions` / `.env`. ChainIds are the canonical values
 * (chainlist + each chain's own docs): Polygon PoS 137, Arbitrum One 42161,
 * Plasma mainnet 9745.
 */
export const POLYGON_PUBLIC_RPCS: readonly string[] = [
  "https://polygon-rpc.com",
  "https://polygon-bor-rpc.publicnode.com",
  "https://rpc.ankr.com/polygon",
];
export const ARBITRUM_PUBLIC_RPCS: readonly string[] = [
  "https://arb1.arbitrum.io/rpc",
  "https://arbitrum-one-rpc.publicnode.com",
  "https://rpc.ankr.com/arbitrum",
];
/**
 * Plasma is a stablecoin-focused EVM L1 (Reth-based, full EVM compat). Simple
 * USD₮ transfers are gasless via a protocol-managed paymaster; every other
 * transaction pays its fee in XPL — so XPL is the honest fee asset
 * (see `feeAssetFor`). One official public endpoint at present.
 */
export const PLASMA_PUBLIC_RPCS: readonly string[] = ["https://rpc.plasma.to"];

const POLYGON_CHAIN_ID = 137;
const ARBITRUM_CHAIN_ID = 42161;
const PLASMA_CHAIN_ID = 9745;

/* ---- Asset set (parity with wdk-starter-react-native) ------------------- */

/**
 * BTC is native (no `token`). USDT/XAU₮ are ERC-20 on Ethereum. `token` is
 * omitted (not set to `undefined`) for BTC to satisfy
 * `exactOptionalPropertyTypes`.
 */
export const DEFAULT_ASSETS: readonly Asset[] = [
  { symbol: "BTC", chain: "bitcoin", decimals: 8 },
  { symbol: "USDT", chain: "ethereum", token: USDT_ETHEREUM, decimals: 6 },
  { symbol: "XAUT", chain: "ethereum", token: XAUT_ETHEREUM, decimals: 6 },
  { symbol: "USDT", chain: "polygon", token: USDT_POLYGON, decimals: 6 },
  { symbol: "USDT", chain: "arbitrum", token: USDT_ARBITRUM, decimals: 6 },
  { symbol: "USDT", chain: "plasma", token: USDT_PLASMA, decimals: 6 },
];

/**
 * Native gas/fee assets — NOT holdable portfolio balances; used only to label
 * `FeeQuote.feeAsset`. A Bitcoin fee is paid in BTC (8 decimals). EVM gas is
 * paid in the chain's own native coin (always 18 decimals — the EVM wei
 * invariant, not a looked-up market figure): Ethereum and Arbitrum One both
 * settle gas in ETH (Arbitrum reuses `ETH_NATIVE`), Polygon PoS in POL
 * (renamed from MATIC), Plasma in XPL.
 */
export const ETH_NATIVE: Asset = { symbol: "ETH", chain: "ethereum", decimals: 18 };
export const BTC_NATIVE: Asset = { symbol: "BTC", chain: "bitcoin", decimals: 8 };
export const POL_NATIVE: Asset = { symbol: "POL", chain: "polygon", decimals: 18 };
export const XPL_NATIVE: Asset = { symbol: "XPL", chain: "plasma", decimals: 18 };

/* ---- Chain registry ---------------------------------------------------- */

export interface BuildChainsOptions {
  /** Override the keyless public Ethereum RPC list. */
  ethereumRpcUrls?: readonly string[];
  /** Override the keyless public Polygon RPC list. */
  polygonRpcUrls?: readonly string[];
  /** Override the keyless public Arbitrum One RPC list. */
  arbitrumRpcUrls?: readonly string[];
  /** Override the keyless public Plasma RPC list. */
  plasmaRpcUrls?: readonly string[];
  /**
   * Bitcoin Electrum-over-WebSocket endpoint (`wss://…`). The browser cannot
   * open raw Electrum TCP, and there is no universally-available public
   * Electrum-WS server, so BTC is only registered when the host supplies this
   * (from env / config). Omitting it is honest: BTC balances then raise a
   * typed UnsupportedChainError rather than silently reading nothing.
   */
  btcElectrumWsUrl?: string;
}

/**
 * Build a `ChainRegistry`. The EVM networks (Ethereum, Polygon, Arbitrum One,
 * Plasma) are always present — each only needs a keyless public RPC, so
 * adding a chain here is a pure config change (no per-chain code: WDK's EVM
 * manager is fully generic, see `wdk/wdk-core.ts → registerAll`). Bitcoin is
 * added only when an Electrum-WS URL is provided, because the browser cannot
 * open a raw Electrum socket and there is no universal public one.
 */
export function buildChainRegistry(opts: BuildChainsOptions = {}): ChainRegistry {
  const registry: ChainRegistry = {
    ethereum: {
      kind: "evm",
      chain: "ethereum",
      chainId: ETHEREUM_CHAIN_ID,
      rpcUrls: opts.ethereumRpcUrls ?? ETHEREUM_PUBLIC_RPCS,
    },
    polygon: {
      kind: "evm",
      chain: "polygon",
      chainId: POLYGON_CHAIN_ID,
      rpcUrls: opts.polygonRpcUrls ?? POLYGON_PUBLIC_RPCS,
    },
    arbitrum: {
      kind: "evm",
      chain: "arbitrum",
      chainId: ARBITRUM_CHAIN_ID,
      rpcUrls: opts.arbitrumRpcUrls ?? ARBITRUM_PUBLIC_RPCS,
    },
    plasma: {
      kind: "evm",
      chain: "plasma",
      chainId: PLASMA_CHAIN_ID,
      rpcUrls: opts.plasmaRpcUrls ?? PLASMA_PUBLIC_RPCS,
    },
  };
  if (opts.btcElectrumWsUrl) {
    registry.bitcoin = {
      kind: "btc",
      chain: "bitcoin",
      network: "bitcoin",
      electrumWsUrl: opts.btcElectrumWsUrl,
    };
  }
  return registry;
}

/** Default registry: all four EVM nets (BTC needs an explicit Electrum-WS URL). */
export const DEFAULT_CHAINS: ChainRegistry = buildChainRegistry();
