#!/usr/bin/env node
/**
 * fetch-macrowire.mjs — v7.7.0 multi-source macro wire fetcher.
 *
 * Pulls headlines from four public feeds that materially affect quant
 * research and trading:
 *   1. Reuters           — feeds.reuters.com/Reuters/worldNews (macro/world)
 *   2. CoinDesk          — coindesk.com/arc/outboundfeeds/rss/ (crypto macro)
 *   3. The Block         — theblock.co/rss.xml (institutional crypto)
 *   4. Binance announcements — api.binance.com (exchange)
 *
 * Each feed is parsed with a small RSS reader (or JSON for the
 * Binance catalogue). Outputs the merged, deduped, time-sorted union
 * to src/data/macrowire-cache.json (+ .fallback.json mirror).
 *
 * Output schema:
 *   { fetchedAt, buildDate, source, url, items: [
 *     { id, title, link, timestamp, publisher, tags }
 *   ] }
 *
 * Zero npm deps — Node 22 built-ins only. Logging is the same shape
 * as fetch-gdelt.mjs / fetch-arxiv.mjs.
 *
 * Standing Order §9 carve-out: this script uses real `new Date()` and
 * `Date.now()` because it's a build-time tool, not a rendered output.
 *
 * Graceful degradation: on any HTTP / parse failure the per-source
 * promise resolves to [] and the union still writes whatever survived.
 * On a total failure, .fallback.json ships unchanged.
 *
 * Run order:
 *   1. `npm run scripts:fetch-macrowire` (this script, standalone)
 *   2. `npm run build` (prebuild chain runs this automatically)
 *   3. `npm run deploy:mirror` (ships dist/ to Cloudflare Pages)
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// --- Paths ---------------------------------------------------------
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE); // scripts/ → repo root
const CACHE_PATH = `${ROOT}/src/data/macrowire-cache.json`;
const FALLBACK_PATH = `${ROOT}/src/data/macrowire-cache.fallback.json`;

// --- Constants -----------------------------------------------------
// Reuters.com direct RSS is 401-blocked at CloudFront; route via
// Google News RSS which proxies the same content reliably.
const SOURCES = [
  {
    publisher: 'REUTERS',
    url: 'https://news.google.com/rss/search?q=site:reuters.com+world+news&hl=en-US&gl=US&ceid=US:en',
    kind: 'rss',
    tag: 'macro',
  },
  {
    publisher: 'COINDESK',
    url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',
    kind: 'rss',
    tag: 'crypto',
  },
  {
    publisher: 'THEBLOCK',
    url: 'https://www.theblock.co/rss.xml',
    kind: 'rss',
    tag: 'crypto-inst',
  },
  {
    publisher: 'COINTELEGRAPH',
    url: 'https://cointelegraph.com/rss',
    kind: 'rss',
    tag: 'crypto',
  },
];

const MAX_ITEMS = 30; // cap after dedupe
const TIMEOUT_MS = 30_000;
const BUILD_DATE_FALLBACK = '2026-07-10T00:00:00Z';

// --- Logging -------------------------------------------------------
function log(level, msg) {
  const stamp = new Date().toISOString();
  console.log(`[fetch-macrowire ${stamp}] ${level} ${msg}`);
}

// --- HTTP wrapper with timeout -------------------------------------
async function fetchWithTimeout(url, ms, label) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (christianmacion-portfolio-fetcher)',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${label || url}`);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// --- RSS parser (shared with fetch-arxiv.mjs conceptually) -------
function extractTag(body, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = body.match(re);
  if (!m) return '';
  let v = m[1].trim();
  const cdata = v.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/i);
  if (cdata) v = cdata[1].trim();
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

function extractFirstHref(body) {
  // Some feeds put the URL in <link>text</link>; others in <link href="…"/>.
  // Try the closed-tag path first, then the href attribute.
  const closed = extractTag(body, 'link');
  if (closed) return closed;
  const m = body.match(/<link\b[^>]*href=["']([^"']+)["']/i);
  return m ? m[1] : '';
}

function parseRssItems(xml) {
  const items = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    items.push({
      title: extractTag(m[1], 'title'),
      link: extractFirstHref(m[1]),
      pubDate: extractTag(m[1], 'pubDate'),
      guid: extractTag(m[1], 'guid'),
      description: extractTag(m[1], 'description'),
    });
  }
  return items;
}

// --- Item normalizer ----------------------------------------------
function normalizeItem(raw, publisher, tag) {
  if (!raw.title || !raw.link) return null;

  // id: prefer guid, else hash of link
  const id =
    raw.guid ||
    raw.link
      .replace(/^https?:\/\//, '')
      .replace(/[^a-z0-9]+/gi, '-')
      .toLowerCase()
      .slice(0, 80);

  // pubDate → ISO
  let timestamp = '';
  if (raw.pubDate) {
    const d = new Date(raw.pubDate);
    if (!Number.isNaN(d.getTime())) {
      timestamp = d.toISOString();
    }
  }

  // Title cleanup
  let title = raw.title.replace(/\s+/g, ' ').trim();
  // Some Binance announcement titles include "Notice:" prefix — keep it
  // (it's part of the headline identity). Just cap at 200 chars.
  title = title.slice(0, 200);

  return {
    id,
    title,
    link: raw.link,
    timestamp,
    publisher,
    tags: [tag],
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
    source, // 'macrowire' | 'fallback'
    url: source === 'macrowire' ? 'multi-source RSS' : '',
    sources: SOURCES.map((s) => s.publisher),
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
  log('INFO', `macrowire fetch starting (sources=${SOURCES.map((s) => s.publisher).join(',')}, max=${MAX_ITEMS})`);

  const results = await Promise.allSettled(
    SOURCES.map(async (src) => {
      const res = await fetchWithTimeout(src.url, TIMEOUT_MS, `macrowire ${src.publisher}`);
      const xml = await res.text();
      const rawItems = parseRssItems(xml);
      return rawItems.map((it) => normalizeItem(it, src.publisher, src.tag));
    }),
  );

  const allItems = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const src = SOURCES[i];
    if (r.status === 'fulfilled') {
      const ok = r.value.filter(Boolean);
      log('INFO', `${src.publisher}: ${ok.length} items`);
      allItems.push(...ok);
    } else {
      log('WARN', `${src.publisher}: failed (${r.reason?.message ?? 'unknown'})`);
    }
  }

  try {
    const items = bucketAndRank(allItems);
    if (items.length === 0) {
      log('WARN', 'no items bucketed; falling back to last good snapshot');
      const fallback = readFallbackItems();
      writeCache(fallback, fallback.length > 0 ? 'macrowire' : 'fallback', fallback.length === 0);
    } else {
      writeCache(items, 'macrowire');
    }
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    log('OK', `done in ${elapsed}s`);
    process.exit(0);
  } catch (err) {
    log('ERROR', `write failed: ${err.message}`);
    const fallback = readFallbackItems();
    writeCache(fallback, 'fallback', true);
    process.exit(0);
  }
}

main();
