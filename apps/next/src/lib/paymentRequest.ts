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
 *  - Solana (USD₮ / SOL) → Solana Pay transfer request:
 *      solana:<ownerAddress>?amount=<decimal>&spl-token=<mint>&message=<memo>
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

export class InvalidAddressError extends Error {
  constructor(message = "recipient address is not valid for this chain") {
    super(message);
    this.name = "InvalidAddressError";
  }
}

/**
 * Per-chain recipient sanity check, run BEFORE the address is interpolated into
 * a URI. EVM addresses must be the canonical 0x + 40 hex form. BTC addresses are
 * not re-validated character-class by character-class here (bech32/base58 is the
 * wallet's job), but the string must be non-empty and free of whitespace and the
 * URI delimiters (`?#&/: ` ) that would otherwise let a crafted address inject
 * extra URI parts. This is a guard against malformed/injecting input, not a
 * full address validator.
 */
export function assertValidRecipient(address: string, chain: ChainId): void {
  const a = address.trim();
  if (a === "") throw new InvalidAddressError("recipient address is empty");
  if (chain === "bitcoin") {
    if (/[\s?#&/:]/.test(a)) throw new InvalidAddressError("bitcoin address has invalid characters");
    return;
  }
  if (chain === "solana") {
    // Base58 (Bitcoin alphabet) inherently excludes whitespace and every URI
    // delimiter (?#&/: ), so a charset+length check both shape-checks the pubkey
    // and blocks URI injection. Not an on-curve check — the wallet's own
    // derivation produces valid keys; this guards crafted/injecting input.
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) {
      throw new InvalidAddressError("solana address must be base58 (32–44 chars)");
    }
    return;
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) {
    throw new InvalidAddressError("EVM address must be 0x followed by 40 hex characters");
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
  if (asset.chain === "bitcoin" || asset.chain === "solana") return true;
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
  // Reject a malformed/injecting recipient before it reaches any URI.
  assertValidRecipient(address, asset.chain);
  const to = address.trim();

  if (asset.chain === "bitcoin") {
    const params = new URLSearchParams();
    if (amountDecimal && amountDecimal.trim() !== "") {
      // Validate as a positive decimal; BIP-21 keeps the BTC-denominated value.
      decimalToMinorUnits(amountDecimal, asset.decimals);
      params.set("amount", amountDecimal.trim());
    }
    if (memo && memo.trim() !== "") params.set("message", memo.trim());
    const query = params.toString();
    return query ? `bitcoin:${to}?${query}` : `bitcoin:${to}`;
  }

  if (asset.chain === "solana") {
    // Solana Pay transfer request: recipient is the OWNER address (the paying
    // wallet derives the associated token account itself — never the ATA here),
    // `amount` is in DECIMAL "user" units (uiAmountString, NOT base units like
    // EVM), and `spl-token` names the mint. The amount is validated against the
    // mint's decimals; the memo surfaces as Solana Pay `message` (wallet-shown).
    const params = new URLSearchParams();
    if (amountDecimal && amountDecimal.trim() !== "") {
      decimalToMinorUnits(amountDecimal, asset.decimals); // throws on >decimals / ≤0
      params.set("amount", amountDecimal.trim());
    }
    if (asset.token) params.set("spl-token", asset.token);
    if (memo && memo.trim() !== "") params.set("message", memo.trim());
    const query = params.toString();
    return query ? `solana:${to}?${query}` : `solana:${to}`;
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
    params.set("address", to);
    if (minor !== null) params.set("uint256", minor.toString());
    return `ethereum:${asset.token}@${chainId}/transfer?${params.toString()}`;
  }

  // Native-coin request (EIP-681 value form).
  const base = `ethereum:${to}@${chainId}`;
  return minor !== null ? `${base}?value=${minor.toString()}` : base;
}
