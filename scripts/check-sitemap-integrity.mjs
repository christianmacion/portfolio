// check-sitemap-integrity.mjs — v7.7.16 SITEMAP-INTEGRITY CI GATE
//
// Catches malformed sitemap entries before ship. Complements the existing
// `sitemap:check` (validate-sitemap.ts) which verifies completeness
// (sitemap→route mapping, orphans, canonical link). This gate verifies
// *shape* — the producer-side contract every <loc>/<lastmod>/<priority>
// must satisfy for Google / Bing / DuckDuckGo to parse it cleanly.
//
// Rules enforced (per dist/sitemap*.xml):
//   - Valid XML root element (<urlset> or <sitemapindex>)
//   - Canonical host: every <loc> is https://christianmacion-portfolio.pages.dev/
//   - Path shape: lowercase, no double slashes, no index.html, no spaces, ≤200 chars
//   - <lastmod> if present: ISO 8601 and ≤ now (parallel to feed gate's
//     future-entry rule — crawlers re-stamp at next crawl if lastmod is in
//     the future, losing freshness signals)
//   - <changefreq> if present: one of always|hourly|daily|weekly|monthly|yearly|never
//   - <priority> if present: float in [0.0, 1.0]
//   - sitemap.org hard caps: ≤ 50 MB, ≤ 50,000 URLs per file
//   - Cross-feed dedupe: every <loc> resolves to a real dist route OR a
//     feed entry URL (no phantom sitemap URLs that go nowhere)
//
// Exits 1 on any fail. Exits 0 otherwise.
// Used in: npm run ci (after feed:integrity, before audit).

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

// Canonical hosts — site ships to both the Cloudflare Pages mirror
// (`npm run build:mirror` → https://christianmacion-portfolio.pages.dev/...)
// AND the GH Pages deploy (`npm run build` → https://christianmacion26.github.io/portfolio/...).
// Each `npm run ci` and `npm run deploy:mirror` invocation should produce
// sitemap <loc>s on one of these two hosts. Any other host = flag.
const CANONICAL_HOSTS = new Set([
  'christianmacion-portfolio.pages.dev',
  'christianmacion26.github.io',
]);
const MAX_URL_LEN = 200; // safe upper bound; Google supports 2048 but anything > 200 is suspect
const SITEMAP_MAX_BYTES = 50 * 1024 * 1024; // 50 MB sitemap.org hard cap
const SITEMAP_MAX_URLS = 50000; // 50K URLs sitemap.org hard cap

const VALID_CHANGEFREQ = new Set([
  'always',
  'hourly',
  'daily',
  'weekly',
  'monthly',
  'yearly',
  'never',
]);

