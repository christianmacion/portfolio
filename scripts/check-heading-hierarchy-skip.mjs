// check-heading-hierarchy-skip.mjs — v7.7.46 HEADING-HIERARCHY-SKIP CI GATE
//
// Validates that heading levels in each dist/*.html page increase by AT MOST
// one at a time. Skipping levels (e.g., h1 → h3 without an h2 in between)
// breaks the visual + screen-reader hierarchy and is a WCAG 1.3.1 issue.
//
// Rules enforced:
//   1. heading-level-skip — for every page, after each heading, the next
//      heading level must be at most 1 level DEEPER. A jump from <h1> to
//      <h3> (skipping <h2>) fails. Going UP the hierarchy (e.g., h3 → h2)
//      is always allowed.
//
// Skip rules:
//   - `/workbooks/*` paths — print-PDF HTMLs use intentional compact
//     heading structure (no real screen-reader audience for the print template)
//
// Exits 1 on any fail. Exits 0 otherwise.

import { readFileSync, readdirSync } from 'node:fs';

const DIST = 'dist';

function* walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = `${dir}/${e.name}`;
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.endsWith('.html')) yield full;
  }
}

function findHeadingLevels(html) {
  // Match <h1 ...>, <h2 ...>, etc. (any attribute structure)
  const re = /<h([1-6])\b/gi;
  const tags = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    tags.push({ level: parseInt(m[1], 10), offset: m.index });
  }
  return tags;
}

function findHeadingText(html, offset) {
  // Find the heading content after offset — used for context in error msgs
  const m = html.slice(offset).match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
  if (!m) return '<empty>';
  return m[1].replace(/<[^>]+>/g, '').trim().slice(0, 60);
}

function audit() {
  const issues = [];
  let totalPages = 0;
  let pagesChecked = 0;
  let totalHeadings = 0;
  let pagesWithSkip = 0;

  for (const f of walk(DIST)) {
    totalPages++;

    // Skip workbook print-PDF HTMLs
    if (f.includes('/workbooks/')) continue;

    const html = readFileSync(f, 'utf8');
    const headings = findHeadingLevels(html);
    pagesChecked++;
    totalHeadings += headings.length;

    if (headings.length === 0) continue;

    let last = headings[0].level;
    for (let i = 1; i < headings.length; i++) {
      const level = headings[i].level;
      // Skip = level increased by more than 1
      if (level > last + 1) {
        pagesWithSkip++;
        issues.push({
          rule: 'heading-level-skip',
          msg: `${f} — heading skips from <h${last}> "${findHeadingText(html, headings[i - 1].offset)}" to <h${level}> "${findHeadingText(html, headings[i].offset)}" without an <h${last + 1}> in between`,
        });
        break; // One skip per page is enough to fail
      }
      last = level;
    }
  }

  return {
    issues,
    totalPages,
    pagesChecked,
    totalHeadings,
    pagesWithSkip,
  };
}

function main() {
  console.log('=== Heading-Hierarchy-Skip Audit (v7.7.46) — heading levels must increase by at most 1 ===\n');

  const { issues, totalPages, pagesChecked, totalHeadings, pagesWithSkip } = audit();

  console.log(`Scanned ${totalPages} HTML page(s) · ${pagesChecked} checked · ${totalHeadings} heading(s) · ${pagesWithSkip} with skip · ${issues.length} issue(s)\n`);

  if (issues.length === 0) {
    console.log(`✓ All ${pagesChecked} page(s) maintain proper heading hierarchy (h1 → h2 → h3 progression).`);
    return;
  }

  const byRule = new Map();
  for (const i of issues) {
    if (!byRule.has(i.rule)) byRule.set(i.rule, []);
    byRule.get(i.rule).push(i.msg);
  }
  for (const [rule, msgs] of byRule) {
    console.log(`\n[${rule}] — ${msgs.length} site(s):`);
    for (const m of msgs.slice(0, 8)) console.log(`  ${m}`);
    if (msgs.length > 8) console.log(`  ... and ${msgs.length - 8} more`);
  }

  console.error(`\nFAIL — ${issues.length} heading-hierarchy issue(s).`);
  process.exit(1);
}

try {
  main();
} catch (e) {
  console.error('heading-hierarchy-skip scan crashed:', e);
  process.exit(2);
}
