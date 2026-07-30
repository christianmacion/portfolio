#!/usr/bin/env node
// scripts/check-role-attribute-allowed-on-element.mjs
// v7.7.72 — 76th CI gate
// Catches the WAI-ARIA-in-HTML 1.2 conformance bug class:
// every <tag role="X"> element MUST have role="X" in the
// allowed-roles list for that specific HTML tag.
//
// Why:
// Per WAI-ARIA-in-HTML 1.2 (https://www.w3.org/TR/html-aria/), each
// HTML element has a STRICT list of ARIA roles it is allowed to
// carry. If a role outside this list is set, the role is either
// ignored (silent) or — worse — interpreted incorrectly by assistive
// tech. This is a structural conformance violation per WCAG 4.1.2
// Name/Role/Value, and it explains why certain SVG groups and
// <aside> elements sometimes behave unpredictably for screen-reader
// users despite carrying a `role` attribute.
//
// Reference: https://www.w3.org/TR/html-aria/
// Reference: https://www.w3.org/TR/wai-aria-1.2/
//
// Detection strategy: walk src/**/*.astro + src/pages/**/*.md. For
// every `<tag role="X">` opening tag, look up X in the
// HTML_TAG_ROLES table for `tag`. Report any tag+role combo not in
// the table. Generic elements (`div`, `span`) accept ALL roles per
// the ARIA-in-HTML spec, so they are never flagged.
//
// Mutation harness:
//   - M1: inject `<aside role="dialog">x</aside>` (aside forbids dialog) → caught.
//   - M2: inject `<div role="dialog">x</div>` (div allows any role) → pass.
//   - M3: positive control (final revert clean).
//
// Usage: node scripts/check-role-attribute-allowed-on-element.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
const SCAN_EXT = new Set(['.astro', '.md']);

