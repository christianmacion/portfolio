/**
 * market-ticks.ts — L1/L2/L3 market data fetcher with cache.
 *
 * Sources (all public, free, no auth):
 *   - ECB reference rates: data-api.ecb.europa.eu/service/data/EXR/...
 *     (daily FX; EUR base; cached 6h)
 *   - CoinGecko simple/price: api.coingecko.com/api/v3/simple/price
 *     (30s; crypto; cached 30s)
 *
 * The ECB SDMX JSON API lives on a different origin and is CORS-friendly.
 * CoinGecko also serves Access-Control-Allow-Origin: * for /simple/price.
 *
 * Normalized tick shape:
 *
 *   {
 *     id: string,
 *     timestamp: string,    // ISO8601 (last update from source)
 *     symbol: string,       // "EUR/USD" or "BTC/USD"
 *     price: number,
 *     change: number,       // absolute change vs prior session
 *     changePct: number,    // percent change
 *     level: 'L1' | 'L2' | 'L3',
 *     source: string
 *   }
 *
 * On any failure path (CORS, network, parse), returns the static fallback
 * baked at build time (src/data/worldview-static.json).
 *
 * Bundle budget: ~2KB minified. No deps.
 */

import fallback from '../data/worldview-static.json';

export interface MarketTick {
  id: string;
  timestamp: string;
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  level: 'L1' | 'L2' | 'L3';
  source: string;
}

/** Module-level cache: { fetchedAt, ticks[] }. */
let cached: { fetchedAt: number; ticks: MarketTick[] } | null = null;
const TTL_MS = 30_000; // 30s ticker cache

/** ECB cache is longer (daily cadence, fetch-once-per-session is fine). */
let ecbCache: { fetchedAt: number; rates: Record<string, number> } | null = null;
const ECB_TTL_MS = 6 * 60 * 60 * 1000; // 6h

/** Static-fallback ticks (already typed). */
const fallbackTicks: MarketTick[] = (fallback.ticks as MarketTick[]).slice(0, 4);

/** Parse the ECB SDMX-JSON structure for a single time-series key.
 *  Shape: data.dataSets[0].series['0:0:0:0:0'].observations['0'] = [v] */
function parseEcbSeries(json: unknown, key: string): number | null {
  if (!json || typeof json !== 'object') return null;
  const j = json as Record<string, unknown>;
  const ds = (j as { dataSets?: Array<{ series?: Record<string, unknown> }> }).dataSets;
  const series = ds?.[0]?.series;
  if (!series) return null;
  const s = (series as Record<string, { observations?: Record<string, number[]> }>)[key];
  const obs = s?.observations;
  if (!obs) return null;
  const keys = Object.keys(obs);
  if (keys.length === 0) return null;
  const lastKey = keys[keys.length - 1];
  const arr = obs[lastKey];
  return typeof arr?.[0] === 'number' ? arr[0] : null;
}

/** Fetch ECB reference rates vs USD (daily). Returns { 'EUR': rate, 'JPY': rate, ... }. */
async function loadEcbRates(): Promise<Record<string, number>> {
  if (ecbCache && Date.now() - ecbCache.fetchedAt < ECB_TTL_MS) {
    return ecbCache.rates;
  }
  const series: Array<{ ccy: string; key: string }> = [
    { ccy: 'EUR', key: '0.EUR.USD.EUR' },
    { ccy: 'JPY', key: '0.JPY.USD.JPY' },
    { ccy: 'GBP', key: '0.GBP.USD.GBP' },
  ];
  const rates: Record<string, number> = {};
  for (const { ccy, key } of series) {
    try {
      const u =
        'https://data-api.ecb.europa.eu/service/data/EXR/D.' +
        ccy +
        '.USD.SP00.A?lastObservation=1&format=jsondata';
      const res = await fetch(u, { cache: 'no-store' });
      if (!res.ok) continue;
      const json = await res.json();
      const rate = parseEcbSeries(json, key);
      if (typeof rate === 'number') rates[ccy] = rate;
    } catch {
      // single-currency fetch failure is non-fatal
    }
  }
  if (Object.keys(rates).length > 0) {
    ecbCache = { fetchedAt: Date.now(), rates };
  }
  return ecbCache?.rates ?? {};
}

/** Fetch CoinGecko simple/price for BTC and ETH vs USD. */
async function loadCrypto(): Promise<Array<{ id: string; usd: number; usd_24h_change?: number }>> {
  try {
    const u =
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true';
    const res = await fetch(u, { cache: 'no-store' });
    if (!res.ok) return [];
    const json = (await res.json()) as Record<
      string,
      { usd: number; usd_24h_change?: number }
    >;
    return [
      { id: 'bitcoin', usd: json.bitcoin?.usd ?? 0, usd_24h_change: json.bitcoin?.usd_24h_change },
      { id: 'ethereum', usd: json.ethereum?.usd ?? 0, usd_24h_change: json.ethereum?.usd_24h_change },
    ];
  } catch {
    return [];
  }
}

/** Convert one ECB rate + change into a MarketTick. */
function ecbTick(
  ccy: string,
  rate: number,
  prev: number | undefined,
  now: string,
): MarketTick {
  const change = prev != null ? rate - prev : 0;
  const changePct = prev != null ? (change / prev) * 100 : 0;
  return {
    id: 'ECB-' + ccy + '-' + now.slice(0, 13),
    timestamp: now,
    symbol: ccy + '/USD',
    price: rate,
    change,
    changePct,
    level: 'L1',
    source: 'ECB',
  };
}

/** Primary entry point. Returns 4 ticks (latest from each source). */
export async function loadMarketTicks(): Promise<MarketTick[]> {
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
    return cached.ticks;
  }

  const now = new Date().toISOString();
  const ticks: MarketTick[] = [];

  const ecb = await loadEcbRates();
  if (ecb.EUR) ticks.push(ecbTick('EUR', 1 / ecb.EUR, undefined, now));
  if (ecb.JPY) ticks.push(ecbTick('JPY', 1 / ecb.JPY, undefined, now));
  if (ecb.GBP) ticks.push(ecbTick('GBP', 1 / ecb.GBP, undefined, now));

  const crypto = await loadCrypto();
  for (const c of crypto) {
    if (!c.usd) continue;
    ticks.push({
      id: 'CG-' + c.id + '-' + now.slice(0, 13),
      timestamp: now,
      symbol: c.id === 'bitcoin' ? 'BTC/USD' : 'ETH/USD',
      price: c.usd,
      change: ((c.usd_24h_change ?? 0) * c.usd) / 100,
      changePct: c.usd_24h_change ?? 0,
      level: 'L3',
      source: 'CoinGecko',
    });
  }

  const out = ticks.length > 0 ? ticks.slice(0, 4) : fallbackTicks;
  cached = { fetchedAt: Date.now(), ticks: out };
  return out;
}