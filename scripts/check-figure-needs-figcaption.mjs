#!/usr/bin/env node
// scripts/check-figure-needs-figcaption.mjs
// v7.7.77 — 81st CI gate
// Catches the WAI-ARIA 1.2 + WCAG 4.1.2 (Name/Role/Value, Level A)
// conformance bug class:
// every <figure> element exposes the implicit role="figure", which per
// ARIA 1.2 §5.4 has "Name Required: True". The accessible name MUST be
// provided via one of:
//   1. A <figcaption> child element, OR
//   2. An aria-labelledby="..." attribute on the <figure>, OR
//   3. An aria-label="..." attribute on the <figure>.
//
// Figures with role="presentation" / role="none" are exempt (decorative).
// Figures whose immediate ancestor carries aria-hidden="true" are
// exempt (already hidden from AT).
//
// Reference: WAI-ARIA 1.2 §5.4 figure role
//   https://www.w3.org/TR/wai-aria-1.2/#figure
// Reference: WCAG 4.1.2
//   https://www.w3.org/WAI/WCAG22/Understanding/name-role-value
//
// Mutation harness:
//   - M1: inject <figure><img></figure> → caught (no caption/label).
//   - M2: inject <figure aria-label="x"><img></figure> → pass.
//   - M3: inject <figure role="presentation"><img></figure> → exempt (pass).
//
// Usage: node scripts/check-figure-needs-figcaption.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
const SCAN_EXT = new Set(['.astro', '.md']);

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

function isExempt(attrs, html, start) {
  // role="presentation" or role="none" → exempt.
  if (/\brole\s*=\s*["'](presentation|none)["']/i.test(attrs)) return true;
  // 200-char window BEFORE <figure> for wrapping aria-hidden="true".
  const window = html.slice(Math.max(0, start - 400), start);
  if (/\baria-hidden\s*=\s*["']true["']/i.test(window)) return true;
  return false;
}

function hasAccessibleName(attrs, inner) {
  if (/<figcaption\b/i.test(inner)) return true;
  // Match quoted aria-labelledby / aria-label AND Astro/JSX expression values.
  if (/\baria-labelledby\s*=\s*(?:"[^"]+"|'[^']+'|\{[^}]+\})/i.test(attrs)) return true;
  if (/\baria-label\s*=\s*(?:"[^"]+"|'[^']+'|\{[^}]+\})/i.test(attrs)) return true;
  return false;
}

function findFigureViolations(html, file) {
  const findings = [];
  const re = /<figure\b([^>]*?)>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const start = m.index;
    const closeIdx = html.indexOf('</figure>', start);
    if (closeIdx === -1) continue;
    const inner = html.slice(start + m[0].length, closeIdx);
    re.lastIndex = closeIdx + '</figure>'.length;
    if (isExempt(attrs, html, start)) continue;
    if (hasAccessibleName(attrs, inner)) continue;
    findings.push({
      file,
      line: lineOf(html, start),
      reason:
        '<figure> has no accessible name — add <figcaption>, aria-labelledby, or aria-label (or mark role="presentation" if purely decorative)',
    });
  }
  return findings;
}

async function main() {
  console.log(
    '=== Figure-Needs-Figcaption Audit (v7.7.77) — WAI-ARIA 1.2 §5.4 + WCAG 4.1.2 conformance ===\n',
  );

  const files = walk(ROOT);
  const allFindings = [];

  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    const html = stripComments(raw);
    const findings = findFigureViolations(html, file);
    allFindings.push(...findings);
  }

  console.log(
    `Scanned ${files.length} source file(s) · ${allFindings.length} <figure> accessible-name violation(s)\n`,
  );

  if (allFindings.length === 0) {
    console.log(
      '✓ Every <figure> has an accessible name (via <figcaption>, aria-labelledby, aria-label, or is exempt as decorative).',
    );
    return;
  }

  console.error(`FAIL — ${allFindings.length} <figure> accessible-name violation(s):\n`);
  for (const f of allFindings) {
    console.error(`  ✗ ${f.file}:${f.line}  — ${f.reason}`);
  }
  console.error(
    '\nFix: add a <figcaption> child element, OR aria-labelledby="..." pointing to a heading, OR aria-label="..." on the <figure>. Mark with role="presentation" if purely decorative.',
  );
  console.error('Reference: https://www.w3.org/TR/wai-aria-1.2/#figure (Name Required: True)');
  process.exit(1);
}

main().catch((e) => {
  console.error('figure-needs-figcaption scan crashed:', e);
  process.exit(2);
});
