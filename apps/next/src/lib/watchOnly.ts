/**
 * Watch-Only wallets (Phase 5).
 *
 * Read-only monitoring of an externally-supplied address without ever creating
 * or importing a hot seed. This is host-app layer only: watched addresses live
 * in localStorage and feed the engine's seedless `getBalancesForAddress` path
 * (see wallet-core `engine.ts`). No vault, no signer, no unlock is involved —
 * a watch-only session can show balances but can never sign, by construction.
 *
 * Scope is EVM-first: an EVM address (`0x` + 40 hex) is valid on every
 * configured EVM chain, so a watched entry pins ONE chain (the user's choice)
 * and the portfolio shows that chain's supported assets for the address.
 *
 * Hardening: persisted JSON is untrusted — every row is shape-validated on load
 * and malformed rows are dropped, never thrown on (mirrors contacts/dataSources).
 */
import type { ChainId } from "@wdk-web/wallet-core";

/** Chains a watch-only wallet may pin. EVM-first: BTC watch is future work. */
export const WATCH_CHAINS = ["ethereum", "polygon", "arbitrum", "plasma"] as const;
export type WatchChain = (typeof WATCH_CHAINS)[number];

export interface WatchedWallet {
  /** Stable id (address|chain) so a re-add of the same pair is idempotent. */
  readonly id: string;
  readonly chain: WatchChain;
  /** Checksummed-as-typed is not required; stored lowercased and 0x-prefixed. */
  readonly address: string;
  /** Optional user label. Absent when never set. */
  readonly label?: string;
  /** ms epoch the entry was added. */
  readonly createdAt: number;
}

const STORAGE_KEY = "wdk-watch-wallets";

/** `0x` followed by exactly 40 hex chars. Case-insensitive; no checksum check. */
export function isValidEvmAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value.trim());
}

/** Normalise an EVM address for storage/compare: trimmed, lowercased. */
export function normalizeEvmAddress(value: string): string {
  return value.trim().toLowerCase();
}

function isWatchChain(v: unknown): v is WatchChain {
  return typeof v === "string" && (WATCH_CHAINS as readonly string[]).includes(v);
}

function watchId(chain: WatchChain, address: string): string {
  return `${normalizeEvmAddress(address)}|${chain}`;
}

/** Coerce one untrusted row into a WatchedWallet, or null to drop it. */
function sanitizeRow(raw: unknown): WatchedWallet | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isWatchChain(r.chain)) return null;
  if (typeof r.address !== "string" || !isValidEvmAddress(r.address)) return null;
  const address = normalizeEvmAddress(r.address);
  const label =
    typeof r.label === "string" && r.label.trim().length > 0 ? r.label.trim() : undefined;
  const createdAt =
    typeof r.createdAt === "number" && Number.isFinite(r.createdAt) ? r.createdAt : Date.now();
  return {
    id: watchId(r.chain, address),
    chain: r.chain,
    address,
    ...(label !== undefined ? { label } : {}),
    createdAt,
  };
}

/**
 * Coerce untrusted persisted JSON into a deduped WatchedWallet list. Bad rows
 * are dropped; later duplicates of the same id are ignored (first wins).
 */
export function sanitizeWatchWallets(raw: unknown): WatchedWallet[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: WatchedWallet[] = [];
  for (const row of raw) {
    const w = sanitizeRow(row);
    if (!w || seen.has(w.id)) continue;
    seen.add(w.id);
    out.push(w);
  }
  return out;
}

function parse(): unknown {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** SSR-safe: returns [] when localStorage is unavailable or JSON is malformed. */
export function loadWatchWallets(): WatchedWallet[] {
  if (typeof localStorage === "undefined") return [];
  return sanitizeWatchWallets(parse());
}

export function saveWatchWallets(wallets: readonly WatchedWallet[]): WatchedWallet[] {
  const clean = sanitizeWatchWallets(wallets);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  } catch {
    // Best-effort; a full/blocked store leaves the in-memory value usable.
  }
  return clean;
}

/**
 * Add (or update the label of) a watched address. Returns the new list, or
 * null when the address is invalid (caller surfaces the error). Idempotent on
 * the (address, chain) pair — re-adding refreshes the label, never duplicates.
 */
export function addWatchWallet(
  wallets: readonly WatchedWallet[],
  input: { chain: WatchChain; address: string; label?: string },
): WatchedWallet[] | null {
  if (!isValidEvmAddress(input.address)) return null;
  const address = normalizeEvmAddress(input.address);
  const id = watchId(input.chain, address);
  const label = input.label?.trim();
  const entry: WatchedWallet = {
    id,
    chain: input.chain,
    address,
    ...(label ? { label } : {}),
    createdAt: Date.now(),
  };
  const existingIdx = wallets.findIndex((w) => w.id === id);
  if (existingIdx >= 0) {
    const next = wallets.slice();
    const prev = next[existingIdx]!;
    next[existingIdx] = { ...prev, ...(label ? { label } : {}) };
    return saveWatchWallets(next);
  }
  return saveWatchWallets([entry, ...wallets]);
}

export function removeWatchWallet(
  wallets: readonly WatchedWallet[],
  id: string,
): WatchedWallet[] {
  return saveWatchWallets(wallets.filter((w) => w.id !== id));
}

/** Narrow a WatchChain to the engine's ChainId (it is a subset by construction). */
export function watchChainToChainId(chain: WatchChain): ChainId {
  return chain;
}
