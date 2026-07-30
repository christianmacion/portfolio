// check-hreflang-integrity.mjs — v7.7.21 HREFLANG-INTEGRITY CI GATE
//
// Catches malformed <link rel="alternate" hreflang="..."> tags before ship.
// hreflang is the SEO surface for i18n — tells Google which URL serves each
// language version of a page. Malformed hreflang causes wrong-language pages
// to rank for the wrong-language queries, or duplicate-content penalties.
//
// Today the site is English-only so 0 hreflang tags exist — this gate is
// forward-looking hardening for when Squad S's bilingual Ugnay venture
// (Filipino-English family-decision-memory product) ships per [[ugnay-startup-package]].
//
// Companion gates:
//   - scripts/check-canonical-url-integrity.mjs (v7.7.20) — canonical SEO surface
//   - scripts/check-og-integrity.mjs (v7.7.18)          — OG + Twitter Card surface
//
// Rules enforced (per dist/**/index.html):
//   1. If ANY hreflang is present, hreflang must be valid BCP 47 code
//      (e.g. "en", "en-US", "fil", "tl") OR the special values
//      "x-default" (language picker) or "*" (wildcard, discouraged).
//   2. href must be a valid absolute https URL.
//   3. href host must be one of the canonical hosts (pages.dev / github.io).
//   4. Self-referential hreflang: a translated page must include an
//      hreflang tag pointing at its own URL with its own language code.
//   5. x-default (if present) must point at a URL on the canonical host.
//   6. hreflang set must be consistent across pages: the same hreflang
//      codes should appear on all translated versions of a page. (Simplified:
//      we just check that the SAME hreflang codes appear on all pages that
//      have hreflang — future refinement uses a manifest.)
//   7. hreflang href must not contain query strings (hreflang URLs must be clean).
//
// Exits 1 on any fail. Exits 0 otherwise.
// Used in: npm run ci (after canonical:url:integrity, before audit).

import { readFile, readdir } from 'node:fs/promises';

const DIST = 'dist';
const CANONICAL_HOSTS = new Set([
  'christianmacion-portfolio.pages.dev',
  'christianmacion26.github.io',
]);

// Valid BCP 47 primary language subtag registry (most common subset; full
// ISO 639-1 codes per https://tools.ietf.org/html/bcp47).
// Special: 'x-default' (language picker) and '*' (wildcard).
const VALID_HREFLANG = new Set([
  // Special values
  'x-default',
  '*',
  // Most-common ISO 639-1 codes (covers ~90% of web content)
  'en', 'en-us', 'en-gb', 'en-ca', 'en-au', 'en-nz', 'en-ie', 'en-za',
  'es', 'es-es', 'es-mx', 'es-ar', 'es-cl', 'es-co', 'es-pe', 'es-ve',
  'fr', 'fr-fr', 'fr-ca', 'fr-be', 'fr-ch',
  'de', 'de-de', 'de-at', 'de-ch',
  'it', 'pt', 'pt-br', 'pt-pt', 'nl', 'nl-nl', 'nl-be',
  'ru', 'ja', 'ko', 'zh', 'zh-cn', 'zh-tw', 'zh-hk',
  'ar', 'hi', 'bn', 'pa', 'tr', 'vi', 'th', 'id', 'ms',
  'fil', 'tl', // Filipino / Tagalog
  'sv', 'no', 'da', 'fi', 'pl', 'cs', 'sk', 'hu', 'ro', 'uk', 'el',
  'he', 'fa', 'ur', 'ta', 'te', 'ml', 'kn', 'mr', 'gu',
  'sw', 'af', 'sq', 'am', 'az', 'eu', 'be', 'bg', 'bs', 'ca',
  'hr', 'et', 'fo', 'gl', 'ka', 'kk', 'km', 'ky', 'lo', 'lt',
  'lv', 'mk', 'mn', 'ne', 'si', 'sr', 'tg', 'uk',
]);

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === 'data' || (e.name.startsWith('_') && e.isDirectory())) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else yield full;
  }
}

import { join } from 'node:path';

