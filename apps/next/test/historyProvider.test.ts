/**
 * Unit tests for the Phase-4 remote history provider — the HTTP indexer client
 * that makes the Data Sources "Use configured indexer" setting actually do
 * something (it was previously persisted but never wired into the engine).
 *
 * Focus: the request it builds, the untrusted-JSON hardening (bad rows dropped,
 * never thrown on), asset resolution against DEFAULT_ASSETS, timestamp/amount
 * normalisation, and graceful [] on every failure mode so a bad indexer falls
 * back to the local log instead of breaking activity.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { USDT_ETHEREUM } from "@wdk-web/wallet-core";
import { createIndexerHistoryProvider } from "../src/lib/historyProvider";

const ADDR = "0x" + "a".repeat(40);

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("createIndexerHistoryProvider", () => {
  it("builds GET {base}/v1/history with chain, address and token query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ transactions: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = createIndexerHistoryProvider("https://idx.example/");
    await provider.getTransactionHistory("ethereum", ADDR, USDT_ETHEREUM);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.origin + url.pathname).toBe("https://idx.example/v1/history"); // trailing slash trimmed
    expect(url.searchParams.get("chain")).toBe("ethereum");
    expect(url.searchParams.get("address")).toBe(ADDR);
    expect(url.searchParams.get("token")).toBe(USDT_ETHEREUM);
  });

  it("omits the token param for a native (BTC) query and resolves the BTC asset", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        transactions: [
          { hash: "0xabc", direction: "in", amount: "50000", timestamp: 1700000000, status: "confirmed" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createIndexerHistoryProvider("https://idx.example");
    const items = await provider.getTransactionHistory("bitcoin", ADDR);

    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.searchParams.has("token")).toBe(false);
    expect(items).toHaveLength(1);
    expect(items[0]?.asset.symbol).toBe("BTC");
    expect(items[0]?.asset.chain).toBe("bitcoin");
    expect(items[0]?.amount).toBe(50000n);
  });

  it("maps a valid USDT row to an ActivityItem with the resolved asset", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          transactions: [
            { hash: "0xdef", direction: "out", amount: "1000000", timestamp: 1700000000000, status: "pending" },
          ],
        }),
      ),
    );

    const provider = createIndexerHistoryProvider("https://idx.example");
    const items = await provider.getTransactionHistory("ethereum", ADDR, USDT_ETHEREUM);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      hash: "0xdef",
      direction: "out",
      amount: 1000000n,
      timestamp: 1700000000000,
      status: "pending",
    });
    expect(items[0]?.asset).toMatchObject({ symbol: "USDT", chain: "ethereum", decimals: 6 });
  });

  it("scales a second-precision timestamp up to milliseconds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          transactions: [
            { hash: "0x1", direction: "in", amount: "1", timestamp: 1700000000, status: "confirmed" },
          ],
        }),
      ),
    );
    const provider = createIndexerHistoryProvider("https://idx.example");
    const items = await provider.getTransactionHistory("ethereum", ADDR, USDT_ETHEREUM);
    expect(items[0]?.timestamp).toBe(1700000000000);
  });

  it("drops malformed rows (bad direction, status, amount, timestamp, missing hash)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          transactions: [
            { hash: "0xok", direction: "in", amount: "10", timestamp: 1700000000, status: "confirmed" },
            { hash: "0xbad", direction: "sideways", amount: "10", timestamp: 1700000000, status: "confirmed" },
            { hash: "0xbad", direction: "in", amount: "10", timestamp: 1700000000, status: "weird" },
            { hash: "0xbad", direction: "in", amount: "-5", timestamp: 1700000000, status: "confirmed" },
            { hash: "0xbad", direction: "in", amount: "1.5", timestamp: 1700000000, status: "confirmed" },
            { hash: "0xbad", direction: "in", amount: "10", timestamp: 0, status: "confirmed" },
            { direction: "in", amount: "10", timestamp: 1700000000, status: "confirmed" },
            null,
            "nope",
          ],
        }),
      ),
    );
    const provider = createIndexerHistoryProvider("https://idx.example");
    const items = await provider.getTransactionHistory("ethereum", ADDR, USDT_ETHEREUM);
    expect(items).toHaveLength(1);
    expect(items[0]?.hash).toBe("0xok");
  });

  it("returns [] for an unresolvable asset without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const provider = createIndexerHistoryProvider("https://idx.example");
    // A token that isn't in DEFAULT_ASSETS for this chain → no honest asset label.
    const items = await provider.getTransactionHistory("ethereum", ADDR, "0x" + "9".repeat(40));
    expect(items).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns [] on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, false, 503)));
    const provider = createIndexerHistoryProvider("https://idx.example");
    expect(await provider.getTransactionHistory("ethereum", ADDR, USDT_ETHEREUM)).toEqual([]);
  });

  it("returns [] when the network call rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const provider = createIndexerHistoryProvider("https://idx.example");
    expect(await provider.getTransactionHistory("ethereum", ADDR, USDT_ETHEREUM)).toEqual([]);
  });

  it("returns [] when the JSON body has no transactions array", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ transactions: "oops" })));
    const provider = createIndexerHistoryProvider("https://idx.example");
    expect(await provider.getTransactionHistory("ethereum", ADDR, USDT_ETHEREUM)).toEqual([]);
  });
});
