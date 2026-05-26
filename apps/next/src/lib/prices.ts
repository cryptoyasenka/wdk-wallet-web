/**
 * CoinGecko price fetching.
 *
 * Maps wallet asset symbols to CoinGecko IDs and fetches current USD
 * prices. The free API has a 10-30 req/min limit so we cache for 60 s.
 */

const SYMBOL_TO_COINGECKO: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  USDT: "tether",
  XAUT: "tether-gold",
  POL: "matic-network",
  XPL: "matic-network", // Plasma uses similar base pricing
};

export type PriceMap = Record<string, number>; // symbol → USD price

let cachedPrices: PriceMap = {};
let cacheTime = 0;
const CACHE_TTL = 60_000; // 60 seconds

export async function fetchPrices(): Promise<PriceMap> {
  if (Date.now() - cacheTime < CACHE_TTL && Object.keys(cachedPrices).length > 0) {
    return cachedPrices;
  }

  const ids = [...new Set(Object.values(SYMBOL_TO_COINGECKO))].join(",");

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return cachedPrices; // graceful degradation
    const data = await res.json();

    const prices: PriceMap = {};
    for (const [symbol, geckoId] of Object.entries(SYMBOL_TO_COINGECKO)) {
      const entry = data[geckoId];
      if (entry?.usd != null) prices[symbol] = entry.usd;
    }

    cachedPrices = prices;
    cacheTime = Date.now();
    return prices;
  } catch {
    return cachedPrices; // network error → stale or empty prices, never crash
  }
}

/**
 * Fetch 7-day sparkline data for a CoinGecko coin ID.
 * Returns an array of 168 hourly price points.
 */
export async function fetchSparkline(symbol: string): Promise<number[]> {
  const geckoId = SYMBOL_TO_COINGECKO[symbol];
  if (!geckoId) return [];

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${geckoId}/market_chart?vs_currency=usd&days=7`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return [];
    const data = await res.json();
    // data.prices is [ [timestamp, price], ... ]
    return (data.prices as [number, number][]).map(([, p]) => p);
  } catch {
    return [];
  }
}

export function formatUsd(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 10_000) return `$${(amount / 1_000).toFixed(1)}K`;
  if (amount >= 1) return `$${amount.toFixed(2)}`;
  if (amount >= 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(6)}`;
}
