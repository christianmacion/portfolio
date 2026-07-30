#!/usr/bin/env node
// scripts/check-duplicate-id-presence.mjs
// v7.7.56 — 60th CI gate
// Validates every HTML document has unique id="..." attributes.
//
// Lesson: a11y audit claimed 25 duplicate IDs in 7 pages — turned out to be
// a regex false-positive (the auditor's `id="..."` pattern matched
// `data-toc-id="..."` as well). The PRECISE regex `(?<![a-zA-Z0-9_-])id="..."`
// (no alpha or hyphen immediately before `id=`) shows ZERO real duplicates.
// Ship as preventive hardening — gate prevents the class from ever
// regressing.
//
// WCAG 4.1.1 Parsing (Level A) — browsers/AT honor only the first match
// for getElementById and aria-labelledby, so duplicates silently break
// anchor links + labelled-by references.
//
// Rule: every `id="X"` may appear AT MOST ONCE per HTML document.
// Skips: build artifacts under dist/data/, _pagefind/, _astro/.
// Mutation: inject <div id="foo"> + <div id="foo"> → caught.
//
// Usage:
//   node scripts/check-duplicate-id-presence.mjs

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const DIST = 'dist';

// PRECISE regex: id= must NOT be preceded by alpha or hyphen (so
// data-toc-id=, aria-labelledby=, formaction=, etc. are not matched).
// Also accept id= at start of tag (preceded by whitespace, <, quote, or /).
const ID_RE = /(?<![a-zA-Z0-9_-])id\s*=\s*["']([^"']+)["']/g;

const SKIP_DIRS = new Set(['data', '_pagefind', '_astro']);
const ISSUE_LIST = [];

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.endsWith('.html')) yield full;
  }
}

function lineOf(haystack, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < haystack.length; i++) {
    if (haystack.charCodeAt(i) === 10) line++;
  }
  return line;
}

let pagesScanned = 0;
let totalIdsScanned = 0;

for await (const file of walk(DIST)) {
  pagesScanned++;
  const html = await readFile(file, 'utf8');
  const counts = new Map(); // id → [{line, snippet}, ...]
  const re = new RegExp(ID_RE.source, 'g');
  let m;
  while ((m = re.exec(html)) !== null) {
    const id = m[1];
    const line = lineOf(html, m.index);
    if (!counts.has(id)) counts.set(id, []);
    counts.get(id).push({ line, snippet: m[0].slice(0, 60) });
    totalIdsScanned++;
  }
  for (const [id, occurrences] of counts) {
    if (occurrences.length > 1) {
      const first = occurrences[0];
      ISSUE_LIST.push({
        file,
        id,
        count: occurrences.length,
        line: first.line,
        snippet: `id="${id}" appears ${occurrences.length}× (lines ${occurrences
          .map((o) => o.line)
          .join(', ')})`,
      });
    }
  }
}

if (ISSUE_LIST.length === 0) {
  console.log(
    '=== Duplicate-Id-Presence Audit (v7.7.56) — every id="X" appears at most once per document ===',
  );
  console.log('');
  console.log(
    `Scanned ${pagesScanned} HTML page(s) · ${totalIdsScanned} id attr(s) · 0 duplicate(s)`,
  );
  console.log('');
  console.log('✓ No duplicate IDs — aria-labelledby + getElementById are safe.');
  process.exit(0);
}

console.log('=== Duplicate-Id-Presence Audit (v7.7.56) ===');
console.log('');
console.log(`${ISSUE_LIST.length} duplicate-id issue(s):\n`);
for (const i of ISSUE_LIST) {
  console.log(`  ${i.file}:${i.line}  ${i.snippet}`);
}
console.log('');
console.log(
  'Fix: rename one of the conflicting id="..." values (suggest prefixing with parent section slug).',
);
process.exit(1);
