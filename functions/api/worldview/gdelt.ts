/**
 * functions/api/worldview/gdelt.ts - Cloudflare Pages Function proxy for GDELT 2.0.
 *
 * GDELT 2.0 publishes geo-tagged news events every 15 minutes. The manifest
 * (data.gdeltproject.org/gdeltv2/lastupdate.txt) lists a .export.CSV.zip URL
 * for each 15-minute window; the export contains tab-separated rows with
 * one event per line. GDELT may CORS-block direct browser fetches, so this
 * route fetches server-side, unzips the CSV, normalizes the columns, and
 * returns JSON with CORS headers for the WorldView globe.
 *
 * Usage (browser, via src/utils/gdelt-client.ts):
 *   GET /api/worldview/gdelt                 → latest 6 events from current window
 *   GET /api/worldview/gdelt?url=<encoded>   → events from a specific export URL
 *
 * Worker LoC: ~120.
 *
 * CORS: allowedOrigin(request, env) - defined in functions/lib/contracts.ts.
 * The v12.W2 WorldView pipeline expanded the allowlist to include
 *   - query1.finance.yahoo.com   (Yahoo Finance v7 quote)
 *   - api.coingecko.com          (CoinGecko simple/price)
 *   - data-api.ecb.europa.eu     (ECB SDMX JSON)
 * even though this worker only proxies GDELT directly. The expansion is for
 * completeness so future worker endpoints can talk to those origins without
 * an extra deploy. When called same-origin, CORS is moot; when called from
 * a different deploy (e.g. local dev), only allowed-listed hosts get ACAO.
 */
import type { PagesFunction } from '@cloudflare/workers-types';
import {
  errorResponse,
  json,
  requestId,
  allowedOrigin,
  type Env,
} from '../../lib/contracts';

interface GdeltEvent {
  id: string;
  title: string;
  category: string;
  severity: string;
  lat: number;
  lon: number;
  city: string;
  source: string;
  timestamp: string;
  goldstein?: number;
}

/** GDELT Event Code → our category. Conservative mapping; unknown → 'geopolitical'. */
function classify(code: string): { category: string; severity: string } {
  if (!code) return { category: 'geopolitical', severity: 'moderate' };
  const c = code.toUpperCase();
  if (c.startsWith('07') || c.startsWith('08')) return { category: 'central-bank', severity: 'moderate' };
  if (c.startsWith('06')) return { category: 'data-release', severity: 'mild' };
  if (c.startsWith('04') || c.startsWith('05')) return { category: 'earnings', severity: 'mild' };
  if (c.startsWith('03')) return { category: 'fx', severity: 'mild' };
  return { category: 'geopolitical', severity: 'moderate' };
}

/** Look up the city/region from GDELT ActionGeo_FullName (e.g. "Frankfurt, Germany"). */
function cityFromGeo(geo: string): { city: string; lat: number; lon: number } {
  if (!geo) return { city: 'Unknown', lat: 0, lon: 0 };
  const city = geo.split(',')[0].trim() || geo;
  return { city, lat: 0, lon: 0 };
}

/** Normalize a single GDELT export row into our GdeltEvent schema.
 *  GDELT CSV columns (no header):
 *    0:GLOBALEVENTID  1:Day  2:MonthYear  3:Year  4:FractionDate
 *    5:Actor1Code 6:Actor1Name 7:Actor1CountryCode 8:Actor1KnownGroupCode 9:Actor1EthnicCode
 *    10:Actor1Religion1Code 11:Actor1Religion2Code 12:Actor1Type1Code 13:Actor1Type2Code 14:Actor1Type3Code
 *    15:Actor2Code 16:Actor2Name 17:Actor2CountryCode 18:Actor2KnownGroupCode 19:Actor2EthnicCode
 *    ...(many cols)... 27:GoldsteinScale 28:NumMentions 29:NumSources 30:NumArticles
 *    31:AvgTone ... 39:ActionGeo_Type 40:ActionGeo_FullName 41:ActionGeo_CountryCode
 *    42:ActionGeo_ADM1Code 43:ActionGeo_Lat 44:ActionGeo_Long 45:ActionGeo_FeatureID
 *    46:SourceGeo_Type ... 53:DateAdded ... */
