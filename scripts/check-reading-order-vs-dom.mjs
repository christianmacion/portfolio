#!/usr/bin/env node
// scripts/check-reading-order-vs-dom.mjs
// v7.7.59 — 63rd CI gate
// Catches the WCAG 1.3.2 Meaningful Sequence bug class: visual reading
// order diverges from DOM order. The patterns detected are CSS rules
// that explicitly reorder, reverse, or rotate content relative to its
// DOM position.
//
// Detected patterns (auto-fail unless allow-listed):
//   1. CSS `order: <integer>` on a flex/grid item — moves the item
//      visually out of DOM order
//   2. CSS `flex-direction: row-reverse` or `column-reverse` — reverses
//      visual flow vs DOM flow
//   3. CSS `direction: rtl` — sets RTL flow (legitimate on RTL content,
//      but a signal to verify DOM order matches)
//   4. CSS `writing-mode: vertical-rl | vertical-lr | horizontal-tb`
//      (NOT the default horizontal-tb) — visual rotation
//
// What this gate does NOT detect:
//   - position: absolute / position: fixed (decorative positioning, not
//     reordering; not an automatic WCAG 1.3.2 violation)
//   - transform: translate(Xpx, Ypx) (visual shift, not reordering)
//   - Roving tabindex patterns (composite widget keyboard nav per
//     ARIA Authoring Practices — legitimate, not a violation)
//   - JavaScript DOM reorder via insertBefore / appendChild — out of
//     scope; needs a separate "js-dom-reorder" audit
//
// Allow-list (known-safe patterns):
//   - `src/pages/index.astro` `.hero__portrait { order: -1 }` inside
//     `@media (max-width: 720px)` — deliberate mobile responsive
//     reordering (portrait above hero text on small screens). The DOM
//     order has text → portrait; mobile visual order is portrait → text.
//     The meaning is preserved (Christian's hero section identity), and
//     the photo is decorative (alt text describes it). NOT a WCAG 1.3.2
//     violation.
//
// Usage: node scripts/check-reading-order-vs-dom.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = 'src';
const SCAN_EXT = new Set(['.astro', '.css']);

// Patterns: regex matches the rule, capture groups give context
const PATTERNS = [
  {
    id: 'flex-order',
    regex: /(?<![a-z-])order\s*:\s*(-?\d+)\s*;/g,
    desc: 'flex/grid `order` value',
    rule: 'reorders item relative to DOM order',
  },
  {
    id: 'flex-direction-reverse',
    regex: /flex-direction\s*:\s*(row|column)-reverse\s*;/g,
    desc: 'flex-direction with -reverse',
    rule: 'reverses flex flow vs DOM order',
  },
  {
    id: 'direction-rtl',
    regex: /(?<![a-z-])direction\s*:\s*rtl\s*;/g,
    desc: 'CSS direction: rtl',
    rule: 'sets RTL flow (verify DOM order matches)',
  },
  {
    id: 'writing-mode-vertical',
    regex: /writing-mode\s*:\s*(vertical-rl|vertical-lr|sideways-rl|sideways-lr)\s*;/g,
    desc: 'writing-mode vertical',
    rule: 'rotates text flow visually',
  },
];

// Allow-list: file + pattern id + optional selector context. A match
// at this exact (file, pattern-id, value) tuple is permitted.
const ALLOW = [
  {
    file: 'src/pages/index.astro',
    pattern: 'flex-order',
    value: '-1',
    context: '.hero__portrait',
    why: 'Mobile responsive portrait-above-text reorder (≤720px media query). Decorative image, DOM order preserves meaning.',
  },
];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, files);
    } else if (SCAN_EXT.has(full.slice(full.lastIndexOf('.')))) {
      files.push(full);
    }
  }
  return files;
}

function lineOf(haystack, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < haystack.length; i++) {
    if (haystack.charCodeAt(i) === 10) line++;
  }
  return line;
}

