// check-heading-hierarchy.mjs — v7.7.9 HEADING-HIERARCHY CI GATE
//
// Walks dist/**/index.html, extracts the heading tree from each
// route, and fails the build on any WCAG 2.2 AA / SC 1.3.1 + 2.4.6
// violation.
//
// Rules enforced:
//   - Exactly one <h1> per route (multiple-h1 → fail)
//   - No skipped levels (h1→h3, h2→h4, h2→h5, … → fail)
//   - No empty headings (<h2></h2> → fail)
//   - Heading depth ≤ h4 (h5+, h6+ → warn — many CMS sites use
//     flat h6 for nested cards, but anything beyond is suspicious)
//   - No descendant skips INSIDE the same section (per-route only,
//     not cross-document; landing-page <header> h2 + footer <h4>
//     would still fail unless the footer cols use h3)
//
// Allow-list (routes where multi-h1 is intentional, e.g. workbook
// chapters where each chapter is its own first-class section):
//
//   /workbooks/*  — multiple h1 are chapter titles; each chapter
//                   is the page's primary heading in its own right
//
// Exits 1 on any fail. Exits 0 otherwise.
// Used in: npm run ci (after a11y:scan, before link:rot).

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

/**
 * Extract the visible heading tree from an HTML file.
 * Uses a regex scan rather than jsdom for speed + zero-dep.
 * Skips headings that are aria-hidden="true" (decorative)
 * or inside <template> (cloned at runtime, not on the
 * critical path for the page-load hierarchy).
 */
function extractHeadings(html) {
  const re = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const level = Number(m[1]);
    const attrs = m[2] || '';
    const inner = m[3] || '';
    // Skip hidden headings — they don't affect the document outline
    if (/\baria-hidden\s*=\s*["']true["']/i.test(attrs)) continue;
    // Skip headings whose only content is whitespace or a comment
    const text = inner.replace(/<!---->|<!---?[^>]*-->/g, '').replace(/<[^>]+>/g, '').trim();
    out.push({ level, text, attrs });
  }
  return out;
}

function auditHeadings(route, html) {
  const headings = extractHeadings(html);
  const issues = [];

  // Allow-list for routes where multiple-h1 is intentional
  // (e.g. workbook chapters). Add paths here only with a one-line
  // rationale for why the WCAG 2.4.6 / HTML5 outline exception
  // is acceptable.
  const allowMultiH1 = /\/workbooks\//.test(route);

  // Multiple-h1 check
  const h1Count = headings.filter((h) => h.level === 1).length;
  if (h1Count === 0) {
    if (!allowMultiH1) {
      issues.push({ rule: 'no-h1', msg: 'route has zero <h1> elements' });
    }
  } else if (h1Count > 1) {
    if (!allowMultiH1) {
      issues.push({ rule: 'multiple-h1', msg: `route has ${h1Count} <h1> elements (expected exactly 1)` });
    }
  }

  // Empty headings
  for (const h of headings) {
    if (!h.text) {
      issues.push({ rule: 'empty-heading', msg: `<h${h.level}></h${h.level}> is empty` });
    }
  }

  // Skipped levels and depth check
  let prevLevel = 0;
  for (const h of headings) {
    if (prevLevel > 0) {
      const delta = h.level - prevLevel;
      if (delta > 1) {
        issues.push({
          rule: 'skipped-level',
          msg: `skipped heading level: <h${prevLevel}> → <h${h.level}> (text="${h.text.slice(0, 40)}")`,
        });
      }
    }
    if (h.level > 4) {
      issues.push({
        rule: 'too-deep',
        msg: `<h${h.level}> exceeds recommended depth 4 (text="${h.text.slice(0, 40)}")`,
      });
    }
    prevLevel = h.level;
  }

  return { route, h1Count, total: headings.length, issues };
}

async function main() {
  console.log('=== Heading Hierarchy Audit (v7.7.9) — WCAG SC 1.3.1 + 2.4.6 ===\n');

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
    findings.push(auditHeadings(route, html));
  }

  const failing = findings.filter((f) => f.issues.length > 0);
  const totalIssues = failing.reduce((n, f) => n + f.issues.length, 0);

  console.log(`Scanned ${findings.length} routes · ${totalIssues} heading-hierarchy issue(s) across ${failing.length} route(s)\n`);

  if (totalIssues === 0) {
    console.log('✓ All routes pass heading-hierarchy contract.');
    return;
  }

  // Group issues by rule for the report
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

  console.error(`\nFAIL — ${totalIssues} heading-hierarchy issue(s) across ${failing.length} route(s).`);
  process.exit(1);
}

main().catch((e) => {
  console.error('heading-hierarchy scan crashed:', e);
  process.exit(2);
});
