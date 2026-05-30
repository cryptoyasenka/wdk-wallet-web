/**
 * Unwrap a scanned payment-URI envelope down to the bare recipient address.
 *
 * Handles BIP-21 (`bitcoin:<addr>?amount=…`), EIP-681 — both the native
 * value form (`ethereum:[pay-]<addr>[@chainId][?value=…]`) and the ERC-20
 * `transfer` form (`ethereum:<token>[@chainId]/transfer?address=<recipient>`),
 * whose real recipient is the `address` query param, not the leading token
 * contract — and Solana Pay (`solana:<owner>?amount=…&spl-token=<mint>&…`),
 * whose recipient is the owner before the query string (this app generates
 * exactly that QR). The scheme is matched
 * case-insensitively; the address itself keeps its original case because
 * base58, bech32 and EIP-55 checksums are all case-significant.
 * Anything without a known scheme is returned trimmed and otherwise
 * untouched — a plain pasted or scanned address.
 *
 * This deliberately does NOT validate the address. The existing wallet-core
 * Send path is the single source of truth for recipient validity (DRY +
 * honest: one validator, not two that can drift apart). `extractAddress` only
 * unwraps the URI envelope; an invalid address still fails downstream exactly
 * as a hand-typed invalid one does.
 *
 * Byte-identical in apps/next/src/lib and apps/svelte/src/lib so "one core,
 * two real apps" stays honest down to the QR-scan helper.
 */
export function extractAddress(raw: string): string {
  const trimmed = raw.trim();
  const scheme = ["bitcoin:", "ethereum:", "solana:"].find((s) =>
    trimmed.toLowerCase().startsWith(s),
  );
  if (!scheme) return trimmed;
  let rest = trimmed.slice(scheme.length);
  if (rest.toLowerCase().startsWith("pay-")) rest = rest.slice(4);
  // EIP-681 puts an ERC-20 transfer's real recipient in the `address` query
  // param; the leading target is the TOKEN contract. Only the function-call
  // form (path contains `/`, e.g. `/transfer`) uses it — the BIP-21 and
  // EIP-681 native-value forms have no such param, so their leading target
  // stays the recipient. Without this, scanning this app's own USDT/XAU₮
  // request QR put the token contract into the recipient field.
  const qIndex = rest.indexOf("?");
  const path = qIndex === -1 ? rest : rest.slice(0, qIndex);
  const query = qIndex === -1 ? "" : rest.slice(qIndex + 1);
  if (path.includes("/") && query) {
    const recipient = new URLSearchParams(query).get("address");
    if (recipient && recipient.trim() !== "") return recipient.trim();
  }
  const end = path.search(/[@/]/);
  return (end === -1 ? path : path.slice(0, end)).trim();
}
