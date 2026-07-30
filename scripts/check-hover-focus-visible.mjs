#!/usr/bin/env node
// scripts/check-hover-focus-visible.mjs
// v7.7.62 — 66th CI gate
// Catches the WCAG 2.2 Level AA 2.4.7 Focus Visible bug class:
// every interactive element with a `:hover` style must also have a matching
// `:focus-visible` style so keyboard users get the same visual feedback
// as mouse users.
//
// Detection strategy: walk src/**/*.astro + src/**/*.css. For each rule
// whose selector ends with `:hover`:
//   1. Strip the `:hover` pseudo-class to get the base selector
//   2. Determine if the base selector is interactive (matches a, button,
//      input, select, textarea, summary, [tabindex], [contenteditable],
//      [role=button|tab|switch|menuitem], or class with INTERACTIVE_PATTERNS)
//   3. If interactive, find any `:focus-visible` (or `:focus`) rule whose
//      base selector matches. If none, flag the hover rule as a bug.
//
// Out of scope (documented):
//   - Universal `*:focus-visible` ring declared in global.css is
//     sufficient fallback for interactive elements without a
//     component-specific rule — but only if the hover rule doesn't
//     visually restyle the element beyond the universal ring. Gate
//     treats this case as PASS if global.css:204 has the universal rule.
//   - Hover on non-interactive selectors (div, span, h1, h2, p, etc.)
//     are decorative animations, not focus-visible bugs.
//
// Allow-list (known-safe patterns):
//   - Hover-only animations on decorative chrome (line draws, marquee,
//     ticker pulse) — these elements are NOT focusable, so they don't
//     need focus-visible. Gate already filters by interactive detection.
//
// Mutation harness:
//   - M1: inject `:hover { color: var(--c-amber) }` on a known
//     interactive selector without matching focus-visible → caught.
//   - M2: inject the matching `:focus-visible { color: var(--c-amber) }`
//     → pass (no longer a bug).
//   - M3: positive control (final revert clean).
//
// Usage: node scripts/check-hover-focus-visible.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
const SCAN_EXT = new Set(['.astro', '.css']);

const INTERACTIVE_TAGS = new Set([
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  'details',
]);

const INTERACTIVE_ROLES = new Set([
  'button',
  'tab',
  'switch',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'checkbox',
  'link',
  'treeitem',
]);

// Pseudo-classes that, when present in a selector, indicate the element IS focusable.
const FOCUSABLE_ATTRS = ['tabindex', 'contenteditable', 'draggable'];

// Decorative class fragments — skip these even if they match interactive patterns.
const DECORATIVE_FRAGMENTS = [
  'swatch',
  'pill',
  'badge',
  'cap',
  'indicator',
  'marker',
  'dot',
  '__thumb',
  'legend',
  'tag',
  '__label',
  '__text',
];

