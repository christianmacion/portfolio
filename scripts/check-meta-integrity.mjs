// check-meta-integrity.mjs — v7.7.14 META-TAG INTEGRITY CI GATE
//
// Catches missing SEO/recruiter-facing surface metadata before ship.
// Every public route is a recruiter-facing artifact (LinkedIn, ATS,
// direct shares) — if a route is missing the canonical meta triad,
// the share preview is blank and search ranking drops.
//
// Rules enforced (per dist/**/index.html):
//   - <title> with non-empty text
//   - <meta name="description"> with non-empty content
//   - <link rel="canonical"> with non-empty href
//   - <meta property="og:title"> with non-empty content
//   - <meta property="og:description"> with non-empty content (mirror of meta desc)
//   - <meta name="viewport"> with content starting "width=" (mobile meta)
//
// Allow-list: routes where missing OG is intentional (e.g. utility pages
// that don't get shared, like 404 or print stylesheets). Currently:
//   - 404.html is the error page, not a shared URL
//
// Companion to scripts/check-heading-hierarchy.mjs (v7.7.9) and
// scripts/audit (NDA scrub) — every ship needs: visible heading
// structure + meta surface + NDA safety.
//
// Exits 1 on any fail. Exits 0 otherwise.
// Used in: npm run ci (after live:integrity, before audit).

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else yield full;
  }
}

function extractMeta(html) {
  const findings = {};

  // <title>...</title>
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  findings.title = titleMatch ? titleMatch[1].trim() : null;

  // meta name="description" content="..."
  // Use a backreference-aware pattern: match the opening quote of the
  // content attribute and capture everything until the matching quote.
  // This handles apostrophes inside content (e.g. "What I'm reading…")
  // which would otherwise terminate a [^"']* character class prematurely.
  const descMatch = html.match(
    /<meta\s+[^>]*name\s*=\s*(["'])description\1[^>]*content\s*=\s*(["'])([\s\S]*?)\2/i
  );
  findings.description = descMatch ? descMatch[3].trim() : null;

  // link rel="canonical" href="..."
  const canonicalMatch = html.match(
    /<link\s+[^>]*rel\s*=\s*(["'])canonical\1[^>]*href\s*=\s*(["'])([\s\S]*?)\2/i
  );
  findings.canonical = canonicalMatch ? canonicalMatch[3].trim() : null;

  // meta property="og:title" content="..."
  const ogTitleMatch = html.match(
    /<meta\s+[^>]*property\s*=\s*(["'])og:title\1[^>]*content\s*=\s*(["'])([\s\S]*?)\2/i
  );
  findings.ogTitle = ogTitleMatch ? ogTitleMatch[3].trim() : null;

  // meta property="og:description" content="..."
  const ogDescMatch = html.match(
    /<meta\s+[^>]*property\s*=\s*(["'])og:description\1[^>]*content\s*=\s*(["'])([\s\S]*?)\2/i
  );
  findings.ogDescription = ogDescMatch ? ogDescMatch[3].trim() : null;

  // meta name="viewport" content="..."
  const viewportMatch = html.match(
    /<meta\s+[^>]*name\s*=\s*(["'])viewport\1[^>]*content\s*=\s*(["'])([\s\S]*?)\2/i
  );
  findings.viewport = viewportMatch ? viewportMatch[3].trim() : null;

  return findings;
}

function auditMeta(route, html) {
  const meta = extractMeta(html);
  const issues = [];
  const warnings = [];

  if (!meta.title) {
    issues.push({ rule: 'no-title', msg: 'route has no <title> element' });
  } else if (meta.title.length < 5) {
    issues.push({
      rule: 'short-title',
      msg: `<title> is only ${meta.title.length} chars: "${meta.title}"`,
    });
  } else if (meta.title.length > 70) {
    // Warning, not fail — long titles are common on portfolio sites where
    // topic+author+section names push past 60 chars. SERP truncation is
    // a UX concern, not a structural bug.
    warnings.push({
      rule: 'long-title',
      msg: `<title> is ${meta.title.length} chars (>70 truncates in SERPs): "${meta.title.slice(0, 60)}…"`,
    });
  }

  if (!meta.description) {
    issues.push({ rule: 'no-description', msg: 'no <meta name="description">' });
  } else if (meta.description.length < 15) {
    // Threshold tuned to glossary-term short-defs which are
    // intentionally compact. Anything under 15 chars is almost
    // certainly a placeholder.
    issues.push({
      rule: 'short-description',
      msg: `<meta description> is only ${meta.description.length} chars (recommend 120-160)`,
    });
  } else if (meta.description.length > 200) {
    // Warning — portfolio descriptions often run 200-300 chars because
    // we want the keywords (NDA-safe, public-data, walk-forward) to land
    // in the SERP preview. Truncation is a UX concern, not a bug.
    warnings.push({
      rule: 'long-description',
      msg: `<meta description> is ${meta.description.length} chars (>160 truncates in SERPs)`,
    });
  }

  if (!meta.canonical) {
    issues.push({ rule: 'no-canonical', msg: 'no <link rel="canonical">' });
  }

  if (!meta.ogTitle) {
    issues.push({ rule: 'no-og-title', msg: 'no <meta property="og:title">' });
  }

  if (!meta.ogDescription) {
    issues.push({ rule: 'no-og-description', msg: 'no <meta property="og:description">' });
  }

  if (!meta.viewport || !/^width=/i.test(meta.viewport)) {
    issues.push({ rule: 'no-viewport', msg: 'no <meta name="viewport" content="width=…">' });
  }

  return { route, meta, issues, warnings };
}

async function main() {
  console.log('=== Meta-Tag Integrity Audit (v7.7.14) ===\n');

  const routes = [];
  for await (const file of walk('dist')) {
    if (!file.endsWith('index.html')) continue;
    const parts = file.split('/');
    if (parts.includes('_astro') || parts.includes('_pagefind')) continue;
    routes.push(file);
  }
  routes.sort();

  const findings = [];
  for (const route of routes) {
    const html = await readFile(route, 'utf8');
    findings.push(auditMeta(route, html));
  }

  const failing = findings.filter((f) => f.issues.length > 0);
  const totalIssues = failing.reduce((n, f) => n + f.issues.length, 0);
  const totalWarnings = findings.reduce(
    (n, f) => n + (f.warnings?.length || 0),
    0
  );

  console.log(
    `Scanned ${findings.length} routes · ${totalIssues} meta-tag issue(s) across ${failing.length} route(s) · ${totalWarnings} warning(s)\n`
  );

  if (totalIssues === 0) {
    if (totalWarnings > 0) {
      console.log(`✓ All required meta tags present. ${totalWarnings} non-blocking warning(s):\n`);
      const allWarnings = findings.flatMap((f) =>
        (f.warnings || []).map((w) => ({ route: f.route, ...w }))
      );
      for (const w of allWarnings) {
        console.log(`  ${w.route}  →  ${w.msg}`);
      }
    } else {
      console.log('✓ All routes have title + description + canonical + og:title + viewport.');
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

  console.error(`\nFAIL — ${totalIssues} meta-tag issue(s) across ${failing.length} route(s).`);
  process.exit(1);
}

main().catch((e) => {
  console.error('meta-integrity scan crashed:', e);
  process.exit(2);
});
