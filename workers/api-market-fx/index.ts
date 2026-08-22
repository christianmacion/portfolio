/**
 * workers/api-market-fx/index.ts — Cloudflare Worker entrypoint.
 *
 * GET /api/market/fx — ECB SDMX reference rates (EUR-anchored).
 *
 * Design contract (port of functions/api/market/fx.ts, commit 88a0e59):
 *   - 3 pairs (EUR/USD, GBP/USD, USD/JPY).
 *   - 1h edge cache (cf.cacheTtl: 3600) — ECB publishes once per biz day.
 *   - Typed envelope: { ok, request_id, source, items[], lastSync }.
 *   - On failure return errorResponse, not silent empty data.
 *
 * Why a standalone Worker (per contact Worker template):
 *   - The portfolio CF Pages project was DELETED. The site is static on
 *     GH Pages; functions/ is local-dev only. A standalone Worker can
 *     be deployed independently to its own `wrangler deploy` target.
 *   - Worker keeps the FX surface on a separate origin so the static
 *     site's CSP `connect-src 'self'` does not need to be relaxed.
 *
 * ECB URL (live-verified 2026-08-23):
 *   https://data-api.ecb.europa.eu/service/data/EXR/D.USD+GBP+JPY.EUR.SP00.A?format=csvdata&lastNObservations=1
 *   - Note: `service/data/EXR/D.` (the legacy /data/exr/ shortcut 404s).
 *   - lastNObservations=1 caps payload to the latest row per series.
 *
 * 5-must-have (§1 of CLAUDE.md):
 *   - Terminal state: 200 | 502 — never streams forever.
 *   - Idempotent: same minute → same upstream cache → same response.
 *   - Dedupe: edge cache keyed on URL; no app-layer dedupe needed.
 *   - Coverage: 200 (live), 502 (ecb_404, ecb_502, ecb_invalid_csv).
 *   - AAR: ~/.claude/cache/corporate/aars/portfolio-data-02-c-worker-refactor-2026-08-23.md
 *
 * Bundle budget: <6KB minified, no npm deps. Hand-rolled CSV parser.
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
  /** Optional KV — used only for /api/market/fx-counter debug, not the data path. */
  CACHE?: KVNamespace;
  /** CORS allowlist. Defaults to https://christianmacion.github.io. */
  ALLOWED_ORIGIN?: string;
}

// ===== Wire types ======================================================
export interface FxItem {
  /** Display pair: "EUR/USD" (1 EUR = N USD) or "USD/JPY" (1 USD = N JPY). */
  pair: string;
  /** Foreign-exchange rate. */
  px: number;
  /** Currency code on the LEFT of the pair (base currency). */
  base: string;
  /** Currency code on the RIGHT of the pair (quote currency). */
  quote: string;
}

// ===== Constants =======================================================
const ECB_URL =
  'https://data-api.ecb.europa.eu/service/data/EXR/D.USD+GBP+JPY.EUR.SP00.A?format=csvdata&lastNObservations=1';

/**
 * ECB SDMX CSV columns (bulk pull of D.USD+GBP+JPY.EUR.SP00.A):
 *   0:KEY  1:FREQ  2:CURRENCY  3:CURRENCY_DENOM  4:EXR_TYPE  5:EXR_SUFFIX
 *   6:TIME_PERIOD  7:OBS_VALUE  8:OBS_STATUS  ...
 *
 * Each row is a (CURRENCY, CURRENCY_DENOM) pair. The bulk URL returns
 * rows in alphabetical order of CURRENCY (the base symbol on the
 * LEFT of the URL):
 *   row 1: CURRENCY=GBP, CURRENCY_DENOM=EUR, OBS_VALUE=0.8567  (1 EUR = 0.8567 GBP)
 *   row 2: CURRENCY=JPY, CURRENCY_DENOM=EUR, OBS_VALUE=185.66  (1 EUR = 185.66 JPY)
 *   row 3: CURRENCY=USD, CURRENCY_DENOM=EUR, OBS_VALUE=1.1699  (1 EUR = 1.1699 USD)
 *
 * Each rate is "1 EUR = N X". We triangulate to display pairs.
 */
const SERIES_INDEX_TO_CURRENCY = ['GBP', 'JPY', 'USD'] as const;
const CURRENCY_COL = 2;
const OBS_VALUE_COL = 7;
const HEADER_LINE_PREFIX = 'KEY,';

const CORS_HEADERS: HeadersInit = {
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '300',
};