// Interactive class patterns (from target-size gate).
const INTERACTIVE_PATTERNS = [
  'btn',
  'button',
  'chip',
  'toggle',
  'switch',
  'menu-btn',
  'icon-btn',
  'link-btn',
  'nav-btn',
  'nav-toggle',
  'back-to-top',
  'summary',
  'card', // .workbook-card hover often needs focus
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

// Strip `:hover` from the END of a selector (last token).
// Returns the base selector (without `:hover`) or null if selector doesn't end with :hover.
function stripHover(selector) {
  const trimmed = selector.trim();
  // Replace ":hover" at end (possibly preceded by other pseudo-classes)
  const re = /([,>\s]|^)([^{]+?):hover\s*$/i;
  const m = trimmed.match(re);
  if (!m) return null;
  return (m[2] + '').trim();
}

function isInteractiveBase(baseSelector) {
  const sel = baseSelector.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  // Last token — same approach as target-size gate
  const lastTok = sel.split(/\s+/).pop() || '';
  // Bare interactive tag?
  const bare = lastTok.replace(/[:.[#].*$/, ''); // strip pseudo-classes / classes / ids
  if (INTERACTIVE_TAGS.has(bare.toLowerCase())) return true;
  // [tabindex], [contenteditable], [role=...]
  for (const a of FOCUSABLE_ATTRS) if (lastTok.includes(`[${a}=`)) return true;
  if (/\[role=/i.test(lastTok)) {
    const roleMatch = lastTok.match(/\[role=["']?([^"'\\s\\]]+)/i);
    if (roleMatch && INTERACTIVE_ROLES.has(roleMatch[1].toLowerCase())) return true;
  }
  // Decorative class fragment in LAST token? → skip
  for (const frag of DECORATIVE_FRAGMENTS) {
    const re = new RegExp(`(?:^|[^a-zA-Z0-9_])${frag}(?:$|[^a-zA-Z0-9_])`, 'i');
    if (re.test(lastTok)) return false;
  }
  // Interactive class pattern in LAST token?
  for (const p of INTERACTIVE_PATTERNS) {
    const re = new RegExp(`(?:^|[^a-zA-Z0-9_])${p}(?:$|[^a-zA-Z0-9_])`, 'i');
    if (re.test(lastTok)) return true;
  }
  return false;
}

// Parse CSS declarations inside one `{ ... }` rule body.
function parseDecls(body) {
  const decls = {};
  const cleaned = body.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([a-z-]+)\s*:\s*([^;]+);/gi;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    decls[m[1].toLowerCase().trim()] = m[2].trim();
  }
  return decls;
}

// Collect every CSS rule from <style> blocks + .css files.
// Returns array of {file, line, selector, decls}.
function collectRules(files) {
  const rules = [];
  for (const file of files) {
    const html = readFileSync(file, 'utf8');
    const styleRanges = [];
    if (file.endsWith('.css')) {
      styleRanges.push([0, html.length]);
    } else {
      const re = /<style[^>]*>([\s\S]*?)<\/style>/g;
      let m;
      while ((m = re.exec(html)) !== null) {
        styleRanges.push([
          m.index + m[0].indexOf('>') + 1,
          m.index + m[0].length - '</style>'.length,
        ]);
      }
    }
    for (const [start, end] of styleRanges) {
      const css = html.slice(start, end);
      // Strip CSS comments BEFORE brace-matching so `{` / `}` inside a
      // /* ... */ block don't terminate the parser early.
      const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
      let i = 0;
      while (i < cssNoComments.length) {
        const braceIdx = cssNoComments.indexOf('{', i);
        if (braceIdx === -1) break;
        const selector = cssNoComments.slice(i, braceIdx).trim();
        const closeIdx = cssNoComments.indexOf('}', braceIdx);
        if (closeIdx === -1) break;
        const body = cssNoComments.slice(braceIdx + 1, closeIdx);
        // Use original-css byte offset for line numbers — we know comments
        // were replaced with single spaces (same length as `/* */` min),
        // so positions in cssNoComments up to comment start are valid.
        rules.push({
          file,
          line: lineOf(html, start + braceIdx),
          selector,
          decls: parseDecls(body),
        });
        i = closeIdx + 1;
      }
    }
  }
  return rules;
}

function selectorsOf(ruleSelector) {
  return ruleSelector
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Normalize a selector for matching: strip trailing pseudo-classes, lowercase tag.
function normalizeBase(sel) {
  return sel
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(
      /::?(hover|focus|focus-visible|active|focus-within|disabled|visited|checked)\b[^,{]*$/i,
      '',
    )
    .trim();
}

async function main() {
  console.log('=== Hover-without-Focus-Visible Audit (v7.7.62) — WCAG 2.4.7 Focus Visible ===\n');

  const files = walk(ROOT);
  const rules = collectRules(files);

  // Index: for each base selector, what focus / focus-visible rules exist?
  const focusMap = new Map(); // baseSelector → Set(file:line)
  for (const rule of rules) {
    for (const sel of selectorsOf(rule.selector)) {
      if (/:focus(?:-visible)?\b/i.test(sel)) {
        const base = normalizeBase(sel);
        if (!base) continue;
        if (!focusMap.has(base)) focusMap.set(base, []);
        focusMap.get(base).push(`${rule.file}:${rule.line}`);
      }
    }
  }

  // Universal *:focus-visible declared?
  const universalFocusVisible = rules.some(
    (r) =>
      /\*:focus-visible\b/i.test(r.selector) && /outline/i.test(Object.keys(r.decls).join(' ')),
  );

  // Hover rules that introduce VISUAL CHANGES (color, background, border,
  // transform, opacity, filter, box-shadow). These cannot be fully mitigated
  // by the universal outline alone — keyboard users should see the same
  // visual restyling as mouse users.
  const VISUAL_DECL_KEYS = [
    'color',
    'background',
    'background-color',
    'border',
    'border-color',
    'border-top-color',
    'border-right-color',
    'border-bottom-color',
    'border-left-color',
    'outline',
    'outline-color',
    'box-shadow',
    'transform',
    'opacity',
    'filter',
    'text-decoration',
    'text-decoration-color',
  ];
  function hasVisualChange(decls) {
    return VISUAL_DECL_KEYS.some((k) => k in decls);
  }

  // Walk hover rules.
  const findings = [];
  const reviewed = new Set();
  for (const rule of rules) {
    for (const sel of selectorsOf(rule.selector)) {
      const base = stripHover(sel);
      if (!base) continue;
      const baseNorm = normalizeBase(base);
      if (!baseNorm) continue;
      if (!isInteractiveBase(baseNorm)) continue;
      reviewed.add(baseNorm);
      const focusLocs = focusMap.get(baseNorm) || [];
      const visualChange = hasVisualChange(rule.decls);
      // Universal ring alone mitigates ONLY if the hover rule introduces no
      // visual change beyond the outline (i.e., it's a focus-state fallback
      // for plain pointer cursors or transparent transitions).
      if (focusLocs.length === 0 && !(universalFocusVisible && !visualChange)) {
        findings.push({
          file: rule.file,
          line: rule.line,
          hoverSelector: sel,
          baseSelector: baseNorm,
          hoverDecls: rule.decls,
        });
      }
    }
  }

  console.log(
    `Scanned ${files.length} source file(s) · ${reviewed.size} interactive :hover rule(s) · ${findings.length} candidate(s) without :focus-visible\n`,
  );

  if (universalFocusVisible) {
    console.log(
      '  ✓ Universal *:focus-visible ring declared — mitigates hover rules WITHOUT visual change (color/bg/border/transform).\n',
    );
  }

  if (findings.length === 0) {
    console.log('✓ All interactive :hover rules have matching :focus-visible (or universal ring).');
    return;
  }

  console.error(
    `FAIL — ${findings.length} interactive :hover rule(s) without matching :focus-visible:\n`,
  );
  for (const f of findings) {
    console.error(`  ✗ ${f.file}:${f.line}  ${f.hoverSelector}`);
    console.error(`      base: ${f.baseSelector}`);
    console.error(
      `      hover decls: ${JSON.stringify({ color: f.hoverDecls['color'], 'background-color': f.hoverDecls['background-color'], 'border-color': f.hoverDecls['border-color'], transform: f.hoverDecls['transform'] })}\n`,
    );
  }
  console.error(
    'Fix: add a `:focus-visible` rule with the same visual restyling (color, background, border, transform) as the `:hover` rule. Keyboard users get the same feedback as mouse users.',
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('hover-focus-visible scan crashed:', e);
  process.exit(2);
});
