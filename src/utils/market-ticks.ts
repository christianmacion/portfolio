/**
 * market-ticks.ts : L1/L2/L3 market data fetcher with per-source cache.
 *
 * Sources (all public, free, no auth):
 *   - ECB reference rates: data-api.ecb.europa.eu/service/data/EXR/...
 *     (daily FX; EUR base; cached 6h)
 *   - CoinGecko simple/price: api.coingecko.com/api/v3/simple/price
 *     (BTC, ETH, SOL; cached 30s)
 *   - Yahoo Finance v7 quote: query1.finance.yahoo.com/v7/finance/quote
 *     (^GSPC, ^DJI, ^IXIC, AAPL, MSFT, NVDA, TSLA, BTC-USD, ETH-USD, XAU-USD;
 *      cached 60s)
 *
 * The ECB SDMX JSON API lives on a different origin and is CORS-friendly.
 * CoinGecko also serves Access-Control-Allow-Origin: * for /simple/price.
 * Yahoo's v7/finance/quote endpoint is generally reachable from the browser,
 * but CORS errors are non-fatal: we fall through to the static fallback.
 *
 * L1 / L2 / L3 depth mapping:
 *   - L1 = top-of-book (indices, crypto spot, gold spot)
 *   - L2 = depth-of-book (single-name equities: AAPL, MSFT, NVDA, TSLA)
 *   - L3 = full order book / aggregated tape (reserved)
 *
 * Normalized tick shape:
 *
 *   {
 *     id: string,
 *     timestamp: string,    // ISO8601 (last update from source)
 *     symbol: string,       // "EUR/USD" or "BTC/USD" or "^GSPC"
 *     name?: string,        // friendly long name (Yahoo only)
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
 * Bundle budget: ~3KB minified. No deps.
 */

import fallback from '../data/worldview-static.json';

export interface MarketTick {
  id: string;
  timestamp: string;
  symbol: string;
  name?: string;
  price: number;
  change: number;
  changePct: number;
  level: 'L1' | 'L2' | 'L3';
  source: string;
}

/** Module-level cache: { fetchedAt, ticks[], bySource: { [src]: ISO } }. */
let cached: {
  fetchedAt: number;
  ticks: MarketTick[];
  bySource: Record<string, string>;
} | null = null;
const TTL_MS = 30_000; // 30s ticker cache (CoinGecko cadence)

/** ECB cache is longer (daily cadence, fetch-once-per-session is fine). */
let ecbCache: { fetchedAt: number; rates: Record<string, number> } | null = null;
const ECB_TTL_MS = 6 * 60 * 60 * 1000; // 6h

/** Yahoo cache : 60s cadence (matches upstream quote refresh). */
let yahooCache: { fetchedAt: number; quotes: YahooQuote[] } | null = null;
const YAHOO_TTL_MS = 60_000;

/** CoinGecko cache : 30s cadence. */
let coingeckoCache: { fetchedAt: number; quotes: CoinGeckoQuote[] } | null = null;
const COINGECKO_TTL_MS = 30_000;

/** Static-fallback ticks (already typed). */
const fallbackTicks: MarketTick[] = (fallback.ticks as MarketTick[]).slice();

// === Yahoo symbol table ===============================================
interface YahooSymbolSpec {
  symbol: string;
  name: string;
  level: 'L1' | 'L2';
}
/** Equities = L2 (depth of book), crypto = L1, indices = L1, gold = L1. */
const YAHOO_SYMBOLS: YahooSymbolSpec[] = [
  { symbol: '^GSPC', name: 'S&P 500', level: 'L1' },
  { symbol: '^DJI', name: 'Dow Jones Industrial Average', level: 'L1' },
  { symbol: '^IXIC', name: 'NASDAQ Composite', level: 'L1' },
  { symbol: 'AAPL', name: 'Apple Inc.', level: 'L2' },
  { symbol: 'MSFT', name: 'Microsoft Corporation', level: 'L2' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', level: 'L2' },
  { symbol: 'TSLA', name: 'Tesla, Inc.', level: 'L2' },
  { symbol: 'BTC-USD', name: 'Bitcoin / USD', level: 'L1' },
  { symbol: 'ETH-USD', name: 'Ethereum / USD', level: 'L1' },
  { symbol: 'XAU-USD', name: 'Gold / USD (Spot)', level: 'L1' },
];

interface YahooQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  level: 'L1' | 'L2';
}

