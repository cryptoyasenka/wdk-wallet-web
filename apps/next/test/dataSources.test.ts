/**
 * Unit tests for the Phase-4 data-source / privacy settings layer. The focus is
 * the pure logic the Settings card and the Phase-6 CSP depend on: URL list
 * validation, untrusted-JSON hardening (bad values fall back to the
 * privacy-preserving default, never throw), and the connect-src origin set.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DATA_SOURCES,
  DEFAULT_PRICE_ENDPOINT,
  connectSrcOrigins,
  cspBlockedOrigins,
  deployEndpointDefaults,
  originOf,
  parseUrlList,
  sanitizeDataSources,
} from "../src/lib/dataSources";

describe("parseUrlList", () => {
  it("keeps valid URLs of an allowed scheme, dropping the rest", () => {
    const raw = "https://a.example, http://b.example , not-a-url, ftp://c.example";
    expect(parseUrlList(raw, ["http:", "https:"])).toEqual(["https://a.example", "http://b.example"]);
  });

  it("splits on commas and newlines and ignores blanks", () => {
    expect(parseUrlList("wss://x.example\n\nwss://y.example", ["ws:", "wss:"]))
      .toEqual(["wss://x.example", "wss://y.example"]);
  });

  it("rejects a ws URL when only http is allowed", () => {
    expect(parseUrlList("wss://x.example", ["http:", "https:"])).toEqual([]);
  });
});

describe("originOf", () => {
  it("returns scheme://host[:port] and null for junk", () => {
    expect(originOf("https://eth.example/path?x=1")).toBe("https://eth.example");
    expect(originOf("wss://e.example:50004")).toBe("wss://e.example:50004");
    expect(originOf("nonsense")).toBeNull();
  });
});

describe("sanitizeDataSources", () => {
  it("returns the privacy-preserving default for null/garbage", () => {
    expect(sanitizeDataSources(null)).toEqual(DEFAULT_DATA_SOURCES);
    expect(sanitizeDataSources("corrupt")).toEqual(DEFAULT_DATA_SOURCES);
    expect(sanitizeDataSources(42)).toEqual(DEFAULT_DATA_SOURCES);
  });

  it("keeps valid fields and drops malformed ones", () => {
    const out = sanitizeDataSources({
      ethereumRpcUrls: ["https://eth.example", "bad", "ftp://no"],
      btcElectrumWsUrl: "wss://e.example:50004",
      indexerMode: "indexer",
      indexerUrl: "https://idx.example",
      pricesEnabled: false,
      priceEndpoint: "https://prices.example",
    });
    expect(out.ethereumRpcUrls).toEqual(["https://eth.example"]);
    expect(out.btcElectrumWsUrl).toBe("wss://e.example:50004");
    expect(out.indexerMode).toBe("indexer");
    expect(out.pricesEnabled).toBe(false);
    expect(out.priceEndpoint).toBe("https://prices.example");
  });

  it("rejects a non-ws electrum URL and an unknown indexer mode", () => {
    const out = sanitizeDataSources({ btcElectrumWsUrl: "https://not-ws.example", indexerMode: "weird" });
    expect(out.btcElectrumWsUrl).toBe("");
    expect(out.indexerMode).toBe("local");
  });

  it("defaults pricesEnabled to true when absent or mistyped", () => {
    expect(sanitizeDataSources({}).pricesEnabled).toBe(true);
    expect(sanitizeDataSources({ pricesEnabled: "yes" }).pricesEnabled).toBe(true);
  });
});

describe("connectSrcOrigins", () => {
  it("includes the default CoinGecko origin when prices are on and nothing else is set", () => {
    expect(connectSrcOrigins(DEFAULT_DATA_SOURCES)).toEqual([new URL(DEFAULT_PRICE_ENDPOINT).origin]);
  });

  it("omits the price origin when prices are disabled", () => {
    expect(connectSrcOrigins({ ...DEFAULT_DATA_SOURCES, pricesEnabled: false })).toEqual([]);
  });

  it("collects unique origins across RPCs, electrum, active indexer and price endpoint", () => {
    const out = connectSrcOrigins({
      ...DEFAULT_DATA_SOURCES,
      ethereumRpcUrls: ["https://eth.example/a", "https://eth.example/b"], // same origin → deduped
      btcElectrumWsUrl: "wss://e.example:50004",
      indexerMode: "indexer",
      indexerUrl: "https://idx.example",
      priceEndpoint: "https://prices.example",
    });
    expect(out).toEqual([
      "https://eth.example",
      "wss://e.example:50004",
      "https://idx.example",
      "https://prices.example",
    ]);
  });

  it("collects a Solana RPC override origin (non-EVM net, same https fetch path)", () => {
    const out = connectSrcOrigins({
      ...DEFAULT_DATA_SOURCES,
      solanaRpcUrls: ["https://my-solana.example/rpc"],
      pricesEnabled: false,
    });
    expect(out).toEqual(["https://my-solana.example"]);
  });

  it("ignores the indexer URL while in local mode", () => {
    const out = connectSrcOrigins({
      ...DEFAULT_DATA_SOURCES,
      indexerMode: "local",
      indexerUrl: "https://idx.example",
      pricesEnabled: false,
    });
    expect(out).toEqual([]);
  });
});

describe("cspBlockedOrigins", () => {
  it("is empty for the defaults (CoinGecko is in the static allowlist)", () => {
    expect(cspBlockedOrigins(DEFAULT_DATA_SOURCES)).toEqual([]);
  });

  it("flags a custom RPC/indexer/price origin the static CSP won't allow", () => {
    const out = cspBlockedOrigins({
      ...DEFAULT_DATA_SOURCES,
      ethereumRpcUrls: ["https://my-node.example"],
      indexerMode: "indexer",
      indexerUrl: "https://idx.example",
      priceEndpoint: "https://prices.example",
    });
    expect(out).toEqual([
      "https://my-node.example",
      "https://idx.example",
      "https://prices.example",
    ]);
  });

  it("never flags a wss:// Electrum origin (wss: is allowed wholesale)", () => {
    const out = cspBlockedOrigins({
      ...DEFAULT_DATA_SOURCES,
      btcElectrumWsUrl: "wss://e.example:50004",
      pricesEnabled: false,
    });
    expect(out).toEqual([]);
  });
});

describe("deployEndpointDefaults", () => {
  const ETH = "NEXT_PUBLIC_ETHEREUM_RPC_URLS";
  const BTC = "NEXT_PUBLIC_BTC_ELECTRUM_WS_URL";
  const orig = { eth: process.env[ETH], btc: process.env[BTC] };
  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  afterEach(() => {
    restore(ETH, orig.eth);
    restore(BTC, orig.btc);
  });

  it("reads the BTC Electrum-WS endpoint from env, trimmed (the live-deploy case)", () => {
    process.env[BTC] = "  wss://blockstream.info/electrum-websocket/api  ";
    delete process.env[ETH];
    expect(deployEndpointDefaults()).toEqual({
      ethereumRpcUrls: [],
      btcElectrumWsUrl: "wss://blockstream.info/electrum-websocket/api",
    });
  });

  it("splits the Ethereum RPC list on commas, trimming and dropping blanks", () => {
    process.env[ETH] = "https://a.example, , https://b.example ";
    delete process.env[BTC];
    expect(deployEndpointDefaults()).toEqual({
      ethereumRpcUrls: ["https://a.example", "https://b.example"],
      btcElectrumWsUrl: "",
    });
  });

  it("returns the zero-config default ([] / \"\") when neither env var is set", () => {
    delete process.env[ETH];
    delete process.env[BTC];
    expect(deployEndpointDefaults()).toEqual({ ethereumRpcUrls: [], btcElectrumWsUrl: "" });
  });
});