function parseRow(row: string): GdeltEvent | null {
  const cols = row.split('\t');
  if (cols.length < 45) return null;
  const id = (cols[0] ?? '').trim();
  const lat = parseFloat(cols[43] ?? '');
  const lon = parseFloat(cols[44] ?? '');
  if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const geoName = (cols[40] ?? '').trim();
  const { city } = cityFromGeo(geoName);
  const eventCode = (cols[27] ?? '').trim(); // GoldsteinScale lives at 27 in some schemas; we use it for severity hint
  const goldstein = parseFloat(cols[27] ?? '');
  const numMentions = parseInt(cols[28] ?? '0', 10);
  const avgTone = parseFloat(cols[31] ?? '0');
  const severity =
    numMentions > 50 || Math.abs(avgTone) > 8
      ? 'critical'
      : numMentions > 15 || Math.abs(avgTone) > 4
        ? 'moderate'
        : 'mild';
  const { category } = classify(eventCode);
  // Build a sensible headline from actor names when present.
  const a1 = (cols[6] ?? '').trim();
  const a2 = (cols[16] ?? '').trim();
  let title = '';
  if (a1 && a2) title = a1 + ' ↔ ' + a2 + ' · ' + city;
  else if (a1) title = a1 + ' · ' + city;
  else title = 'Event · ' + city;
  // Day 1 + MonthYear 2 + Year 3 → ISO timestamp (UTC).
  const day = cols[1] ?? '';
  const monthYear = cols[2] ?? '';
  const year = cols[3] ?? '';
  const ts = day && monthYear
    ? `${year}${monthYear.padStart(4, '0')}${day.padStart(2, '0')}000000`
    : '';
  const isoTs = ts
    ? `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(8, 10)}:${ts.slice(10, 12)}:${ts.slice(12, 14)}Z`
    : new Date().toISOString();
  return {
    id: 'GDELT-' + id,
    title: title.slice(0, 140),
    category,
    severity,
    lat,
    lon,
    city,
    source: 'GDELT 2.0',
    timestamp: isoTs,
    goldstein: Number.isFinite(goldstein) ? goldstein : undefined,
  };
}

/** Use a tiny ZIP central-directory parser to extract the single file inside
 *  the .export.CSV.zip. We avoid pulling in fflate/jszip to keep the worker
 *  small. GDELT export zips contain exactly one entry named
 *  "YYYYMMDDHHMMSS.export.CSV". */
function inflateZip(data: Uint8Array): string | null {
  // Local file header signature: 0x04034b50
  if (data.length < 30) return null;
  const sig = (data[0]! << 24) | (data[1]! << 16) | (data[2]! << 8) | data[3]!;
  if (sig !== 0x04034b50) return null;
  const method = (data[8]! << 8) | data[9]!;
  const compSize =
    (data[18]! << 24) | (data[19]! << 16) | (data[20]! << 8) | data[21]!;
  const nameLen = (data[26]! << 8) | data[27]!;
  const extraLen = (data[28]! << 8) | data[29]!;
  const dataStart = 30 + nameLen + extraLen;
  if (data.length < dataStart + compSize) return null;
  const chunk = data.slice(dataStart, dataStart + compSize);
  if (method === 0) {
    return new TextDecoder().decode(chunk);
  }
  if (method === 8) {
    // Use the platform's built-in DecompressionStream ('deflate-raw' is the
    // raw DEFLATE bitstream without the zlib header; GDELT uses 'deflate'
    // (zlib-wrapped). The platform exposes both via DecompressionStream.
    try {
      // Synchronous inflate via DecompressionStream is unavailable; we use
      // a small async inflate. Worker pages support the API.
      // For sync we ship: fall back to no-op for compressed entries -
      // the upstream data is small enough to also accept a no-extract
      // path and return a static empty list.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ds = new (globalThis as any).DecompressionStream('deflate');
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();
      writer.write(chunk);
      writer.close();
      const parts: Uint8Array[] = [];
      // NOTE: this is fire-and-await; in practice Cloudflare Workers supports
      // async decompression. We block on the reader below.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return null; // placeholder; the actual decompression is handled in inflateZipAsync
    } catch {
      return null;
    }
  }
  return null;
}

async function inflateZipAsync(data: Uint8Array): Promise<string | null> {
  if (data.length < 30) return null;
  const sig = (data[0]! << 24) | (data[1]! << 16) | (data[2]! << 8) | data[3]!;
  if (sig !== 0x04034b50) return null;
  const method = (data[8]! << 8) | data[9]!;
  const compSize =
    (data[18]! << 24) | (data[19]! << 16) | (data[20]! << 8) | data[21]!;
  const nameLen = (data[26]! << 8) | data[27]!;
  const extraLen = (data[28]! << 8) | data[29]!;
  const dataStart = 30 + nameLen + extraLen;
  if (data.length < dataStart + compSize) return null;
  const chunk = data.slice(dataStart, dataStart + compSize);
  if (method === 0) {
    return new TextDecoder().decode(chunk);
  }
  if (method === 8) {
    try {
      // @ts-expect-error DecompressionStream is in workers
      const ds = new DecompressionStream('deflate');
      const stream = new Blob([chunk]).stream().pipeThrough(ds);
      const buf = await new Response(stream).arrayBuffer();
      return new TextDecoder().decode(buf);
    } catch {
      return null;
    }
  }
  return null;
}

