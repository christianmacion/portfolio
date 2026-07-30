#!/usr/bin/env node
/**
 * fetch-arxiv.mjs — v7.7.0 arXiv preprint RSS fetcher.
 *
 * Pulls the latest preprints from arXiv's RSS feeds for the five
 * categories that matter to the quant-research + AI narrative:
 *   q-fin     (quantitative finance)
 *   stat.AP   (applied statistics)
 *   cs.LG     (machine learning)
 *   cs.AI     (artificial intelligence)
 *   cs.CL     (computation & language)
 *
 * arXiv RSS endpoint: http://export.arxiv.org/rss/<cat>
 * Each feed returns up to ~30 most-recent items; we union + dedupe +
 * cap at MAX_ITEMS across all five.
 *
 * Output:
 *   src/data/arxiv-cache.json
 *   src/data/arxiv-cache.fallback.json    (mirror on every success)
 *
 * Zero npm deps — Node 22 built-ins only. XML is parsed by a small
 * stack-based reader (no full XML spec compliance; just the RSS 2.0
 * fields we actually use).
 *
 * Standing Order §9 carve-out: this script uses real `new Date()` and
 * `Date.now()` because it's a build-time tool, not a rendered output
 * surface. The downstream consumers read the cached `fetchedAt` ISO
 * string from the JSON; that string IS the build-stamped artifact.
 *
 * Graceful degradation (mirror of fetch-gdelt.mjs): on any HTTP / parse
 * failure we write
 *   { items: [], fetchedAt: <build-stamp>, source: 'fallback' }
 * so the build never fails; live papers disappear but the static
 * category chrome still renders.
 *
 * Run order:
 *   1. `npm run scripts:fetch-arxiv` (this script, standalone)
 *   2. `npm run build` (prebuild chain runs this automatically)
 *   3. `npm run deploy:mirror` (ships dist/ to Cloudflare Pages)
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// --- Paths ---------------------------------------------------------
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE); // scripts/ → repo root
const CACHE_PATH = `${ROOT}/src/data/arxiv-cache.json`;
const FALLBACK_PATH = `${ROOT}/src/data/arxiv-cache.fallback.json`;

// --- Constants -----------------------------------------------------
const ARXIV_RSS_BASE = 'https://export.arxiv.org/rss/';
const CATEGORIES = ['q-fin', 'stat.AP', 'cs.LG', 'cs.AI', 'cs.CL'];
const MAX_ITEMS = 20; // per category, dedupe + global cap
const TIMEOUT_MS = 30_000;
const BUILD_DATE_FALLBACK = '2026-07-10T00:00:00Z';

// --- Logging -------------------------------------------------------
function log(level, msg) {
  const stamp = new Date().toISOString();
  console.log(`[fetch-arxiv ${stamp}] ${level} ${msg}`);
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

// --- Minimal RSS XML parser ---------------------------------------
/**
 * Extracts <item>...</item> blocks from an RSS 2.0 document and pulls
 * title / link / description / pubDate / author / guid / category.
 * Hand-rolled because we don't want a 200KB XML lib for one feed.
 *
 * arXiv-specific quirks:
 * - <title> may contain ":cat:" suffix like "Title (q-fin.TR)"
 * - <author> may be "Name1, Name2, ..." (comma-separated)
 * - <link> is the abstract page URL
 * - <guid> is the arXiv id (e.g., "oai:arXiv.org:2607.12345")
 * - <category> per arXiv: the primary category is the first
 */
function parseRssItems(xml) {
  const items = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const body = m[1];
    items.push({
      title: extractTag(body, 'title'),
      link: extractTag(body, 'link'),
      description: extractTag(body, 'description'),
      pubDate: extractTag(body, 'pubDate'),
      author: extractTag(body, 'author'),
      guid: extractTag(body, 'guid'),
      category: extractCategory(body),
    });
  }
  return items;
}

function extractTag(body, tag) {
  // CDATA wrapper support: <tag><![CDATA[...]]></tag>
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = body.match(re);
  if (!m) return '';
  let v = m[1].trim();
  const cdata = v.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/i);
  if (cdata) v = cdata[1].trim();
  // Decode common HTML entities
  v = v
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/<!\[CDATA\[/gi, '')
    .replace(/\]\]>/g, '');
  return v;
}

function extractCategory(body) {
  // First <category> tag holds the primary arXiv category like "q-fin.TR"
  const m = body.match(/<category\b[^>]*>([\s\S]*?)<\/category>/i);
  if (!m) return '';
  let v = m[1].trim();
  v = v
    .replace(/<!\[CDATA\[/gi, '')
    .replace(/\]\]>/g, '')
    .replace(/&amp;/g, '&')
    .trim();
  return v;
}

// --- Item normalizer -----------------------------------------------
/**
 * Maps raw RSS items into the canonical cache shape. Skips items
 * missing required fields (id, title, link, timestamp).
 *
 * Per Standing Order §9: `pubDate` is parsed from RFC 822 → ISO; the
 * script is the build-time tool, so `new Date()` is fine here.
 */
