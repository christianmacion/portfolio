#!/usr/bin/env node
// scripts/check-aria-required-parent.mjs
// v7.7.67 — 71st CI gate
// Catches the WAI-ARIA 1.2 conformance bug class:
// every child role="X" element must have a corresponding parent role="Y"
// element in the same file. Without the parent, the a11y tree has an
// orphan child — screen readers either announce "orphan role X" or
// skip it entirely.
//
// Reference: https://www.w3.org/TR/wai-aria-1.2/ (required owned elements).
//
// Required parent mappings:
//   - role=listitem       → parent role=list
//   - role=tab            → parent role=tablist
//   - role=cell           → parent role=row
//   - role=gridcell       → parent role=row (within grid)
//   - role=row            → parent role=table | rowgroup | grid | treegrid
//   - role=rowheader      → parent role=row
//   - role=columnheader   → parent role=row
//   - role=menuitem       → parent role=menu | menubar
//   - role=menuitemcheckbox → parent role=menu | menubar
//   - role=menuitemradio  → parent role=menu | menubar
//   - role=option         → parent role=listbox | group
//   - role=treeitem       → parent role=tree
//
// Out of scope (documented):
//   - Native HTML <table>/<ul>/<ol>/<select>/<nav> elements that have
//     implicit role assignments — gate only checks EXPLICIT role="X"
//     attributes. <tr> inside <table> doesn't need explicit roles.
//
// Detection strategy: walk src/**/*.astro + src/pages/**/*.md. For every
// explicit role="X" attribute where X is in CHILD_ROLES, check that the
// same file has at least one explicit parent role="Y" where Y is in
// REQUIRED_PARENT[X]. If not, flag the orphan.
//
// Mutation harness:
//   - M1: inject `role="listitem"` without parent role="list" → caught.
//   - M2: inject both `role="list"` + `role="listitem"` → pass.
//   - M3: positive control (final revert clean).
//
// Usage: node scripts/check-aria-required-parent.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
const SCAN_EXT = new Set(['.astro', '.md']);

// Required-parent mapping per WAI-ARIA 1.2.
const REQUIRED_PARENT = {
  listitem: ['list'],
  tab: ['tablist'],
  cell: ['row'],
  gridcell: ['row'],
  row: ['table', 'rowgroup', 'grid', 'treegrid'],
  rowheader: ['row'],
  columnheader: ['row'],
  menuitem: ['menu', 'menubar'],
  menuitemcheckbox: ['menu', 'menubar'],
  menuitemradio: ['menu', 'menubar'],
  option: ['listbox', 'group'],
  treeitem: ['tree'],
};

const CHILD_ROLES = new Set(Object.keys(REQUIRED_PARENT));

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

// Find every explicit role="X" attribute in the file. Track which parent
// roles are declared anywhere in the same file. Flag child roles whose
// parent set is missing.
function findOrphanRoles(html, file) {
  const findings = [];
  // Collect all explicit role="X" declarations and their line numbers.
  const roleRe = /\brole\s*=\s*["']([^"']+)["']/gi;
  const declaredRoles = new Map(); // role → [{line, index}]
  let m;
  while ((m = roleRe.exec(html)) !== null) {
    const r = m[1].toLowerCase();
    if (!declaredRoles.has(r)) declaredRoles.set(r, []);
    declaredRoles.get(r).push({ line: lineOf(html, m.index) });
  }

  // For every child role declared, check parent role(s) are present.
  for (const childRole of CHILD_ROLES) {
    const occurrences = declaredRoles.get(childRole) || [];
    if (occurrences.length === 0) continue;
    const expectedParents = REQUIRED_PARENT[childRole];
    const hasParent = expectedParents.some((p) => declaredRoles.has(p));
    if (!hasParent) {
      findings.push({
        file,
        role: childRole,
        expectedParents: expectedParents,
        occurrences: occurrences.length,
        firstLine: occurrences[0].line,
      });
    }
  }
  return findings;
}

async function main() {
  console.log('=== ARIA Required-Parent Audit (v7.7.67) — WAI-ARIA 1.2 conformance ===\n');

  const files = walk(ROOT);
  const allFindings = [];

  for (const file of files) {
    const html = readFileSync(file, 'utf8');
    const findings = findOrphanRoles(html, file);
    allFindings.push(...findings);
  }

  console.log(
    `Scanned ${files.length} source file(s) · ${allFindings.length} orphan child role(s) without parent\n`,
  );

  if (allFindings.length === 0) {
    console.log(
      '✓ Every child role="X" element has a corresponding parent role="Y" in the same file.',
    );
    return;
  }

  console.error(
    `FAIL — ${allFindings.length} child role(s) without required parent role:\n`,
  );
  for (const f of allFindings) {
    console.error(
      `  ✗ ${f.file}:${f.firstLine}  role="${f.role}" × ${f.occurrences}  (expected parent: ${f.expectedParents.join(' | ')})`,
    );
  }
  console.error(
    '\nFix: declare the parent role="..." on the container element (e.g., role="table" wrapper for role="row" / role="cell").',
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('aria-required-parent scan crashed:', e);
  process.exit(2);
});
