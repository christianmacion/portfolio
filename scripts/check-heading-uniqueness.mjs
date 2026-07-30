// check-heading-uniqueness.mjs — v7.7.47 HEADING-UNIQUENESS CI GATE
//
// Validates that every dist/*.html page has UNIQUE heading text (no two
// <h1>-<h6> elements on the same page have the same visible text).
//
// Why this matters: screen-reader users navigate by heading text (the H key
// in NVDA/JAWS reads headings as a list). If two headings on a page have
// the same text, the user can't distinguish them — they hear "Heading:
// Project" twice in a row and have no way to know which "Project" they
// landed on. WCAG 2.4.6 (Headings and Labels) recommends headings describe
// the topic/purpose of the section.
//
// Rules enforced:
//   1. heading-text-duplicate — no two <h1>-<h6> on the SAME page share
//      identical visible text (stripped of HTML tags, whitespace-normalized)
//
// Skip rules:
//   - `/workbooks/*` paths — print-PDF HTMLs may have intentional duplicates
//     (e.g., repeated section headers in a 2-column print layout)
//
// Skip-content rules:
//   - Empty headings (no visible text) are exempt — they're sr-only or
//     decorative and don't create navigation ambiguity
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

function normalizeHeadingText(raw) {
  // Strip nested HTML tags, decode entities, normalize whitespace
  const noTags = raw.replace(/<[^>]+>/g, '');
  const decoded = noTags
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return decoded.replace(/\s+/g, ' ').trim();
}

function findHeadings(html) {
  const re = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  const tags = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const text = normalizeHeadingText(m[2]);
    if (!text) continue; // Skip empty headings (sr-only decorative)
    tags.push({
      level: parseInt(m[1], 10),
      text,
      offset: m.index,
    });
  }
  return tags;
}

function audit() {
  const issues = [];
  let totalPages = 0;
  let pagesChecked = 0;
  let totalHeadings = 0;
  let pagesWithDup = 0;

  for (const f of walk(DIST)) {
    totalPages++;
    if (f.includes('/workbooks/')) continue;

    const html = readFileSync(f, 'utf8');
    const headings = findHeadings(html);
    pagesChecked++;
    totalHeadings += headings.length;

    // Find duplicate texts within this page
    const textCount = new Map();
    for (const h of headings) {
      if (!textCount.has(h.text)) textCount.set(h.text, []);
      textCount.get(h.text).push(h);
    }

    const dups = [];
    for (const [text, hList] of textCount) {
      if (hList.length > 1) {
        dups.push({ text, headings: hList });
      }
    }

    if (dups.length > 0) {
      pagesWithDup++;
      for (const d of dups) {
        const levels = d.headings.map((h) => `h${h.level}`).join('+');
        issues.push({
          rule: 'heading-text-duplicate',
          msg: `${f} — heading "${d.text.slice(0, 50)}" appears ${d.headings.length} times as ${levels}`,
        });
      }
    }
  }

  return {
    issues,
    totalPages,
    pagesChecked,
    totalHeadings,
    pagesWithDup,
  };
}

function main() {
  console.log(
    '=== Heading-Uniqueness Audit (v7.7.47) — no two headings on same page may have identical text ===\n',
  );

  const { issues, totalPages, pagesChecked, totalHeadings, pagesWithDup } = audit();

  console.log(
    `Scanned ${totalPages} HTML page(s) · ${pagesChecked} checked · ${totalHeadings} heading(s) · ${pagesWithDup} with duplicate · ${issues.length} issue(s)\n`,
  );

  if (issues.length === 0) {
    console.log(
      `✓ All ${pagesChecked} page(s) have unique heading text (screen-reader heading navigation is unambiguous).`,
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
    for (const m of msgs.slice(0, 8)) console.log(`  ${m}`);
    if (msgs.length > 8) console.log(`  ... and ${msgs.length - 8} more`);
  }

  console.error(`\nFAIL — ${issues.length} heading-uniqueness issue(s).`);
  process.exit(1);
}

try {
  main();
} catch (e) {
  console.error('heading-uniqueness scan crashed:', e);
  process.exit(2);
}
