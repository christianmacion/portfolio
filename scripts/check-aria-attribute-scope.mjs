#!/usr/bin/env node
// scripts/check-aria-attribute-scope.mjs
// v7.7.73 — 77th CI gate
// Catches the WAI-ARIA 1.2 conformance bug class:
// every aria-* attribute MUST be used only on elements/roles where it
// is defined per ARIA 1.2 — i.e., the attribute must be in the
// "scope" of the element's tag-or-role.
//
// Why:
// ARIA 1.2 defines which attributes are valid on which roles. Using an
// attribute outside its scope either silently has no effect or — worse
// — is misinterpreted by assistive tech. This is a structural
// conformance violation per WCAG 4.1.2 Name/Role/Value, and it
// explains why some aria-* usages "look right in source" but never
// reach the user.
//
// Reference: https://www.w3.org/TR/wai-aria-1.2/#states_and_properties
// Reference: https://www.w3.org/TR/wai-aria-1.2/#aria-modal
// Reference: https://www.w3.org/TR/wai-aria-1.2/#aria-pressed
// Reference: https://www.w3.org/TR/wai-aria-1.2/#aria-selected
//
// Companion to v7.7.72 (role-attribute-allowed-on-element). Together
// they cover the full ARIA placement surface:
//   - v7.7.72: every <tag role="X"> must have role="X" allowed for that tag
//   - v7.7.73: every aria-ATTR must be allowed for the element's tag-or-role
//
// Mutation harness:
//   - M1: inject `<span aria-pressed="true">x</span>` (aria-pressed only on button) → caught.
//   - M2: inject `<button aria-pressed="true">x</button>` → pass.
//   - M3: positive control (final revert clean).
//
// Usage: node scripts/check-aria-attribute-scope.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
const SCAN_EXT = new Set(['.astro', '.md']);

