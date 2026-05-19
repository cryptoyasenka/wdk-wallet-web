/**
 * Unwrap a scanned payment-URI envelope down to the bare recipient address.
 *
 * Handles BIP-21 (`bitcoin:<addr>?amount=…`) and EIP-681
 * (`ethereum:[pay-]<addr>[@chainId][?…]`). The scheme is matched
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
  const scheme = ["bitcoin:", "ethereum:"].find((s) =>
    trimmed.toLowerCase().startsWith(s),
  );
  if (!scheme) return trimmed;
  let rest = trimmed.slice(scheme.length);
  if (rest.toLowerCase().startsWith("pay-")) rest = rest.slice(4);
  const end = rest.search(/[?@]/);
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}
