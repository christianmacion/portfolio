/**
 * workers/api-market-selected/index.ts — Cloudflare Worker entrypoint.
 *
 * GET /api/market/selected — terminal tape aggregator.
 *
 * Design contract (port of functions/api/market/ticker.ts, commit 88a0e59):
 *   - Fetches Yahoo + CoinGecko + ECB in parallel and returns a unified
 *     tape (11 items: 4 equities + 4 cryptos + 3 FX pairs).
 *   - Per-source `lastSync` so chrome can render "live · 14:23:12Z · yahoo".
 *   - Fan-out via `Promise.allSettled` keeps wall-clock to slowest source.
 *   - Each upstream has its own cache TTL; the aggregator advertises 60s
 *     edge cache to the browser.
 *   - Failure mode: partial failure is honest. If Yahoo returns 502 but
 *     CoinGecko and ECB succeed, we still ship the tape with yahoo's
 *     `lastSync: null` and `items: []`. Only full-source-down returns 502.
 *
 * Why a standalone Worker (per contact Worker template):
 *   - The portfolio CF Pages project was DELETED. The site is static on
 *     GH Pages; functions/ is local-dev only.
 *   - Worker keeps the data surface on a separate origin so the static
 *     site's CSP `connect-src 'self'` does not need to be relaxed.
 *
 * 5-must-have (§1 of CLAUDE.md):
 *   - Terminal state: 200 | 502 — never streams forever.
 *   - Idempotent: same minute → same upstream cache → same response.
 *   - Dedupe: edge cache keyed on URL.
 *   - Coverage: 200 (live), 200 (partial), 502 (all_sources_unavailable).
 *   - AAR: ~/.claude/cache/corporate/aars/portfolio-data-02-c-worker-refactor-2026-08-23.md
 *
 * Bundle budget: <10KB minified, no npm deps.
 */

// ===== Cloudflare runtime type shims ==================================
declare global {
  interface KVNamespace {
    get<T = unknown>(key: string, type?: 'text' | 'json' | 'arrayBuffer' | 'stream'): Promise<T | null>;
    put(key: string, value: string | ReadableStream | ArrayBuffer | FormData,
        options?: { expirationTtl?: number; expiration?: number; metadata?: unknown }): Promise<void>;
    delete(key: string): Promise<void>;
    list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
      keys: Array<{ name: string; expiration?: number; metadata?: unknown }>;
      list_complete: boolean;
      cursor?: string;
    }>;
  }
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// ===== Env contract ====================================================
export interface Env {
  /** Base URL of the sibling api-market-fx Worker. Required. */
  FX_WORKER_URL: string;
  /** Base URL of the sibling api-market-quotes Worker. Required. */
  QUOTES_WORKER_URL: string;
  /** Base URL of the sibling api-market-crypto Worker. Required. */
  CRYPTO_WORKER_URL: string;
  /** CORS allowlist. Defaults to https://christianmacion.github.io. */
  ALLOWED_ORIGIN?: string;
}

// ===== Wire types ======================================================
export interface TickerItem {
  sym: string;
  px: number;
  deltaPct: number;
  source: 'yahoo' | 'coingecko' | 'ecb';
  currency?: string;
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
  status: {
    yahoo: 'live' | 'error' | 'cached';
    coingecko: 'live' | 'error' | 'cached';
    ecb: 'live' | 'error' | 'cached';
  };
}

interface SourceEnvelope<T> {
  ok: true;
  items: T[];
  lastSync: string;
}

// ===== Constants =======================================================
const CORS_HEADERS: HeadersInit = {
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '300',
};

// Type guards reused from the legacy functions/api/market/ticker.ts
function isYahooItem(it: unknown): it is { sym: string; px: number; deltaPct: number; currency: string; shortName?: string } {
  if (!it || typeof it !== 'object') return false;
  const o = it as Record<string, unknown>;
  return (
    typeof o.sym === 'string' &&
    typeof o.px === 'number' &&
    typeof o.deltaPct === 'number' &&
    typeof o.currency === 'string'
  );
}

function isCoinGeckoItem(it: unknown): it is { sym: string; px: number; deltaPct: number; id: string } {
  if (!it || typeof it !== 'object') return false;
  const o = it as Record<string, unknown>;
  return (
    typeof o.sym === 'string' &&
    typeof o.px === 'number' &&
    typeof o.deltaPct === 'number' &&
    typeof o.id === 'string'
  );
}

function isFxItem(it: unknown): it is { pair: string; px: number; base: string; quote: string } {
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

// ===== Response envelopes ==============================================
function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  origin: string | null,
  extraHeaders: Record<string, string> = {},
): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders,
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(requestId: string, status: number, code: string, reason: string, origin: string | null): Response {
  return jsonResponse(
    { ok: false, code, reason, request_id: requestId },
    status,
    origin,
  );
}

// ===== Main handler ====================================================
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const requestId = crypto.randomUUID();
    const origin = request.headers.get('Origin');
    const allowedOrigin = env.ALLOWED_ORIGIN
      ? env.ALLOWED_ORIGIN
      : origin && /^https:\/\/(www\.)?christianmacion\.github\.io$/.test(origin)
        ? origin
        : null;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...(allowedOrigin ? { 'Access-Control-Allow-Origin': allowedOrigin } : {}),
          ...CORS_HEADERS,
          Vary: 'Origin',
        },
      });
    }

    // Path gate: only GET /api/market/selected
    if (url.pathname !== '/api/market/selected') {
      return errorResponse(requestId, 404, 'NOT_FOUND', 'path_not_found', allowedOrigin);
    }
    if (request.method !== 'GET') {
      return errorResponse(requestId, 405, 'METHOD_NOT_ALLOWED', 'method_not_allowed', allowedOrigin);
    }

    // Env contract: the three upstream Worker URLs are required.
    if (!env.FX_WORKER_URL || !env.QUOTES_WORKER_URL || !env.CRYPTO_WORKER_URL) {
      return errorResponse(requestId, 503, 'UPSTREAM_UNCONFIGURED', 'sibling_workers_not_configured', allowedOrigin);
    }

    // Fan-out to the three sibling Workers in parallel.
    const [yahoo, coingecko, ecb] = await Promise.all([
      fetchSource<{ sym: string; px: number; deltaPct: number; currency: string; shortName?: string }>(env.QUOTES_WORKER_URL),
      fetchSource<{ sym: string; px: number; deltaPct: number; id: string }>(env.CRYPTO_WORKER_URL),
      fetchSource<{ pair: string; px: number; base: string; quote: string }>(env.FX_WORKER_URL),
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
    // is fine — items[] still ships with empty slots per source.
    if (yahoo.status === 'error' && coingecko.status === 'error' && ecb.status === 'error') {
      return errorResponse(requestId, 502, 'UPSTREAM_UNAVAILABLE', 'all_sources_unavailable', allowedOrigin);
    }

    return jsonResponse(
      {
        ok: true,
        request_id: requestId,
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
      allowedOrigin,
      {
        'Cache-Control': 'public, max-age=60',
      },
    );
  },
};