// HTML element → allowed ARIA roles (per WAI-ARIA-in-HTML 1.2).
// `null` means the element is a generic container and accepts any role.
// `Set` membership is case-insensitive (stored lowercase).
const HTML_TAG_ROLES = {
  // Generic containers — accept ANY role per ARIA-in-HTML 1.2 §5.
  div: null,
  span: null,

  // Document landmarks
  header: new Set(['banner', 'none', 'presentation']),
  footer: new Set(['contentinfo', 'none', 'presentation']),
  nav: new Set(['navigation', 'none', 'presentation']),
  main: new Set(['main', 'none', 'presentation']),
  aside: new Set(['complementary', 'region', 'doc-deletion', 'doc-tip', 'none', 'presentation']),
  section: new Set([
    'alert', 'alertdialog', 'application', 'banner', 'complementary',
    'contentinfo', 'definition', 'dialog', 'document', 'feed', 'group',
    'log', 'main', 'marquee', 'navigation', 'none', 'note',
    'presentation', 'region', 'search', 'status', 'tabpanel',
  ]),
  article: new Set([
    'application', 'article', 'banner', 'complementary', 'contentinfo',
    'definition', 'document', 'feed', 'group', 'heading', 'main',
    'navigation', 'none', 'note', 'presentation', 'region', 'search',
    'tabpanel',
  ]),
  address: new Set(['group', 'none', 'presentation']),
  body: new Set(['document', 'none', 'presentation']),
  // h1..h6 collectively
  h1: new Set(['heading', 'none', 'presentation', 'tab', 'treeitem']),
  h2: new Set(['heading', 'none', 'presentation', 'tab', 'treeitem']),
  h3: new Set(['heading', 'none', 'presentation', 'tab', 'treeitem']),
  h4: new Set(['heading', 'none', 'presentation', 'tab', 'treeitem']),
  h5: new Set(['heading', 'none', 'presentation', 'tab', 'treeitem']),
  h6: new Set(['heading', 'none', 'presentation', 'tab', 'treeitem']),

  // Lists
  ul: new Set([
    'directory', 'group', 'list', 'listbox', 'menu', 'menubar', 'none',
    'presentation', 'radiogroup', 'tablist', 'tree',
  ]),
  ol: new Set([
    'directory', 'group', 'list', 'listbox', 'menu', 'menubar', 'none',
    'presentation', 'radiogroup', 'tablist', 'tree',
  ]),
  li: new Set([
    'listitem', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'none',
    'option', 'presentation', 'radio', 'separator', 'tab', 'treeitem',
  ]),
  dl: new Set(['group', 'list', 'none', 'presentation']),
  dt: new Set(['listitem', 'none', 'presentation', 'term']),
  dd: new Set(['definition', 'none', 'presentation']),

  // Tables
  table: new Set(['none', 'presentation', 'table']),
  thead: new Set(['none', 'presentation', 'rowgroup']),
  tbody: new Set(['none', 'presentation', 'rowgroup']),
  tfoot: new Set(['none', 'presentation', 'rowgroup']),
  tr: new Set(['none', 'presentation', 'row']),
  td: new Set(['cell', 'gridcell', 'none', 'presentation']),
  th: new Set(['cell', 'columnheader', 'gridcell', 'none', 'presentation', 'rowheader']),
  caption: new Set(['caption', 'none', 'presentation']),
  col: new Set(['none', 'presentation']),
  colgroup: new Set(['none', 'presentation']),

  // Interactive
  a: new Set([
    'button', 'checkbox', 'link', 'menuitem', 'menuitemcheckbox',
    'menuitemradio', 'none', 'option', 'presentation', 'radio',
    'separator', 'switch', 'tab', 'treeitem',
  ]),
  button: new Set([
    'button', 'checkbox', 'gridcell', 'link', 'menuitem', 'menuitemcheckbox',
    'menuitemradio', 'none', 'option', 'presentation', 'radio', 'separator',
    'switch', 'tab', 'treeitem',
  ]),
  form: new Set(['form', 'none', 'presentation', 'search']),
  label: new Set(['none', 'presentation']),
  select: new Set(['combobox', 'listbox', 'none', 'presentation']),
  option: new Set(['none', 'option', 'presentation']),
  optgroup: new Set(['group', 'none', 'presentation']),
  textarea: new Set(['none', 'presentation', 'textbox']),
  fieldset: new Set(['group', 'none', 'presentation']),
  legend: new Set(['none', 'presentation']),
  details: new Set(['group', 'none', 'presentation']),
  summary: new Set(['button', 'none', 'presentation']),
  dialog: new Set(['alertdialog', 'dialog', 'none', 'presentation']),

  // Inputs (treated as a single bucket — type-specific constraints
  // are runtime-validated, not gated here).
  input: new Set([
    'button', 'checkbox', 'combobox', 'gridcell', 'link', 'menuitem',
    'menuitemcheckbox', 'menuitemradio', 'none', 'option', 'presentation',
    'radio', 'searchbox', 'slider', 'spinbutton', 'switch', 'tab',
    'textbox', 'treeitem',
  ]),

  // Embeds / media
  img: new Set([
    'button', 'checkbox', 'img', 'link', 'menuitem', 'menuitemcheckbox',
    'menuitemradio', 'none', 'option', 'presentation', 'progressbar',
    'radio', 'separator', 'slider', 'switch', 'tab', 'treeitem',
  ]),
  area: new Set(['button', 'link', 'none', 'presentation']),
  iframe: new Set(['application', 'document', 'img', 'none', 'presentation']),
  embed: new Set(['application', 'document', 'img', 'none', 'presentation']),
  object: new Set(['application', 'document', 'img', 'none', 'presentation']),
  video: new Set(['application', 'document', 'img', 'none', 'presentation']),
  audio: new Set(['application', 'document', 'img', 'none', 'presentation']),
  canvas: new Set(['application', 'document', 'img', 'none', 'presentation']),

  // SVG (the most constrained elements — only a handful of roles allowed).
  svg: new Set(['graphics-document', 'img', 'none', 'presentation']),
  g: new Set(['group', 'none', 'presentation']),
  // SVG-a elements accept global roles but not specific ARIA widget roles
  // in general. Keep conservative — only generic roles allowed.
  // (Sub-elements like <rect> <path> etc. inherit from <svg> semantics.)
  rect: new Set(['group', 'none', 'presentation']),
  path: new Set(['group', 'none', 'presentation']),
  circle: new Set(['group', 'none', 'presentation']),
  ellipse: new Set(['group', 'none', 'presentation']),
  polygon: new Set(['group', 'none', 'presentation']),
  polyline: new Set(['group', 'none', 'presentation']),
  line: new Set(['group', 'none', 'presentation']),
  text: new Set(['group', 'none', 'presentation']),
  use: new Set(['group', 'none', 'presentation']),
  defs: new Set(['group', 'none', 'presentation']),
  symbol: new Set(['group', 'none', 'presentation']),
  marker: new Set(['group', 'none', 'presentation']),

  // Status / output
  output: new Set(['none', 'presentation', 'status']),
  progress: new Set(['none', 'presentation', 'progressbar']),
  meter: new Set(['none', 'presentation']),
  time: new Set(['none', 'presentation']),
  mark: new Set(['none', 'presentation']),
  ins: new Set(['none', 'presentation']),
  del: new Set(['none', 'presentation']),

  // Structural
  hr: new Set(['none', 'presentation', 'separator']),
  blockquote: new Set(['none', 'presentation']),
  q: new Set(['none', 'presentation']),
  cite: new Set(['none', 'presentation']),
  code: new Set(['none', 'presentation']),
  pre: new Set(['group', 'none', 'presentation']),
  figure: new Set(['group', 'none', 'presentation']),
  figcaption: new Set(['caption', 'group', 'none', 'presentation']),
  picture: new Set(['none', 'presentation']),

  // Form-associated data elements
  data: new Set(['none', 'presentation']),
  template: new Set(['none', 'presentation']),
  slot: new Set(['none', 'presentation']),

  // Custom elements — accept all roles (runtime-validated).
  // We do not flag custom tags.
};

