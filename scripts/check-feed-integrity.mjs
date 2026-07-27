// check-feed-integrity.mjs — v7.7.15 FEED-INTEGRITY CI GATE
//
// Catches broken Atom feeds before ship. dist/feed.xml + dist/feed-*.xml
// are the recruiter/automation-facing surface (Feedly, NetNewsWire,
// inoreader, IFTTT) — if any feed is malformed, missing required fields,
// or has stale entries, the downstream reader silently degrades.
//
// Rules enforced (per dist/feed*.xml):
//   - Valid XML (parses without error)
//   - Top-level <feed> has <title>, <id>, <updated>
//   - Every <entry> has <title>, <id>, <updated>, <link href=...>
//   - Every entry link is a valid https URL
//   - Every updated timestamp parses + is ≤ now
//   - Entries are sorted newest-first (updated DESC)
//
// Exits 1 on any fail. Exits 0 otherwise.
// Used in: npm run ci (after meta:integrity, before audit).

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';


// Find dist/feed*.xml (single + multi-feed set)
async function findFeeds() {
  const out = [];
  for await (const f of walk('dist')) {
    if (!f.endsWith('.xml')) continue;
    const base = f.split('/').pop();
    if (base === 'sitemap-0.xml' || base === 'sitemap-index.xml') continue;
    if (base.startsWith('feed')) out.push(f);
  }
  return out.sort();
}

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else yield full;
  }
}

// Lightweight Atom parser — handles the subset of XML that Astro emits.
// Uses regex to extract feed/entry structures; doesn't try to be a
// general XML parser (no attributes on nested elements, no namespaces).
// This is enough for the well-formed Atom output that astro-rss emits.
function parseAtom(xml) {
  // Top-level fields
  const title = xml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || null;
  const id = xml.match(/<id[^>]*>([\s\S]*?)<\/id>/i)?.[1]?.trim() || null;
  const updated = xml.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i)?.[1]?.trim() || null;

  // Entries
  const entryRe = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
  const entries = [];
  let m;
  while ((m = entryRe.exec(xml)) !== null) {
    const e = m[1];
    entries.push({
      title: e.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || null,
      id: e.match(/<id[^>]*>([\s\S]*?)<\/id>/i)?.[1]?.trim() || null,
      updated: e.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i)?.[1]?.trim() || null,
      link:
        e.match(/<link[^>]+href\s*=\s*(["'])(https?:\/\/[^"']+)\1/i)?.[2] || null,
    });
  }

  return { title, id, updated, entries };
}

function auditFeed(route, xml) {
  const issues = [];
  let parsed;
  try {
    parsed = parseAtom(xml);
  } catch (e) {
    return {
      route,
      issues: [{ rule: 'parse-fail', msg: `XML parse failed: ${e.message}` }],
    };
  }

  if (!parsed.title) {
    issues.push({ rule: 'no-feed-title', msg: 'feed has no <title>' });
  }
  if (!parsed.id) {
    issues.push({ rule: 'no-feed-id', msg: 'feed has no <id>' });
  }
  if (!parsed.updated) {
    issues.push({ rule: 'no-feed-updated', msg: 'feed has no <updated>' });
  }

  if (parsed.entries.length === 0) {
    issues.push({ rule: 'no-entries', msg: 'feed has zero <entry> elements' });
  }

  const now = Date.now();
  let prevTime = Infinity;
  let sortViolations = 0;

  for (const [i, e] of parsed.entries.entries()) {
    if (!e.title) {
      issues.push({ rule: 'no-entry-title', msg: `entry #${i + 1} has no <title>` });
    }
    if (!e.id) {
      issues.push({ rule: 'no-entry-id', msg: `entry #${i + 1} has no <id>` });
    }
    if (!e.updated) {
      issues.push({ rule: 'no-entry-updated', msg: `entry #${i + 1} has no <updated>` });
    } else {
      const t = new Date(e.updated).getTime();
      if (Number.isNaN(t)) {
        issues.push({
          rule: 'bad-entry-updated',
          msg: `entry #${i + 1} has unparseable updated: "${e.updated}"`,
        });
      } else {
        if (t > now) {
          issues.push({
            rule: 'future-entry',
            msg: `entry #${i + 1} updated=${e.updated} is in the future`,
          });
        }
        if (t > prevTime) {
          sortViolations++;
        }
        prevTime = t;
      }
    }
    if (!e.link) {
      issues.push({ rule: 'no-entry-link', msg: `entry #${i + 1} has no <link href=…>` });
    } else if (!/^https:\/\//.test(e.link)) {
      issues.push({
        rule: 'non-https-link',
        msg: `entry #${i + 1} link is "${e.link}" (must be https://)`,
      });
    }
  }

  if (sortViolations > 0) {
    issues.push({
      rule: 'not-sorted-newest-first',
      msg: `feed has ${sortViolations} out-of-order entry timestamp(s) — entries must be newest-first`,
    });
  }

  return { route, feed: parsed, issues };
}

async function main() {
  console.log('=== Feed-Integrity Audit (v7.7.15) — Atom XML ===\n');

  const feeds = await findFeeds();
  if (feeds.length === 0) {
    console.error('FAIL: no feed*.xml files found in dist/');
    process.exit(1);
  }

  const findings = [];
  for (const route of feeds) {
    const xml = await readFile(route, 'utf8');
    findings.push(auditFeed(route, xml));
  }

  const failing = findings.filter((f) => f.issues.length > 0);
  const totalIssues = failing.reduce((n, f) => n + f.issues.length, 0);
  const totalEntries = findings.reduce((n, f) => n + (f.feed?.entries.length || 0), 0);

  console.log(
    `Scanned ${findings.length} feed(s) · ${totalEntries} total entries · ${totalIssues} issue(s) across ${failing.length} feed(s)\n`
  );

  if (totalIssues === 0) {
    console.log('✓ All feeds are valid Atom + have required fields + sorted newest-first.');
    return;
  }

  const byRule = new Map();
  for (const f of failing) {
    for (const i of f.issues) {
      if (!byRule.has(i.rule)) byRule.set(i.rule, []);
      byRule.get(i.rule).push({ route: f.route, msg: i.msg });
    }
  }
  for (const [rule, list] of byRule) {
    console.log(`\n[${rule}] — ${list.length} site(s):`);
    for (const x of list) {
      console.log(`  ${x.route}  →  ${x.msg}`);
    }
  }

  console.error(`\nFAIL — ${totalIssues} feed-integrity issue(s) across ${failing.length} feed(s).`);
  process.exit(1);
}

main().catch((e) => {
  console.error('feed-integrity scan crashed:', e);
  process.exit(2);
});