// ARIA 1.2 attribute scope: which ROLES (or `*` for any) an aria-* attribute
// may be used on. Native HTML elements map to their implicit roles:
//   - <button> → role="button"
//   - <a href> → role="link"
//   - <input> depends on type
//   - <textarea> → role="textbox"
//   - <select> → role="combobox"
//   - <option> → role="option"
//   - <h1>-<h6> → role="heading"
//   - <nav> → role="navigation"
//   - <main> → role="main"
//   - <aside> → role="complementary"
//   - <header> → role="banner"
//   - <footer> → role="contentinfo"
//   - <li> → role="listitem"
//   - <tr> → role="row"
//   - <th> → role="columnheader"
//   - <td> → role="cell"
//   - <dialog> → role="dialog"
//   - <output> → role="status"
//   - <progress> → role="progressbar"
//   - <summary> → role="button"
//   - <input type="checkbox|radio"> → role="checkbox|radio"
//
// For each aria-* attr, `null` means any role is allowed (universal);
// `Set` membership is the allowlist of roles.
const ATTR_SCOPE = {
  // Pressed — only button (native or role).
  'aria-pressed': new Set(['button']),

  // Selected — option, tab, treeitem, gridcell, row, columnheader, rowheader.
  'aria-selected': new Set([
    'gridcell', 'option', 'row', 'tab', 'columnheader', 'rowheader', 'treeitem',
  ]),

  // Checked — checkbox, radio, switch, menuitemcheckbox, option, treeitem.
  'aria-checked': new Set([
    'checkbox', 'menuitemcheckbox', 'option', 'radio', 'switch', 'treeitem',
  ]),

  // Modal — dialog (or alertdialog).
  'aria-modal': new Set(['dialog', 'alertdialog']),

  // Level — heading, listitem, row, tab, treeitem.
  'aria-level': new Set(['heading', 'listitem', 'row', 'tab', 'treeitem']),

  // Sort — columnheader, rowheader.
  'aria-sort': new Set(['columnheader', 'rowheader']),

  // Multiline — textbox only.
  'aria-multiline': new Set(['textbox']),

  // Posinset / setsize — listitem, menuitem, menuitemcheckbox, menuitemradio,
  // option, radio, tab, treeitem, etc.
  'aria-posinset': new Set([
    'article', 'listitem', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
    'option', 'radio', 'row', 'tab', 'treeitem',
  ]),
  'aria-setsize': new Set([
    'article', 'listitem', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
    'option', 'radio', 'row', 'tab', 'treeitem',
  ]),

  // Value attributes — progressbar, scrollbar, separator, slider, spinbutton.
  'aria-valuenow': new Set([
    'progressbar', 'scrollbar', 'separator', 'slider', 'spinbutton',
  ]),
  'aria-valuemin': new Set([
    'progressbar', 'scrollbar', 'separator', 'slider', 'spinbutton',
  ]),
  'aria-valuemax': new Set([
    'progressbar', 'scrollbar', 'separator', 'slider', 'spinbutton',
  ]),
  'aria-valuetext': new Set([
    'progressbar', 'scrollbar', 'separator', 'slider', 'spinbutton',
  ]),

  // Readonly / required — form-field roles.
  'aria-readonly': new Set([
    'checkbox', 'combobox', 'grid', 'gridcell', 'listbox', 'radiogroup',
    'slider', 'spinbutton', 'textbox', 'tree', 'treegrid', 'columnheader',
    'rowheader', 'treeitem',
  ]),
  'aria-required': new Set([
    'checkbox', 'combobox', 'grid', 'gridcell', 'listbox', 'radiogroup',
    'spinbutton', 'textbox', 'tree', 'treegrid', 'columnheader',
    'rowheader', 'treeitem',
  ]),

  // Multiselectable — grid, listbox, tablist, tree, treegrid.
  'aria-multiselectable': new Set([
    'grid', 'listbox', 'tablist', 'tree', 'treegrid',
  ]),

  // Grabbed (deprecated but still scoped) — separator, treeitem.
  'aria-grabbed': new Set(['separator', 'treeitem']),

  // Haspopup — button, combobox, menu, menuitem, menuitemcheckbox,
  // menuitemradio, radio, slider, tab, textbox, tree, treeitem.
  'aria-haspopup': new Set([
    'button', 'combobox', 'menu', 'menuitem', 'menuitemcheckbox',
    'menuitemradio', 'radio', 'slider', 'tab', 'textbox', 'tree', 'treeitem',
  ]),

  // Expanded — many roles.
  'aria-expanded': new Set([
    'alert', 'application', 'button', 'cell', 'checkbox', 'combobox',
    'dialog', 'disclosure', 'gridcell', 'heading', 'link', 'listbox',
    'menu', 'menubar', 'menuitem', 'radio', 'row', 'rowgroup', 'tab',
    'tree', 'treegrid', 'treeitem',
  ]),

  // Orientation — many roles.
  'aria-orientation': new Set([
    'alert', 'article', 'banner', 'complementary', 'contentinfo',
    'definition', 'directory', 'document', 'feed', 'form', 'group',
    'img', 'list', 'listbox', 'log', 'main', 'marquee', 'math',
    'menu', 'menubar', 'navigation', 'none', 'note', 'presentation',
    'radiogroup', 'region', 'row', 'rowgroup', 'scrollbar', 'search',
    'separator', 'slider', 'spinbutton', 'status', 'tab', 'tablist',
    'tabpanel', 'term', 'timer', 'toolbar', 'tree', 'treegrid',
    'treeitem', 'combobox', 'menuitem', 'menuitemcheckbox',
    'menuitemradio', 'progressbar',
  ]),

  // Live-region attrs — all elements (default values), no scope check.
  'aria-atomic': null,
  'aria-busy': null,
  'aria-live': null,
  'aria-relevant': null,
  'aria-hidden': null,
  'aria-current': null,
  'aria-disabled': null,
  'aria-dropeffect': null,
  'aria-keyshortcuts': null,
  'aria-roledescription': null,
  'aria-flowto': null,
  'aria-labelledby': null,
  'aria-describedby': null,
  'aria-controls': null,
  'aria-errormessage': null,
  'aria-activedescendant': null,
  'aria-details': null,
  'aria-describedat': null,
  'aria-label': null,
};

// Map native HTML tags to their implicit ARIA roles.
const NATIVE_ROLE = {
  a: 'link',
  button: 'button',
  textarea: 'textbox',
  select: 'combobox',
  option: 'option',
  nav: 'navigation',
  main: 'main',
  aside: 'complementary',
  header: 'banner',
  footer: 'contentinfo',
  li: 'listitem',
  tr: 'row',
  th: 'columnheader',
  td: 'cell',
  dialog: 'dialog',
  output: 'status',
  progress: 'progressbar',
  summary: 'button',
};

