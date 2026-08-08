/**
 * functions/api/market/ticker.ts - Cloudflare Pages Function aggregator.
 * Fetches Yahoo + CoinGecko + ECB in parallel and returns a unified tape
 * with per-source sync timestamps.
 *
 * Architecture: 2026-08-08-live-data-apis.md (live data wiring).
 *
 * Why an aggregator:
 *   - The browser hits one endpoint, gets all 11 items (4 equities +
 *     4 cryptos + 3 FX pairs) plus per-source `lastSync` so the chrome
 *     can render "live · 14:23:12Z · yahoo" attribution.
 *   - Fan-out via `Promise.all` keeps the work parallel - wall-clock is
 *     the slowest single source, not the sum.
 *   - Each upstream has its own cache TTL (60s/60s/1h); the aggregator
 *     advertises a 60s edge cache to the browser.
 *
 * Failure mode: partial failure is honest. If Yahoo returns 502 but
 * CoinGecko and ECB succeed, we still ship the tape with yahoo's
 * `lastSync: null` and `items: []`. The chrome renders "cached/error"
 * for that source, not a fake number.
 */
import type { PagesFunction } from '@cloudflare/workers-types';
import {
  allowedOrigin,
  errorResponse,
  json,
  requestId,
  type Env,
} from '../../lib/contracts';
import type { YahooItem } from './quotes';
import type { CoinGeckoItem } from './crypto';
import type { FxItem } from './fx';

const YAHOO_URL = '/api/market/quotes';
const COINGECKO_URL = '/api/market/crypto';
const ECB_URL = '/api/market/fx';

export interface TickerItem {
  /** Display ticker (e.g. "SPY", "BTC", "EUR/USD"). */
  sym: string;
  px: number;
  deltaPct: number;
  /** Upstream source - used for `data-source` attribution. */
  source: 'yahoo' | 'coingecko' | 'ecb';
  /** Optional currency (USD, EUR, etc.). */
  currency?: string;
  /** Display label (e.g. "SPDR S&P 500 ETF"). */
  label?: string;
}

export interface TickerResponse {
  ok: true;
  request_id: string;
  items: TickerItem[];
  lastSync: string;
  sources: {
    yahoo: string | null;
    coingecko: string | null;
    ecb: string | null;
  };
  /** Per-source status - 'live' | 'error' | 'cached'. */
  status: {
    yahoo: 'live' | 'error' | 'cached';
    coingecko: 'live' | 'error' | 'cached';
    ecb: 'live' | 'error' | 'cached';
  };
}

const CORS_HEADERS: HeadersInit = {
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '300',
};

interface SourceEnvelope<T> {
  ok: true;
  items: T[];
  lastSync: string;
}

function isYahooItem(it: unknown): it is YahooItem {
  if (!it || typeof it !== 'object') return false;
  const o = it as Record<string, unknown>;
  return (
    typeof o.sym === 'string' &&
    typeof o.px === 'number' &&
    typeof o.deltaPct === 'number' &&
    typeof o.currency === 'string'
  );
}

function isCoinGeckoItem(it: unknown): it is CoinGeckoItem {
  if (!it || typeof it !== 'object') return false;
  const o = it as Record<string, unknown>;
  return (
    typeof o.sym === 'string' &&
    typeof o.px === 'number' &&
    typeof o.deltaPct === 'number' &&
    typeof o.id === 'string'
  );
}

function isFxItem(it: unknown): it is FxItem {
  if (!it || typeof it !== 'object') return false;
  const o = it as Record<string, unknown>;
  return (
    typeof o.pair === 'string' &&
    typeof o.px === 'number' &&
    typeof o.base === 'string' &&
    typeof o.quote === 'string'
  );
}

async function fetchSource<T>(url: string): Promise<{
  items: T[];
  lastSync: string | null;
  status: 'live' | 'error' | 'cached';
}> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      cf: { cacheTtl: 60, cacheEverything: true },
    });
    if (!res.ok) return { items: [], lastSync: null, status: 'error' };
    const age = res.headers.get('Age');
    const data = (await res.json()) as SourceEnvelope<T>;
    return {
      items: Array.isArray(data.items) ? data.items : [],
      lastSync: data.lastSync ?? null,
      status: age && Number(age) > 0 ? 'cached' : 'live',
    };
  } catch {
    return { items: [], lastSync: null, status: 'error' };
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const rid = requestId(request);
  const origin = allowedOrigin(request, env);
  const cors: HeadersInit = origin
    ? { 'Access-Control-Allow-Origin': origin, ...CORS_HEADERS }
    : CORS_HEADERS;

  // Same-origin fetch: resolve the URL against the request origin so the
  // aggregator works in both production and `astro dev` contexts.
  const origin_url = new URL(request.url);
  const base = `${origin_url.protocol}//${origin_url.host}`;

  const [yahoo, coingecko, ecb] = await Promise.all([
    fetchSource<YahooItem>(`${base}${YAHOO_URL}`),
    fetchSource<CoinGeckoItem>(`${base}${COINGECKO_URL}`),
    fetchSource<FxItem>(`${base}${ECB_URL}`),
  ]);

  const items: TickerItem[] = [];

  for (const it of yahoo.items) {
    if (!isYahooItem(it)) continue;
    items.push({
      sym: it.sym,
      px: it.px,
      deltaPct: it.deltaPct,
      source: 'yahoo',
      currency: it.currency,
      label: it.shortName,
    });
  }

  for (const it of coingecko.items) {
    if (!isCoinGeckoItem(it)) continue;
    items.push({
      sym: it.sym,
      px: it.px,
      deltaPct: it.deltaPct,
      source: 'coingecko',
      currency: 'USD',
      label: it.id,
    });
  }

  for (const it of ecb.items) {
    if (!isFxItem(it)) continue;
    items.push({
      sym: it.pair,
      px: it.px,
      deltaPct: 0, // ECB doesn't supply 24h delta; tape renders neutral.
      source: 'ecb',
      currency: it.quote,
      label: `${it.base} to ${it.quote}`,
    });
  }

  // Hard-cap items at 11 (4 + 4 + 3).
  const finalItems = items.slice(0, 11);

  // If EVERY source failed, surface the error envelope. Partial failure
  // is fine - items[] still ships with empty slots per source.
  if (
    yahoo.status === 'error' &&
    coingecko.status === 'error' &&
    ecb.status === 'error'
  ) {
    return errorResponse(rid, 502, 'UPSTREAM_UNAVAILABLE', 'all_sources_unavailable');
  }

  return json<TickerResponse>(
    {
      ok: true,
      request_id: rid,
      items: finalItems,
      lastSync: new Date().toISOString(),
      sources: {
        yahoo: yahoo.lastSync,
        coingecko: coingecko.lastSync,
        ecb: ecb.lastSync,
      },
      status: {
        yahoo: yahoo.status,
        coingecko: coingecko.status,
        ecb: ecb.status,
      },
    },
    200,
    rid,
    { ...cors, 'Cache-Control': 'public, max-age=60' },
  );
};

export const onRequestOptions: PagesFunction<Env> = async ({ request, env }) => {
  const origin = allowedOrigin(request, env);
  const cors: HeadersInit = origin
    ? { 'Access-Control-Allow-Origin': origin, ...CORS_HEADERS }
    : CORS_HEADERS;
  return new Response(null, { status: 204, headers: cors });
};