function lineOf(haystack, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < haystack.length; i++) if (haystack.charCodeAt(i) === 10) line++;
  return line;
}

// Strip comments so role= inside a comment is not flagged.
// Patterns: /* ... */ (block), <!-- ... --> (HTML), {/* ... */} (Astro/JSX).
function stripComments(html) {
  return html
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, ' '));
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, files);
    else if (SCAN_EXT.has(full.slice(full.lastIndexOf('.')))) files.push(full);
  }
  return files;
}

// Find every `<tag role="X">` whose role is NOT in HTML_TAG_ROLES[tag].
// Returns an array of {file, line, tag, role}.
function findRoleViolations(html, file) {
  const findings = [];
  // Tag-bounded regex (same pattern as v7.7.63 / 67 / 68 / 69 / 70 / 71).
  // Captures the entire opening tag attrs up to the first `>`.
  const tagRe = /<\s*([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*?)>/g;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    // Extract role="..." or role='...' (case-insensitive). Use first match.
    const roleMatch = /\brole\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (!roleMatch) continue;
    const role = roleMatch[1].trim().toLowerCase();
    const allowed = HTML_TAG_ROLES[tag];
    if (allowed === undefined) continue; // unknown / custom tag — skip
    if (allowed === null) continue; // generic container — accepts all roles
    if (!allowed.has(role)) {
      findings.push({
        file,
        line: lineOf(html, m.index),
        tag,
        role,
      });
    }
  }
  return findings;
}

async function main() {
  console.log(
    '=== Role-Attribute-Allowed-on-Element Audit (v7.7.72) — WAI-ARIA-in-HTML 1.2 conformance ===\n',
  );

  const files = walk(ROOT);
  const allFindings = [];

  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    const html = stripComments(raw);
    const findings = findRoleViolations(html, file);
    allFindings.push(...findings);
  }

  console.log(
    `Scanned ${files.length} source file(s) · ${allFindings.length} role/element violation(s) (role="..." not in WAI-ARIA-in-HTML allowed list for that tag)\n`,
  );

  if (allFindings.length === 0) {
    console.log(
      '✓ Every role="..." attribute is in the allowed-roles list for its element tag (WAI-ARIA-in-HTML 1.2).',
    );
    return;
  }

  console.error(
    `FAIL — ${allFindings.length} role/element violation(s):\n`,
  );
  for (const f of allFindings) {
    console.error(
      `  ✗ ${f.file}:${f.line}  <${f.tag} role="${f.role}">  — role "${f.role}" is NOT allowed on <${f.tag}> per WAI-ARIA-in-HTML 1.2`,
    );
  }
  console.error(
    '\nFix: either change the role to one in the allowed list for that tag, OR change the tag to one that allows the role.',
  );
  console.error(
    'Reference: https://www.w3.org/TR/html-aria/ (allowed ARIA roles, states and properties for each HTML element)',
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('role-attribute-allowed-on-element scan crashed:', e);
  process.exit(2);
});