// Find dist/sitemap*.xml (skip the feed-inventory helpers)
async function findSitemaps() {
  const out = [];
  for await (const f of walk('dist')) {
    if (!f.endsWith('.xml')) continue;
    const base = f.split('/').pop();
    if (base === 'sitemap-0.xml' || base === 'sitemap-index.xml') {
      out.push(f);
    }
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

// Extract <loc> + optional <lastmod>/<changefreq>/<priority>/<sitemap> children
function parseSitemap(xml) {
  const root = /<urlset\b/i.test(xml)
    ? 'urlset'
    : /<sitemapindex\b/i.test(xml)
      ? 'sitemapindex'
      : null;

  if (!root) return { root: null, urls: [] };

  const blockRe =
    root === 'urlset'
      ? /<url\b[^>]*>([\s\S]*?)<\/url>/gi
      : /<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi;

  const urls = [];
  let m;
  while ((m = blockRe.exec(xml)) !== null) {
    const body = m[1];
    urls.push({
      loc: body.match(/<loc[^>]*>([\s\S]*?)<\/loc>/i)?.[1]?.trim() || null,
      lastmod: body.match(/<lastmod[^>]*>([\s\S]*?)<\/lastmod>/i)?.[1]?.trim() || null,
      changefreq: body.match(/<changefreq[^>]*>([\s\S]*?)<\/changefreq>/i)?.[1]?.trim() || null,
      priority: body.match(/<priority[^>]*>([\s\S]*?)<\/priority>/i)?.[1]?.trim() || null,
    });
  }
  return { root, urls };
}

// Build the set of URLs that ship as either a dist route OR a feed entry.
// The dist/ layout mixes two kinds of files:
//   (a) Astro pages — live under dist/<basePath>/<route>/index.html
//       (basePath is `/portfolio` for `npm run build`, `/` for `npm run build:mirror`)
//   (b) Public/* assets — copied verbatim to dist/<route>/index.html (no basePath)
//
// For each dist/<route>/index.html we emit URLs on every (host, basePath)
// combination, where:
//   - GH Pages host gets BOTH the `dist/<route>/` URL AND the
//     `dist/<basePath>/<route>/` URL (Astro pages live under basePath,
//     public/* assets live at root).
//   - Cloudflare Pages host only gets the `dist/<route>/` URL (basePath=/).
async function buildKnownUrlSet() {
  const known = new Set();

  for await (const f of walk('dist')) {
    if (!f.endsWith('index.html')) continue;
    let rel = f.slice('dist/'.length).replace(/\/index\.html$/, '') || '/';
    // Emit at root (this is where public/* assets land on both hosts,
    // and where Astro pages land on the Cloudflare mirror).
    if (rel !== '/') rel = '/' + rel + '/';
    for (const host of CANONICAL_HOSTS) {
      const proto = 'https://';
      const basePath = host === 'christianmacion26.github.io' ? '/portfolio' : '';
      known.add(`${proto}${host}${basePath}${rel}`);
    }
    // Also emit at /portfolio/<rel> on GH Pages for Astro pages that
    // got rendered under dist/portfolio/<route>/index.html.
    if (rel !== '/' && !rel.startsWith('/portfolio/')) {
      for (const host of CANONICAL_HOSTS) {
        if (host !== 'christianmacion26.github.io') continue;
        known.add(`https://${host}${rel}`);
      }
    }
  }

  // (2) feed entries — every <link> in dist/feed*.xml
  for await (const f of walk('dist')) {
    if (!f.endsWith('.xml')) continue;
    const base = f.split('/').pop();
    if (base.startsWith('sitemap')) continue; // don't recurse into sitemap URLs
    if (!base.startsWith('feed')) continue;
    const xml = await readFile(f, 'utf8');
    for (const lm of xml.matchAll(/<link[^>]+href\s*=\s*(["'])(https?:\/\/[^"']+)\1/gi)) {
      try {
        const u = new URL(lm[2]);
        known.add(u.href);
      } catch {
        // skip — caught by feed-integrity
      }
    }
  }

  return known;
}

async function auditSitemap(route, xml, known) {
  const issues = [];
  const fileBytes = Buffer.byteLength(xml, 'utf8');

  if (fileBytes > SITEMAP_MAX_BYTES) {
    issues.push({
      rule: 'sitemap-too-large',
      msg: `${route} is ${(fileBytes / 1024 / 1024).toFixed(2)} MB — sitemap.org caps at 50 MB`,
    });
  }

  const parsed = parseSitemap(xml);
  if (!parsed.root) {
    return {
      route,
      issues: [
        {
          rule: 'no-root-element',
          msg: `${route} has no <urlset> or <sitemapindex> root`,
        },
      ],
    };
  }

  if (parsed.urls.length === 0) {
    issues.push({
      rule: 'no-entries',
      msg: `${route} has zero <url>/<sitemap> entries`,
    });
    return { route, issues };
  }

  if (parsed.urls.length > SITEMAP_MAX_URLS) {
    issues.push({
      rule: 'too-many-urls',
      msg: `${route} has ${parsed.urls.length} entries — sitemap.org caps at 50,000 per file`,
    });
  }

  if (parsed.root === 'sitemapindex' && parsed.urls.length < 1) {
    issues.push({
      rule: 'empty-sitemapindex',
      msg: `${route} is a <sitemapindex> but has no <sitemap> children`,
    });
  }

  const now = Date.now();
  let canonicalHostViolations = 0;
  let phantomUrlViolations = 0;
  const seen = new Set();
  const dupes = [];

  for (const [i, u] of parsed.urls.entries()) {
    const label = `${route}#${i + 1}`;

    if (!u.loc) {
      issues.push({ rule: 'no-loc', msg: `${label} has no <loc>` });
      continue;
    }

    // Rule: canonical host
    let parsedUrl;
    try {
      parsedUrl = new URL(u.loc);
    } catch {
      issues.push({
        rule: 'malformed-loc',
        msg: `${label} <loc>="${u.loc}" is not a valid URL`,
      });
      continue;
    }
    if (parsedUrl.protocol !== 'https:') {
      issues.push({
        rule: 'non-https-loc',
        msg: `${label} <loc>="${u.loc}" is not https://`,
      });
    }
    if (!CANONICAL_HOSTS.has(parsedUrl.host)) {
      canonicalHostViolations++;
    }

    // Rule: path shape
    const path = parsedUrl.pathname;
    if (path !== path.toLowerCase()) {
      issues.push({
        rule: 'uppercase-path',
        msg: `${label} <loc>="${u.loc}" has uppercase characters in path`,
      });
    }
    if (path.includes('//')) {
      issues.push({
        rule: 'double-slash',
        msg: `${label} <loc>="${u.loc}" has // in path`,
      });
    }
    if (path.endsWith('/index.html')) {
      issues.push({
        rule: 'index-html-suffix',
        msg: `${label} <loc>="${u.loc}" ends with /index.html`,
      });
    }
    if (path.includes(' ')) {
      issues.push({
        rule: 'space-in-path',
        msg: `${label} <loc>="${u.loc}" has spaces in path`,
      });
    }
    if (u.loc.length > MAX_URL_LEN) {
      issues.push({
        rule: 'loc-too-long',
        msg: `${label} <loc> is ${u.loc.length} chars (max ${MAX_URL_LEN})`,
      });
    }

    // Duplicate detection
    if (seen.has(u.loc)) {
      dupes.push(u.loc);
    } else {
      seen.add(u.loc);
    }

    // Cross-feed dedupe: does this URL exist as a route or feed entry?
    if (parsed.root === 'urlset' && !known.has(u.loc)) {
      phantomUrlViolations++;
    }

    // Rule: <lastmod> if present
    if (u.lastmod) {
      const t = new Date(u.lastmod).getTime();
      if (Number.isNaN(t)) {
        issues.push({
          rule: 'bad-lastmod',
          msg: `${label} <lastmod>="${u.lastmod}" is unparseable`,
        });
      } else if (t > now) {
        issues.push({
          rule: 'future-lastmod',
          msg: `${label} <lastmod>="${u.lastmod}" is in the future`,
        });
      }
    }

    // Rule: <changefreq> if present
    if (u.changefreq && !VALID_CHANGEFREQ.has(u.changefreq.toLowerCase())) {
      issues.push({
        rule: 'bad-changefreq',
        msg: `${label} <changefreq>="${u.changefreq}" not in ${[...VALID_CHANGEFREQ].join('|')}`,
      });
    }

    // Rule: <priority> if present
    if (u.priority) {
      const p = Number.parseFloat(u.priority);
      if (Number.isNaN(p) || p < 0 || p > 1) {
        issues.push({
          rule: 'bad-priority',
          msg: `${label} <priority>="${u.priority}" not in [0.0, 1.0]`,
        });
      }
    }
  }

  // Summary rules (one per failure mode, not per entry)
  if (canonicalHostViolations > 0) {
    issues.push({
      rule: 'non-canonical-host',
      msg: `${route} has ${canonicalHostViolations} <loc> on a non-canonical host (expected one of: ${[...CANONICAL_HOSTS].join(', ')})`,
    });
  }
  if (phantomUrlViolations > 0) {
    issues.push({
      rule: 'phantom-loc',
      msg: `${route} has ${phantomUrlViolations} <loc> that don't resolve to any dist route or feed entry`,
    });
  }
  if (dupes.length > 0) {
    issues.push({
      rule: 'duplicate-loc',
      msg: `${route} has ${dupes.length} duplicate <loc> entries (first: ${dupes[0]})`,
    });
  }

  return { route, root: parsed.root, urlCount: parsed.urls.length, issues };
}

async function main() {
  console.log('=== Sitemap-Integrity Audit (v7.7.16) — XML shape ===\n');

  const sitemaps = await findSitemaps();
  if (sitemaps.length === 0) {
    console.error('FAIL: no sitemap*.xml files found in dist/');
    process.exit(1);
  }

  console.log(`Building cross-feed URL set (dist routes + feed entries)...`);
  const known = await buildKnownUrlSet();
  console.log(`  → ${known.size} known URL(s)\n`);

  const findings = [];
  for (const route of sitemaps) {
    const xml = await readFile(route, 'utf8');
    findings.push(await auditSitemap(route, xml, known));
  }

  const failing = findings.filter((f) => f.issues.length > 0);
  const totalIssues = failing.reduce((n, f) => n + f.issues.length, 0);
  const totalUrls = findings.reduce((n, f) => n + f.urlCount, 0);

  console.log(
    `Scanned ${findings.length} sitemap(s) · ${totalUrls} total entries · ${totalIssues} issue(s) across ${failing.length} sitemap(s)\n`,
  );

  for (const f of findings) {
    const tag = f.issues.length === 0 ? '✓' : '✗';
    console.log(`  ${tag} ${f.route} (${f.root ?? 'INVALID'} · ${f.urlCount} entries)`);
  }

  if (totalIssues === 0) {
    console.log('\n✓ All sitemaps are well-formed + canonical + cross-feed deduped.');
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

  console.error(
    `\nFAIL — ${totalIssues} sitemap-integrity issue(s) across ${failing.length} sitemap(s).`,
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('sitemap-integrity scan crashed:', e);
  process.exit(2);
});
