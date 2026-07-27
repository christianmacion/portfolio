// check-canonical-url-integrity.mjs — v7.7.20 CANONICAL-URL-INTEGRITY CI GATE
//
// Catches malformed <link rel="canonical"> tags before ship. Google and other
// crawlers use canonical URLs as the source-of-truth for indexing — if the
// canonical points to a non-canonical host, or to a different path than the
// og:url, the page is effectively "competing with itself" in search results,
// which dilutes ranking signal.
//
// Companion gates:
//   - scripts/check-og-integrity.mjs (v7.7.18)  — OG + Twitter Card surface
//   - scripts/check-meta-integrity.mjs (v7.7.14) — <title> + <meta description>
//   - scripts/validate-sitemap.ts              — sitemap canonical host check
//
// Rules enforced (per dist/**/index.html):
//   1. <link rel="canonical" href="..."> MUST exist (presence)
//   2. href MUST be a valid absolute https URL
//   3. URL host MUST be one of the canonical hosts (pages.dev or github.io/portfolio)
//   4. Canonical path MUST match the route's dist-relative path (no drift)
//   5. Canonical URL MUST equal og:url if both are present (path + host parity)
//   6. URL MUST NOT contain query strings or fragments (canonical must be clean)
//
// Exits 1 on any fail. Exits 0 otherwise.
// Used in: npm run ci (after og:integrity, before audit).

import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const DIST = 'dist';
const CANONICAL_HOSTS = new Set([
  'christianmacion-portfolio.pages.dev',
  'christianmacion26.github.io',
]);

// GH-Pages subpath prefix used by the GH build (hosted at github.io/portfolio/)
const _GH_BASEPATH_PREFIX = 'portfolio';

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === 'data' || (e.name.startsWith('_') && e.isDirectory())) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else yield full;
  }
}

// Extract all <link rel="canonical" href="..."> tags.
// Backref-aware regex (same fix as v7.7.14 / v7.7.18) — handles apostrophes in URLs.
function extractCanonical(html) {
  const re = /<link\s+[^>]*\brel\s*=\s*(["'])canonical\1[^>]*\bhref\s*=\s*(["'])([^"']*)\2[^>]*\/?>/gi;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push(m[3]);
  }
  // Also catch the alternate attribute order (href then rel)
  const re2 = /<link\s+[^>]*\bhref\s*=\s*(["'])([^"']*)\1[^>]*\brel\s*=\s*(["'])canonical\3[^>]*\/?>/gi;
  while ((m = re2.exec(html)) !== null) {
    out.push(m[2]);
  }
  return out;
}

