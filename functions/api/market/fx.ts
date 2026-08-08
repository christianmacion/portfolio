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
 *   Quote currencies: EUR, USD
 *     - D.USD+GBP+JPY.EUR+USD
 * The ECB returns rows like: <USD, EUR, N> = 1 USD = N EUR.
 */
const ECB_URL =
  'https://data-api.ecb.europa.eu/service/data/EXR/D.USD+GBP+JPY.EUR+USD?lastNObservations=1&format=jsondata';

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
 * Convert an ECB observation into a display pair.
 * ECB gives 1 {base} = N {quote}; we want pairs in display order:
 *   - EUR/USD (1 EUR = N USD)
 *   - GBP/USD (1 GBP = N USD)
 *   - USD/JPY (1 USD = N JPY)
 *
 * For EUR/USD: ECB row D.USD.EUR gives 1 USD = N EUR → invert to 1 EUR = 1/N USD.
 * For GBP/USD: ECB row D.USD.GBP gives 1 USD = N GBP → invert to 1 GBP = 1/N USD.
 * For USD/JPY: ECB row D.JPY.USD gives 1 JPY = N USD → invert to 1 USD = 1/N USD.
 */
function toDisplay(base: string, quote: string, rate: number): FxItem | null {
  if (rate <= 0) return null;
  if (base === 'USD' && quote === 'EUR') {
    return { pair: 'EUR/USD', px: +(1 / rate).toFixed(4), base: 'EUR', quote: 'USD' };
  }
  if (base === 'USD' && quote === 'GBP') {
    return { pair: 'GBP/USD', px: +(1 / rate).toFixed(4), base: 'GBP', quote: 'USD' };
  }
  if (base === 'JPY' && quote === 'USD') {
    return { pair: 'USD/JPY', px: +(1 / rate).toFixed(2), base: 'USD', quote: 'JPY' };
  }
  return null;
}

/** Walk the SDMX structure and pull observation values.
 *  ECB SDMX JSON shape (relevant subset):
 *    {
 *      "dataSets": [{ "series": { "0:0:0:0:0": { "observations": { "0": [N] } } } }],
 *      "structure": {
 *        "dimensions": {
 *          "series": [
 *            { "id": "FREQ",    "values": [{ "id": "D" }] },
 *            { "id": "CURRENCY", "values": [{ "id": "USD" }, { "id": "GBP" }, ...] },
 *            { "id": "CURRENCY_DENOM", "values": [{ "id": "EUR" }, ...] },
 *            ...
 *          ]
 *        }
 *      }
 *    }
 */
function parseEcbSdmx(raw: unknown): FxItem[] {
  if (!raw || typeof raw !== 'object' || raw === null) return [];
  const root = raw as Record<string, unknown>;
  const dataSets = Array.isArray(root.dataSets) ? root.dataSets : [];
  const structure = root.structure as Record<string, unknown> | undefined;
  const seriesDims =
    structure && typeof structure === 'object' && structure !== null
      ? ((structure as { dimensions?: { series?: Array<{ values?: Array<{ id?: string }> }> } })
          .dimensions?.series ?? [])
      : [];

  // Identify which series dim holds base (CURRENCY) and which holds quote (CURRENCY_DENOM).
  let baseDimIdx = -1;
  let quoteDimIdx = -1;
  seriesDims.forEach((dim, idx) => {
    if (dim && typeof dim === 'object' && 'id' in dim) {
      const id = (dim as { id?: string }).id;
      if (id === 'CURRENCY') baseDimIdx = idx;
      else if (id === 'CURRENCY_DENOM') quoteDimIdx = idx;
    }
  });
  if (baseDimIdx < 0 || quoteDimIdx < 0) return [];

  const items: FxItem[] = [];
  for (const ds of dataSets) {
    if (!ds || typeof ds !== 'object') continue;
    const series =
      (ds as { series?: Record<string, { observations?: Record<string, number[]> }> }).series ?? {};
    for (const [key, value] of Object.entries(series)) {
      if (!value || typeof value !== 'object') continue;
      const idxs = key.split(':');
      const baseIdx = Number(idxs[baseDimIdx] ?? -1);
      const quoteIdx = Number(idxs[quoteDimIdx] ?? -1);
      const baseValues = seriesDims[baseDimIdx]?.values ?? [];
      const quoteValues = seriesDims[quoteDimIdx]?.values ?? [];
      const base = String(baseValues[baseIdx]?.id ?? '');
      const quote = String(quoteValues[quoteIdx]?.id ?? '');
      const obs = (value.observations ?? {}) as Record<string, number[]>;
      const firstObs = Object.values(obs)[0];
      const rate = Number(firstObs?.[0] ?? 0);
      const item = toDisplay(base, quote, rate);
      if (item) items.push(item);
    }
  }
  return items;
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
export const __test__ = { parseEcbSdmx, toDisplay, type EcbObs };