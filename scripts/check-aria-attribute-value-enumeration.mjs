#!/usr/bin/env node
// scripts/check-aria-attribute-value-enumeration.mjs
// v7.7.74 — 78th CI gate
// Catches the WAI-ARIA 1.2 conformance bug class:
// every aria-ATTR with an enumerated value set MUST use a value
// from that set; values outside the set are either silently ignored
// or — worse — misinterpreted by assistive tech.
//
// Why:
// ARIA 1.2 §6 defines a finite list of valid tokens for many aria-*
// attributes (e.g., aria-current must be one of {page, step, location,
// date, time, true, false}). If a token outside that set is used, the
// value is invalid per spec. WCAG 4.1.2 Name/Role/Value conformance
// violation. This is a structural conformance check.
//
// Reference: https://www.w3.org/TR/wai-aria-1.2/#states_and_properties
//
// Companion to v7.7.73 (aria-attribute-scope). Together they cover
// the ARIA attribute surface:
//   - v7.7.73: aria-ATTR is allowed on the element/role
//   - v7.7.74: aria-ATTR's value is in the enumerated token set
//
// Mutation harness:
//   - M1: inject `<a aria-current="current">x</a>` (invalid token) → caught.
//   - M2: inject `<a aria-current="page">x</a>` → pass.
//   - M3: positive control (final revert clean).
//
// Usage: node scripts/check-aria-attribute-value-enumeration.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
const SCAN_EXT = new Set(['.astro', '.md']);

// ARIA 1.2 enumerated value sets for aria-* attributes.
// `null` means attribute has free-form string value (not enumerated).
const ENUM_VALUE_SETS = {
  // aria-current — token-valued per ARIA 1.2 §6.6.1.
  'aria-current': new Set([
    'page', 'step', 'location', 'date', 'time', 'true', 'false',
  ]),

  // aria-live — politeness setting per ARIA 1.2 §6.6.7.
  'aria-live': new Set(['off', 'polite', 'assertive']),

  // aria-atomic — boolean per ARIA 1.2 §6.6.1.
  'aria-atomic': new Set(['true', 'false']),

  // aria-busy — boolean per ARIA 1.2 §6.6.1.
  'aria-busy': new Set(['true', 'false']),

  // aria-relevant — additions/removals/text/all list per ARIA 1.2 §6.6.9.
  'aria-relevant': new Set([
    'additions', 'removals', 'text', 'all', 'additions text',
  ]),

  // aria-orientation — per ARIA 1.2 §6.6.8.
  'aria-orientation': new Set(['horizontal', 'vertical', 'undefined']),

  // aria-haspopup — per ARIA 1.2 §6.6.6.
  'aria-haspopup': new Set([
    'false', 'true', 'menu', 'listbox', 'tree', 'grid', 'dialog',
  ]),

  // aria-sort — per ARIA 1.2 §6.6.10.
  'aria-sort': new Set(['ascending', 'descending', 'none', 'other']),

  // aria-invalid — per ARIA 1.2 §6.6.5.
  'aria-invalid': new Set(['false', 'true', 'grammar', 'spelling']),

  // aria-pressed — tri-state per ARIA 1.2 §6.6.7.
  'aria-pressed': new Set(['false', 'mixed', 'true', 'undefined']),

  // aria-checked — tri-state per ARIA 1.2 §6.6.2.
  'aria-checked': new Set(['false', 'mixed', 'true', 'undefined']),

  // aria-dropeffect — deprecated in ARIA 1.2 but still scoped per §6.6.3.
  'aria-dropeffect': new Set([
    'copy', 'execute', 'link', 'move', 'none', 'popup',
  ]),

  // aria-grabbed — deprecated in ARIA 1.2.
  'aria-grabbed': new Set(['false', 'true', 'undefined']),

  // aria-hidden — boolean per ARIA 1.2 §6.6.4.
  'aria-hidden': new Set(['true', 'false', 'undefined']),

  // aria-disabled — boolean per ARIA 1.2 §6.6.3 (state).
  'aria-disabled': new Set(['true', 'false', 'undefined']),

  // aria-expanded — boolean/ tristate per ARIA 1.2 §6.6.4.
  'aria-expanded': new Set(['true', 'false', 'undefined']),

  // aria-selected — boolean/ tristate per ARIA 1.2 §6.6.10.
  'aria-selected': new Set(['true', 'false', 'undefined']),
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

// Find every aria-ATTR="value" whose value is NOT in ENUM_VALUE_SETS[attr].
// Returns array of {file, line, attr, value}.
function findEnumValueViolations(html, file) {
  const findings = [];
  // Use a tag-bounded regex (multi-line OK) to capture every opening tag.
  const tagRe = /<\s*[a-zA-Z][a-zA-Z0-9-]*\b([^>]*?)>/gs;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const attrs = m[1];
    // For each enumerated aria-*, check value.
    const ariaRe = /\b(aria-[a-z0-9-]+)\s*=\s*["']([^"']*)["']/gi;
    let am;
    while ((am = ariaRe.exec(attrs)) !== null) {
      const attr = am[1].toLowerCase();
      const validSet = ENUM_VALUE_SETS[attr];
      if (validSet === undefined) continue; // not enumerated
      const rawValue = am[2].trim();
      const value = rawValue.toLowerCase();
      // For aria-relevant, accept any space-separated combination of tokens
      // (the value is a list of {additions, removals, text, all}).
      if (attr === 'aria-relevant') {
        const tokens = value.split(/\s+/);
        const allValid = tokens.every((t) => validSet.has(t));
        if (!allValid) {
          findings.push({file, line: lineOf(html, m.index), attr, value: rawValue});
        }
        continue;
      }
      if (!validSet.has(value)) {
        findings.push({file, line: lineOf(html, m.index), attr, value: rawValue});
      }
    }
  }
  return findings;
}

async function main() {
  console.log(
    '=== ARIA Attribute-Value-Enumeration Audit (v7.7.74) — WAI-ARIA 1.2 conformance ===\n',
  );

  const files = walk(ROOT);
  const allFindings = [];

  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    const html = stripComments(raw);
    const findings = findEnumValueViolations(html, file);
    allFindings.push(...findings);
  }

  console.log(
    `Scanned ${files.length} source file(s) · ${allFindings.length} aria-attribute enum-value violation(s)\n`,
  );

  if (allFindings.length === 0) {
    console.log(
      '✓ Every enumerated aria-* attribute uses a valid token from its ARIA 1.2 enum set.',
    );
    return;
  }

  console.error(
    `FAIL — ${allFindings.length} aria-attribute enum-value violation(s):\n`,
  );
  for (const f of allFindings) {
    console.error(
      `  ✗ ${f.file}:${f.line}  ${f.attr}="${f.value}"  — "${f.value}" is NOT in the ARIA 1.2 enum set for ${f.attr}`,
    );
  }
  console.error(
    '\nFix: use one of the documented tokens for this attribute (see reference below).',
  );
  console.error(
    'Reference: https://www.w3.org/TR/wai-aria-1.2/#states_and_properties',
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('aria-attribute-value-enumeration scan crashed:', e);
  process.exit(2);
});