function normalizeItem(raw, fallbackCategory) {
  if (!raw.title || !raw.link || !raw.guid) return null;

  // arXiv guid is "oai:arXiv.org:NNNN.NNNNN[vN]"
  const guidMatch = raw.guid.match(/arXiv\.org:(\d{4,5}\.\d{4,5}(?:v\d+)?)/i);
  const arxivId = guidMatch ? guidMatch[1] : raw.guid;

  // pubDate is GMT/UTC; arXiv serves "Mon, 27 Jul 2026 00:00:00 GMT"
  let timestamp = '';
  if (raw.pubDate) {
    const d = new Date(raw.pubDate);
    if (!Number.isNaN(d.getTime())) {
      timestamp = d.toISOString();
    }
  }

  // Primary category — strip sub-category for the badge
  // "q-fin.TR" → "q-fin"
  const fullCat = raw.category || fallbackCategory || '';
  const catBadge = fullCat.split('.')[0].split(/\s/)[0];

  // Title may include " (cat)" suffix; trim it for clean display
  let title = raw.title.replace(/\s*\([a-z-]+\.[A-Z]{2}\)\s*$/i, '').trim();
  // Strip whitespace runs
  title = title.replace(/\s+/g, ' ').slice(0, 200);

  // Author: arXiv emits "Name1, Name2, ..."
  const authors = raw.author
    ? raw.author
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean)
        .slice(0, 4)
    : [];

  // Description: arXiv gives a paragraph of plain + LaTeX. Strip
  // aggressively to a 1-line summary.
  const summary = raw.description
    ? raw.description
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/&[a-z]+;|&#\d+;/g, '')
        .trim()
        .slice(0, 240)
    : '';

  return {
    id: arxivId,
    title,
    link: raw.link,
    timestamp,
    category: catBadge,
    categoryFull: fullCat,
    authors,
    summary,
    publisher: 'arXiv',
  };
}

// --- Bucket + dedupe + rank ---------------------------------------
function bucketAndRank(allItems) {
  const seen = new Set();
  const out = [];
  for (const item of allItems) {
    if (!item || !item.id) continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
    if (out.length >= MAX_ITEMS) break;
  }
  // Sort by timestamp descending (most-recent first)
  out.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  return out.slice(0, MAX_ITEMS);
}

// --- Write --------------------------------------------------------
function buildDateIso() {
  const raw = process.env.BUILD_DATE;
  if (!raw) return new Date(BUILD_DATE_FALLBACK).toISOString();
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date(BUILD_DATE_FALLBACK).toISOString() : d.toISOString();
}

function writeCache(items, source, fallback = false) {
  const payload = {
    fetchedAt: new Date().toISOString(),
    buildDate: buildDateIso(),
    source, // 'arxiv' | 'fallback'
    url: source === 'arxiv' ? ARXIV_RSS_BASE : '',
    categories: CATEGORIES,
    items,
  };
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(payload, null, 2));
  if (!fallback) {
    writeFileSync(FALLBACK_PATH, JSON.stringify(payload, null, 2));
  }
  log('OK', `wrote ${items.length} items (source=${source}) → ${CACHE_PATH}`);
}

function readFallbackItems() {
  if (!existsSync(FALLBACK_PATH)) return [];
  try {
    const raw = JSON.parse(readFileSync(FALLBACK_PATH, 'utf8'));
    return Array.isArray(raw.items) ? raw.items : [];
  } catch {
    return [];
  }
}

// --- Main ---------------------------------------------------------
async function main() {
  const startedAt = Date.now();
  log('INFO', `arXiv fetch starting (cats=${CATEGORIES.join(',')}, max=${MAX_ITEMS})`);

  // Fetch each category in parallel; tolerate per-feed failures.
  const results = await Promise.allSettled(
    CATEGORIES.map(async (cat) => {
      const url = `${ARXIV_RSS_BASE}${cat}`;
      const res = await fetchWithTimeout(url, TIMEOUT_MS, `arxiv ${cat}`);
      const xml = await res.text();
      const rawItems = parseRssItems(xml);
      return rawItems.map((it) => normalizeItem(it, cat));
    }),
  );

  const allItems = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const cat = CATEGORIES[i];
    if (r.status === 'fulfilled') {
      const ok = r.value.filter(Boolean);
      log('INFO', `${cat}: ${ok.length} items`);
      allItems.push(...ok);
    } else {
      log('WARN', `${cat}: failed (${r.reason?.message ?? 'unknown'})`);
    }
  }

  try {
    const items = bucketAndRank(allItems);
    if (items.length === 0) {
      log('WARN', 'no items bucketed; falling back to last good snapshot');
      const fallback = readFallbackItems();
      writeCache(fallback, fallback.length > 0 ? 'arxiv' : 'fallback', fallback.length === 0);
    } else {
      writeCache(items, 'arxiv');
    }
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    log('OK', `done in ${elapsed}s`);
    process.exit(0);
  } catch (err) {
    log('ERROR', `write failed: ${err.message}`);
    const fallback = readFallbackItems();
    writeCache(fallback, 'fallback', true);
    // v7.7.93 — Deming SoPK: fail-closed. Was exit(0) (silent degradation).
    process.exit(1);
  }
}

main();
