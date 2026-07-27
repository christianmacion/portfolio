// build-live-feed.mjs — v7.7.2 UNIFIED LIVE FEED BUILDER.
//
// Reads 3 cache JSONs (arxiv + macrowire + gdelt), normalizes each into
// a `LiveEvent` shape, deduplicates by URL fingerprint + title fingerprint,
// sorts by timestamp DESC, caps at 100 items, and writes
// public/live-feed-cache.json for the LiveFeed.astro component to embed.
//
// Cross-feed dedup heuristic:
//   - Identical URL → drop
//   - Identical title (lowercased, trimmed, collapsed whitespace) → drop
//   - Same domain in URL but different path → keep both (mark "related")
//
// Run: node scripts/build-live-feed.mjs
// Wired into prebuild per package.json (after build-graph-snapshot.mjs).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'src/data';
const OUT_DIR = 'src/data';
const OUT_FILE = 'live-feed-cache.json';
const CAP = 100;

const NDA_BLOCKLIST = new Set([
  '19v', 'macion-capital', 'macion_capital', 'quantivo',
]);

async function loadJson(path) {
  if (!existsSync(path)) return null;
  const text = await readFile(path, 'utf-8');
  return JSON.parse(text);
}

function isNdaClean(text) {
  if (!text) return true;
  const lower = text.toLowerCase();
  for (const blocked of NDA_BLOCKLIST) {
    if (lower.includes(blocked)) return false;
  }
  return true;
}

function fingerprint(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function urlDomain(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function asLiveEvent(item, source, overrides = {}) {
  const id = overrides.id || `${source}-${fingerprint(item.title).slice(0, 48)}`;
  return {
    id,
    source,
    title: item.title || '',
    link: item.link || '',
    timestamp: item.timestamp || '',
    category: overrides.category || item.category || 'unknown',
    severity: overrides.severity || item.severity || null,
    city: overrides.city || item.city || null,
    publisher: overrides.publisher || item.publisher || null,
    fingerprint: fingerprint(item.title || ''),
    domain: urlDomain(item.link || ''),
  };
}

function normalizeArxiv(cache) {
  if (!cache || !Array.isArray(cache.items)) return [];
  return cache.items
    .filter((it) => isNdaClean(it.title))
    .map((it) =>
      asLiveEvent(it, 'arxiv', {
        publisher: 'arXiv',
        category: it.category || 'q-fin',
      }),
    );
}

function normalizeMacrowire(cache) {
  if (!cache || !Array.isArray(cache.items)) return [];
  return cache.items
    .filter((it) => isNdaClean(it.title))
    .map((it) =>
      asLiveEvent(it, 'macrowire', {
        publisher: it.publisher || 'unknown',
        category: it.publisher || 'macro',
      }),
    );
}

function normalizeGdelt(cache) {
  if (!cache || !Array.isArray(cache.events)) return [];
  return cache.events
    .filter((ev) => isNdaClean(ev.title))
    .map((ev) => {
      // GDELT events don't carry outbound article links; build a stable
      // pseudo-link from the event id so dedup-by-URL works uniformly.
      const syntheticLink = ev.link || `https://gdelt.org/event/${ev.id}`;
      return asLiveEvent({ ...ev, link: syntheticLink }, 'gdelt', {
        category: ev.category || 'geopolitical',
        severity: ev.severity || 'moderate',
        city: ev.city || null,
      });
    });
}

function dedupe(events) {
  const byUrl = new Map();
  const byFp = new Map();
  const out = [];

  // Sort so most-recent wins on conflict
  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  for (const e of events) {
    if (!e.title) continue;
    if (byUrl.has(e.link)) {
      // Mark as related to existing entry
      const existing = byUrl.get(e.link);
      if (!existing.related) existing.related = [];
      if (!existing.related.find((r) => r.source === e.source)) {
        existing.related.push({ source: e.source, id: e.id });
      }
      continue;
    }
    if (byFp.has(e.fingerprint)) {
      const existing = byFp.get(e.fingerprint);
      if (!existing.related) existing.related = [];
      if (!existing.related.find((r) => r.source === e.source)) {
        existing.related.push({ source: e.source, id: e.id });
      }
      continue;
    }
    byUrl.set(e.link, e);
    byFp.set(e.fingerprint, e);
    out.push(e);
    if (out.length >= CAP) break;
  }

  return out;
}

async function main() {
  const arxiv = await loadJson(join(SRC, 'arxiv-cache.json'));
  const macrowire = await loadJson(join(SRC, 'macrowire-cache.json'));
  const gdelt = await loadJson(join(SRC, 'gdelt-cache.json'));

  const all = [
    ...normalizeArxiv(arxiv),
    ...normalizeMacrowire(macrowire),
    ...normalizeGdelt(gdelt),
  ];

  const deduped = dedupe(all);

  // Source counts
  const counts = {
    arxiv: deduped.filter((e) => e.source === 'arxiv').length,
    macrowire: deduped.filter((e) => e.source === 'macrowire').length,
    gdelt: deduped.filter((e) => e.source === 'gdelt').length,
  };

  const out = {
    generated: new Date().toISOString(),
    fetchedAt: arxiv?.fetchedAt || macrowire?.fetchedAt || gdelt?.fetchedAt || null,
    cap: CAP,
    counts,
    total: deduped.length,
    events: deduped,
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, OUT_FILE), JSON.stringify(out, null, 2));

  console.log(
    `live-feed: wrote ${deduped.length}/${CAP} events (arxiv=${counts.arxiv}, macrowire=${counts.macrowire}, gdelt=${counts.gdelt}) → ${join(OUT_DIR, OUT_FILE)}`,
  );
}

main().catch((e) => {
  console.error('live-feed build failed:', e);
  process.exit(1);
});