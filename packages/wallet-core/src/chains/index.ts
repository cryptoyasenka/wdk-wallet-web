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
];

/**
 * Native gas/fee assets — NOT holdable portfolio balances; used only to label
 * `FeeQuote.feeAsset`. EVM gas (incl. for a USDT/XAU₮ transfer) is paid in ETH
 * (18 decimals); a Bitcoin transaction fee is paid in BTC (8 decimals).
 */
export const ETH_NATIVE: Asset = { symbol: "ETH", chain: "ethereum", decimals: 18 };
export const BTC_NATIVE: Asset = { symbol: "BTC", chain: "bitcoin", decimals: 8 };

/* ---- Chain registry ---------------------------------------------------- */

export interface BuildChainsOptions {
  /** Override the keyless public Ethereum RPC list. */
  ethereumRpcUrls?: readonly string[];
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
 * Build a `ChainRegistry`. Ethereum is always present (keyless public RPCs by
 * default); Bitcoin is added only when an Electrum-WS URL is provided.
 */
export function buildChainRegistry(opts: BuildChainsOptions = {}): ChainRegistry {
  const registry: ChainRegistry = {
    ethereum: {
      kind: "evm",
      chain: "ethereum",
      chainId: ETHEREUM_CHAIN_ID,
      rpcUrls: opts.ethereumRpcUrls ?? ETHEREUM_PUBLIC_RPCS,
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

/** Default registry: Ethereum only (BTC needs an explicit Electrum-WS URL). */
export const DEFAULT_CHAINS: ChainRegistry = buildChainRegistry();
