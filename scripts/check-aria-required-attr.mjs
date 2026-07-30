#!/usr/bin/env node
// scripts/check-aria-required-attr.mjs
// v7.7.63 — 67th CI gate
// Catches the WCAG 2.2 Level AA 4.1.2 Name/Role/Value bug class:
// every element with role="X" must also declare the state attributes
// required by WAI-ARIA 1.2 for that role (e.g., role="checkbox" requires
// aria-checked; role="tab" requires aria-selected; role="slider" requires
// aria-valuenow; etc.).
//
// Detection strategy: walk src/**/*.astro + src/pages/**/*.md. For every
// element that declares role="X":
//   1. Look up the REQUIRED state attribute(s) for role X per the
//      canonical WAI-ARIA 1.2 mapping (see REQUIRED_STATES below).
//   2. Check whether the element has the required attribute declared
//      within the same <element ... > opening tag (regex bounded by the
//      closing >).
//   3. If any required attribute is missing, flag as a bug.
//
// Out of scope (documented):
//   - Decorative/static roles (img, group, region, presentation, none,
//     list, listitem, table, row, cell, columnheader, rowheader, banner,
//     main, navigation, contentinfo, complementary, search, form, button,
//     link, tooltip, status, toolbar, application, document, article,
//     figure, definition, directory, feed, log, marquee, note, timer,
//     alert, math, scrollbar, paragraph) have NO required state — gate
//     passes them unconditionally.
//   - Custom roles (data-*) and unknown roles — gate skips (cannot
//     statically verify ARIA 1.2 conformance for non-standard roles).
//
// Mutation harness:
//   - M1: inject `role="checkbox"` without aria-checked → caught.
//   - M2: inject `role="checkbox" aria-checked="false"` → pass.
//   - M3: positive control (final revert clean).
//
// Usage: node scripts/check-aria-required-attr.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
const SCAN_EXT = new Set(['.astro', '.md']);

// WAI-ARIA 1.2 required state attributes per role.
// Reference: https://www.w3.org/TR/wai-aria-1.2/ (states & properties table).
const REQUIRED_STATES = {
  // Checkboxes / switches / radios — required to convey checked state.
  checkbox: ['aria-checked'],
  switch: ['aria-checked'],
  radio: ['aria-checked'],
  'menuitemcheckbox': ['aria-checked'],
  'menuitemradio': ['aria-checked'],

  // Slider-like — required to convey current value.
  slider: ['aria-valuenow'],
  spinbutton: ['aria-valuenow'],
  separator: ['aria-valuenow'], // ARIA 1.2 separator (focusable)
  progressbar: ['aria-valuenow'],

  // Tabs — required to convey selected state.
  tab: ['aria-selected'],

  // Combobox — required to convey expanded state.
  combobox: ['aria-expanded'],
};

// Roles that have no required state — pass unconditionally.
// Anything not in REQUIRED_STATES is treated as "no required state".
const ALL_KNOWN_ROLES = new Set([
  ...Object.keys(REQUIRED_STATES),
  // Decorative / static roles — explicit allow-list so gate doesn't warn on them.
  'img',
  'group',
  'region',
  'presentation',
  'none',
  'list',
  'listitem',
  'table',
  'row',
  'rowgroup',
  'cell',
  'columnheader',
  'rowheader',
  'grid',
  'gridcell',
  'banner',
  'main',
  'navigation',
  'contentinfo',
  'complementary',
  'search',
  'form',
  'button',
  'link',
  'tooltip',
  'status',
  'toolbar',
  'application',
  'document',
  'article',
  'figure',
  'definition',
  'directory',
  'feed',
  'log',
  'marquee',
  'note',
  'timer',
  'alert',
  'math',
  'scrollbar',
  'paragraph',
  'tablist',
  'tabpanel',
  'dialog',
  'alertdialog',
  'menu',
  'menubar',
  'menuitem',
  'tree',
  'treeitem',
  'heading',
  'separator',
  'listbox',
  'option',
  'radiogroup',
  'treegrid',
  'columnheader',
  'rowheader',
]);

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, files);
    else if (SCAN_EXT.has(full.slice(full.lastIndexOf('.')))) files.push(full);
  }
  return files;
}