// Extract og:url value (re-using the same regex pattern as check-og-integrity).
function extractOgUrl(html) {
  const re = /<meta\s+(?:property|name)\s*=\s*(["'])og:url\1[^>]*content\s*=\s*(["'])([\s\S]*?)\2[^>]*\/?>/i;
  const m = re.exec(html);
  return m ? m[3] : null;
}

function stripScripts(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

// Compute the route's "expected" canonical path from its dist-relative file.
// e.g. "about/index.html" → "/about/"
// e.g. "" (root) → "/"
function expectedPath(distRelPath) {
  if (distRelPath === '' || distRelPath === 'index.html') return '/';
  const dir = dirname(distRelPath);
  if (dir === '.') return `/${distRelPath.replace(/\/index\.html$/, '')}/`;
  return `/${dir.replace(/\/index\.html$/, '')}/`;
}

function auditRoute(distRelPath, html) {
  const issues = [];
  const scan = stripScripts(html);
  const canonicals = extractCanonical(scan);
  const ogUrl = extractOgUrl(scan);

  // Rule 1 — presence
  if (canonicals.length === 0) {
    issues.push({
      rule: 'missing-canonical',
      msg: `<link rel="canonical"> missing on ${distRelPath}`,
    });
    return { route: distRelPath, issues, canonicals, ogUrl };
  }

  if (canonicals.length > 1) {
    issues.push({
      rule: 'duplicate-canonical',
      msg: `${canonicals.length} <link rel="canonical"> tags found on ${distRelPath} (expected exactly 1)`,
    });
  }

  const href = canonicals[0];

  // Rule 6 — no query/fragment
  if (href.includes('?') || href.includes('#')) {
    issues.push({
      rule: 'canonical-has-query-or-fragment',
      msg: `canonical="${href}" contains ? or # (canonical URL must be clean)`,
    });
  }

  // Rule 2 + 3 — valid absolute https URL on canonical host
  let url;
  try {
    url = new URL(href);
  } catch {
    issues.push({
      rule: 'malformed-canonical',
      msg: `canonical="${href}" is not a valid URL`,
    });
    return { route: distRelPath, issues, canonicals, ogUrl };
  }

  if (url.protocol !== 'https:') {
    issues.push({
      rule: 'non-https-canonical',
      msg: `canonical="${href}" is not https://`,
    });
  }

  if (!CANONICAL_HOSTS.has(url.host)) {
    issues.push({
      rule: 'non-canonical-host',
      msg: `canonical host="${url.host}" is not canonical (expected one of: ${[...CANONICAL_HOSTS].join(', ')})`,
    });
  }

  // Rule 4 — path matches the route's expected path (with GH-prefix tolerance)
  const expected = expectedPath(distRelPath);
  const actualPath = url.pathname;
  // GH build keeps /portfolio/ prefix; mirror strips it. Tolerate both.
  const expectedStripped = expected.replace(/^\/portfolio/, '');
  const actualStripped = actualPath.replace(/^\/portfolio/, '');
  if (actualPath !== expected && actualStripped !== expectedStripped) {
    issues.push({
      rule: 'canonical-path-mismatch',
      msg: `canonical path "${actualPath}" does not match expected route path "${expected}" on ${distRelPath}`,
    });
  }

  // Rule 5 — og:url parity
  if (ogUrl) {
    let ogUrlObj;
    try {
      ogUrlObj = new URL(ogUrl);
    } catch {
      issues.push({
        rule: 'og-url-malformed',
        msg: `og:url="${ogUrl}" is malformed (canonical="${href}")`,
      });
    }
    if (ogUrlObj) {
      const canonicalStripped = url.host === ogUrlObj.host ? url.pathname : url.pathname.replace(/^\/portfolio/, '');
      const ogStripped = ogUrlObj.host === url.host ? ogUrlObj.pathname : ogUrlObj.pathname.replace(/^\/portfolio/, '');
      if (canonicalStripped !== ogStripped) {
        issues.push({
          rule: 'canonical-og-url-mismatch',
          msg: `canonical path "${url.pathname}" (host ${url.host}) != og:url path "${ogUrlObj.pathname}" (host ${ogUrlObj.host})`,
        });
      }
    }
  }

  return { route: distRelPath, issues, canonicals, ogUrl };
}

async function main() {
  console.log(
    '=== Canonical-URL Integrity Audit (v7.7.20) — SEO source-of-truth ===\n',
  );

  const findings = [];
  for await (const f of walk(DIST)) {
    if (!f.endsWith('index.html')) continue;
    const rel = f.slice(DIST.length + 1); // strip 'dist/'
    const html = await readFile(f, 'utf8');
    findings.push(auditRoute(rel, html));
  }

  const failing = findings.filter((f) => f.issues.length > 0);
  const totalIssues = failing.reduce((n, f) => n + f.issues.length, 0);

  console.log(
    `Scanned ${findings.length} route(s) · ${totalIssues} issue(s) across ${failing.length} route(s)\n`,
  );

  if (totalIssues === 0) {
    console.log(`✓ All canonical links present, on canonical hosts, matching og:url paths.`);
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
    `\nFAIL — ${totalIssues} canonical-url integrity issue(s) across ${failing.length} route(s).`,
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('canonical-url integrity scan crashed:', e);
  process.exit(2);
});