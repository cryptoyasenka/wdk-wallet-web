/**
 * The local activity log — Option A backing for `WalletEngine.getActivity`.
 *
 * Alpha WDK exposes no transaction-history API (verified 2026-05-17: there is
 * `getTransactionReceipt(hash)` but nothing that lists a wallet's txs). Rather
 * than fabricate history or return empty, the engine records every outgoing
 * send it performs into this append-only log, persisted through the injected
 * `StorageAdapter`, and refreshes each pending entry's status via the receipt
 * lookup. The honest limit (documented in docs/ARCHITECTURE.md → ADR-003): it
 * covers only sends made *by this wallet through this app* — inbound transfers
 * and sends from another client are not visible until WDK ships an indexer.
 *
 * This module is pure persistence + (de)serialisation: no `@tetherto/*`, no
 * framework, no crypto. The activity log is non-secret (it is the user's own
 * public tx metadata) and non-critical: a corrupt or unreadable log must never
 * brick the wallet, so every read failure degrades to an empty list instead of
 * throwing.
 */
import type { ActivityItem, Asset, ChainId, StorageAdapter } from "../types.js";

/** Versioned so a format change is a clean key bump, mirroring the vault. */
export const ACTIVITY_KEY = "wdk:activity:v1";
const ENVELOPE_VERSION = 1;

/**
 * What is actually stored. The public `ActivityItem` is returned to apps; the
 * extra `from` (sender address) stays internal — it is required to refresh a
 * Bitcoin tx's status, because WDK's BTC `getTransactionReceipt` is scoped to
 * an address's history, not a global hash lookup.
 */
export type StoredActivityItem = ActivityItem & { readonly from: string };

const DIRECTIONS = new Set<ActivityItem["direction"]>(["in", "out"]);
const STATUSES = new Set<ActivityItem["status"]>(["pending", "confirmed", "failed"]);

/** JSON-safe shape on disk: `bigint` amount becomes a decimal string. */
interface SerializedItem {
  hash: string;
  symbol: string;
  chain: string;
  token?: string;
  decimals: number;
  amount: string;
  direction: string;
  timestamp: number;
  status: string;
  from: string;
}

interface Envelope {
  v: number;
  items: SerializedItem[];
}

function serialize(item: StoredActivityItem): SerializedItem {
  const s: SerializedItem = {
    hash: item.hash,
    symbol: item.asset.symbol,
    chain: item.asset.chain,
    decimals: item.asset.decimals,
    amount: item.amount.toString(),
    direction: item.direction,
    timestamp: item.timestamp,
    status: item.status,
    from: item.from,
  };
  // exactOptionalPropertyTypes: only set `token` when it actually exists
  // (a native BTC send has no token and must not carry `token: undefined`).
  if (item.asset.token !== undefined) s.token = item.asset.token;
  return s;
}

/** Reconstruct one item, or `null` if any field is missing/ill-typed. */
function deserialize(raw: unknown): StoredActivityItem | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const {
    hash,
    symbol,
    chain,
    token,
    decimals,
    amount,
    direction,
    timestamp,
    status,
    from,
  } = r;
  if (
    typeof hash !== "string" ||
    typeof symbol !== "string" ||
    typeof chain !== "string" ||
    typeof decimals !== "number" ||
    typeof amount !== "string" ||
    typeof timestamp !== "number" ||
    typeof from !== "string" ||
    typeof direction !== "string" ||
    !DIRECTIONS.has(direction as ActivityItem["direction"]) ||
    typeof status !== "string" ||
    !STATUSES.has(status as ActivityItem["status"])
  ) {
    return null;
  }
  let parsedAmount: bigint;
  try {
    parsedAmount = BigInt(amount);
  } catch {
    return null;
  }
  // The symbol/chain are persisted strings; they are cast back to the public
  // unions. A log written by this package always holds valid values, and a
  // hand-corrupted one only mislabels the user's own metadata (never a
  // security boundary) — not worth a second runtime enum table here.
  const asset: Asset =
    typeof token === "string"
      ? {
          symbol: symbol as Asset["symbol"],
          chain: chain as ChainId,
          token,
          decimals,
        }
      : { symbol: symbol as Asset["symbol"], chain: chain as ChainId, decimals };
  return {
    hash,
    asset,
    amount: parsedAmount,
    direction: direction as ActivityItem["direction"],
    timestamp,
    status: status as ActivityItem["status"],
    from,
  };
}

/**
 * Read the whole log. Any failure — missing key, non-JSON bytes, wrong
 * envelope version, ill-typed entries — yields `[]`. Activity is best-effort
 * UI data; it must not be able to throw into a balance/send flow.
 */
export async function readLog(storage: StorageAdapter): Promise<StoredActivityItem[]> {
  let bytes: Uint8Array | null;
  try {
    bytes = await storage.get(ACTIVITY_KEY);
  } catch {
    return [];
  }
  if (bytes === null) return [];
  let envelope: Envelope;
  try {
    envelope = JSON.parse(new TextDecoder().decode(bytes)) as Envelope;
  } catch {
    return [];
  }
  if (
    typeof envelope !== "object" ||
    envelope === null ||
    envelope.v !== ENVELOPE_VERSION ||
    !Array.isArray(envelope.items)
  ) {
    return [];
  }
  const out: StoredActivityItem[] = [];
  for (const raw of envelope.items) {
    const item = deserialize(raw);
    if (item !== null) out.push(item); // skip a single bad row, keep the rest
  }
  return out;
}

/** Overwrite the log with `items` (envelope-wrapped, version-stamped). */
export async function writeLog(
  storage: StorageAdapter,
  items: readonly StoredActivityItem[],
): Promise<void> {
  const envelope: Envelope = { v: ENVELOPE_VERSION, items: items.map(serialize) };
  await storage.set(ACTIVITY_KEY, new TextEncoder().encode(JSON.stringify(envelope)));
}

/** Append one freshly-broadcast send to the log (read-modify-write). */
export async function appendSend(
  storage: StorageAdapter,
  item: StoredActivityItem,
): Promise<void> {
  const items = await readLog(storage);
  items.push(item);
  await writeLog(storage, items);
}
