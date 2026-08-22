/**
 * functions/api/market/fx.ts - Cloudflare Pages Function proxy for
 * ECB SDMX JSON data API.
 *
 * Architecture: 2026-08-08-live-data-apis.md (live data wiring).
 *
 * Why a proxy:
 *   - ECB SDMX JSON returns verbose metadata wrappers; the proxy
 *     normalises to a flat `FxItem[]` so the chrome can render without
 *     parsing SDMX shape in the browser.
 *   - 1h edge cache - ECB publishes reference rates once per business day.
 *
 * Hard rules:
 *   - 3 pairs (EUR/USD, GBP/USD, USD/JPY).
 *   - Edge cache 1h.
 *   - Typed envelope via `json()`.
 *   - On failure return errorResponse, not silent empty data.
 *
 * ECB URL: data-api.ecb.europa.eu/service/data/EXR/D.{CURRENCIES}.{QUOTE_CURRENCIES}?lastNObservations=1&format=jsondata
 *   - EXR = Exchange Rates; D = daily frequency.
 *   - For each base currency (USD), quote in EUR / GBP / JPY.
 *   - The result row gives 1 unit of {base} = {obs_value} {quote}.
 */
import type { PagesFunction } from '@cloudflare/workers-types';
import {
  allowedOrigin,
  errorResponse,
  json,
  requestId,
  type Env,
} from '../../lib/contracts';

/**
 * ECB SDMX endpoint.
 * We pull 1 observation per (base, quote) pair.
 *   Base currencies: USD, GBP, JPY
 *   Quote currencies: EUR (ECB publishes EUR-anchored reference rates
 *   only — the URL is `D.<base>.<reference>`, not a cross-product).
 *     - D.USD+GBP+JPY.EUR
 * ECB returns rows like: <GBP, EUR, N> = 1 GBP = N EUR. Each rate is
 * "1 EUR = N X" (alphabetical series index: GBP=0, JPY=1, USD=2).
 */
const ECB_URL =
  'https://data-api.ecb.europa.eu/service/data/EXR/D.USD+GBP+JPY.EUR.SP00.A?lastNObservations=1&format=jsondata';

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

const CORS_HEADERS: HeadersInit = {
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '300',
};

interface EcbObs {
  base?: string;
  quote?: string;
  rate?: number;
}

/**
 * Map alphabetical position in the bulk ECB response to currency code.
 * The bulk URL `D.USD+GBP+JPY.EUR` returns series in alphabetical order:
 *   keys[0] = GBP, keys[1] = JPY, keys[2] = USD
 */
const SERIES_INDEX_TO_CURRENCY = ['GBP', 'JPY', 'USD'] as const;

/**
 * Convert raw "1 EUR = N X" rates (one per X in the bulk query) into
 * the display pairs the converter UI needs:
 *   - EUR/USD (1 EUR = N USD)
 *   - GBP/USD (1 GBP = N USD)
 *   - USD/JPY (1 USD = N JPY)
 *
 * For EUR/USD: read EUR→USD directly.
 * For GBP/USD: 1 GBP = (EUR→USD)/(EUR→GBP) USD.
 * For USD/JPY: 1 USD = (EUR→JPY)/(EUR→USD) JPY → px = (EUR→JPY)/(EUR→USD).
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

/** Walk the SDMX structure and pull observation values.
 *  ECB SDMX JSON shape for the bulk query
 *  `D.USD+GBP+JPY.EUR.SP00.A?lastNObservations=1` (relevant subset):
 *    {
 *      "dataSets": [{ "series": {
 *          "0:0:0:0:0": { "observations": { "7137": [N] } },
 *          "0:1:0:0:0": { "observations": { "7137": [N] } },
 *          "0:2:0:0:0": { "observations": { "7137": [N] } }
 *      }}],
 *      "structure": { "dimensions": { "series": [
 *        { "id": "FREQ", "values": [{ "id": "D" }] },
 *        { "id": "CURRENCY", "values": [{ "id": "GBP" }, { "id": "JPY" }, { "id": "USD" }] },
 *        { "id": "CURRENCY_DENOM", "values": [{ "id": "EUR" }] },
 *        ...
 *      ]}}
 *    }
 *  Series index 0 = GBP, 1 = JPY, 2 = USD (alphabetical CURRENCY order).
 *  Each rate is "1 EUR = N X". We take the LATEST observation per
 *  series (highest numeric index) and triangulate to X/USD.
 */
function parseEcbSdmx(raw: unknown): FxItem[] {
  if (!raw || typeof raw !== 'object' || raw === null) return [];
  const root = raw as Record<string, unknown>;
  const dataSets = Array.isArray(root.dataSets) ? root.dataSets : [];
  const rates: Record<string, number> = {};
  for (const ds of dataSets) {
    if (!ds || typeof ds !== 'object') continue;
    const series =
      (ds as { series?: Record<string, { observations?: Record<string, number[]> }> }).series ?? {};
    Object.entries(series).forEach(([key, value]) => {
      if (!value || typeof value !== 'object') return;
      // The CURRENCY dim is the SECOND one in `0:N:0:0:0` (index 1).
      const idxs = key.split(':');
      const currencyIdx = Number(idxs[1] ?? -1);
      const ccy = SERIES_INDEX_TO_CURRENCY[currencyIdx];
      if (!ccy) return;
      const obs = (value.observations ?? {}) as Record<string, number[]>;
      const obsKeys = Object.keys(obs);
      if (obsKeys.length === 0) return;
      // Numeric sort → take the highest = newest observation.
      const lastKey = obsKeys.sort((a, b) => parseInt(a) - parseInt(b)).pop();
      if (lastKey === undefined) return;
      const v = obs[lastKey]?.[0];
      if (typeof v === 'number' && v > 0) rates[ccy] = v;
    });
  }
  return buildDisplay(rates.GBP ?? null, rates.JPY ?? null, rates.USD ?? null);
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const rid = requestId(request);
  const origin = allowedOrigin(request, env);
  const cors: HeadersInit = origin
    ? { 'Access-Control-Allow-Origin': origin, ...CORS_HEADERS }
    : CORS_HEADERS;

  let res: Response;
  try {
    res = await fetch(ECB_URL, {
      headers: { Accept: 'application/json' },
      cf: { cacheTtl: 3600, cacheEverything: false },
    });
  } catch {
    return errorResponse(rid, 502, 'UPSTREAM_UNAVAILABLE', 'ecb_unreachable');
  }
  if (!res.ok) {
    return errorResponse(rid, 502, 'UPSTREAM_UNAVAILABLE', `ecb_${res.status}`);
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return errorResponse(rid, 502, 'UPSTREAM_UNAVAILABLE', 'ecb_invalid_json');
  }

  const items = parseEcbSdmx(raw);

  return json<{
    ok: true;
    request_id: string;
    source: 'ecb';
    items: FxItem[];
    lastSync: string;
  }>(
    { ok: true, request_id: rid, source: 'ecb', items, lastSync: new Date().toISOString() },
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

/** Re-export the parser so unit tests can hit it without standing up a Worker. */
export const __test__ = { parseEcbSdmx, buildDisplay, SERIES_INDEX_TO_CURRENCY };
export type { EcbObs };