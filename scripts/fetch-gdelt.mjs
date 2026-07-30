#!/usr/bin/env node
/**
 * fetch-gdelt.mjs — v6.11 nightly GDELT event fetcher.
 *
 * Pulls the latest 15-min GDELT export from
 *   http://data.gdeltproject.org/gdeltv2/<timestamp>.export.CSV.zip
 * via the masterfilelist manifest, buckets ~300 events into our
 * 5-category portfolio taxonomy (geopolitical + central-bank only in
 * v6.11), keeps top-50 by |Goldstein|, writes
 *   src/data/gdelt-cache.json
 *
 * Zero npm deps — uses Node 22's built-in `fetch`, `node:stream`, and
 * `node:zlib`. TSV parsing is hand-rolled (rows are simple enough).
 *
 * Standing Order §9 carve-out: this script uses real `new Date()` and
 * `Date.now()` because it's a build-time tool, not a rendered output
 * surface. The downstream consumers (`src/utils/gdelt-events.ts`) read
 * the cached `fetchedAt` ISO string from the JSON; that string IS the
 * build-stamped artifact, and downstream code never re-derives it.
 *
 * Graceful degradation (mirror of scripts/build-resumes.mjs lines
 * 109-124): on any HTTP / parse failure we write
 *   { events: [], fetchedAt: <build-stamp>, source: 'fallback' }
 * so the build never fails; live pins disappear but the static 10-event
 * collection still renders.
 *
 * Run order:
 *   1. `npm run scripts:fetch-gdelt` (this script, standalone)
 *   2. `npm run build` (prebuild chain runs this automatically)
 *   3. `npm run deploy:mirror` (ships dist/ to Cloudflare Pages)
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

// --- Paths ---------------------------------------------------------
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE); // scripts/ → repo root
const CACHE_PATH = `${ROOT}/src/data/gdelt-cache.json`;
const FALLBACK_PATH = `${ROOT}/src/data/gdelt-cache.fallback.json`;

// --- Constants -----------------------------------------------------
const MANIFEST_URL = 'http://data.gdeltproject.org/gdeltv2/masterfilelist.txt';
const MAX_EVENTS = 50;
const MANIFEST_TIMEOUT_MS = 30_000;
const ZIP_TIMEOUT_MS = 120_000;
const MAX_MANIFEST_LINES = 200; // ~3 days of exports @ 15min cadence

const BUILD_DATE_FALLBACK = '2026-07-10T00:00:00Z';

// --- Logging -------------------------------------------------------
function log(level, msg) {
  const stamp = new Date().toISOString();
  console.log(`[fetch-gdelt ${stamp}] ${level} ${msg}`);
}

// --- HTTP wrapper with timeout -------------------------------------
async function fetchWithTimeout(url, ms, label) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${label || url}`);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// --- Manifest fetch + parse ----------------------------------------
/**
 * GDELT masterfilelist.txt is 3-space-separated columns:
 *   <size> <hash> <url>
 * The most recent export is the LAST line. We only need the last N.
 */
async function pickLatestExportUrl() {
  const res = await fetchWithTimeout(MANIFEST_URL, MANIFEST_TIMEOUT_MS, 'masterfilelist');
  const text = await res.text();
  const lines = text.trim().split('\n').slice(-MAX_MANIFEST_LINES);
  for (let i = lines.length - 1; i >= 0; i--) {
    const parts = lines[i].trim().split(/\s+/);
    if (parts.length < 3) continue;
    const url = parts[2];
    if (!/\.export\.CSV\.zip$/.test(url)) continue;
    return url;
  }
  throw new Error('No export URL found in masterfilelist.txt');
}

