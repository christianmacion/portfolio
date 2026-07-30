// check-anchor-rot.mjs — v7.7.12 INTERNAL-ANCHOR-ROT CI GATE
//
// Catches intra-page hash drift: a route references href="#foo"
// but no element on the page has id="foo". This is the #1 cause
// of "clicked the section link, page jumped nowhere" — usually
// from a refactor that renamed the section heading's auto-id
// without updating the table-of-contents link.
//
// Companion gates:
//   - scripts/check-link-rot.mjs (v7.7.6) — EXTERNAL href targets
//   - scripts/verify-anchors.mjs           — workbook fragment links
//   - scripts/check-heading-hierarchy.mjs (v7.7.9) — heading structure
//
// Rules enforced:
//   - Every `href="#id"` (where id is non-empty) must have a matching
//     `id="id"` somewhere on the same page
//   - Empty `href="#"` and `href="#main"` (skip-to-content) are
//     allow-listed — they don't reference a target
//   - href="#!" framework placeholders are allow-listed
//   - Cross-page anchors (href="/foo#bar") are out of scope here —
//     verify-anchors.mjs handles those
//
// Exits 1 on any fail. Exits 0 otherwise.
// Used in: npm run ci (after link:rot, before audit).

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

// Allow-list: hash-only hrefs that don't reference a target.
// - ""    → scrolls to top of page (intentional UX)
// - "main"→ skip-to-content link (a11y standard, target is <main>)
// - "!"   → framework placeholder (some libs use this for "no-op")
// - top   → "back to top" pattern
const HASH_SKIP = new Set(['', '!', 'main', 'top']);

function extractIds(html) {
  // Match id="..." or id='...'. Use a simple non-greedy scan.
  // (Skips nested quotes which is fine — HTML attribute parsers
  // disallow quotes inside the value.)
  const re = /\bid\s*=\s*["']([^"']+)["']/gi;
  const out = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    out.add(m[1]);
  }
  // Also catch legacy <a name="..."> (HTML4 anchor pattern)
  const re2 = /<a\b[^>]*\bname\s*=\s*["']([^"']+)["'][^>]*>/gi;
  while ((m = re2.exec(html)) !== null) {
    out.add(m[1]);
  }
  return out;
}

// Strip <script>...</script> blocks before scanning. Without this,
// the scanner matches template literals like `href="#${t}"` that
// are inside inline JS — false positives on every page that has
// a client-side TOC builder. (Real-world catch from v7.7.12 ship:
// dist/methodology/index.html had 1 false positive from
// SectionTOC.astro's inline script.)
function stripScripts(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

function extractHashTargets(html) {
  // Match href="#id" — only true anchor links, not query strings.
  // Skips href="https://..." etc.
  const re = /\bhref\s*=\s*["']#([^"'?]+)["']/gi;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const target = m[1];
    if (HASH_SKIP.has(target)) continue;
    out.push(target);
  }
  return out;
}

function auditAnchors(route, html) {
  // Strip <script> blocks before scanning — see stripScripts() above.
  const scanHtml = stripScripts(html);
  const ids = extractIds(scanHtml);
  const targets = extractHashTargets(scanHtml);
  const issues = [];
  const seen = new Set();

  for (const t of targets) {
    if (seen.has(t)) continue;
    seen.add(t);
    if (!ids.has(t)) {
      issues.push({
        rule: 'broken-hash',
        msg: `href="#${t}" → no element on page with id="${t}"`,
        target: t,
      });
    }
  }

  return { route, idCount: ids.size, targetCount: targets.length, issues };
}

async function main() {
  console.log('=== Internal Anchor-Rot Audit (v7.7.12) ===\n');

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
    findings.push(auditAnchors(route, html));
  }

  const failing = findings.filter((f) => f.issues.length > 0);
  const totalIssues = failing.reduce((n, f) => n + f.issues.length, 0);
  const totalIds = findings.reduce((n, f) => n + f.idCount, 0);
  const totalTargets = findings.reduce((n, f) => n + f.targetCount, 0);

  console.log(
    `Scanned ${findings.length} routes · ${totalIds} id(s) · ${totalTargets} hash-link(s) · ${totalIssues} broken anchor(s) across ${failing.length} route(s)\n`
  );

  if (totalIssues === 0) {
    console.log('✓ All hash links resolve to a target on the same page.');
    return;
  }

  // Group by rule for the report
  const byRule = new Map();
  for (const f of failing) {
    for (const i of f.issues) {
      if (!byRule.has(i.rule)) byRule.set(i.rule, []);
      byRule.get(i.rule).push({ route: f.route, msg: i.msg, target: i.target });
    }
  }
  for (const [rule, list] of byRule) {
    console.log(`\n[${rule}] — ${list.length} site(s):`);
    for (const x of list) {
      console.log(`  ${x.route}  →  ${x.msg}`);
    }
  }

  console.error(
    `\nFAIL — ${totalIssues} broken anchor(s) across ${failing.length} route(s).`
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('anchor-rot scan crashed:', e);
  process.exit(2);
});
