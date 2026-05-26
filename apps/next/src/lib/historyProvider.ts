/**
 * Remote history provider (Phase 4 wiring — closes the indexer gap).
 *
 * The Data Sources card lets a user opt into "Use configured indexer" so the
 * activity list can show INBOUND transfers and sends made from another client —
 * which wallet-core's default outgoing-only local log can never show. This is
 * the host-app HTTP client that turns that setting into a real `historyProvider`,
 * injected into `createWalletEngine`'s optional config (see `engine.ts`).
 *
 * Host-app layer only: wallet-core stays storage/network-agnostic and merely
 * consumes the `{ getTransactionHistory }` port (wallet-core `engine.ts` merges
 * indexer items over the local log, preferring the indexer). When the indexer is
 * unset or the mode is `local`, NO provider is wired and no request is ever made.
 *
 * Expected indexer contract (generic, so any compatible indexer can be pointed
 * at it):
 *
 *   GET {baseUrl}/v1/history?chain={chain}&address={address}[&token={contract}]
 *   → 200 application/json
 *     { "transactions": [ {
 *         "hash": "0x…",            // transaction hash
 *         "direction": "in"|"out",  // relative to {address}
 *         "amount": "1000000",      // base units (string or integer), never float
 *         "timestamp": 1700000000,  // epoch seconds or ms
 *         "status": "confirmed"|"pending"|"failed"
 *       } ] }
 *
 * Hardening: the response is untrusted remote JSON. Every row is shape-validated
 * and malformed rows are dropped, never thrown on. A non-2xx, network, or parse
 * failure yields [] for that (chain, asset), so the core falls back to the local
 * log — a bad indexer degrades activity gracefully instead of breaking it.
 */
import {
  DEFAULT_ASSETS,
  type ActivityItem,
  type Asset,
  type ChainId,
} from "@wdk-web/wallet-core";

/** Structural match for wallet-core's `WalletEngineConfig.historyProvider`. */
export interface HistoryProvider {
  getTransactionHistory(
    chain: ChainId,
    address: string,
    tokenAddress?: string,
  ): Promise<readonly ActivityItem[]>;
}

const VALID_STATUS = new Set<ActivityItem["status"]>(["pending", "confirmed", "failed"]);
const VALID_DIRECTION = new Set<ActivityItem["direction"]>(["in", "out"]);

/**
 * Resolve the full Asset (symbol + decimals) for the (chain, token) the engine
 * queried, against the same `DEFAULT_ASSETS` set the engine derived the call
 * from. Native assets (BTC) carry no token, so an absent `tokenAddress` matches
 * the absent-token row. No match ⇒ null (we cannot honestly label the amount).
 */
function resolveAsset(chain: ChainId, tokenAddress: string | undefined): Asset | null {
  const token = tokenAddress?.toLowerCase();
  return (
    DEFAULT_ASSETS.find((a) => a.chain === chain && a.token?.toLowerCase() === token) ?? null
  );
}

/** Epoch seconds or ms → ms. Sub-1e12 values are treated as second-precision. */
function normalizeTimestamp(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
}

/** Base-unit amount as bigint from a decimal string or integer; null if invalid. */
function parseAmount(value: unknown): bigint | null {
  try {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) return BigInt(value);
    if (typeof value === "string" && /^\d+$/.test(value.trim())) return BigInt(value.trim());
    return null;
  } catch {
    return null;
  }
}

/** Coerce one untrusted indexer row into an ActivityItem, or null to drop it. */
function toActivityItem(raw: unknown, asset: Asset): ActivityItem | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.hash !== "string" || r.hash.length === 0) return null;
  if (typeof r.direction !== "string" || !VALID_DIRECTION.has(r.direction as ActivityItem["direction"]))
    return null;
  if (typeof r.status !== "string" || !VALID_STATUS.has(r.status as ActivityItem["status"]))
    return null;
  const amount = parseAmount(r.amount);
  if (amount === null) return null;
  const timestamp = normalizeTimestamp(r.timestamp);
  if (timestamp === null) return null;
  return {
    hash: r.hash,
    asset,
    amount,
    direction: r.direction as ActivityItem["direction"],
    timestamp,
    status: r.status as ActivityItem["status"],
  };
}

/**
 * Build an indexer-backed `historyProvider`. `baseUrl` is the user-configured
 * indexer origin (validated upstream in `dataSources.ts`). Trailing slashes are
 * trimmed so `${base}/v1/history` is well-formed regardless of how it was typed.
 */
export function createIndexerHistoryProvider(baseUrl: string): HistoryProvider {
  const root = baseUrl.replace(/\/+$/, "");
  return {
    async getTransactionHistory(chain, address, tokenAddress) {
      const asset = resolveAsset(chain, tokenAddress);
      if (!asset) return [];
      let url: string;
      try {
        const u = new URL(`${root}/v1/history`);
        u.searchParams.set("chain", chain);
        u.searchParams.set("address", address);
        if (tokenAddress) u.searchParams.set("token", tokenAddress);
        url = u.toString();
      } catch {
        return [];
      }
      try {
        const res = await fetch(url, { headers: { accept: "application/json" } });
        if (!res.ok) return [];
        const body: unknown = await res.json();
        const rows = (body as { transactions?: unknown } | null)?.transactions;
        if (!Array.isArray(rows)) return [];
        const out: ActivityItem[] = [];
        for (const row of rows) {
          const item = toActivityItem(row, asset);
          if (item) out.push(item);
        }
        return out;
      } catch {
        return [];
      }
    },
  };
}