// --- Zip stream → text --------------------------------------------
/**
 * GDELT exports are zip files containing a single .CSV (TSV) entry.
 * We stream-download, pipe through createGunzip, accumulate lines.
 * (We don't use a streaming zip parser because the export has only
 *  one entry and Node's zlib handles raw deflate; GDELT actually
 *  uses STORE or DEFLATE depending on the slice.)
 *
 * Strategy: try `Content-Type: application/zip` first, fall back to
 * treating the body as a single DEFLATE stream. In practice GDELT
 * serves gzip-wrapped zip files (Content-Encoding: gzip); we pipe
 * through createGunzip THEN look for the zip's local file header.
 *
 * For simplicity and robustness: rely on Node 22's automatic gzip
 * decompression via the `Accept-Encoding: gzip` header that fetch
 * sets by default. The body we receive is the raw zip bytes; we
 * scan for the PK\x03\x04 header and decompress the first entry's
 * DEFLATE block manually.
 */
async function downloadAndExtract(zipUrl) {
  const res = await fetchWithTimeout(zipUrl, ZIP_TIMEOUT_MS, `zip ${zipUrl}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return extractFirstEntryFromZip(buf);
}

/**
 * Minimal zip extractor: parses the End-Of-Central-Directory record,
 * reads the central directory, locates the first entry, reads its
 * local file header, then DEFLATE-decompresses the compressed data.
 *
 * Reference: PKWARE APPNOTE.TXT, version 6.3.x.
 */
function extractFirstEntryFromZip(buf) {
  // EOCD signature = 0x06054b50. Scan backwards from end of buffer.
  const EOCD_SIG = 0x06054b50;
  let eocdOffset = -1;
  const maxScan = Math.min(buf.length, 65_557);
  for (let i = buf.length - 22; i >= buf.length - maxScan && i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('zip: EOCD record not found');
  }

  // EOCD layout (22 bytes minimum):
  //   0  uint32 signature
  //   4  uint16 disk number
  //   6  uint16 disk where CD starts
  //   8  uint16 # CD entries on this disk
  //  10  uint16 total # CD entries
  //  12  uint32 size of CD
  //  16  uint32 offset of CD
  //  20  uint16 comment length
  const cdEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  if (cdEntries === 0) {
    throw new Error('zip: zero central-directory entries');
  }

  // Read first CD entry.
  const CD_SIG = 0x02014b50;
  if (buf.readUInt32LE(cdOffset) !== CD_SIG) {
    throw new Error('zip: central-directory signature mismatch');
  }

  // CD entry fixed fields (46 bytes):
  //   0  uint32 signature
  //   4  uint16 version made by
  //   6  uint16 version needed
  //   8  uint16 GP flags
  //  10  uint16 compression method (0=STORE, 8=DEFLATE)
  //  12  uint16 last mod time
  //  14  uint16 last mod date
  //  16  uint32 CRC-32
  //  20  uint32 compressed size
  //  24  uint32 uncompressed size
  //  28  uint16 file name length
  //  30  uint16 extra field length
  //  32  uint16 file comment length
  //  34  uint16 disk #
  //  36  uint16 internal attrs
  //  38  uint32 external attrs
  //  42  uint32 local header offset
  const method = buf.readUInt16LE(cdOffset + 10);
  const compSize = buf.readUInt32LE(cdOffset + 20);
  const uncompSize = buf.readUInt32LE(cdOffset + 24);
  // nameLen + extraLen are part of the PKZIP spec (offset 28 + 30) and
  // are read for forward-compat but currently unused. Prefix with _ to
  // satisfy eslint no-unused-vars (config: /^_/u).
  const _nameLen = buf.readUInt16LE(cdOffset + 28);
  const _extraLen = buf.readUInt16LE(cdOffset + 30);
  const localOff = buf.readUInt32LE(cdOffset + 42);

  // Skip the local file header (30 bytes + name + extra) to reach data.
  const LOCAL_SIG = 0x04034b50;
  if (buf.readUInt32LE(localOff) !== LOCAL_SIG) {
    throw new Error('zip: local-file-header signature mismatch');
  }
  const localNameLen = buf.readUInt16LE(localOff + 26);
  const localExtraLen = buf.readUInt16LE(localOff + 28);
  const dataOff = localOff + 30 + localNameLen + localExtraLen;

  if (method === 0) {
    // STORE — no compression.
    return buf.slice(dataOff, dataOff + compSize).toString('utf8');
  }
  if (method !== 8) {
    throw new Error(`zip: unsupported compression method ${method}`);
  }
  // DEFLATE — use Node's inflateRawSync. We can't use createInflateRaw
  // without a stream wrapper here; inflateRawSync is fine for buffers.
  const compressed = buf.slice(dataOff, dataOff + compSize);
  const inflated = inflateRawSync(compressed, { maxOutputLength: uncompSize || 10 * 1024 * 1024 });
  return inflated.toString('utf8');
}

// --- TSV parser ---------------------------------------------------
/**
 * GDELT 2.0 export is tab-separated with 61 columns. There is no header
 * row — every line is data. Field positions of interest:
 *   0  GLOBALEVENTID
 *   1  SQLDATE  (YYYYMMDD)
 *   7  Actor1CountryCode   (e.g. "USA")
 *  17  Actor2CountryCode   (e.g. "RUS")
 *  26  EventCode
 *  28  EventRootCode       (CAMEO root, e.g. "04")
 *  29  QuadClass           (1..4)
 *  30  GoldsteinScale      (-10..+10)
 *  52  ActionGeo_FullName  (e.g. "Beijing, Beijing, China")
 *  53  ActionGeo_CountryCode
 *  56  ActionGeo_Lat
 *  57  ActionGeo_Long
 *  60  SOURCEURL           (NEVER rendered — NDA Rule 4 risk)
 *
 * Reference: http://data.gdeltproject.org/documentation/CSV.Header.FieldIDs.pdf
 */
const GDELT_FIELD_INDEX = {
  GLOBALEVENTID: 0,
  SQLDATE: 1,
  EventCode: 26,
  EventRootCode: 28,
  QuadClass: 29,
  GoldsteinScale: 30,
  Actor1CountryCode: 7,
  Actor2CountryCode: 17,
  ActionGeo_FullName: 52,
  ActionGeo_CountryCode: 53,
  ActionGeo_Lat: 56,
  ActionGeo_Long: 57,
  SOURCEURL: 60,
};

function parseGdeltTsv(text) {
  const lines = text.split('\n');
  const rows = [];
  // No header — every line is data.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = line.split('\t');
    if (cols.length < 61) continue; // malformed row, skip
    rows.push({
      GLOBALEVENTID: cols[GDELT_FIELD_INDEX.GLOBALEVENTID],
      SQLDATE: cols[GDELT_FIELD_INDEX.SQLDATE],
      EventCode: cols[GDELT_FIELD_INDEX.EventCode],
      EventRootCode: cols[GDELT_FIELD_INDEX.EventRootCode],
      QuadClass: cols[GDELT_FIELD_INDEX.QuadClass],
      GoldsteinScale: cols[GDELT_FIELD_INDEX.GoldsteinScale],
      Actor1CountryCode: cols[GDELT_FIELD_INDEX.Actor1CountryCode],
      Actor2CountryCode: cols[GDELT_FIELD_INDEX.Actor2CountryCode],
      ActionGeo_FullName: cols[GDELT_FIELD_INDEX.ActionGeo_FullName],
      ActionGeo_CountryCode: cols[GDELT_FIELD_INDEX.ActionGeo_CountryCode],
      ActionGeo_Lat: cols[GDELT_FIELD_INDEX.ActionGeo_Lat],
      ActionGeo_Long: cols[GDELT_FIELD_INDEX.ActionGeo_Long],
      SOURCEURL: cols[GDELT_FIELD_INDEX.SOURCEURL],
    });
  }
  return rows;
}

// --- Bucket + dedupe + rank ---------------------------------------
function bucketAndRank(rawRows) {
  // This re-implements the same logic as `src/utils/gdelt-bucket.ts`
  // (the .ts module is for type imports at SSR time; the .mjs script
  // can't import it because Node has no TS loader here). If the logic
  // drifts, the contract is the ResolvedEvent shape — both modules
  // produce the same keys.
  const buckets = [];
  const seen = new Set();
  const DAVAO_RE = /\bDavao City\b/;
  const CB_JURISDICTIONS = new Set([
    'USA', 'GBR', 'EUR', 'JPN', 'CHN', 'AUS', 'CAN', 'CHE',
    'NZL', 'SGP', 'HKG', 'KOR', 'IND', 'BRA', 'MEX',
  ]);

  function shortCity(raw) {
    if (!raw) return '';
    const first = raw.split(',')[0].trim();
    if (!first) return '';
    return first
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .slice(0, 32);
  }

  function isGeopolitical(root, quad) {
    if (!(quad === 1 || quad === 2 || quad === 3)) return false;
    const r = Number(root);
    if (!(r >= 1 && r <= 15) && r !== 17) return false;
    return true;
  }

  function isCentralBank(root, goldstein, a1, a2, actionCountry) {
    const r = Number(root);
    if (!(r >= 4 && r <= 9)) return false;
    if (!(goldstein >= 1.5)) return false;
    return (
      CB_JURISDICTIONS.has(a1) ||
      CB_JURISDICTIONS.has(a2) ||
      CB_JURISDICTIONS.has(actionCountry)
    );
  }

  function goldsteinToSeverity(g) {
    const abs = Math.abs(g);
    if (abs <= 3.0) return 'mild';
    if (abs <= 7.0) return 'moderate';
    return 'critical';
  }

  function synthesizeTitle(a1, a2, root, city) {
    const verb = {
      '01': 'statement', '02': 'appeal', '03': 'cooperation',
      '04': 'consultation', '05': 'diplomacy', '06': 'engagement',
      '07': 'aid', '08': 'yield', '09': 'investigation',
      '10': 'demand', '11': 'disapproval', '12': 'rejection',
      '13': 'threat', '14': 'protest', '15': 'posturing',
      '17': 'coercion',
    };
    // v6.11.6 — drop raw "actor-1" / "actor-2" placeholder tokens that
    // leaked into the rendered globe titles. When a1/a2 are missing
    // (common in GDELT rows with no resolved actor), hide the actor
    // leg entirely instead of substituting the placeholder. Also dedupe
    // self-loops (ISR–ISR) and cases where the action city equals one
    // of the actor jurisdictions.
    const a1Show = a1 && a1 !== city ? a1 : '';
    const a2Show = a2 && a2 !== city ? a2 : '';
    // Dedupe identical actors (e.g. ISR–ISR domestic events)
    let actors = [a1Show, a2Show].filter(Boolean);
    if (actors.length === 2 && actors[0] === actors[1]) actors = [actors[0]];
    const verbStr = verb[root] || 'event';
    const cityTag = city ? ` · ${city}` : '';
    if (actors.length === 0) return `${verbStr}${cityTag}`;
    if (actors.length === 1) return `${actors[0]} ${verbStr}${cityTag}`;
    return `${actors[0]}–${actors[1]} ${verbStr}${cityTag}`;
  }

  function sqlDateToIso(sql) {
    if (!/^\d{8}$/.test(sql)) return '';
    return `${sql.slice(0, 4)}-${sql.slice(4, 6)}-${sql.slice(6, 8)}T12:00:00Z`;
  }

  for (const row of rawRows) {
    if (seen.has(row.GLOBALEVENTID)) continue;
    const lat = Number(row.ActionGeo_Lat);
    const lon = Number(row.ActionGeo_Long);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    if (lat === 0 && lon === 0) continue;
    if (DAVAO_RE.test(row.ActionGeo_FullName || '')) continue;

    const root = row.EventRootCode;
    const quad = Number(row.QuadClass);
    const g = Number(row.GoldsteinScale) || 0;
    const a1 = row.Actor1CountryCode;
    const a2 = row.Actor2CountryCode;
    const actionCountry = row.ActionGeo_CountryCode;

    let category = null;
    if (isCentralBank(root, g, a1, a2, actionCountry)) category = 'central-bank';
    else if (isGeopolitical(root, quad)) category = 'geopolitical';
    if (!category) continue;

    const city = shortCity(row.ActionGeo_FullName);
    const title = synthesizeTitle(a1, a2, root, city || actionCountry || 'unspecified');
    const severity = goldsteinToSeverity(g);

    seen.add(row.GLOBALEVENTID);
    buckets.push({
      id: row.GLOBALEVENTID,
      title,
      category,
      severity,
      lat,
      lon,
      city,
      source: 'GDELT event monitor',
      timestamp: sqlDateToIso(row.SQLDATE),
      goldstein: g,
    });
  }

  // Rank by |Goldstein|, keep top-N.
  buckets.sort((a, b) => Math.abs(b.goldstein) - Math.abs(a.goldstein));
  return buckets.slice(0, MAX_EVENTS);
}

// --- Write --------------------------------------------------------
function buildDateIso() {
  const raw = process.env.BUILD_DATE;
  if (!raw) return new Date(BUILD_DATE_FALLBACK).toISOString();
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date(BUILD_DATE_FALLBACK).toISOString() : d.toISOString();
}

function writeCache(events, source, fallback = false) {
  const payload = {
    fetchedAt: new Date().toISOString(),
    buildDate: buildDateIso(),
    source, // 'gdelt' | 'fallback'
    url: source === 'gdelt' ? 'http://data.gdeltproject.org/gdeltv2/' : '',
    events,
  };
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(payload, null, 2));
  // Mirror to .fallback.json so next failure has something to ship.
  if (!fallback) {
    writeFileSync(FALLBACK_PATH, JSON.stringify(payload, null, 2));
  }
  log('OK', `wrote ${events.length} events (source=${source}) → ${CACHE_PATH}`);
}

// --- Fallback recovery --------------------------------------------
function readFallbackEvents() {
  if (!existsSync(FALLBACK_PATH)) return [];
  try {
    const raw = JSON.parse(readFileSync(FALLBACK_PATH, 'utf8'));
    return Array.isArray(raw.events) ? raw.events : [];
  } catch {
    return [];
  }
}

// --- Main ---------------------------------------------------------
async function main() {
  const startedAt = Date.now();
  log('INFO', `GDELT fetch starting (max=${MAX_EVENTS})`);
  try {
    const exportUrl = await pickLatestExportUrl();
    log('INFO', `latest export → ${exportUrl}`);
    const tsv = await downloadAndExtract(exportUrl);
    const rawRows = parseGdeltTsv(tsv);
    log('INFO', `parsed ${rawRows.length} raw rows`);
    const events = bucketAndRank(rawRows);
    if (events.length === 0) {
      log('WARN', 'bucket yielded 0 events; falling back to last good snapshot');
      const fallback = readFallbackEvents();
      writeCache(fallback, fallback.length > 0 ? 'gdelt' : 'fallback', fallback.length === 0);
    } else {
      writeCache(events, 'gdelt');
    }
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    log('OK', `done in ${elapsed}s`);
    process.exit(0);
  } catch (err) {
    log('ERROR', `fetch failed: ${err.message}`);
    log('WARN', 'writing empty cache (source=fallback); live pins will be hidden');
    const fallback = readFallbackEvents();
    writeCache(fallback, 'fallback', true);
    // v7.7.93 — Deming SoPK: fail-closed. Was exit(0) (silent degradation).
    // Now exit(1) so CI flags the degraded mode; the deploy still ships
    // with the fallback cache, but the gate honesty is preserved.
    process.exit(1);
  }
}

main();