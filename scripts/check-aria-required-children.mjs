#!/usr/bin/env node
// scripts/check-aria-required-children.mjs
// v7.7.68 — 72nd CI gate
// Catches the WAI-ARIA 1.2 conformance bug class:
// every parent role="X" element MUST own at least one of the required
// child roles "Y" in the same file. Without the children, the a11y tree
// has an empty parent — screen readers either announce "empty group" or
// skip the container entirely, which is a structural correctness
// violation per WAI-ARIA 1.2 (required owned elements).
//
// Reference: https://www.w3.org/TR/wai-aria-1.2/#required_owned_elements
//
// This is the INVERSE of v7.7.67 (aria-required-parent). Together they
// close the structural validation triangle:
//   - v7.7.63 child role needs required state attr
//   - v7.7.67 child role needs required parent role in same file
//   - v7.7.68 parent role needs ≥1 required child role in same file
//
// Required-children mappings (parent → any of children required):
//   - role=list                → listitem
//   - role=tablist             → tab
//   - role=row                 → cell | gridcell | rowheader | columnheader
//   - role=table               → row
//   - role=rowgroup            → row
//   - role=grid                → row
//   - role=treegrid            → row
//   - role=menu                → menuitem | menuitemcheckbox | menuitemradio
//   - role=menubar             → menuitem | menuitemcheckbox | menuitemradio
//   - role=listbox             → option
//   - role=radiogroup          → radio
//   - role=tree                → treeitem | groupitem
//
// Out of scope (documented):
//   - Native HTML elements with implicit roles (e.g., <ul> = list,
//     <select> = listbox, <table> = table). Gate only checks EXPLICIT
//     role="X" attributes. A real <ul> with <li> children doesn't
//     need explicit role attributes.
//   - ARIA owns/controls: this gate doesn't trace aria-owns or
//     aria-controls across element boundaries; the v7.7.67 inverse is
//     "parent in same file", this is "child in same file".
//
// Detection strategy: walk src/**/*.astro + src/pages/**/*.md. For every
// explicit role="X" attribute where X is a PARENT role in REQUIRED_CHILDREN,
// check the same file has ≥1 explicit role="Y" where Y is in REQUIRED_CHILDREN[X].
// If not, flag the empty parent.
//
// Mutation harness:
//   - M1: inject `role="list"` without any role="listitem" → caught.
//   - M2: inject `role="list"` + `role="listitem"` → pass.
//   - M3: positive control (final revert clean).
//
// Usage: node scripts/check-aria-required-children.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
const SCAN_EXT = new Set(['.astro', '.md']);

// Required-children mapping per WAI-ARIA 1.2.
// Each parent role maps to ANY-OF the listed child roles required.
const REQUIRED_CHILDREN = {
  list: ['listitem'],
  tablist: ['tab'],
  row: ['cell', 'gridcell', 'rowheader', 'columnheader'],
  table: ['row'],
  rowgroup: ['row'],
  grid: ['row'],
  treegrid: ['row'],
  menu: ['menuitem', 'menuitemcheckbox', 'menuitemradio'],
  menubar: ['menuitem', 'menuitemcheckbox', 'menuitemradio'],
  listbox: ['option'],
  radiogroup: ['radio'],
  tree: ['treeitem', 'groupitem'],
};

const PARENT_ROLES = new Set(Object.keys(REQUIRED_CHILDREN));

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

// Find every parent role="X" declaration lacking required children.
function findEmptyParents(html, file) {
  const findings = [];
  // Collect all explicit role="X" declarations.
  const roleRe = /\brole\s*=\s*["']([^"']+)["']/gi;
  const declaredRoles = new Map(); // role → [{line, index}]
  let m;
  while ((m = roleRe.exec(html)) !== null) {
    const r = m[1].toLowerCase();
    if (!declaredRoles.has(r)) declaredRoles.set(r, []);
    declaredRoles.get(r).push({ line: lineOf(html, m.index) });
  }

  // For every parent role declared, check ≥1 required child role is present.
  for (const parentRole of PARENT_ROLES) {
    const occurrences = declaredRoles.get(parentRole) || [];
    if (occurrences.length === 0) continue;
    const expectedChildren = REQUIRED_CHILDREN[parentRole];
    const presentChildren = expectedChildren.filter((c) => declaredRoles.has(c));
    if (presentChildren.length === 0) {
      findings.push({
        file,
        parentRole,
        expectedChildren,
        occurrences: occurrences.length,
        firstLine: occurrences[0].line,
      });
    }
  }
  return findings;
}

async function main() {
  console.log('=== ARIA Required-Children Audit (v7.7.68) — WAI-ARIA 1.2 conformance ===\n');

  const files = walk(ROOT);
  const allFindings = [];

  for (const file of files) {
    const html = readFileSync(file, 'utf8');
    const findings = findEmptyParents(html, file);
    allFindings.push(...findings);
  }

  console.log(
    `Scanned ${files.length} source file(s) · ${allFindings.length} empty parent role(s) without required child\n`,
  );

  if (allFindings.length === 0) {
    console.log(
      '✓ Every parent role="X" element has ≥1 corresponding child role="Y" in the same file.',
    );
    return;
  }

  console.error(
    `FAIL — ${allFindings.length} parent role(s) without required child role:\n`,
  );
  for (const f of allFindings) {
    console.error(
      `  ✗ ${f.file}:${f.firstLine}  role="${f.parentRole}" × ${f.occurrences}  (expected ≥1 child: ${f.expectedChildren.join(' | ')})`,
    );
  }
  console.error(
    '\nFix: declare at least one required child role="..." inside the parent container (e.g., role="listitem" inside role="list").',
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('aria-required-children scan crashed:', e);
  process.exit(2);
});