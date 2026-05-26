/**
 * Block-explorer URL mapping.
 *
 * Every chain the wallet supports maps to a public block explorer so
 * transaction hashes in the Activity list and recipient addresses in the
 * pre-send safety panel are clickable.
 */

import type { ChainId } from "@wdk-web/wallet-core";

const EXPLORERS: Record<ChainId, { readonly tx: string; readonly address: string }> = {
  bitcoin: { tx: "https://mempool.space/tx/", address: "https://mempool.space/address/" },
  ethereum: { tx: "https://etherscan.io/tx/", address: "https://etherscan.io/address/" },
  polygon: { tx: "https://polygonscan.com/tx/", address: "https://polygonscan.com/address/" },
  arbitrum: { tx: "https://arbiscan.io/tx/", address: "https://arbiscan.io/address/" },
  plasma: { tx: "https://explorer.plasma.build/tx/", address: "https://explorer.plasma.build/address/" },
  tron: { tx: "https://tronscan.org/#/transaction/", address: "https://tronscan.org/#/address/" },
};

export function explorerUrl(chain: ChainId, hash: string): string {
  return `${EXPLORERS[chain].tx}${hash}`;
}

export function addressExplorerUrl(chain: ChainId, address: string): string {
  return `${EXPLORERS[chain].address}${address}`;
}
