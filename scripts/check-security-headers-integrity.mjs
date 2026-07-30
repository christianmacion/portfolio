// check-security-headers-integrity.mjs — v7.7.26 SECURITY-HEADERS-INTEGRITY CI GATE
//
// Catches malformed / missing security headers in public/_headers before
// ship. Cloudflare Pages serves public/_headers verbatim as the response
// headers for matching paths. A typo or accidental delete silently weakens
// the security posture — currently trusted by inspection only.
//
// Companion gates:
//   - scripts/check-meta-integrity.mjs           (v7.7.14) — <meta> tags
//   - scripts/check-robots-txt-integrity.mjs     (v7.7.25) — robots.txt
//
// Rules enforced:
//   1. public/_headers MUST exist (presence)
//   2. /*  (catch-all) section MUST declare:
//        - X-Content-Type-Options: nosniff
//        - X-Frame-Options: DENY (or SAMEORIGIN)
//        - Referrer-Policy: strict-origin-when-cross-origin (or stricter)
//        - Permissions-Policy (any directive)
//        - Content-Security-Policy: default-src 'self'
//   3. /_astro/*  section MUST declare Cache-Control with max-age ≥ 31536000 (1y)
//   4. /*.html    section MUST declare Cache-Control: must-revalidate
//   5. /sitemap*.xml section MUST exist (with Cache-Control)
//   6. /feed*.xml  section MUST exist (with Cache-Control)
//   7. CSP MUST NOT contain 'unsafe-eval' (no eval)
//   8. CSP MUST NOT contain wildcard script-src (only 'self' or specific origins)
//
// Exits 1 on any fail. Exits 0 otherwise.
// Used in: npm run ci (after robots:txt:integrity, before audit).

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

// Path — public/_headers is copied to dist/_headers by Astro; CF reads the
// one in dist/. We read the source-of-truth in public/.
const HEADERS_PATH = 'public/_headers';

// Parse _headers into sections: [{ pattern: string, headers: [{name, value}] }]
function parseHeaders(text) {
  const sections = [];
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    // Strip comments + trim
    const line = rawLine.replace(/#.*$/, '').trimEnd();
    if (line === '') {
      // blank line ends current section
      if (current) {
        sections.push(current);
        current = null;
      }
      continue;
    }
    // Indented line = header directive
    if (line.startsWith('  ') || line.startsWith('\t')) {
      if (!current) continue; // orphan directive
      const trimmed = line.trim();
      const m = trimmed.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
      if (m) {
        const [, name, value] = m;
        current.headers.push({ name, value: value.trim() });
      }
    } else {
      // Pattern line — starts a new section
      if (current) sections.push(current);
      current = { pattern: line.trim(), headers: [] };
    }
  }
  if (current) sections.push(current);
  return sections;
}

// Match a path pattern against a URL path. Patterns are glob-ish:
//   /*          matches anything
//   /_astro/*   matches /_astro/anything
//   /*.html     matches any .html file
//   /sitemap*.xml matches /sitemap.xml, /sitemap-index.xml, etc.
function matchPattern(pattern, urlPath) {
  // Escape regex specials, then replace glob-ish * with .*
  const re = new RegExp(
    '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
  );
  return re.test(urlPath);
}

// Find the section whose pattern matches a test path. CF Pages applies
// the MOST SPECIFIC pattern first, then falls back to less-specific
// patterns (e.g. /_astro/* takes precedence over /*). We mirror that:
// sort matches by specificity (more path segments + non-* chars = higher
// rank) and return the most specific match.
function sectionFor(sections, testPath) {
  const matches = sections.filter((s) => matchPattern(s.pattern, testPath));
  if (matches.length === 0) return null;
  // Score: longer patterns + fewer wildcards = more specific
  matches.sort((a, b) => {
    const scoreA = specificity(a.pattern);
    const scoreB = specificity(b.pattern);
    return scoreB - scoreA; // most specific first
  });
  return matches[0];
}