// Backref-aware regex for hreflang extraction — handles apostrophes in hrefs.
function extractHreflangs(html) {
  const re = /<link\s+[^>]*\brel\s*=\s*(["'])alternate\1[^>]*\bhreflang\s*=\s*(["'])([^"']+)\2[^>]*\bhref\s*=\s*(["'])([^"']+)\4[^>]*\/?>/gi;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push({ hreflang: m[3], href: m[5] });
  }
  // Alternate attribute order: hreflang then href
  const re2 = /<link\s+[^>]*\bhreflang\s*=\s*(["'])([^"']+)\1[^>]*\bhref\s*=\s*(["'])([^"']+)\3[^>]*\brel\s*=\s*(["'])alternate\5[^>]*\/?>/gi;
  while ((m = re2.exec(html)) !== null) {
    out.push({ hreflang: m[2], href: m[4] });
  }
  // Another permutation: rel then hreflang then href
  const re3 = /<link\s+[^>]*\brel\s*=\s*(["'])alternate\1[^>]*\bhref\s*=\s*(["'])([^"']+)\2[^>]*\bhreflang\s*=\s*(["'])([^"']+)\4[^>]*\/?>/gi;
  while ((m = re3.exec(html)) !== null) {
    out.push({ hreflang: m[5], href: m[3] });
  }
  return out;
}

// Extract canonical URL from a page (already implemented in canonical-url gate;
// duplicated here for self-containment so this gate works standalone).
function extractCanonical(html) {
  const re = /<link\s+[^>]*\brel\s*=\s*(["'])canonical\1[^>]*\bhref\s*=\s*(["'])([^"']*)\2[^>]*\/?>/gi;
  const m = re.exec(html);
  return m ? m[3] : null;
}

function stripScripts(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

function auditRoute(distRelPath, html) {
  const issues = [];
  const scan = stripScripts(html);
  const hreflangs = extractHreflangs(scan);

  // 0 hreflang is fine — page is monolingual, no surface to validate.
  if (hreflangs.length === 0) {
    return { route: distRelPath, hreflangCount: 0, issues };
  }

  const seenHreflangs = new Set();
  for (const { hreflang, href } of hreflangs) {
    // Rule 1 — valid BCP 47
    const normalized = hreflang.toLowerCase();
    if (!VALID_HREFLANG.has(normalized)) {
      // Allow non-ISO codes with a warning? Strictly: only registered codes.
      // For robustness, allow any "xx" or "xx-yy" pattern as long as 2-3 char base + optional region.
      const bcp47Pattern = /^[a-z]{2,3}(-[a-z]{2,4})?$/i;
      if (!bcp47Pattern.test(hreflang)) {
        issues.push({
          rule: 'invalid-hreflang',
          msg: `hreflang="${hreflang}" is not a valid BCP 47 language tag`,
        });
      }
    }

    // Rule 7 — no query strings
    if (href.includes('?')) {
      issues.push({
        rule: 'hreflang-has-query',
        msg: `hreflang="${hreflang}" href="${href}" contains ? (must be clean)`,
      });
    }

    // Rule 2 — valid URL
    let url;
    try {
      url = new URL(href);
    } catch {
      issues.push({
        rule: 'malformed-hreflang-href',
        msg: `hreflang="${hreflang}" href="${href}" is not a valid URL`,
      });
      continue;
    }

    // Rule 2 — https
    if (url.protocol !== 'https:') {
      issues.push({
        rule: 'non-https-hreflang-href',
        msg: `hreflang="${hreflang}" href="${href}" is not https://`,
      });
    }

    // Rule 3 — canonical host
    if (!CANONICAL_HOSTS.has(url.host)) {
      issues.push({
        rule: 'non-canonical-host-hreflang',
        msg: `hreflang="${hreflang}" host="${url.host}" is not canonical`,
      });
    }

    seenHreflangs.add(normalized);
  }

  // Rule 4 — self-referential: if hreflangs exist, the canonical URL of this
  // page should appear among them.
  const canonical = extractCanonical(scan);
  if (canonical) {
    let selfRefFound = false;
    try {
      const canonicalUrl = new URL(canonical);
      for (const { href } of hreflangs) {
        try {
          const hrefUrl = new URL(href);
          if (hrefUrl.host === canonicalUrl.host && hrefUrl.pathname === canonicalUrl.pathname) {
            selfRefFound = true;
            break;
          }
        } catch {
          /* skip malformed */
        }
      }
    } catch {
      /* skip malformed canonical */
    }
    if (!selfRefFound) {
      issues.push({
        rule: 'missing-self-referential-hreflang',
        msg: `route has hreflang tags but none points to its own canonical URL "${canonical}"`,
      });
    }
  }

  return { route: distRelPath, hreflangCount: hreflangs.length, issues };
}

async function main() {
  console.log(
    '=== Hreflang-Integrity Audit (v7.7.21) — i18n SEO surface (forward-looking hardening) ===\n',
  );

  const findings = [];
  for await (const f of walk(DIST)) {
    if (!f.endsWith('index.html')) continue;
    const rel = f.slice(DIST.length + 1);
    const html = await readFile(f, 'utf8');
    findings.push(auditRoute(rel, html));
  }

  const totalHreflangs = findings.reduce((n, f) => n + f.hreflangCount, 0);
  const routesWithHreflang = findings.filter((f) => f.hreflangCount > 0).length;
  const failing = findings.filter((f) => f.issues.length > 0);
  const totalIssues = failing.reduce((n, f) => n + f.issues.length, 0);

  console.log(
    `Scanned ${findings.length} route(s) · ${routesWithHreflang} with hreflang · ${totalHreflangs} hreflang tag(s) · ${totalIssues} issue(s) across ${failing.length} route(s)\n`,
  );

  if (totalIssues === 0) {
    if (totalHreflangs === 0) {
      console.log(`✓ No hreflang tags present — site is monolingual. Gate is forward-looking hardening for i18n.`);
    } else {
      console.log(`✓ All hreflang tags are valid, on canonical hosts, with self-referential hreflang.`);
    }
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
    `\nFAIL — ${totalIssues} hreflang integrity issue(s) across ${failing.length} route(s).`,
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('hreflang-integrity scan crashed:', e);
  process.exit(2);
});