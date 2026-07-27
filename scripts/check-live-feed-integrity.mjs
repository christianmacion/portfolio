// check-live-feed-integrity.mjs — v7.7.13 LIVE-FEED DEDUPE-INTEGRITY CI GATE
//
// Validates src/data/live-feed-cache.json (the unified /live page's
// data source) against the dedupe contract that scripts/build-live-feed.mjs
// is supposed to enforce. Catches:
//
//   (a) duplicate event.id (caller assumes unique keys for React keys)
//   (b) duplicate event.fingerprint (dedupe is by fingerprint — duplicates
//       mean the dedupe pass failed)
//   (c) duplicate event.link (URL is the strongest dedupe signal;
//       duplicates mean two events will point to the same article)
//   (d) counts.{arxiv,macrowire,gdelt} != events.filter(source=X).length
//   (e) total != events.length
//   (f) any event missing a required field
//   (g) any event with a timestamp > 7 days old (stale entries leak through
//       if a feed's "fetchedAt" drifts but its events don't)
//
// Companion to scripts/build-live-feed.mjs. Catches structural drift
// in the live feed that visual QA (the v7.7.1 polish) would miss.
//
// Exits 1 on any fail. Exits 0 otherwise.
// Used in: npm run ci (after anchor:rot, before audit).

import { readFileSync } from 'node:fs';

const CACHE_PATH = 'src/data/live-feed-cache.json';
const MAX_AGE_DAYS = 7;

const REQUIRED_FIELDS = [
  'id',
  'source',
  'title',
  'link',
  'timestamp',
  'fingerprint',
  'domain',
];
const VALID_SOURCES = new Set(['arxiv', 'macrowire', 'gdelt']);

function audit(cache) {
  const issues = [];
  const events = cache.events || [];

  // (a) duplicate id
  const idCounts = new Map();
  for (const e of events) {
    idCounts.set(e.id, (idCounts.get(e.id) || 0) + 1);
  }
  for (const [id, n] of idCounts) {
    if (n > 1) {
      issues.push({
        rule: 'duplicate-id',
        msg: `event id "${id}" appears ${n} times`,
      });
    }
  }

  // (b) duplicate fingerprint
  const fpCounts = new Map();
  for (const e of events) {
    fpCounts.set(e.fingerprint, (fpCounts.get(e.fingerprint) || 0) + 1);
  }
  for (const [fp, n] of fpCounts) {
    if (n > 1) {
      issues.push({
        rule: 'duplicate-fingerprint',
        msg: `event fingerprint "${fp}" appears ${n} times (dedupe pass failed)`,
      });
    }
  }

  // (c) duplicate link (the strongest dedupe signal — same article twice)
  const linkCounts = new Map();
  for (const e of events) {
    // Strip UTM params so two syndicated versions of the same article dedupe
    const normalized = stripUtm(e.link);
    linkCounts.set(normalized, (linkCounts.get(normalized) || 0) + 1);
  }
  for (const [url, n] of linkCounts) {
    if (n > 1) {
      issues.push({
        rule: 'duplicate-link',
        msg: `article URL "${url}" appears ${n} times (same article from multiple feeds)`,
      });
    }
  }

  // (d) source counts
  const actualCounts = {
    arxiv: events.filter((e) => e.source === 'arxiv').length,
    macrowire: events.filter((e) => e.source === 'macrowire').length,
    gdelt: events.filter((e) => e.source === 'gdelt').length,
  };
  for (const source of Object.keys(actualCounts)) {
    if (cache.counts?.[source] !== actualCounts[source]) {
      issues.push({
        rule: 'count-mismatch',
        msg: `counts.${source} = ${cache.counts?.[source]} but events has ${actualCounts[source]}`,
      });
    }
  }

  // (e) total mismatch
  if (cache.total !== events.length) {
    issues.push({
      rule: 'total-mismatch',
      msg: `total = ${cache.total} but events.length = ${events.length}`,
    });
  }

  // (f) required fields
  for (const e of events) {
    for (const f of REQUIRED_FIELDS) {
      if (e[f] == null || e[f] === '') {
        issues.push({
          rule: 'missing-field',
          msg: `event id="${e.id}" missing required field "${f}"`,
        });
        break; // one finding per event
      }
    }
    if (!VALID_SOURCES.has(e.source)) {
      issues.push({
        rule: 'invalid-source',
        msg: `event id="${e.id}" has invalid source "${e.source}"`,
      });
    }
  }

  // (g) stale entries
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  for (const e of events) {
    const t = new Date(e.timestamp).getTime();
    if (Number.isNaN(t)) {
      issues.push({
        rule: 'bad-timestamp',
        msg: `event id="${e.id}" has unparseable timestamp "${e.timestamp}"`,
      });
      continue;
    }
    if (t < cutoff) {
      const ageDays = Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
      issues.push({
        rule: 'stale-entry',
        msg: `event id="${e.id}" is ${ageDays} day(s) old (cutoff: ${MAX_AGE_DAYS})`,
      });
    }
  }

  return {
    total: events.length,
    counts: actualCounts,
    issues,
  };
}

function stripUtm(url) {
  try {
    const u = new URL(url);
    // Drop common tracking params
    for (const k of [...u.searchParams.keys()]) {
      if (/^utm_/i.test(k) || /^fbclid$|^gclid$|^mc_cid$|^mc_eid$/i.test(k)) {
        u.searchParams.delete(k);
      }
    }
    // Canonicalize: drop trailing slash, lowercase host
    let s = u.toString();
    if (s.endsWith('/') && u.pathname === '/') s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    return url;
  }
}

async function main() {
  console.log('=== Live-Feed Dedupe-Integrity Audit (v7.7.13) ===\n');

  let cache;
  try {
    cache = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
  } catch (e) {
    console.error(`FAIL: could not read ${CACHE_PATH}: ${e.message}`);
    process.exit(2);
  }

  console.log(
    `Cache: generated=${cache.generated} · fetchedAt=${cache.fetchedAt} · cap=${cache.cap} · total=${cache.total}\n`
  );

  const result = audit(cache);
  console.log(
    `Events: ${result.total} · arxiv=${result.counts.arxiv} · macrowire=${result.counts.macrowire} · gdelt=${result.counts.gdelt}\n`
  );

  if (result.issues.length === 0) {
    console.log('✓ Live feed passes dedupe-integrity contract.');
    return;
  }

  const byRule = new Map();
  for (const i of result.issues) {
    if (!byRule.has(i.rule)) byRule.set(i.rule, []);
    byRule.get(i.rule).push(i.msg);
  }
  for (const [rule, list] of byRule) {
    console.log(`\n[${rule}] — ${list.length} issue(s):`);
    for (const m of list.slice(0, 10)) {
      console.log(`  ${m}`);
    }
    if (list.length > 10) {
      console.log(`  …and ${list.length - 10} more`);
    }
  }

  console.error(`\nFAIL — ${result.issues.length} live-feed integrity issue(s).`);
  process.exit(1);
}

main().catch((e) => {
  console.error('live-feed-integrity scan crashed:', e);
  process.exit(2);
});