function contextLine(haystack, offset) {
  // Return the full line containing this offset
  let start = offset;
  while (start > 0 && haystack.charCodeAt(start - 1) !== 10) start--;
  let end = offset;
  while (end < haystack.length && haystack.charCodeAt(end) !== 10) end++;
  return haystack.slice(start, end).trim();
}

function nearestSelectorAbove(haystack, offset) {
  // Walk backward from offset to find the nearest `{` of a selector block.
  // Return the selector text (e.g. ".hero__portrait") for context.
  let i = offset;
  while (i > 0) {
    if (haystack.charCodeAt(i) === 123 /* { */) {
      // walk back to find the matching closing `;` or `}` boundary
      let j = i - 1;
      while (j > 0) {
        const c = haystack.charCodeAt(j);
        if (c === 125 /* } */ || c === 59 /* ; */) break;
        j--;
      }
      const sel = haystack.slice(j + 1, i).trim().split('\n').pop().trim();
      return sel;
    }
    i--;
  }
  return '';
}

function isAllowed(file, patternId, value, lineContext) {
  const rel = relative('.', file);
  for (const a of ALLOW) {
    if (a.file !== rel) continue;
    if (a.pattern !== patternId) continue;
    if (a.value && a.value !== value) continue;
    if (a.context && !lineContext.includes(a.context)) continue;
    return a;
  }
  return null;
}

async function main() {
  console.log(
    '=== Reading-Order-vs-DOM-Order Audit (v7.7.59) — WCAG 1.3.2 Meaningful Sequence ===\n',
  );

  const files = walk(ROOT);
  const findings = [];
  const allowed = [];

  for (const file of files) {
    const html = readFileSync(file, 'utf8');
    for (const pattern of PATTERNS) {
      // Reset lastIndex
      pattern.regex.lastIndex = 0;
      let m;
      while ((m = pattern.regex.exec(html)) !== null) {
        const value = m[1] || '';
        const offset = m.index;
        const line = lineOf(html, offset);
        const ctxLine = contextLine(html, offset);
        const selector = nearestSelectorAbove(html, offset);
        const allow = isAllowed(file, pattern.id, value, ctxLine + ' ' + selector);
        if (allow) {
          allowed.push({
            file,
            line,
            pattern: pattern.id,
            value,
            context: ctxLine,
            selector,
            why: allow.why,
          });
        } else {
          findings.push({
            file,
            line,
            pattern: pattern.id,
            desc: pattern.desc,
            rule: pattern.rule,
            value,
            context: ctxLine,
            selector,
          });
        }
      }
    }
  }

  console.log(
    `Scanned ${files.length} source file(s) · ${findings.length} candidate(s) · ${allowed.length} allow-listed\n`,
  );

  if (allowed.length > 0) {
    console.log('Allow-listed (permitted):\n');
    for (const a of allowed) {
      console.log(`  ✓ ${a.file}:${a.line}  ${a.pattern} = ${a.value}  (selector: ${a.selector})`);
      console.log(`      "${a.context}"`);
      console.log(`      Why: ${a.why}\n`);
    }
  }

  if (findings.length === 0) {
    console.log('✓ All reading-order-affecting CSS rules are allow-listed.');
    console.log(
      '  No WCAG 1.3.2 Meaningful Sequence violations — visual order matches DOM order (or the reordering preserves meaning).',
    );
    return;
  }

  console.error(`FAIL — ${findings.length} candidate(s) require manual review:\n`);
  for (const f of findings) {
    console.error(`  ✗ ${f.file}:${f.line}  ${f.pattern} = ${f.value}  (selector: ${f.selector})`);
    console.error(`      "${f.context}"`);
    console.error(`      Risk: ${f.rule}\n`);
  }
  console.error(
    'Fix: either (a) remove the reordering CSS if it changes meaning, OR (b) add an entry to the ALLOW array in scripts/check-reading-order-vs-dom.mjs with a one-line `why` justification.',
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('reading-order-vs-dom scan crashed:', e);
  process.exit(2);
});
