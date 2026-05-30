/**
 * Pre-send safety helpers (Phase 2).
 *
 * Pure, framework-free classification used by the send confirmation panel to
 * make a transaction harder to misuse: is the recipient known, is it your own
 * address, does it look like an address-poisoning lookalike, and is the token a
 * known-official Tether contract. No network, no storage, no React — so the
 * heuristics are unit-tested in isolation and the panel just renders the result.
 */
import type { Asset, ChainId } from "@wdk-web/wallet-core";
import { normalizeAddress } from "./address";
import type { Contact } from "./contacts";

/**
 * Same payee? EVM compares case-insensitively; BTC and Solana are
 * case-significant (base58/bech32 carry meaning in case). `normalizeAddress`
 * is the single source of that rule, shared with the address book.
 */
function addressesEqual(a: string, b: string, chain: ChainId): boolean {
  return normalizeAddress(a, chain) === normalizeAddress(b, chain);
}

export type RecipientStatus =
  | { readonly kind: "self" }
  | { readonly kind: "saved"; readonly name: string }
  | { readonly kind: "recent" }
  | { readonly kind: "new" };

export interface RecipientContext {
  readonly to: string;
  readonly chain: ChainId;
  readonly contacts: readonly Contact[];
  readonly ownAddresses: ReadonlyArray<readonly [ChainId, string]>;
  readonly recentRecipient?: string | undefined;
  readonly recentChain?: ChainId | undefined;
}

/**
 * Classify the recipient relative to what the wallet already knows: one of the
 * user's own receive addresses, a saved contact, a recently-used recipient, or
 * a brand-new address. The first match wins in that order of confidence.
 */
export function classifyRecipient(ctx: RecipientContext): RecipientStatus {
  const { to, chain, contacts, ownAddresses, recentRecipient, recentChain } = ctx;
  for (const [c, addr] of ownAddresses) {
    if (c === chain && addressesEqual(addr, to, chain)) return { kind: "self" };
  }
  const saved = contacts.find((c) => c.chain === chain && addressesEqual(c.address, to, chain));
  if (saved) return { kind: "saved", name: saved.name };
  if (recentRecipient && recentChain === chain && addressesEqual(recentRecipient, to, chain)) {
    return { kind: "recent" };
  }
  return { kind: "new" };
}

export interface PoisoningMatch {
  readonly address: string;
  readonly name?: string;
}

/**
 * Address-poisoning heuristic. An attacker seeds your history/contacts with an
 * address whose first and last few characters match a real one you use, betting
 * you recognise only the ends before pasting. Flag when head AND tail match a
 * known address on the same chain but the full string differs. Returns the
 * resembled address so the UI can name what it looks like.
 */
export function detectPoisoning(ctx: RecipientContext, edge = 6): PoisoningMatch | null {
  const { to, chain, contacts, ownAddresses, recentRecipient, recentChain } = ctx;
  const norm = (s: string) => normalizeAddress(s, chain);
  const target = norm(to);
  if (target.length < edge * 2) return null;

  const candidates: PoisoningMatch[] = contacts
    .filter((c) => c.chain === chain)
    .map((c) => ({ address: c.address, name: c.name }));
  if (recentRecipient && recentChain === chain) candidates.push({ address: recentRecipient });
  // The classic trap is a lookalike of one of YOUR OWN receive addresses, so
  // include them as candidates too — same-chain only.
  for (const [c, addr] of ownAddresses) {
    if (c === chain) candidates.push({ address: addr, name: "your own address" });
  }

  for (const cand of candidates) {
    const a = norm(cand.address);
    if (a === target) continue; // exact match is a known-good recipient, not poisoning
    if (a.length < edge * 2) continue;
    if (a.slice(0, edge) === target.slice(0, edge) && a.slice(-edge) === target.slice(-edge)) {
      return cand;
    }
  }
  return null;
}

/** Chain-keyed (`chain:contract`) set from the bundled official asset list. */
export function officialTokenContracts(assets: readonly Asset[]): ReadonlySet<string> {
  const set = new Set<string>();
  for (const a of assets) if (a.token) set.add(`${a.chain}:${normalizeAddress(a.token, a.chain)}`);
  return set;
}

/**
 * True when this asset is a token whose contract is official ON ITS OWN CHAIN.
 * The chain is part of the key on purpose: a token on chain B whose address
 * happens to equal an official contract on chain A must NOT inherit the badge,
 * or the official-Tether checkmark becomes spoofable.
 */
export function isOfficialToken(asset: Asset, official: ReadonlySet<string>): boolean {
  return asset.token !== undefined && official.has(`${asset.chain}:${normalizeAddress(asset.token, asset.chain)}`);
}