/**
 * Convert raw "1 EUR = N X" rates (one per X in the bulk query) into
 * the display pairs the converter UI needs:
 *   - EUR/USD (1 EUR = N USD)              → direct
 *   - GBP/USD (1 GBP = N USD)             → eurToUsd / eurToGbp
 *   - USD/JPY (1 USD = N JPY)             → eurToJpy / eurToUsd
 */
function buildDisplay(eurToGbp: number | null, eurToJpy: number | null, eurToUsd: number | null): FxItem[] {
  const out: FxItem[] = [];
  if (typeof eurToUsd === 'number' && eurToUsd > 0) {
    out.push({ pair: 'EUR/USD', px: +eurToUsd.toFixed(4), base: 'EUR', quote: 'USD' });
  }
  if (typeof eurToGbp === 'number' && eurToGbp > 0 && typeof eurToUsd === 'number' && eurToUsd > 0) {
    out.push({ pair: 'GBP/USD', px: +(eurToUsd / eurToGbp).toFixed(4), base: 'GBP', quote: 'USD' });
  }
  if (typeof eurToJpy === 'number' && eurToJpy > 0 && typeof eurToUsd === 'number' && eurToUsd > 0) {
    out.push({ pair: 'USD/JPY', px: +(eurToJpy / eurToUsd).toFixed(2), base: 'USD', quote: 'JPY' });
  }
  return out;
}

/**
 * Walk the SDMX CSV and pull observation values for the requested bases.
 * Returns the parsed display items.
 *
 * Why this parser and not a regex or split('\n') only:
 *   - The CSV header can include quoted strings (e.g. the TITLE_COMPL
 *     column). Simple split is fine because we only read fixed-position
 *     columns (CURRENCY=2, OBS_VALUE=7) and we skip rows where either
 *     is unparseable.
 *   - ECB returns one row per series in alphabetical base order.
 *     We map each row's CURRENCY column to the canonical SERIES_INDEX
 *     and aggregate, so a row order shuffle doesn't break parsing.
 */
function parseEcbCsv(csv: string): FxItem[] {
  if (!csv || !csv.startsWith(HEADER_LINE_PREFIX)) return [];
  const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const rates: Record<string, number> = {};
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i]!.split(',');
    const ccy = (cells[CURRENCY_COL] ?? '').trim();
    const valueStr = (cells[OBS_VALUE_COL] ?? '').trim();
    const value = parseFloat(valueStr);
    if (!ccy || !Number.isFinite(value) || value <= 0) continue;
    // Defensive: only accept the three currencies we requested.
    if (!(SERIES_INDEX_TO_CURRENCY as readonly string[]).includes(ccy)) continue;
    rates[ccy] = value;
  }
  return buildDisplay(rates.GBP ?? null, rates.JPY ?? null, rates.USD ?? null);
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

    // Path gate: only GET /api/market/fx
    if (url.pathname !== '/api/market/fx') {
      return errorResponse(requestId, 404, 'NOT_FOUND', 'path_not_found', allowedOrigin);
    }
    if (request.method !== 'GET') {
      return errorResponse(requestId, 405, 'METHOD_NOT_ALLOWED', 'method_not_allowed', allowedOrigin);
    }

    // Fetch ECB SDMX — 1h edge cache; cap at 3600s to respect ECB's
    // daily publication cadence. cf.cacheEverything: false so we
    // don't accidentally cache 502s.
    let res: Response;
    try {
      res = await fetch(ECB_URL, {
        headers: { Accept: 'text/csv' },
        cf: { cacheTtl: 3600, cacheEverything: false },
      });
    } catch {
      return errorResponse(requestId, 502, 'UPSTREAM_UNAVAILABLE', 'ecb_unreachable', allowedOrigin);
    }
    if (!res.ok) {
      return errorResponse(requestId, 502, 'UPSTREAM_UNAVAILABLE', `ecb_${res.status}`, allowedOrigin);
    }

    let csv: string;
    try {
      csv = await res.text();
    } catch {
      return errorResponse(requestId, 502, 'UPSTREAM_UNAVAILABLE', 'ecb_invalid_csv', allowedOrigin);
    }

    const items = parseEcbCsv(csv);
    if (items.length === 0) {
      return errorResponse(requestId, 502, 'UPSTREAM_UNAVAILABLE', 'ecb_no_valid_rows', allowedOrigin);
    }

    return jsonResponse(
      {
        ok: true,
        request_id: requestId,
        source: 'ecb',
        items,
        lastSync: new Date().toISOString(),
      },
      200,
      allowedOrigin,
      {
        'Cache-Control': 'public, max-age=60',
      },
    );
  },
};
