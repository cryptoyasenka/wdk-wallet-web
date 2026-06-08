/**
 * Data-source / privacy settings (Phase 4).
 *
 * Makes every network endpoint the wallet talks to explicit and user-owned: the
 * EVM RPCs, the Bitcoin Electrum-WS server, an optional history indexer, and the
 * CoinGecko price oracle. Defaults are privacy-preserving (public RPCs, no
 * indexer, local-only activity) and the price oracle — the one undisclosed
 * third-party call in the app — becomes a disclosed, opt-out toggle.
 *
 * This is host-app layer only: it is persisted in localStorage and merged into
 * the engine's chain options at construction (see `engine.ts`). It is NEVER
 * threaded into wallet-core, which stays env/option-driven and storage-agnostic.
 *
 * Hardening: persisted JSON is untrusted — every field is shape-validated on
 * load and bad values fall back to the privacy-preserving default, never throw.
 */

import { isOriginAllowedByCsp } from "./cspAllowlist";

export type IndexerMode = "local" | "indexer";

export interface DataSources {
  /** Empty list = use the keyless public RPC default for that chain. */
  ethereumRpcUrls: string[];
  polygonRpcUrls: string[];
  arbitrumRpcUrls: string[];
  plasmaRpcUrls: string[];
  /** Solana is non-EVM but its RPC is reached over the same https `fetch`. */
  solanaRpcUrls: string[];
  /** `wss://…`. Empty = BTC stays unregistered (honest UnsupportedChainError). */
  btcElectrumWsUrl: string;
  /** `local` = outgoing log only; `indexer` = also query the configured indexer. */
  indexerMode: IndexerMode;
  indexerUrl: string;
  /** Default on. When off, no CoinGecko call is made at all. */
  pricesEnabled: boolean;
  /** Empty = the default CoinGecko host. */
  priceEndpoint: string;
}

export const DEFAULT_PRICE_ENDPOINT = "https://api.coingecko.com";

export const DEFAULT_DATA_SOURCES: DataSources = {
  ethereumRpcUrls: [],
  polygonRpcUrls: [],
  arbitrumRpcUrls: [],
  plasmaRpcUrls: [],
  solanaRpcUrls: [],
  btcElectrumWsUrl: "",
  indexerMode: "local",
  indexerUrl: "",
  pricesEnabled: true,
  priceEndpoint: "",
};

const STORAGE_KEY = "wdk-data-sources";

/**
 * The two endpoints a deployment can set at build time via `NEXT_PUBLIC_*`
 * (statically inlined into the client bundle). Only the Ethereum RPC list and the
 * Bitcoin Electrum-WS URL are env-driven; every other chain rides keyless public
 * defaults. Read by BOTH the engine's chain-option layering and the Data Sources
 * card, so the endpoint disclosed to the user can never drift from the one the
 * wallet actually talks to — which is what keeps the "every network endpoint this
 * wallet talks to" privacy claim true on a deploy that, e.g., enables BTC via env.
 */
export interface DeployEndpointDefaults {
  ethereumRpcUrls: string[];
  btcElectrumWsUrl: string;
}