// HTML <input> types → role.
const INPUT_ROLE = {
  button: 'button',
  checkbox: 'checkbox',
  color: 'textbox',
  date: 'textbox',
  'datetime-local': 'textbox',
  email: 'textbox',
  file: 'button',
  hidden: null, // hidden inputs are not in the accessibility tree
  image: 'button',
  month: 'textbox',
  number: 'spinbutton',
  password: 'textbox',
  radio: 'radio',
  range: 'slider',
  reset: 'button',
  search: 'searchbox',
  submit: 'button',
  tel: 'textbox',
  text: 'textbox',
  time: 'textbox',
  url: 'textbox',
  week: 'textbox',
};

function lineOf(haystack, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < haystack.length; i++) if (haystack.charCodeAt(i) === 10) line++;
  return line;
}

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

// Find every opening tag carrying an aria-* attribute that is OUTSIDE
// the attribute's allowed scope. Returns array of {file, line, tag, attr, role}.
function findAriaScopeViolations(html, file) {
  const findings = [];
  const tagRe = /<\s*([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*?)>/g;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];

    // Compute the effective role for this element.
    // Order of precedence: explicit role="..." > native role (tag + input type).
    const explicitRoleMatch = /\brole\s*=\s*["']([^"']+)["']/i.exec(attrs);
    let role;
    if (explicitRoleMatch) {
      role = explicitRoleMatch[1].trim().toLowerCase();
    } else if (tag === 'input') {
      const typeMatch = /\btype\s*=\s*["']([^"']+)["']/i.exec(attrs);
      const t = typeMatch ? typeMatch[1].toLowerCase() : 'text';
      // hidden inputs are out of scope
      if (t === 'hidden') continue;
      role = INPUT_ROLE[t] || null;
    } else {
      role = NATIVE_ROLE[tag] || null;
    }

    // If we can't determine a role (generic div/span without role=),
    // the element still has ARIA semantics — but a scoped attribute
    // (e.g., aria-pressed) requires a SPECIFIC role. Generic
    // containers with no role= do NOT match aria-pressed/aria-selected
    // /aria-modal scope, so they should be flagged.
    //
    // For universal attributes (null scope), any role is fine.

    // For each aria-* attr, check scope.
    const ariaRe = /\b(aria-[a-z0-9-]+)\s*=\s*["'][^"']*["']/gi;
    let am;
    while ((am = ariaRe.exec(attrs)) !== null) {
      const attr = am[1].toLowerCase();
      const allowedRoles = ATTR_SCOPE[attr];
      if (allowedRoles === undefined) continue; // unknown attr — not in scope table
      if (allowedRoles === null) continue; // universal attribute — any role OK
      // scoped attribute — element's effective role must be in the allowlist.
      // If role === null (generic div/span with no role=), it is NOT in
      // any scoped allowlist unless we explicitly treat generic as 'generic'.
      if (role === null) {
        findings.push({
          file,
          line: lineOf(html, m.index),
          tag,
          role: 'generic',
          attr,
        });
        continue;
      }
      if (!allowedRoles.has(role)) {
        findings.push({
          file,
          line: lineOf(html, m.index),
          tag,
          role,
          attr,
        });
      }
    }
  }
  return findings;
}

async function main() {
  console.log(
    '=== ARIA Attribute-Scope Audit (v7.7.73) — WAI-ARIA 1.2 conformance ===\n',
  );

  const files = walk(ROOT);
  const allFindings = [];

  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    const html = stripComments(raw);
    const findings = findAriaScopeViolations(html, file);
    allFindings.push(...findings);
  }

  console.log(
    `Scanned ${files.length} source file(s) · ${allFindings.length} aria-attribute scope violation(s) (aria-ATTR used on element/role outside its ARIA 1.2 scope)\n`,
  );

  if (allFindings.length === 0) {
    console.log(
      '✓ Every aria-* attribute is in scope for its element/role per WAI-ARIA 1.2.',
    );
    return;
  }

  console.error(
    `FAIL — ${allFindings.length} aria-attribute scope violation(s):\n`,
  );
  for (const f of allFindings) {
    console.error(
      `  ✗ ${f.file}:${f.line}  <${f.tag} role="${f.role}">  ${f.attr}="..."  — ${f.attr} is NOT in scope for role "${f.role}" per WAI-ARIA 1.2`,
    );
  }
  console.error(
    '\nFix: either move the attribute to an element with a role that allows it, or remove the attribute.',
  );
  console.error(
    'Reference: https://www.w3.org/TR/wai-aria-1.2/#states_and_properties',
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('aria-attribute-scope scan crashed:', e);
  process.exit(2);
});