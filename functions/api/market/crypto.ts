/**
 * functions/api/market/crypto.ts - Cloudflare Pages Function proxy for
 * CoinGecko `simple/price`.
 *
 * Architecture: 2026-08-08-live-data-apis.md (live data wiring).
 *
 * Why a proxy:
 *   - CoinGecko free tier enforces a 10-30 calls/min limit; centralising
 *     the fetch through the Worker lets every visitor hit the edge cache
 *     instead of the rate limit.
 *   - Browser-direct fetches work today but CoinGecko has hinted at
 *     tightening CORS - the proxy is the resilience layer.
 *
 * Hard rules:
 *   - 4 coins (BTC, ETH, SOL, BNB) - no symbol sprawl.
 *   - Edge cache 60s.
 *   - Typed envelope via `json()`.
 *   - On failure return errorResponse, not silent empty data.
 */
import type { PagesFunction } from '@cloudflare/workers-types';
import {
  allowedOrigin,
  errorResponse,
  json,
  requestId,
  type Env,
} from '../../lib/contracts';

const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,binancecoin&vs_currencies=usd&include_24hr_change=true';

export interface CoinGeckoItem {
  sym: string;
  px: number;
  deltaPct: number;
  /** canonical coin id (e.g. "bitcoin") - for upstream traceability. */
  id: string;
}

const CORS_HEADERS: HeadersInit = {
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '300',
};

const ID_TO_SYM: Record<string, string> = {
  bitcoin: 'BTC',
  ethereum: 'ETH',
  solana: 'SOL',
  binancecoin: 'BNB',
};

function normalize(id: string, value: Record<string, unknown>): CoinGeckoItem | null {
  const sym = ID_TO_SYM[id];
  const px = Number(value.usd ?? 0);
  if (!sym || !Number.isFinite(px) || px <= 0) return null;
  const delta = Number(value.usd_24h_change ?? 0);
  return {
    sym,
    px: +px.toFixed(px >= 1000 ? 0 : 2),
    deltaPct: Number.isFinite(delta) ? +delta.toFixed(2) : 0,
    id,
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
    res = await fetch(COINGECKO_URL, {
      headers: { 'User-Agent': 'ChristianMacionPortfolio/1.0' },
      cf: { cacheTtl: 60, cacheEverything: false },
    });
  } catch {
    return errorResponse(rid, 502, 'UPSTREAM_UNAVAILABLE', 'coingecko_unreachable');
  }
  if (!res.ok) {
    return errorResponse(rid, 502, 'UPSTREAM_UNAVAILABLE', `coingecko_${res.status}`);
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return errorResponse(rid, 502, 'UPSTREAM_UNAVAILABLE', 'coingecko_invalid_json');
  }

  const items: CoinGeckoItem[] = [];
  if (raw && typeof raw === 'object' && raw !== null) {
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const item = normalize(id, value as Record<string, unknown>);
      if (item) items.push(item);
    }
  }

  return json<{
    ok: true;
    request_id: string;
    source: 'coingecko';
    items: CoinGeckoItem[];
    lastSync: string;
  }>(
    { ok: true, request_id: rid, source: 'coingecko', items, lastSync: new Date().toISOString() },
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