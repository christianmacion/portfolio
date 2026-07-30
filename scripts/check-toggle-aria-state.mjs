#!/usr/bin/env node
// scripts/check-toggle-aria-state.mjs
// v7.7.57 — 61st CI gate
// Validates every toggle button (filter chip) carries an aria-pressed
// attribute so screen-reader users learn whether the chip is currently
// filtering — not just its name.
//
// WCAG 4.1.2 Name, Role, Value (Level A) — toggle buttons (filter chips
// that act as on/off switches) carry the `is-active` / `--active` class
// but no `aria-pressed` or `aria-selected`. Screen reader users hear the
// button name but never learn whether it is currently filtering.
//
// Scope (toggle button classes that MUST have aria-pressed):
//   - desk-events__chip-btn (3 groups: cat / sev / city on /desk)
//   - live-feed__chip-btn   (2 groups: source / time-scope on /live)
//   - live-feed__city-btn   (city quick-filter on /live)
//
// Out of scope (deliberate non-toggles):
//   - lane-filter__chip — uses aria-current="page" for anchor-styled
//     visual register (explicit design choice in src/pages/projects/index.astro)
//   - live-feed__share-btn — action button (COPY · LINK), not a toggle
//   - filter-chip — already correctly emits aria-pressed (proof pattern)
//
// Mutation: inject `<button class="desk-events__chip-btn">` without
// aria-pressed → caught.
//
// Usage:
//   node scripts/check-toggle-aria-state.mjs

import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const DIST = 'dist';
const SKIP_DIRS = new Set(['data', '_pagefind', '_astro']);

const TOGGLE_CLASS_PREFIXES = [
  'desk-events__chip-btn',
  'live-feed__chip-btn',
  'live-feed__city-btn',
];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function lineOf(haystack, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < haystack.length; i++) {
    if (haystack.charCodeAt(i) === 10) line++;
  }
  return line;
}

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.endsWith('.html')) yield full;
  }
}

// Match <button ...>...</button>. Group 1 = attrs inside opening tag.
const BUTTON_OPEN_RE =
  /<button\b([^>]*?)>/gi;

async function main() {
  const issues = [];
  let scanned = 0;
  let withPressed = 0;

  for await (const file of walk(DIST)) {
    const html = readFileSync(file, 'utf8');
    let m;
    BUTTON_OPEN_RE.lastIndex = 0;
    while ((m = BUTTON_OPEN_RE.exec(html)) !== null) {
      const attrs = m[1] || '';
      const classMatch = /\bclass\s*=\s*["']([^"']+)["']/i.exec(attrs);
      if (!classMatch) continue;
      const matchedPrefix = TOGGLE_CLASS_PREFIXES.find((p) =>
        new RegExp(`(?:^|\\s)${escapeRe(p)}(?:\\s|--|$)`).test(classMatch[1]),
      );
      if (!matchedPrefix) continue;
      scanned++;
      if (/\baria-pressed\s*=\s*["'](?:true|false)["']/i.test(attrs)) {
        withPressed++;
      } else {
        issues.push({
          file,
          line: lineOf(html, m.index),
          class: matchedPrefix,
          snippet: `<button ${attrs.slice(0, 80)}>`,
        });
      }
    }
  }

  if (issues.length === 0) {
    console.log(
      '=== Toggle-Aria-State Audit (v7.7.57) — every filter-chip button has aria-pressed ===',
    );
    console.log('');
    console.log(
      `Scanned ${scanned} toggle button(s) · ${withPressed} with aria-pressed · 0 missing`,
    );
    console.log('');
    console.log('✓ All toggle buttons announce their on/off state to screen readers.');
    process.exit(0);
  }

  console.log('=== Toggle-Aria-State Audit (v7.7.57) ===');
  console.log('');
  console.log(`${issues.length} toggle button(s) missing aria-pressed:\n`);
  for (const i of issues) {
    console.log(`  ${i.file}:${i.line}  class="${i.class}" — no aria-pressed`);
  }
  console.log('');
  console.log(
    'Fix: add aria-pressed="true" / aria-pressed="false" to every <button class="<toggle-prefix>"> (WCAG 4.1.2 Name, Role, Value).',
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('toggle-aria-state scan crashed:', e);
  process.exit(2);
});