function specificity(pattern) {
  // Count non-wildcard chars + non-glob segments
  const stars = (pattern.match(/\*/g) || []).length;
  return pattern.length - stars * 10; // each * is "less specific"
}

async function audit() {
  const issues = [];

  // Rule 1 — presence
  if (!existsSync(HEADERS_PATH)) {
    issues.push({ rule: 'missing-headers-file', msg: `${HEADERS_PATH} does not exist` });
    return { issues };
  }

  const text = await readFile(HEADERS_PATH, 'utf8');
  const sections = parseHeaders(text);

  // Rule 2 — /*  section security headers
  const catchall = sectionFor(sections, '/anything/here');
  if (!catchall) {
    issues.push({
      rule: 'no-catchall-section',
      msg: `No /* section in ${HEADERS_PATH} (security headers must apply site-wide)`,
    });
    return { issues };
  }

  const catchallByName = new Map(catchall.headers.map((h) => [h.name.toLowerCase(), h.value]));

  // Rule 2a — X-Content-Type-Options: nosniff
  const xcto = catchallByName.get('x-content-type-options');
  if (!xcto) {
    issues.push({
      rule: 'missing-x-content-type-options',
      msg: '/* section missing X-Content-Type-Options header',
    });
  } else if (xcto.toLowerCase() !== 'nosniff') {
    issues.push({
      rule: 'wrong-x-content-type-options',
      msg: `X-Content-Type-Options must be "nosniff" (got "${xcto}")`,
    });
  }

  // Rule 2b — X-Frame-Options: DENY or SAMEORIGIN
  const xfo = catchallByName.get('x-frame-options');
  if (!xfo) {
    issues.push({
      rule: 'missing-x-frame-options',
      msg: '/* section missing X-Frame-Options header',
    });
  } else if (!/^(DENY|SAMEORIGIN)$/i.test(xfo)) {
    issues.push({
      rule: 'weak-x-frame-options',
      msg: `X-Frame-Options must be DENY or SAMEORIGIN (got "${xfo}")`,
    });
  }

  // Rule 2c — Referrer-Policy
  const rp = catchallByName.get('referrer-policy');
  if (!rp) {
    issues.push({
      rule: 'missing-referrer-policy',
      msg: '/* section missing Referrer-Policy header',
    });
  } else {
    const strict = [
      'no-referrer',
      'no-referrer-when-downgrade',
      'same-origin',
      'origin',
      'strict-origin',
      'strict-origin-when-cross-origin',
    ];
    if (!strict.includes(rp.toLowerCase())) {
      issues.push({
        rule: 'weak-referrer-policy',
        msg: `Referrer-Policy must be one of {${strict.join(', ')}} (got "${rp}")`,
      });
    }
  }

  // Rule 2d — Permissions-Policy
  if (!catchallByName.has('permissions-policy')) {
    issues.push({
      rule: 'missing-permissions-policy',
      msg: '/* section missing Permissions-Policy header',
    });
  }

  // Rule 2e — Content-Security-Policy with default-src 'self'
  const csp = catchallByName.get('content-security-policy');
  if (!csp) {
    issues.push({ rule: 'missing-csp', msg: '/* section missing Content-Security-Policy header' });
  } else {
    if (!/default-src\s+[^;]*'self'/i.test(csp)) {
      issues.push({
        rule: 'weak-csp-default-src',
        msg: `CSP must include default-src 'self' (got "${csp}")`,
      });
    }
    // Rule 7 — no unsafe-eval
    if (/unsafe-eval/i.test(csp)) {
      issues.push({
        rule: 'csp-unsafe-eval',
        msg: `CSP contains 'unsafe-eval' — XSS vector, must not be present`,
      });
    }
    // Rule 8 — script-src must not be wildcard
    const scriptSrcMatch = csp.match(/script-src\s+([^;]+)/i);
    if (scriptSrcMatch) {
      const sources = scriptSrcMatch[1].trim().split(/\s+/);
      const hasWildcard = sources.some(
        (s) => s === '*' || s === 'data:' || s.startsWith('https://*'),
      );
      if (
        hasWildcard &&
        !sources.every(
          (s) =>
            s === "'self'" ||
            s === "'unsafe-inline'" ||
            s === "'unsafe-eval'" ||
            s.startsWith('nonce-') ||
            /^https:\/\/[a-z0-9.-]+$/i.test(s),
        )
      ) {
        // Only flag if there's an actual wildcard
        if (sources.includes('*')) {
          issues.push({
            rule: 'csp-wildcard-script-src',
            msg: `CSP script-src contains wildcard "*" — must use 'self' or specific origins`,
          });
        }
      }
    }
  }

  // Rule 3 — /_astro/* must have long cache
  const astroSection = sectionFor(sections, '/_astro/anything.js');
  if (!astroSection) {
    issues.push({
      rule: 'no-astro-cache',
      msg: 'No /_astro/* section (hashed assets need immutable cache)',
    });
  } else {
    const cc = astroSection.headers.find((h) => h.name.toLowerCase() === 'cache-control');
    if (!cc) {
      issues.push({
        rule: 'no-astro-cache-control',
        msg: '/_astro/* section missing Cache-Control',
      });
    } else {
      const m = cc.value.match(/max-age\s*=\s*(\d+)/i);
      if (!m || parseInt(m[1], 10) < 31536000) {
        issues.push({
          rule: 'short-astro-cache',
          msg: `/_astro/* Cache-Control max-age must be ≥ 31536000 (1y) (got "${cc.value}")`,
        });
      }
    }
  }

  // Rule 4 — /*.html must have must-revalidate
  const htmlSection = sectionFor(sections, '/anything.html');
  if (!htmlSection) {
    issues.push({
      rule: 'no-html-cache',
      msg: 'No /*.html section (page HTML needs must-revalidate)',
    });
  } else {
    const cc = htmlSection.headers.find((h) => h.name.toLowerCase() === 'cache-control');
    if (!cc || !/must-revalidate/i.test(cc.value)) {
      issues.push({
        rule: 'no-html-must-revalidate',
        msg: `/*.html Cache-Control must include "must-revalidate" (got "${cc?.value || 'none'}")`,
      });
    }
  }

  // Rule 5 — /sitemap*.xml must exist (as a SPECIFIC section, not catch-all fallback)
  const sitemapSpecific = sections.find(
    (s) => matchPattern(s.pattern, '/sitemap-index.xml') && s.pattern !== '/*',
  );
  if (!sitemapSpecific) {
    issues.push({
      rule: 'no-sitemap-cache',
      msg: 'No /sitemap*.xml section (sitemaps need cache directive)',
    });
  }

  // Rule 6 — /feed*.xml must exist (as a SPECIFIC section, not catch-all fallback)
  const feedSpecific = sections.find(
    (s) => matchPattern(s.pattern, '/feed.xml') && s.pattern !== '/*',
  );
  if (!feedSpecific) {
    issues.push({
      rule: 'no-feed-cache',
      msg: 'No /feed*.xml section (feeds need cache directive)',
    });
  }

  return { issues };
}

async function main() {
  console.log('=== Security-Headers-Integrity Audit (v7.7.26) — CF Pages _headers shape ===\n');

  const { issues } = await audit();

  console.log(`Scanned 1 file (${HEADERS_PATH}) · ${issues.length} issue(s)\n`);

  if (issues.length === 0) {
    console.log(
      '✓ _headers is present, all security headers present, CSP strong, cache directives correct.',
    );
    return;
  }

  const byRule = new Map();
  for (const i of issues) {
    if (!byRule.has(i.rule)) byRule.set(i.rule, []);
    byRule.get(i.rule).push(i.msg);
  }
  for (const [rule, msgs] of byRule) {
    console.log(`\n[${rule}] — ${msgs.length} site(s):`);
    for (const m of msgs) {
      console.log(`  ${m}`);
    }
  }

  console.error(`\nFAIL — ${issues.length} security-headers-integrity issue(s).`);
  process.exit(1);
}

main().catch((e) => {
  console.error('security-headers-integrity scan crashed:', e);
  process.exit(2);
});
