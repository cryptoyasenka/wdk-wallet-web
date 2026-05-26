/**
 * Block-explorer URL mapping.
 *
 * Every chain the wallet supports maps to a public block explorer so
 * transaction hashes in the Activity list are clickable.
 */

import type { ChainId } from "@wdk-web/wallet-core";

const EXPLORERS: Record<ChainId, string> = {
  bitcoin: "https://mempool.space/tx/",
  ethereum: "https://etherscan.io/tx/",
  polygon: "https://polygonscan.com/tx/",
  arbitrum: "https://arbiscan.io/tx/",
  plasma: "https://explorer.plasma.build/tx/",
  tron: "https://tronscan.org/#/transaction/",
};

export function explorerUrl(chain: ChainId, hash: string): string {
  return `${EXPLORERS[chain]}${hash}`;
}