// Find every <element ... role="X" ... > opening tag (everything from
// the first attribute boundary up to the closing `>` of the same tag).
// Returns array of {file, line, role, openingTag}.
function findRoleAttributes(html, file) {
  const findings = [];
  // Match every HTML tag start; we look for role="..." within.
  // Use the regex to capture the entire opening tag up to the first `>`.
  // This stops at the FIRST `>` so the opening tag is self-contained.
  // It works for `<div role="tab">` and `<button\n  role="tab"\n  ...>`
  // but won't match a tag with `>` inside an attribute value (rare in
  // .astro content; would require escaped `&gt;`).
  const tagRe = /<\s*([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const fullTag = m[0];
    const attrs = m[2];
    const roleMatch = attrs.match(/\brole\s*=\s*["']([^"']+)["']/i);
    if (!roleMatch) continue;
    const role = roleMatch[1].toLowerCase();
    if (!ALL_KNOWN_ROLES.has(role)) continue;
    const required = REQUIRED_STATES[role];
    if (!required || required.length === 0) continue;
    // Check which required attrs are missing.
    const missing = required.filter((attr) => {
      const re = new RegExp(`\\b${attr}\\s*=`, 'i');
      return !re.test(attrs);
    });
    if (missing.length === 0) continue;
    findings.push({
      file,
      line: lineOf(html, m.index),
      role,
      missing,
      tag: fullTag.slice(0, 120),
    });
  }
  return findings;
}

function lineOf(haystack, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < haystack.length; i++) if (haystack.charCodeAt(i) === 10) line++;
  return line;
}

async function main() {
  console.log('=== ARIA Required-Attribute Audit (v7.7.63) — WCAG 4.1.2 Name/Role/Value ===\n');

  const files = walk(ROOT);
  const allFindings = [];
  const roleCounts = new Map();

  for (const file of files) {
    const html = readFileSync(file, 'utf8');
    const findings = findRoleAttributes(html, file);
    // Track usage count for each role found in the codebase (for the report footer).
    const roleRe = /\brole\s*=\s*["']([^"']+)["']/gi;
    let rm;
    while ((rm = roleRe.exec(html)) !== null) {
      const r = rm[1].toLowerCase();
      roleCounts.set(r, (roleCounts.get(r) || 0) + 1);
    }
    allFindings.push(...findings);
  }

  console.log(
    `Scanned ${files.length} source file(s) · ${roleCounts.size} distinct role(s) used · ${allFindings.length} bug(s) with missing required attributes\n`,
  );

  // Group findings by role for the report footer.
  const byRole = new Map();
  for (const f of allFindings) {
    if (!byRole.has(f.role)) byRole.set(f.role, []);
    byRole.get(f.role).push(f);
  }
  if (byRole.size > 0) {
    console.error('Role-attr distribution (only roles with missing attrs are listed):');
    for (const [role, list] of [...byRole.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.error(`  ${role.padEnd(20)} ${list.length} bug(s)`);
    }
    console.error('');
  }

  if (allFindings.length === 0) {
    console.log(
      '✓ Every role="X" element declares the required state attribute(s) per WAI-ARIA 1.2.',
    );
    return;
  }

  console.error(
    `FAIL — ${allFindings.length} role-bearing element(s) with missing required attribute(s):\n`,
  );
  for (const f of allFindings) {
    console.error(`  ✗ ${f.file}:${f.line}  role="${f.role}" missing: ${f.missing.join(', ')}`);
    console.error(`      tag: ${f.tag}…`);
  }
  console.error('\nFix: add the required state attribute(s) per WAI-ARIA 1.2.');
  process.exit(1);
}

main().catch((e) => {
  console.error('aria-required-attr scan crashed:', e);
  process.exit(2);
});