// === CoinGecko symbol table ===========================================
interface CoinGeckoQuote {
  id: string;
  symbol: 'BTC/USD' | 'ETH/USD' | 'SOL/USD';
  name: string;
  price: number;
  changePct: number;
  level: 'L1';
}

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

/** Fetch Yahoo Finance v7 quote for the configured symbol set. Cached 60s.
 *  Shape: response.quoteResponse.response[0] = {
 *    symbol, shortName/longName, regularMarketPrice, regularMarketChange,
 *    regularMarketChangePercent, ... } */
async function loadYahooQuotes(): Promise<YahooQuote[]> {
  if (yahooCache && Date.now() - yahooCache.fetchedAt < YAHOO_TTL_MS) {
    return yahooCache.quotes;
  }
  try {
    const symbols = YAHOO_SYMBOLS.map((s) => encodeURIComponent(s.symbol)).join(',');
    const u = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}`;
    const res = await fetch(u, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      // CORS or upstream error → fall back to last-known cache, then empty
      return yahooCache?.quotes ?? [];
    }
    const json = (await res.json()) as {
      quoteResponse?: {
        response?: Array<{
          symbol?: string;
          shortName?: string;
          longName?: string;
          regularMarketPrice?: number;
          regularMarketChange?: number;
          regularMarketChangePercent?: number;
        }>;
      };
    };
    const response = json.quoteResponse?.response ?? [];
    const quotes: YahooQuote[] = [];
    for (const row of response) {
      const sym = row.symbol;
      if (!sym) continue;
      const spec = YAHOO_SYMBOLS.find((s) => s.symbol === sym);
      const price = row.regularMarketPrice;
      if (typeof price !== 'number' || !Number.isFinite(price)) continue;
      quotes.push({
        symbol: sym,
        name: row.longName ?? row.shortName ?? spec?.name ?? sym,
        price,
        change: row.regularMarketChange ?? 0,
        changePercent: row.regularMarketChangePercent ?? 0,
        level: spec?.level ?? 'L1',
      });
    }
    if (quotes.length > 0) {
      yahooCache = { fetchedAt: Date.now(), quotes };
    }
    return yahooCache?.quotes ?? [];
  } catch {
    // CORS / network / parse → fall back to last-known cache, then empty
    return yahooCache?.quotes ?? [];
  }
}

/** Fetch CoinGecko simple/price for BTC, ETH, SOL vs USD. Cached 30s. */
async function loadCoinGecko(): Promise<CoinGeckoQuote[]> {
  if (coingeckoCache && Date.now() - coingeckoCache.fetchedAt < COINGECKO_TTL_MS) {
    return coingeckoCache.quotes;
  }
  try {
    const u =
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true';
    const res = await fetch(u, { cache: 'no-store' });
    if (!res.ok) return coingeckoCache?.quotes ?? [];
    const json = (await res.json()) as Record<
      string,
      { usd?: number; usd_24h_change?: number }
    >;
    const quotes: CoinGeckoQuote[] = [];
    const btc = json.bitcoin?.usd;
    if (typeof btc === 'number') {
      quotes.push({
        id: 'bitcoin',
        symbol: 'BTC/USD',
        name: 'Bitcoin',
        price: btc,
        changePct: json.bitcoin?.usd_24h_change ?? 0,
        level: 'L1',
      });
    }
    const eth = json.ethereum?.usd;
    if (typeof eth === 'number') {
      quotes.push({
        id: 'ethereum',
        symbol: 'ETH/USD',
        name: 'Ethereum',
        price: eth,
        changePct: json.ethereum?.usd_24h_change ?? 0,
        level: 'L1',
      });
    }
    const sol = json.solana?.usd;
    if (typeof sol === 'number') {
      quotes.push({
        id: 'solana',
        symbol: 'SOL/USD',
        name: 'Solana',
        price: sol,
        changePct: json.solana?.usd_24h_change ?? 0,
        level: 'L1',
      });
    }
    if (quotes.length > 0) {
      coingeckoCache = { fetchedAt: Date.now(), quotes };
    }
    return coingeckoCache?.quotes ?? [];
  } catch {
    // CORS / network / parse → fall back to last-known cache, then empty
    return coingeckoCache?.quotes ?? [];
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

/** Convert a Yahoo quote into a MarketTick. */
function yahooTick(q: YahooQuote, now: string): MarketTick {
  return {
    id: 'YAHOO-' + q.symbol + '-' + now.slice(0, 13),
    timestamp: now,
    symbol: q.symbol,
    name: q.name,
    price: q.price,
    change: q.change,
    changePct: q.changePercent,
    level: q.level,
    source: 'Yahoo',
  };
}

/** Convert a CoinGecko quote into a MarketTick. */
function coingeckoTick(q: CoinGeckoQuote, now: string): MarketTick {
  return {
    id: 'CG-' + q.id + '-' + now.slice(0, 13),
    timestamp: now,
    symbol: q.symbol,
    name: q.name,
    price: q.price,
    change: (q.changePct * q.price) / 100,
    changePct: q.changePct,
    level: q.level,
    source: 'CoinGecko',
  };
}

export interface MarketTicksPayload {
  ticks: MarketTick[];
  bySource: Record<string, string>;
}

/** Primary entry point. Returns ticks from ECB + Yahoo + CoinGecko, with
 *  per-source last-sync timestamps for the status footer.
 *  Returns the static fallback when ALL live sources fail. */
export async function loadMarketTicks(): Promise<MarketTick[]> {
  const out = await loadMarketTicksWithMeta();
  return out.ticks;
}

/** Same as loadMarketTicks() but also returns per-source last-sync ISO strings. */
export async function loadMarketTicksWithMeta(): Promise<MarketTicksPayload> {
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
    return { ticks: cached.ticks, bySource: cached.bySource };
  }

  const now = new Date().toISOString();
  const ticks: MarketTick[] = [];
  const bySource: Record<string, string> = {};

  // ECB FX (lowest priority : backup when Yahoo/CoinGecko CORS-block)
  try {
    const ecb = await loadEcbRates();
    if (Object.keys(ecb).length > 0) {
      bySource.ECB = now;
      if (ecb.EUR) ticks.push(ecbTick('EUR', 1 / ecb.EUR, undefined, now));
      if (ecb.JPY) ticks.push(ecbTick('JPY', 1 / ecb.JPY, undefined, now));
      if (ecb.GBP) ticks.push(ecbTick('GBP', 1 / ecb.GBP, undefined, now));
    }
  } catch {
    // ECB failure is non-fatal : Yahoo + CoinGecko cover most tickers.
  }

  // Yahoo Finance : equities, indices, BTC/ETH/Gold via Yahoo
  try {
    const yahoo = await loadYahooQuotes();
    if (yahoo.length > 0) {
      bySource.Yahoo = now;
      for (const q of yahoo) ticks.push(yahooTick(q, now));
    }
  } catch {
    // CORS / network : fall through to CoinGecko + static fallback.
  }

  // CoinGecko : crypto spot (BTC, ETH, SOL)
  try {
    const cg = await loadCoinGecko();
    if (cg.length > 0) {
      bySource.CoinGecko = now;
      for (const q of cg) ticks.push(coingeckoTick(q, now));
    }
  } catch {
    // CORS / network : fall through to static fallback.
  }

  // If ALL live sources failed, use the static fallback so the ticker never
  // goes blank.
  const out = ticks.length > 0 ? ticks : fallbackTicks;
  cached = { fetchedAt: Date.now(), ticks: out, bySource };
  return { ticks: out, bySource };
}
