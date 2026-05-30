/**
 * Canonical form for address identity. EVM is case-insensitive (lower-case);
 * BTC (base58/bech32) and Solana (base58) are case-significant (trim only).
 *
 * Lives in its own module so both safety.ts and contacts.ts can share it
 * without a circular import (safety.ts already imports the `Contact` type from
 * contacts.ts).
 */
export function normalizeAddress(addr: string, chain: string): string {
  const t = addr.trim();
  return chain === "bitcoin" || chain === "solana" ? t : t.toLowerCase();
}
