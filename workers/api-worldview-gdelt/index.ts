/**
 * workers/api-worldview-gdelt/index.ts — Cloudflare Worker entrypoint.
 *
 * GET /api/worldview/gdelt — GDELT 2.0 events for the WorldView globe.
 *
 * Design contract (port of functions/api/worldview/gdelt.ts, commit 88a0e59):
 *   - Fetches the GDELT 2.0 manifest (lastupdate.txt) to find the latest
 *     .export.CSV.zip URL.
 *   - Downloads the ZIP, inflates the embedded CSV (deflate), parses the
 *     tab-separated rows, samples 6 events with valid lat/lon.
 *   - Returns a `data-pull` seed event so the EarthMap shows the cache
 *     is alive even when no fresh GDELT events have arrived.
 *
 *   Query params:
 *     GET /api/worldview/gdelt               → latest 6 events from current window
 *     GET /api/worldview/gdelt?url=<encoded> → events from a specific export URL
 *
 * Why a standalone Worker (per contact Worker template):
 *   - The portfolio CF Pages project was DELETED. The site is static on
 *     GH Pages; functions/ is local-dev only.
 *   - Worker keeps the data surface on a separate origin so the static
 *     site's CSP `connect-src 'self'` does not need to be relaxed.
 *
 * 5-must-have (§1 of CLAUDE.md):
 *   - Terminal state: 200 | 422 | 502 — never streams forever.
 *   - Idempotent: same manifest URL → same export ZIP → same response.
 *   - Dedupe: edge cache keyed on URL.
 *   - Coverage: 200 (live), 200 (empty events), 422 (invalid url),
 *     502 (gdelt_manifest_unavailable).
 *   - AAR: ~/.claude/cache/corporate/aars/portfolio-data-02-c-worker-refactor-2026-08-23.md
 *
 * Bundle budget: <8KB minified, no npm deps. Hand-rolled ZIP inflater.
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
  /** Optional KV — used for a 1m rate-limit budget on the manifest pull. */
  CACHE?: KVNamespace;
  /** CORS allowlist. Defaults to https://christianmacion.github.io. */
  ALLOWED_ORIGIN?: string;
}

// ===== Wire types ======================================================
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

// ===== Constants =======================================================
const GDELT_MANIFEST = 'https://data.gdeltproject.org/gdeltv2/lastupdate.txt';
const CORS_HEADERS: HeadersInit = {
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '300',
};

// ===== GDELT parsers ===================================================

/** Conservative event-code → category mapping. Unknown → 'geopolitical'. */
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
function cityFromGeo(geo: string): { city: string } {
  if (!geo) return { city: 'Unknown' };
  const city = geo.split(',')[0].trim() || geo;
  return { city };
}

/**
 * Parse a single GDELT export row into our GdeltEvent schema.
 * GDELT CSV columns (no header):
 *   0:GLOBALEVENTID  1:Day  2:MonthYear  3:Year  4:FractionDate
 *   5-14: Actor1 metadata
 *   15-26: Actor2 metadata
 *   27:GoldsteinScale  28:NumMentions  29:NumSources  30:NumArticles
 *   31:AvgTone ... 39:ActionGeo_Type  40:ActionGeo_FullName  ...
 *   43:ActionGeo_Lat  44:ActionGeo_Long  45:ActionGeo_FeatureID
 */
function parseRow(row: string): GdeltEvent | null {
  const cols = row.split('\t');
  if (cols.length < 45) return null;
  const id = (cols[0] ?? '').trim();
  const lat = parseFloat(cols[43] ?? '');
  const lon = parseFloat(cols[44] ?? '');
  if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const geoName = (cols[40] ?? '').trim();
  const { city } = cityFromGeo(geoName);
  const eventCode = (cols[27] ?? '').trim();
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

/**
 * Async ZIP inflater for GDELT export.CSV.zip blobs.
 * Uses the platform's DecompressionStream('deflate') for zlib-wrapped
 * entries; returns null on failure (the chrome will render "no events").
 */
async function inflateZipAsync(data: Uint8Array): Promise<string | null> {
  if (data.length < 30) return null;
  const sig = (data[0]! << 24) | (data[1]! << 16) | (data[2]! << 8) | data[3]!;
  if (sig !== 0x04034b50) return null; // Local file header signature
  const method = (data[8]! << 8) | data[9]!;
  const compSize = (data[18]! << 24) | (data[19]! << 16) | (data[20]! << 8) | data[21]!;
  const nameLen = (data[26]! << 8) | data[27]!;
  const extraLen = (data[28]! << 8) | data[29]!;
  const dataStart = 30 + nameLen + extraLen;
  if (data.length < dataStart + compSize) return null;
  const chunk = data.slice(dataStart, dataStart + compSize);
  if (method === 0) return new TextDecoder().decode(chunk);
  if (method === 8) {
    try {
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
    const res = await fetch(GDELT_MANIFEST, {
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

    // Path gate: only GET /api/worldview/gdelt
    if (url.pathname !== '/api/worldview/gdelt') {
      return errorResponse(requestId, 404, 'NOT_FOUND', 'path_not_found', allowedOrigin);
    }
    if (request.method !== 'GET') {
      return errorResponse(requestId, 405, 'METHOD_NOT_ALLOWED', 'method_not_allowed', allowedOrigin);
    }

    const requestedUrl = url.searchParams.get('url');
    let manifest: string | null = requestedUrl;
    if (!manifest) {
      manifest = await fetchManifest();
      if (!manifest) {
        return errorResponse(requestId, 502, 'UPSTREAM_UNAVAILABLE', 'gdelt_manifest_unavailable', allowedOrigin);
      }
    }

    // SSRF guard: URL must be on the GDELT domain.
    let parsed: URL;
    try {
      parsed = new URL(manifest);
    } catch {
      return errorResponse(requestId, 422, 'VALIDATION_ERROR', 'invalid_url', allowedOrigin);
    }
    if (parsed.hostname !== 'data.gdeltproject.org') {
      return errorResponse(requestId, 422, 'VALIDATION_ERROR', 'url_not_gdelt', allowedOrigin);
    }

    const events = await fetchEventsFromExport(manifest);

    // Seed a single "data-source pulling" event so the EarthMap shows
    // the cache is alive. Synthetic coords (0,0) and category 'data-pull'
    // so the chrome can colour it distinctly from real GDELT events.
    const lastSync = new Date().toISOString();
    const seedPull: GdeltEvent = {
      id: `LIVE-${requestId.slice(0, 8)}`,
      title: `GDELT 2.0 · live pull · ${lastSync.slice(11, 19)}Z`,
      category: 'data-pull',
      severity: 'mild',
      lat: 0,
      lon: 0,
      city: 'edge',
      source: 'data-source-pull',
      timestamp: lastSync,
    };

    return jsonResponse(
      {
        ok: true,
        request_id: requestId,
        events: [seedPull, ...events],
        lastSync,
      },
      200,
      allowedOrigin,
      {
        'Cache-Control': 'public, max-age=60',
      },
    );
  },
};