export function deployEndpointDefaults(): DeployEndpointDefaults {
  const ethereumRpcUrls = (process.env.NEXT_PUBLIC_ETHEREUM_RPC_URLS ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter((u) => u.length > 0);
  const btcElectrumWsUrl = process.env.NEXT_PUBLIC_BTC_ELECTRUM_WS_URL?.trim() ?? "";
  return { ethereumRpcUrls, btcElectrumWsUrl };
}

/**
 * Parse a comma/newline-separated list of URLs, keeping only those that parse
 * and whose protocol is allowed. Order is preserved; blanks and invalid entries
 * are dropped rather than throwing.
 */
export function parseUrlList(raw: string, schemes: readonly string[]): string[] {
  return raw
    .split(/[\n,]/)
    .map((u) => u.trim())
    .filter((u) => u.length > 0)
    .filter((u) => {
      try {
        return schemes.includes(new URL(u).protocol);
      } catch {
        return false;
      }
    });
}

/** `scheme://host[:port]` of a URL, or null if it does not parse. */
export function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * In a production build every endpoint must be TLS: a plaintext `http:`/`ws:`
 * origin both leaks the queried addresses on the wire and is mixed-content
 * blocked by the browser on the https-served app anyway, so we reject it at
 * validation time rather than store an origin that can never work. Dev keeps
 * the insecure schemes so a local node (`http://localhost:8545`) is testable.
 */
const DEV = process.env.NODE_ENV !== "production";
const HTTP_SCHEMES = (DEV ? ["http:", "https:"] : ["https:"]) as readonly string[];
const WS_SCHEMES = (DEV ? ["ws:", "wss:"] : ["wss:"]) as readonly string[];

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function validUrl(v: unknown, schemes: readonly string[]): string {
  if (typeof v !== "string" || v.trim() === "") return "";
  const [only] = parseUrlList(v, schemes);
  return only ?? "";
}

/**
 * Coerce untrusted persisted JSON into a DataSources, falling back to the
 * privacy-preserving default for any missing/malformed field.
 */
export function sanitizeDataSources(raw: unknown): DataSources {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_DATA_SOURCES };
  const r = raw as Record<string, unknown>;
  const urls = (key: string): string[] =>
    isStringArray(r[key]) ? parseUrlList((r[key] as string[]).join(","), HTTP_SCHEMES) : [];
  return {
    ethereumRpcUrls: urls("ethereumRpcUrls"),
    polygonRpcUrls: urls("polygonRpcUrls"),
    arbitrumRpcUrls: urls("arbitrumRpcUrls"),
    plasmaRpcUrls: urls("plasmaRpcUrls"),
    solanaRpcUrls: urls("solanaRpcUrls"),
    btcElectrumWsUrl: validUrl(r.btcElectrumWsUrl, WS_SCHEMES),
    indexerMode: r.indexerMode === "indexer" ? "indexer" : "local",
    indexerUrl: validUrl(r.indexerUrl, HTTP_SCHEMES),
    pricesEnabled: typeof r.pricesEnabled === "boolean" ? r.pricesEnabled : true,
    priceEndpoint: validUrl(r.priceEndpoint, HTTP_SCHEMES),
  };
}

/**
 * The set of `connect-src` origins implied by these settings — the explicitly
 * configured endpoints (RPC overrides, Electrum-WS, active indexer, price
 * oracle). Phase 6's CSP unions this with the public-RPC defaults that the
 * engine falls back to when an override list is empty. Explorers are excluded:
 * they are opened as navigations, not fetched.
 */
export function connectSrcOrigins(ds: DataSources): string[] {
  const out: string[] = [];
  const add = (url: string) => {
    const o = originOf(url);
    if (o && !out.includes(o)) out.push(o);
  };
  for (const list of [
    ds.ethereumRpcUrls,
    ds.polygonRpcUrls,
    ds.arbitrumRpcUrls,
    ds.plasmaRpcUrls,
    ds.solanaRpcUrls,
  ]) {
    list.forEach(add);
  }
  if (ds.btcElectrumWsUrl) add(ds.btcElectrumWsUrl);
  if (ds.indexerMode === "indexer" && ds.indexerUrl) add(ds.indexerUrl);
  if (ds.pricesEnabled) add(ds.priceEndpoint || DEFAULT_PRICE_ENDPOINT);
  return out;
}

/**
 * The subset of `connectSrcOrigins(ds)` that this deploy's static CSP will
 * BLOCK (re-audit Finding 2). The Edge middleware cannot read these localStorage
 * settings, so a custom RPC / indexer / price origin not covered by the shipped
 * allowlist (defaults + `NEXT_PUBLIC_*` env) silently fails at fetch time. The
 * Data Sources card surfaces this list so the limit is honest instead of a
 * dead setting — a self-hoster fixes it by widening the deploy env / their CSP.
 * Electrum-WS `wss://` origins are allowed wholesale by default, but once this
 * deploy pins an explicit `wss://` origin in `NEXT_PUBLIC_CONNECT_SRC_ORIGINS`,
 * any other secure-WebSocket origin is blocked and appears here.
 */
export function cspBlockedOrigins(ds: DataSources): string[] {
  return connectSrcOrigins(ds).filter((o) => !isOriginAllowedByCsp(o));
}

function parse(): unknown {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function loadDataSources(): DataSources {
  return sanitizeDataSources(parse());
}

export function saveDataSources(ds: DataSources): DataSources {
  const clean = sanitizeDataSources(ds);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  } catch {
    // Best-effort; a full/blocked store leaves the in-memory value usable.
  }
  return clean;
}

/** Price-oracle gate for `prices.ts` — read at call time so a toggle takes effect. */
export function arePricesEnabled(): boolean {
  return loadDataSources().pricesEnabled;
}

/** Effective CoinGecko base origin (override or default). */
export function priceBase(): string {
  return loadDataSources().priceEndpoint || DEFAULT_PRICE_ENDPOINT;
}
