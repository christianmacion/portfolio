/**
 * functions/api/market/quotes.ts - Cloudflare Pages Function proxy for
 * Yahoo Finance v7 quote API.
 *
 * Architecture: 2026-08-08-live-data-apis.md (live data wiring).
 *
 * Why a proxy:
 *   - Yahoo's CORS policy blocks direct browser fetches.
 *   - The browser needs a typed envelope (lastSync, items[]) so the chrome
 *     can render the data-source attribution + sync timestamp.
 *
 * Hard rules:
 *   - 4 equities (SPY, QQQ, DIA, BTC-USD) - no symbol sprawl.
 *   - Edge cache 60s (Yahoo refreshes are 15-min delayed; 60s is plenty).
 *   - Returns the standard typed envelope via `json()` from contracts.ts.
 *   - CORS allowlist via `allowedOrigin()` (yahoo already on the list).
 *
 * Failure mode: on upstream 5xx / network error, return an errorResponse
 * with the typed envelope rather than silently returning empty data -
 * the chrome can render `error` status, not `live`, so visitors see the
 * truth instead of fabricated prices.
 */
import type { PagesFunction } from '@cloudflare/workers-types';
import {
  allowedOrigin,
  errorResponse,
  json,
  requestId,
  type Env,
} from '../../lib/contracts';

const YAHOO_URL =
  'https://query1.finance.yahoo.com/v7/finance/quote?symbols=SPY,QQQ,DIA,BTC-USD';

export interface YahooItem {
  sym: string;
  px: number;
  deltaPct: number;
  currency: string;
  shortName?: string;
}

const CORS_HEADERS: HeadersInit = {
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '300',
};

/** Yahoo `quoteResponse.results[]` → our `YahooItem`. */
function normalize(item: Record<string, unknown>): YahooItem | null {
  const sym = String(item.symbol ?? '').trim();
  const px = Number(
    item.regularMarketPrice ?? item.postMarketPrice ?? item.preMarketPrice ?? 0,
  );
  const prev = Number(item.regularMarketPreviousClose ?? 0);
  if (!sym || !Number.isFinite(px) || px <= 0) return null;
  const deltaPct =
    Number.isFinite(prev) && prev > 0 ? +(((px - prev) / prev) * 100).toFixed(2) : 0;
  return {
    sym,
    px: +px.toFixed(2),
    deltaPct,
    currency: String(item.currency ?? 'USD'),
    shortName: typeof item.shortName === 'string' ? item.shortName : undefined,
  };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const rid = requestId(request);
  const origin = allowedOrigin(request, env);
  const cors: HeadersInit = origin
    ? { 'Access-Control-Allow-Origin': origin, ...CORS_HEADERS }
    : CORS_HEADERS;

  let res: Response;
  try {
    res = await fetch(YAHOO_URL, {
      headers: { 'User-Agent': 'ChristianMacionPortfolio/1.0' },
      cf: { cacheTtl: 60, cacheEverything: false },
    });
  } catch {
    return errorResponse(rid, 502, 'UPSTREAM_UNAVAILABLE', 'yahoo_unreachable');
  }
  if (!res.ok) {
    return errorResponse(rid, 502, 'UPSTREAM_UNAVAILABLE', `yahoo_${res.status}`);
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return errorResponse(rid, 502, 'UPSTREAM_UNAVAILABLE', 'yahoo_invalid_json');
  }

  const results =
    raw &&
    typeof raw === 'object' &&
    raw !== null &&
    'quoteResponse' in raw &&
    typeof (raw as { quoteResponse?: unknown }).quoteResponse === 'object' &&
    (raw as { quoteResponse?: { result?: unknown[] } }).quoteResponse?.result
      ? (raw as { quoteResponse: { result: unknown[] } }).quoteResponse.result
      : [];

  const items: YahooItem[] = [];
  for (const candidate of results) {
    if (!candidate || typeof candidate !== 'object') continue;
    const item = normalize(candidate as Record<string, unknown>);
    if (item) items.push(item);
  }

  return json<{
    ok: true;
    request_id: string;
    source: 'yahoo';
    items: YahooItem[];
    lastSync: string;
  }>(
    { ok: true, request_id: rid, source: 'yahoo', items, lastSync: new Date().toISOString() },
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