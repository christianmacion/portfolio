#!/usr/bin/env node
// scripts/check-aria-numeric-integer-value.mjs
// v7.7.75 — 79th CI gate
// Catches the WAI-ARIA 1.2 conformance bug class:
// every aria-ATTR with an integer value MUST be a non-negative
// integer (or in the documented range), and relative constraints
// (aria-posinset ≤ aria-setsize, aria-valuemin ≤ aria-valuemax)
// must hold on the same element.
//
// Why:
// ARIA 1.2 §6 defines a set of aria-* attributes whose value is an
// integer. If a non-integer or out-of-range value is used, the
// attribute is either ignored or — worse — misinterpreted by
// assistive tech. WCAG 4.1.2 Name/Role/Value structural conformance
// violation.
//
// Reference: https://www.w3.org/TR/wai-aria-1.2/#states_and_properties
//
// Companion to v7.7.74 (aria-attribute-value-enumeration). Together
// they cover the ARIA attribute value surface:
//   - v7.7.74: enumerated-token attrs (aria-current, aria-live, etc.)
//   - v7.7.75: integer-valued attrs (aria-level, aria-posinset, etc.)
//
// Mutation harness:
//   - M1: inject `<li aria-posinset="-1">x</li>` (negative integer) → caught.
//   - M2: inject `<li aria-posinset="3">x</li>` (positive integer) → pass.
//   - M3: positive control (final revert clean).
//
// Usage: node scripts/check-aria-numeric-integer-value.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
const SCAN_EXT = new Set(['.astro', '.md']);

// ARIA 1.2 integer-valued attributes.
// `null` value means "non-negative integer (≥0)".
// `range` arrays are inclusive [min, max].
const INT_ATTRS = {
  'aria-level': { min: 1, max: 6 }, // heading level 1-6
  'aria-posinset': { min: 1, max: Number.MAX_SAFE_INTEGER }, // ≥1 (or aria-setsize if set)
  'aria-setsize': { min: 1, max: Number.MAX_SAFE_INTEGER }, // ≥1
  'aria-valuenow': { min: null, max: null }, // any number (numeric, not necessarily integer)
  'aria-valuemin': { min: null, max: null }, // any number
  'aria-valuemax': { min: null, max: null }, // any number
  'aria-colcount': { min: 0, max: Number.MAX_SAFE_INTEGER },
  'aria-rowcount': { min: 0, max: Number.MAX_SAFE_INTEGER },
  'aria-colindex': { min: 1, max: Number.MAX_SAFE_INTEGER },
  'aria-rowindex': { min: 1, max: Number.MAX_SAFE_INTEGER },
  'aria-colspan': { min: 1, max: Number.MAX_SAFE_INTEGER },
  'aria-rowspan': { min: 1, max: Number.MAX_SAFE_INTEGER },
  'aria-tabindex': { min: 0, max: Number.MAX_SAFE_INTEGER },
};

// Relative constraints (aria-ATTR1 ≤ aria-ATTR2 on same element).
const RELATIVE_CONSTRAINTS = [
  { less: 'aria-posinset', more: 'aria-setsize', desc: 'aria-posinset must be ≤ aria-setsize' },
  { less: 'aria-valuemin', more: 'aria-valuemax', desc: 'aria-valuemin must be ≤ aria-valuemax' },
];

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

// Find every integer-valued aria-ATTR whose value violates range or is not an integer.
// Returns array of {file, line, attr, value, reason}.
function findIntegerViolations(html, file) {
  const findings = [];
  // Capture every opening tag (multi-line).
  const tagRe = /<\s*[a-zA-Z][a-zA-Z0-9-]*\b([^>]*?)>/gs;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const attrs = m[1];
    // Collect all integer-valued attrs on this element.
    const attrValues = {}; // attr -> raw value string
    const ariaRe = /\b(aria-[a-z0-9-]+)\s*=\s*["']([^"']*)["']/gi;
    let am;
    while ((am = ariaRe.exec(attrs)) !== null) {
      const attr = am[1].toLowerCase();
      if (INT_ATTRS[attr]) attrValues[attr] = am[2];
    }
    // Check each integer-valued attr individually.
    for (const [attr, rawValue] of Object.entries(attrValues)) {
      const range = INT_ATTRS[attr];
      const trimmed = rawValue.trim();
      // Must parse as integer (no decimals for integer-valued attrs).
      // Special: aria-valuenow/min/max are floats per ARIA, but we still flag NaN.
      if (attr === 'aria-valuenow' || attr === 'aria-valuemin' || attr === 'aria-valuemax') {
        const n = Number(trimmed);
        if (Number.isNaN(n)) {
          findings.push({
            file,
            line: lineOf(html, m.index),
            attr,
            value: rawValue,
            reason: `not a valid number`,
          });
        }
        continue;
      }
      // Integer-valued attrs.
      if (!/^-?\d+$/.test(trimmed)) {
        findings.push({
          file,
          line: lineOf(html, m.index),
          attr,
          value: rawValue,
          reason: `not a valid integer`,
        });
        continue;
      }
      const n = parseInt(trimmed, 10);
      if (range.min !== null && n < range.min) {
        findings.push({
          file,
          line: lineOf(html, m.index),
          attr,
          value: rawValue,
          reason: `value ${n} < minimum ${range.min}`,
        });
      }
      if (range.max !== null && n > range.max) {
        findings.push({
          file,
          line: lineOf(html, m.index),
          attr,
          value: rawValue,
          reason: `value ${n} > maximum ${range.max}`,
        });
      }
    }
    // Check relative constraints on this element.
    for (const { less, more, desc } of RELATIVE_CONSTRAINTS) {
      if (attrValues[less] !== undefined && attrValues[more] !== undefined) {
        const ln = parseInt(attrValues[less], 10);
        const mn = parseInt(attrValues[more], 10);
        if (!Number.isNaN(ln) && !Number.isNaN(mn) && ln > mn) {
          findings.push({
            file,
            line: lineOf(html, m.index),
            attr: less,
            value: attrValues[less],
            reason: `${desc} (${attrValues[less]} > ${attrValues[more]})`,
          });
        }
      }
    }
  }
  return findings;
}

async function main() {
  console.log('=== ARIA Numeric-Integer-Value Audit (v7.7.75) — WAI-ARIA 1.2 conformance ===\n');

  const files = walk(ROOT);
  const allFindings = [];

  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    const html = stripComments(raw);
    const findings = findIntegerViolations(html, file);
    allFindings.push(...findings);
  }

  console.log(
    `Scanned ${files.length} source file(s) · ${allFindings.length} aria-integer value violation(s) (out-of-range, non-integer, or relative-constraint violation)\n`,
  );

  if (allFindings.length === 0) {
    console.log(
      '✓ Every integer-valued aria-* attribute uses a valid integer in range, and relative constraints (posinset ≤ setsize, valuemin ≤ valuemax) hold.',
    );
    return;
  }

  console.error(`FAIL — ${allFindings.length} aria-integer value violation(s):\n`);
  for (const f of allFindings) {
    console.error(`  ✗ ${f.file}:${f.line}  ${f.attr}="${f.value}"  — ${f.reason}`);
  }
  console.error('\nFix: use a valid integer in range, or correct the relative constraint.');
  console.error('Reference: https://www.w3.org/TR/wai-aria-1.2/#states_and_properties');
  process.exit(1);
}

main().catch((e) => {
  console.error('aria-numeric-integer-value scan crashed:', e);
  process.exit(2);
});
