#!/usr/bin/env node
// scripts/check-heading-content-quality.mjs
// v7.7.78 — 82nd CI gate
// Catches the WCAG 1.3.1 (Info and Relationships, Level A) + WCAG 2.4.6
// (Headings and Labels, Level AA) conformance bug class:
// every <h1>-<h6> element MUST expose a non-empty accessible name —
// either via visible text content (text node descendants) OR via
// aria-label="..." OR via aria-labelledby="..." on the heading.
//
// Empty headings (no text, no aria-label) silently break screen-reader
// navigation by heading. Icon-only headings (e.g., <h2><svg/></h2>)
// silently announce an empty heading. Both are real WCAG failures.
//
// Comment-strip handles JS/HTML/Astro comment false positives.
//
// Reference: WCAG 1.3.1 https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships
// Reference: WCAG 2.4.6 https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels
//
// Mutation harness:
//   - M1: inject <h2></h2> → caught.
//   - M2: inject <h2>Text</h2> → pass.
//   - M3: inject <h2 aria-label="x"></h2> → pass.
//
// Usage: node scripts/check-heading-content-quality.mjs

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

function hasAccessibleName(attrs, _inner) {
  // Match quoted aria-labelledby / aria-label AND Astro/JSX expression values.
  if (/\baria-labelledby\s*=\s*(?:"[^"]+"|'[^']+'|\{[^}]+\})/i.test(attrs)) return true;
  if (/\baria-label\s*=\s*(?:"[^"]+"|'[^']+'|\{[^}]+\})/i.test(attrs)) return true;
  return false;
}

function findHeadingViolations(html, file) {
  const findings = [];
  // Match <h1> through <h6>; multi-line inner.
  const re = /<h([1-6])\b([^>]*?)>([\s\S]*?)<\/h\1>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const level = m[1];
    const attrs = m[2];
    const inner = m[3];
    if (hasAccessibleName(attrs, inner)) continue;
    // Strip tags + collapse whitespace.
    const text = inner
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length === 0) {
      findings.push({
        file,
        line: lineOf(html, m.index),
        level,
        reason: `<h${level}> is empty — add text content, aria-label, or aria-labelledby`,
      });
    }
  }
  return findings;
}

async function main() {
  console.log('=== Heading-Content-Quality Audit (v7.7.78) — WCAG 1.3.1 + 2.4.6 conformance ===\n');

  const files = walk(ROOT);
  const allFindings = [];

  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    const html = stripComments(raw);
    const findings = findHeadingViolations(html, file);
    allFindings.push(...findings);
  }

  console.log(
    `Scanned ${files.length} source file(s) · ${allFindings.length} empty-heading violation(s)\n`,
  );

  if (allFindings.length === 0) {
    console.log(
      '✓ Every <h1>-<h6> has a non-empty accessible name (text content, aria-label, or aria-labelledby).',
    );
    return;
  }

  console.error(`FAIL — ${allFindings.length} empty-heading violation(s):\n`);
  for (const f of allFindings) {
    console.error(`  ✗ ${f.file}:${f.line}  — ${f.reason}`);
  }
  console.error(
    '\nFix: add visible text content to the heading, OR aria-label="..." OR aria-labelledby="..." pointing to existing content.',
  );
  console.error(
    'Reference: WCAG 1.3.1 https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships',
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('heading-content-quality scan crashed:', e);
  process.exit(2);
});
