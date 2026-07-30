#!/usr/bin/env node
// scripts/check-aria-valid-attr-value.mjs
// v7.7.65 — 69th CI gate
// Catches the WCAG 2.2 Level AA 4.1.2 Name/Role/Value bug class:
// every WAI-ARIA state attribute must declare a value from its allowed set.
// Reference: https://www.w3.org/TR/wai-aria-1.2/ (states & properties table).
//
// Detection strategy: walk src/**/*.astro + src/pages/**/*.md. For every
// opening tag, extract aria-* attributes. Validate the value against the
// canonical allowed set:
//   - aria-checked   ∈ {true, false, mixed, undefined}
//   - aria-selected  ∈ {true, false, undefined}
//   - aria-expanded  ∈ {true, false, undefined}
//   - aria-pressed   ∈ {true, false, mixed, undefined}
//   - aria-current   ∈ {page, step, location, date, time, true, false, undefined}
//   - aria-orientation ∈ {horizontal, vertical, undefined}
//   - aria-level     integer (1..6 for role=heading; integer for treeitem)
//   - aria-valuenow  numeric (decimal)
//   - aria-valuemin  numeric
//   - aria-valuemax  numeric
//   - aria-valuetext string (no constraints)
//
// Attributes without constrained values (aria-label, aria-describedby,
// aria-labelledby, aria-controls, etc.) are passed unconditionally — they
// are either free-form strings or IDREF lists.
//
// Out of scope:
//   - JS expressions (aria-checked={cond ? 'true' : 'false'}) are validated
//     as the literal expression string. We only flag obviously invalid
//     literals, not runtime-resolved values.
//
// Mutation harness:
//   - M1: inject `aria-checked="yes"` (invalid value) → caught.
//   - M2: inject `aria-checked="true"` (valid) → pass.
//   - M3: positive control (final revert clean).
//
// Usage: node scripts/check-aria-valid-attr-value.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
const SCAN_EXT = new Set(['.astro', '.md']);

// Tristate + extended allowed sets per WAI-ARIA 1.2.
const TRISTATE = new Set(['true', 'false', 'undefined']);
const TRISTATE_MIXED = new Set(['true', 'false', 'mixed', 'undefined']);
const ARIA_CURRENT = new Set([
  'page',
  'step',
  'location',
  'date',
  'time',
  'true',
  'false',
  'undefined',
]);
const ARIA_ORIENTATION = new Set(['horizontal', 'vertical', 'undefined']);

// Validator registry: attr name → function that returns null if value is
// valid, or a string describing the constraint that failed.
const VALIDATORS = {
  'aria-checked': (v) =>
    TRISTATE_MIXED.has(v) ? null : `must be one of: ${[...TRISTATE_MIXED].join(', ')}`,
  'aria-selected': (v) =>
    TRISTATE.has(v) ? null : `must be one of: ${[...TRISTATE].join(', ')}`,
  'aria-expanded': (v) =>
    TRISTATE.has(v) ? null : `must be one of: ${[...TRISTATE].join(', ')}`,
  'aria-pressed': (v) =>
    TRISTATE_MIXED.has(v) ? null : `must be one of: ${[...TRISTATE_MIXED].join(', ')}`,
  'aria-current': (v) =>
    ARIA_CURRENT.has(v) ? null : `must be one of: ${[...ARIA_CURRENT].join(', ')}`,
  'aria-orientation': (v) =>
    ARIA_ORIENTATION.has(v) ? null : `must be one of: ${[...ARIA_ORIENTATION].join(', ')}`,
  'aria-level': (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return 'must be a positive integer (1..6 for role=heading)';
    if (!Number.isInteger(n) || n < 1) return 'must be a positive integer';
    return null;
  },
  'aria-valuenow': (v) => (/^-?\d+(\.\d+)?$/.test(v) ? null : 'must be a number'),
  'aria-valuemin': (v) => (/^-?\d+(\.\d+)?$/.test(v) ? null : 'must be a number'),
  'aria-valuemax': (v) => (/^-?\d+(\.\d+)?$/.test(v) ? null : 'must be a number'),
};

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

// Find every opening tag. Extract aria-* attrs and validate their values.
// Skips JS expression values (e.g., `aria-checked={x ? 'true' : 'false'}`)
// because they're not literals we can statically check.
function findInvalidAriaValues(html, file) {
  const findings = [];
  const tagRe = /<\s*([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const attrs = m[2];
    const tag = m[0];
    // Find every aria-* attribute with a literal value.
    const ariaRe = /\baria-([a-z]+)\s*=\s*["']([^"']*)["']/gi;
    let am;
    while ((am = ariaRe.exec(attrs)) !== null) {
      const attrName = 'aria-' + am[1].toLowerCase();
      const attrValue = am[2];
      const validator = VALIDATORS[attrName];
      if (!validator) continue;
      const err = validator(attrValue);
      if (err) {
        findings.push({
          file,
          line: lineOf(html, m.index),
          attr: attrName,
          value: attrValue,
          constraint: err,
          tag: tag.slice(0, 120),
        });
      }
    }
  }
  return findings;
}

async function main() {
  console.log('=== ARIA Valid-Attribute-Value Audit (v7.7.65) — WCAG 4.1.2 Name/Role/Value ===\n');

  const files = walk(ROOT);
  const allFindings = [];
  let scannedAttrs = 0;

  for (const file of files) {
    const html = readFileSync(file, 'utf8');
    const findings = findInvalidAriaValues(html, file);
    // Count validated attrs for the report footer.
    const ariaRe = /\baria-[a-z]+\s*=\s*["'][^"']*["']/gi;
    let am;
    while ((am = ariaRe.exec(html)) !== null) {
      const attrName = am[0].split('=')[0].trim().toLowerCase();
      if (attrName in VALIDATORS) scannedAttrs++;
    }
    allFindings.push(...findings);
  }

  console.log(
    `Scanned ${files.length} source file(s) · ${scannedAttrs} constrained aria-* value(s) · ${allFindings.length} bug(s)\n`,
  );

  if (allFindings.length === 0) {
    console.log('✓ Every constrained aria-* attribute declares a value from the WAI-ARIA 1.2 allowed set.');
    return;
  }

  console.error(`FAIL — ${allFindings.length} aria-* value(s) outside the WAI-ARIA 1.2 allowed set:\n`);
  for (const f of allFindings) {
    console.error(`  ✗ ${f.file}:${f.line}  ${f.attr}="${f.value}"`);
    console.error(`      constraint: ${f.constraint}`);
    console.error(`      tag: ${f.tag}…`);
  }
  console.error('\nFix: use one of the WAI-ARIA 1.2 canonical values for the attribute.');
  process.exit(1);
}

main().catch((e) => {
  console.error('aria-valid-attr-value scan crashed:', e);
  process.exit(2);
});