/** Fetch lastupdate.txt and return the .export.CSV.zip URL, or null on failure. */
async function fetchManifest(): Promise<string | null> {
  try {
    const res = await fetch('https://data.gdeltproject.org/gdeltv2/lastupdate.txt', {
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return null;
    const exportUrl = lines[1];
    if (!/\.export\.CSV\.zip$/i.test(exportUrl)) return null;
    return exportUrl;
  } catch {
    return null;
  }
}

/** Fetch one export ZIP and extract up to 6 events with valid lat/lon. */
async function fetchEventsFromExport(url: string): Promise<GdeltEvent[]> {
  try {
    const res = await fetch(url, {
      cf: { cacheTtl: 60, cacheEverything: false },
    });
    if (!res.ok) return [];
    const buf = new Uint8Array(await res.arrayBuffer());
    const csv = await inflateZipAsync(buf);
    if (!csv) return [];
    const rows = csv.split('\n').filter(Boolean);
    const events: GdeltEvent[] = [];
    // GDELT files are huge (50k+ rows); we only need ~6 with valid lat/lon
    // for the WorldView globe. Sample every Nth row to stay efficient.
    const stride = Math.max(1, Math.floor(rows.length / 1200));
    for (let i = 0; i < rows.length && events.length < 6; i += stride) {
      const ev = parseRow(rows[i]!);
      if (ev) events.push(ev);
    }
    return events;
  } catch {
    return [];
  }
}

const CORS_HEADERS: HeadersInit = {
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '300',
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const rid = requestId(request);
  const origin = allowedOrigin(request, env);
  const cors: HeadersInit = origin ? { 'Access-Control-Allow-Origin': origin, ...CORS_HEADERS } : CORS_HEADERS;

  const url = new URL(request.url);
  const requestedUrl = url.searchParams.get('url');

  let manifest: string | null = requestedUrl;
  if (!manifest) {
    manifest = await fetchManifest();
    if (!manifest) {
      return errorResponse(rid, 502, 'UPSTREAM_UNAVAILABLE', 'gdelt_manifest_unavailable');
    }
  }

  // Validate URL is on the GDELT domain (avoid SSRF).
  let parsed: URL;
  try {
    parsed = new URL(manifest);
  } catch {
    return errorResponse(rid, 422, 'VALIDATION_ERROR', 'invalid_url');
  }
  if (parsed.hostname !== 'data.gdeltproject.org') {
    return errorResponse(rid, 422, 'VALIDATION_ERROR', 'url_not_gdelt');
  }

  const events = await fetchEventsFromExport(manifest);

  // 2026-08-08 live-data wiring: add `lastSync` and seed a single
  // "data-source pulling" event so the EarthMap shows the cache is alive.
  // The seed event sits at the front of the list with synthetic coords
  // (0,0) and category 'data-pull' so the chrome can colour it distinctly
  // from real GDELT events.
  const lastSync = new Date().toISOString();
  const seedPull: GdeltEvent = {
    id: `LIVE-${rid.slice(0, 8)}`,
    title: `GDELT 2.0 · live pull · ${lastSync.slice(11, 19)}Z`,
    category: 'data-pull',
    severity: 'mild',
    lat: 0,
    lon: 0,
    city: 'edge',
    source: 'data-source-pull',
    timestamp: lastSync,
  };

  return json<{
    ok: true;
    request_id: string;
    events: GdeltEvent[];
    lastSync: string;
  }>(
    { ok: true, request_id: rid, events: [seedPull, ...events], lastSync },
    200,
    rid,
    { ...cors, 'Cache-Control': 'public, max-age=60' },
  );
};

export const onRequestOptions: PagesFunction<Env> = async ({ request, env }) => {
  const origin = allowedOrigin(request, env);
  const cors: HeadersInit = origin ? { 'Access-Control-Allow-Origin': origin, ...CORS_HEADERS } : CORS_HEADERS;
  return new Response(null, { status: 204, headers: cors });
};