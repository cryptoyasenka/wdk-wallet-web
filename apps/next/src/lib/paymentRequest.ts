/**
 * Payment-request URI builders (Phase 1).
 *
 * Pure, framework-free helpers that turn (asset + recipient address + optional
 * amount/memo) into a shareable payment URI + the string to encode as a QR.
 * No network, no storage, no React — so they unit-test cleanly and the Receive
 * card just renders what they return.
 *
 *  - EVM tokens (USDT / XAU₮) → EIP-681 `transfer` form:
 *      ethereum:<tokenContract>@<chainId>/transfer?address=<to>&uint256=<minorUnits>
 *  - EVM native (ETH / POL / XPL) → EIP-681 value form:
 *      ethereum:<to>@<chainId>?value=<weiMinorUnits>
 *  - BTC → BIP-21:
 *      bitcoin:<address>?amount=<btcDecimal>&message=<memo>
 *
 * Amount is taken as a human decimal string from the UI and converted to the
 * asset's minor units (bigint) for EVM; BIP-21 keeps a BTC decimal by spec.
 * An invalid/negative amount is rejected BEFORE any URI is produced.
 */
import type { Asset, ChainId } from "@wdk-web/wallet-core";

/** EIP-155 chain ids for the configured EVM networks. Mirrors chains/index.ts. */
const EVM_CHAIN_IDS: Partial<Record<ChainId, number>> = {
  ethereum: 1,
  polygon: 137,
  arbitrum: 42161,
  plasma: 9745,
};

export class InvalidAmountError extends Error {
  constructor(message = "amount must be a positive decimal") {
    super(message);
    this.name = "InvalidAmountError";
  }
}

/**
 * Parse a human decimal string ("1.5", "0.000001") into minor units for a given
 * `decimals`, as bigint. Rejects empty, non-numeric, negative, or
 * more-fractional-digits-than-`decimals` input. No floats are used, so there is
 * no rounding error.
 */
export function decimalToMinorUnits(decimal: string, decimals: number): bigint {
  const trimmed = decimal.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new InvalidAmountError();
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > decimals) {
    throw new InvalidAmountError(`at most ${decimals} fractional digits`);
  }
  const padded = frac.padEnd(decimals, "0");
  const value = BigInt(whole + padded);
  if (value <= 0n) throw new InvalidAmountError();
  return value;
}

/** True when this asset/chain can be expressed as a payment request URI here. */
export function canBuildRequest(asset: Asset): boolean {
  if (asset.chain === "bitcoin") return true;
  return EVM_CHAIN_IDS[asset.chain] !== undefined;
}

/**
 * Build a payment-request URI for `asset` paid to `address`. `amountDecimal` is
 * optional (a bare request with no amount is valid); when present it is
 * validated and converted. `memo` becomes the BIP-21 `message` for BTC; EVM has
 * no standard memo field in EIP-681 `transfer`, so it is ignored there (the UI
 * surfaces it as a copyable reference, not a wallet-honoured field).
 *
 * Throws `InvalidAmountError` for a malformed amount, before producing any URI.
 */
export function buildPaymentRequestUri(
  asset: Asset,
  address: string,
  amountDecimal?: string,
  memo?: string,
): string {
  if (asset.chain === "bitcoin") {
    const params = new URLSearchParams();
    if (amountDecimal && amountDecimal.trim() !== "") {
      // Validate as a positive decimal; BIP-21 keeps the BTC-denominated value.
      decimalToMinorUnits(amountDecimal, asset.decimals);
      params.set("amount", amountDecimal.trim());
    }
    if (memo && memo.trim() !== "") params.set("message", memo.trim());
    const query = params.toString();
    return query ? `bitcoin:${address}?${query}` : `bitcoin:${address}`;
  }

  const chainId = EVM_CHAIN_IDS[asset.chain];
  if (chainId === undefined) {
    throw new Error(`no payment-request mapping for chain ${asset.chain}`);
  }

  const hasAmount = amountDecimal !== undefined && amountDecimal.trim() !== "";
  const minor = hasAmount ? decimalToMinorUnits(amountDecimal, asset.decimals) : null;

  if (asset.token) {
    // ERC-20 transfer request (EIP-681).
    const params = new URLSearchParams();
    params.set("address", address);
    if (minor !== null) params.set("uint256", minor.toString());
    return `ethereum:${asset.token}@${chainId}/transfer?${params.toString()}`;
  }

  // Native-coin request (EIP-681 value form).
  const base = `ethereum:${address}@${chainId}`;
  return minor !== null ? `${base}?value=${minor.toString()}` : base;
}
