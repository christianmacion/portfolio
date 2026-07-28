#!/usr/bin/env node
// scripts/check-aria-idref-target-existence.mjs
// v7.7.71 — 75th CI gate
// Catches the WAI-ARIA 1.2 conformance bug class:
// every aria-{labelledby,describedby,controls,errormessage,activedescendant}
// reference MUST point to an id="..." that exists in the same file.
//
// Why:
// aria-labelledby / aria-describedby / aria-controls / aria-errormessage /
// aria-activedescendant are IDREF attributes. If they reference an ID that
// doesn't exist in the same document, the reference is broken — screen
// readers either silently fall back to no label/description, or fail to
// announce the controlled/active element. This is a structural
// conformance violation per WAI-ARIA 1.2 IDREF specification.
//
// Reference: https://www.w3.org/TR/wai-aria-1.2/#scope-of-references-to-id
// Reference: https://www.w3.org/TR/accname-1.2/#mapping_general_rule
//
// Detection strategy: walk src/**/*.astro + src/pages/**/*.md. For every
// aria-{labelledby,describedby,controls,errormessage,activedescendant}="..."
// attribute, verify the referenced ID exists as id="..." in the same file.
// Multiple IDs (space-separated) are checked individually.
//
// Companion to v7.7.56 (duplicate-id-presence). Together they cover the
// ID integrity surface:
//   - v7.7.56: detect duplicate IDs in same document
//   - v7.7.71: detect IDREF references to non-existent IDs
//
// Mutation harness:
//   - M1: inject `<div aria-labelledby="bogus-id">x</div>` (no matching id) → caught.
//   - M2: inject `<h2 id="real-id">x</h2><div aria-labelledby="real-id">y</div>` → pass.
//   - M3: positive control (final revert clean).
//
// Usage: node scripts/check-aria-idref-target-existence.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
const SCAN_EXT = new Set(['.astro', '.md']);

// IDREF attributes per WAI-ARIA 1.2.
const IDREF_ATTRS = [
  'aria-labelledby',
  'aria-describedby',
  'aria-controls',
  'aria-errormessage',
  'aria-activedescendant',
];

function lineOf(haystack, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < haystack.length; i++) if (haystack.charCodeAt(i) === 10) line++;
  return line;
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

// Collect all id="..." declarations in the file.
function collectIds(html) {
  const ids = new Set();
  const idRe = /\bid\s*=\s*["']([^"']+)["']/g;
  let m;
  while ((m = idRe.exec(html)) !== null) {
    ids.add(m[1]);
  }
  return ids;
}

// Find every IDREF reference whose target does not exist as id="..." in same file.
function findBrokenIdrefs(html, file) {
  const findings = [];
  const declaredIds = collectIds(html);
  // Build a regex matching any of the IDREF attrs.
  const idrefRe = new RegExp(
    `\\b(${IDREF_ATTRS.join('|')})\\s*=\\s*["']([^"']+)["']`,
    'gi',
  );
  let m;
  while ((m = idrefRe.exec(html)) !== null) {
    const attr = m[1].toLowerCase();
    const refList = m[2].trim().split(/\s+/).filter(Boolean);
    const missing = refList.filter((id) => !declaredIds.has(id));
    if (missing.length > 0) {
      findings.push({
        file,
        line: lineOf(html, m.index),
        attr,
        missing,
      });
    }
  }
  return findings;
}

async function main() {
  console.log(
    '=== ARIA IDREF Target-Existence Audit (v7.7.71) — WAI-ARIA 1.2 IDREF conformance ===\n',
  );

  const files = walk(ROOT);
  const allFindings = [];

  for (const file of files) {
    const html = readFileSync(file, 'utf8');
    const findings = findBrokenIdrefs(html, file);
    allFindings.push(...findings);
  }

  console.log(
    `Scanned ${files.length} source file(s) · ${allFindings.length} broken IDREF reference(s) (target id="..." missing)\n`,
  );

  if (allFindings.length === 0) {
    console.log(
      '✓ Every aria-{labelledby,describedby,controls,errormessage,activedescendant}="..." references an id="..." in the same file.',
    );
    return;
  }

  console.error(
    `FAIL — ${allFindings.length} broken IDREF reference(s) (target id missing):\n`,
  );
  for (const f of allFindings) {
    console.error(
      `  ✗ ${f.file}:${f.line}  ${f.attr}="..."  missing id(s): ${f.missing.join(', ')}`,
    );
  }
  console.error(
    '\nFix: declare an id="..." on the target element (or fix the reference to match an existing id).',
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('aria-idref-target-existence scan crashed:', e);
  process.exit(2);
});