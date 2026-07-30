#!/usr/bin/env node
// scripts/check-aria-hidden-focusable.mjs
// v7.7.64 — 68th CI gate
// Catches the WCAG 2.2 Level AA 4.1.2 Name/Role/Value bug class:
// elements with `aria-hidden="true"` must NOT be focusable. Keyboard users
// would tab to an element that screen readers have removed from the a11y
// tree — they get focus on nothing.
//
// Detection strategy: walk src/**/*.astro + src/pages/**/*.md. For every
// opening tag that declares `aria-hidden="true"`, check if it ALSO
// declares any focusable signal:
//   - Interactive tag: a, button, input, select, textarea, summary, iframe
//   - tabindex attribute (any value, even tabindex="-1" — see note below)
//   - contenteditable attribute
//   - role="button" | "link" | "tab" | "switch" | "checkbox" | "radio" |
//     "menuitem" | "option" | "treeitem" | "combobox" | "searchbox" |
//     "slider" | "spinbutton"
//
// Note on tabindex="-1":
//   The gate flags ANY tabindex declaration alongside aria-hidden, even
//   tabindex="-1", because the safer pattern is to remove tabindex entirely
//   when the element is hidden. But the gate's allow-list (below) accepts
//   tabindex="-1" with a class-name justification.
//
// Allow-list (known-safe patterns):
//   - `.nav__toggle-input` (Nav.astro:118) — visually-hidden checkbox used
//     as a CSS hook for the hamburger menu; styled `display: none` so not
//     focusable. The `<label>` next to it is the focusable element.
//
// Mutation harness:
//   - M1: inject `<button aria-hidden="true">x</button>` → caught.
//   - M2: positive control (final revert clean).
//
// Usage: node scripts/check-aria-hidden-focusable.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
const SCAN_EXT = new Set(['.astro', '.md']);

// Tag names that are inherently focusable.
const INTERACTIVE_TAGS = new Set([
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  'iframe',
  'video',
  'audio',
]);

// role="X" values that are focusable.
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'tab',
  'switch',
  'checkbox',
  'radio',
  'menuitem',
  'option',
  'treeitem',
  'combobox',
  'searchbox',
  'slider',
  'spinbutton',
]);

// Allow-list: class names that are styled `display: none` (so not actually
// focusable in practice). Gate warns but does not fail on these. Each entry
// must have a one-line justification.
const ALLOWLIST = [
  {
    pattern: /class="[^"]*\bnav__toggle-input\b/i,
    why: 'Nav.astro:118 — visually-hidden checkbox CSS hook for hamburger menu (display: none)',
  },
];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, files);
    else if (SCAN_EXT.has(full.slice(full.lastIndexOf('.')))) files.push(full);
  }
  return files;
}

function lineOf(haystack, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < haystack.length; i++) if (haystack.charCodeAt(i) === 10) line++;
  return line;
}

// Match every opening tag. Find those with aria-hidden="true" and
// check for co-declared focusable signals.
function findAriaHiddenFocusable(html, file) {
  const findings = [];
  const warnings = [];
  // Regex: every opening tag, bounded by first `>`.
  const tagRe = /<\s*([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const fullTag = m[0];
    const tagName = m[1].toLowerCase();
    const attrs = m[2];
    // aria-hidden="true" present?
    if (!/\baria-hidden\s*=\s*["']true["']/i.test(attrs)) continue;

    // Check focusable signals.
    const focusableSignals = [];

    // 1. Interactive tag?
    if (INTERACTIVE_TAGS.has(tagName)) {
      focusableSignals.push(`tag:<${tagName}>`);
    }

    // 2. tabindex?
    const tabMatch = attrs.match(/\btabindex\s*=\s*["']([^"']+)["']/i);
    if (tabMatch) {
      focusableSignals.push(`tabindex="${tabMatch[1]}"`);
    }

    // 3. contenteditable?
    if (/\bcontenteditable\s*=\s*["']?(?:true|"true")/i.test(attrs)) {
      focusableSignals.push('contenteditable');
    }

    // 4. role="..."?
    const roleMatch = attrs.match(/\brole\s*=\s*["']([^"']+)["']/i);
    if (roleMatch && INTERACTIVE_ROLES.has(roleMatch[1].toLowerCase())) {
      focusableSignals.push(`role="${roleMatch[1]}"`);
    }

    if (focusableSignals.length === 0) continue;

    // Check allow-list.
    const allow = ALLOWLIST.find((a) => a.pattern.test(fullTag));

    const finding = {
      file,
      line: lineOf(html, m.index),
      tag: fullTag.slice(0, 200),
      signals: focusableSignals,
      allowlisted: !!allow,
      allowReason: allow?.why,
    };
    if (allow) {
      warnings.push(finding);
    } else {
      findings.push(finding);
    }
  }
  return { findings, warnings };
}

async function main() {
  console.log('=== ARIA-Hidden Focusable Audit (v7.7.64) — WCAG 4.1.2 Name/Role/Value ===\n');

  const files = walk(ROOT);
  const allFindings = [];
  const allWarnings = [];

  for (const file of files) {
    const html = readFileSync(file, 'utf8');
    const { findings, warnings } = findAriaHiddenFocusable(html, file);
    allFindings.push(...findings);
    allWarnings.push(...warnings);
  }

  console.log(
    `Scanned ${files.length} source file(s) · ${allFindings.length} bug(s) · ${allWarnings.length} allow-listed (known-safe)\n`,
  );

  if (allWarnings.length > 0) {
    console.log('Allow-listed (styled display:none, not actually focusable):');
    for (const w of allWarnings) {
      console.log(`  · ${w.file}:${w.line} — ${w.allowReason}`);
    }
    console.log('');
  }

  if (allFindings.length === 0) {
    console.log('✓ No aria-hidden="true" elements are focusable.');
    return;
  }

  console.error(
    `FAIL — ${allFindings.length} aria-hidden="true" element(s) with focusable signal(s):\n`,
  );
  for (const f of allFindings) {
    console.error(`  ✗ ${f.file}:${f.line}`);
    console.error(`      tag: ${f.tag}…`);
    console.error(`      focusable signals: ${f.signals.join(', ')}`);
  }
  console.error(
    '\nFix: if the element is decorative, set `display: none` (or `inert`) on it. If you genuinely need the focusable behavior, drop `aria-hidden="true"`.',
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('aria-hidden-focusable scan crashed:', e);
  process.exit(2);
});
