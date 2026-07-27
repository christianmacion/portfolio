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
// Drop entries older than this — mirrors the live:integrity gate's
// `MAX_AGE_DAYS=7` (scripts/check-live-feed-integrity.mjs). Fetching
// fresh caches doesn't help if GDELT still returns the same old event;
// the fix is to drop them at build time so the gate never trips.
const MAX_AGE_DAYS = 7;

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

// Drop entries whose timestamp is older than MAX_AGE_DAYS, or unparseable.
// GDELT especially keeps returning the same events on every fetch, so the
// upstream cache doesn't age out — the builder must.
function freshish(items) {
  const cutoff = Date.now() - MAX_AGE_DAYS * 86400 * 1000;
  return items.filter((it) => {
    const ts = it.timestamp || it.pubDate || it.date || '';
    const t = new Date(ts).getTime();
    if (Number.isNaN(t)) return true; // keep unparseable — let gate flag
    return t >= cutoff;
  });
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
  const base = {
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
  // v7.7.3 — attach lat/lon when caller provided them (Layer E on
  // EarthMap). coords is optional; older consumers ignore it.
  if (overrides.coords && typeof overrides.coords.lat === 'number') {
    base.coords = { lat: overrides.coords.lat, lon: overrides.coords.lon };
  }
  return base;
}

// === v7.7.3 — institution + publisher geocode tables (inline so the
//     fetcher has no TypeScript dep). The canonical typed mirror lives
//     in src/data/institutions.ts for the Astro side. ===

const INSTITUTIONS_BY_FOCUS = {
  'q-fin': [
    { id: 'mit', city: 'Cambridge, MA', lat: 42.3601, lon: -71.0942 },
    { id: 'cmu', city: 'Pittsburgh, PA', lat: 40.4406, lon: -79.9959 },
    { id: 'stanford', city: 'Stanford, CA', lat: 37.4275, lon: -122.1697 },
    { id: 'uchicago', city: 'Chicago, IL', lat: 41.7886, lon: -87.5986 },
    { id: 'berkeley', city: 'Berkeley, CA', lat: 37.8716, lon: -122.2727 },
    { id: 'nyu', city: 'New York, NY', lat: 40.7295, lon: -73.9965 },
    { id: 'columbia', city: 'New York, NY', lat: 40.8075, lon: -73.9626 },
    { id: 'princeton', city: 'Princeton, NJ', lat: 40.3573, lon: -74.6672 },
    { id: 'ethz', city: 'Zurich, CH', lat: 47.3769, lon: 8.5417 },
    { id: 'oxford', city: 'Oxford, UK', lat: 51.7548, lon: -1.2544 },
    { id: 'lse', city: 'London, UK', lat: 51.5142, lon: -0.1345 },
    { id: 'lmu', city: 'Munich, DE', lat: 48.1507, lon: 11.568 },
    { id: 'hec', city: 'Paris, FR', lat: 48.7813, lon: 2.2834 },
    { id: 'nus', city: 'Singapore, SG', lat: 1.2966, lon: 103.7764 },
    { id: 'hku', city: 'Hong Kong, HK', lat: 22.282, lon: 114.1369 },
    { id: 'tsinghua', city: 'Beijing, CN', lat: 40.0027, lon: 116.3262 },
    { id: 'todai', city: 'Tokyo, JP', lat: 35.6586, lon: 139.7454 },
  ],
  stat: [
    { id: 'jhu', city: 'Baltimore, MD', lat: 39.3299, lon: -76.6205 },
    { id: 'uw-stat', city: 'Seattle, WA', lat: 47.6553, lon: -122.3035 },
    { id: 'mcgill', city: 'Montréal, CA', lat: 45.5048, lon: -73.5772 },
  ],
  'cs-ai': [
    { id: 'deepmind', city: 'London, UK', lat: 51.5074, lon: -0.1278 },
    { id: 'google-b', city: 'Mountain View, CA', lat: 37.3861, lon: -122.0839 },
    { id: 'stanford-csai', city: 'Stanford, CA', lat: 37.4275, lon: -122.1697 },
  ],
  'cs-cl': [
    { id: 'uw-cs', city: 'Seattle, WA', lat: 47.6534, lon: -122.3077 },
    { id: 'edinburgh', city: 'Edinburgh, UK', lat: 55.9533, lon: -3.1883 },
  ],
  'cs-lg': [
    { id: 'ut-austin', city: 'Austin, TX', lat: 30.2849, lon: -97.7341 },
    { id: 'mila', city: 'Montréal, CA', lat: 45.5035, lon: -73.5745 },
    { id: 'cmu-cs', city: 'Pittsburgh, PA', lat: 40.4406, lon: -79.9959 },
  ],
};

const WIRE_PUBLISHER_CITY = {
  reuters: { lat: 51.5074, lon: -0.1278, city: 'London, UK' },
  coindesk: { lat: 40.7128, lon: -74.006, city: 'New York, NY' },
  theblock: { lat: 40.7128, lon: -74.006, city: 'New York, NY' },
  cointelegraph: { lat: 47.3769, lon: 8.5417, city: 'Zurich, CH' },
};

/** FNV-1a 32-bit hash. Same paper id → same institution on every build. */
function hash32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

function arxivFocus(category) {
  if (!category) return 'q-fin';
  if (category.startsWith('q-fin')) return 'q-fin';
  if (category.startsWith('stat')) return 'stat';
  if (category.startsWith('cs.AI') || category.startsWith('cs.LG')) return 'cs-ai';
  if (category.startsWith('cs.CL')) return 'cs-cl';
  return 'q-fin';
}

function assignInstitution(paperId, focus) {
  const pool = INSTITUTIONS_BY_FOCUS[focus] || INSTITUTIONS_BY_FOCUS['q-fin'];
  const idx = hash32(paperId) % pool.length;
  return pool[idx];
}

function wireCoordsFor(publisher) {
  if (!publisher) return null;
  const lower = publisher.toLowerCase();
  if (lower.includes('reuters')) return WIRE_PUBLISHER_CITY.reuters;
  if (lower.includes('coindesk')) return WIRE_PUBLISHER_CITY.coindesk;
  if (lower.includes('the block') || lower.includes('theblock')) return WIRE_PUBLISHER_CITY.theblock;
  if (lower.includes('cointelegraph') || lower.includes('coin telegraph')) return WIRE_PUBLISHER_CITY.cointelegraph;
  return null;
}

function normalizeArxiv(cache) {
  if (!cache || !Array.isArray(cache.items)) return [];
  return freshish(cache.items)
    .filter((it) => isNdaClean(it.title))
    .map((it) => {
      const focus = arxivFocus(it.category);
      const inst = assignInstitution(it.id || fingerprint(it.title), focus);
      return asLiveEvent(it, 'arxiv', {
        publisher: 'arXiv',
        category: it.category || 'q-fin',
        city: inst.city,
        coords: { lat: inst.lat, lon: inst.lon },
      });
    });
}

function normalizeMacrowire(cache) {
  if (!cache || !Array.isArray(cache.items)) return [];
  return freshish(cache.items)
    .filter((it) => isNdaClean(it.title))
    .map((it) => {
      const wire = wireCoordsFor(it.publisher);
      const overrides = {
        publisher: it.publisher || 'unknown',
        category: it.publisher || 'macro',
      };
      if (wire) {
        overrides.city = wire.city;
        overrides.coords = { lat: wire.lat, lon: wire.lon };
      }
      return asLiveEvent(it, 'macrowire', overrides);
    });
}

function normalizeGdelt(cache) {
  if (!cache || !Array.isArray(cache.events)) return [];
  return freshish(cache.events)
    .filter((ev) => isNdaClean(ev.title))
    .map((ev) => {
      const syntheticLink = ev.link || `https://gdelt.org/event/${ev.id}`;
      return asLiveEvent({ ...ev, link: syntheticLink }, 'gdelt', {
        category: ev.category || 'geopolitical',
        severity: ev.severity || 'moderate',
        city: ev.city || null,
        coords:
          typeof ev.lat === 'number' && typeof ev.lon === 'number'
            ? { lat: ev.lat, lon: ev.lon }
            : undefined,
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