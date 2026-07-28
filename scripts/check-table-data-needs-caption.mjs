#!/usr/bin/env node
// scripts/check-table-data-needs-caption.mjs
// v7.7.76 — 80th CI gate
// Catches the WCAG 1.3.1 (Info and Relationships, Level A) + WCAG 4.1.2
// (Name/Role/Value, Level A) conformance bug class:
// every <table> presenting data (i.e., with <thead> or <th> headers)
// MUST expose a programmatic accessible name — either via:
//   1. A <caption> child element, OR
//   2. An aria-labelledby="..." attribute referencing an id in the same
//      document, OR
//   3. An aria-label="..." attribute on the <table>.
//
// Layout-only tables (those with role="presentation", role="none", or
// no header cells) are exempt — they are decorative per HTML5 spec.
//
// Reference: WCAG 1.3.1 https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships
// Reference: WCAG 4.1.2 https://www.w3.org/WAI/WCAG22/Understanding/name-role-value
//
// Mutation harness:
//   - M1: inject a <table> with <thead> but no caption/labelledby/label → caught.
//   - M2: inject a <table> with <caption> → pass.
//   - M3: inject a <table role="presentation"> with <thead> → exempt (pass).
//
// Usage: node scripts/check-table-data-needs-caption.mjs

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

// Find <table> elements with their inner body. Returns array of
// {file, line, attrs, inner, endIdx}.
function findTables(html) {
  const tables = [];
  const re = /<table\b([^>]*?)>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const start = m.index;
    const closeIdx = html.indexOf('</table>', start);
    if (closeIdx === -1) continue;
    const inner = html.slice(start + m[0].length, closeIdx);
    tables.push({ file: '', line: lineOf(html, start), attrs, inner });
    re.lastIndex = closeIdx + '</table>'.length;
  }
  return tables;
}

function isLayoutTable(attrs, inner) {
  // role="presentation" or role="none" exempts the table.
  if (/\brole\s*=\s*["'](presentation|none)["']/i.test(attrs)) return true;
  // No header cells (no <th> AND no <thead>) — pure layout.
  if (!/<th\b/i.test(inner) && !/<thead\b/i.test(inner)) return true;
  return false;
}

function hasAccessibleName(attrs, inner) {
  if (/<caption\b/i.test(inner)) return true;
  // Match quoted aria-labelledby / aria-label AND Astro/JSX expression values
  // (no quotes, single braces, or template literals).
  if (/\baria-labelledby\s*=\s*(?:"[^"]+"|'[^']+'|\{[^}]+\})/i.test(attrs)) return true;
  if (/\baria-label\s*=\s*(?:"[^"]+"|'[^']+'|\{[^}]+\})/i.test(attrs)) return true;
  // Wrapping region with aria-label is also acceptable — handled outside.
  return false;
}

function findCaptionViolations(html, file) {
  const findings = [];
  const tables = findTables(html);
  for (const t of tables) {
    if (isLayoutTable(t.attrs, t.inner)) continue;
    if (hasAccessibleName(t.attrs, t.inner)) continue;
    // Check for wrapping role="region" aria-label="...".
    // Walk backwards from <table> to find immediate container.
    const before = html.slice(Math.max(0, t.line * 0), t.line === 1 ? 0 : 1);
    // Simpler heuristic: look at the 200 chars preceding <table>.
    const pre = html.slice(Math.max(0, t.file === undefined ? 0 : 0), 0);
    // We can't easily get offset → use a separate index-aware helper below.
    findings.push({
      file,
      line: t.line,
      reason: 'data <table> has <thead>/<th> but no <caption>, aria-labelledby, or aria-label',
    });
  }
  return findings;
}

// Index-aware version (preferred).
function findCaptionViolationsIndexed(rawHtml, file) {
  const findings = [];
  const html = rawHtml;
  const re = /<table\b([^>]*?)>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const start = m.index;
    const closeIdx = html.indexOf('</table>', start);
    if (closeIdx === -1) continue;
    const inner = html.slice(start + m[0].length, closeIdx);
    re.lastIndex = closeIdx + '</table>'.length;
    if (isLayoutTable(attrs, inner)) continue;
    if (hasAccessibleName(attrs, inner)) continue;
    // Check 200-char window before <table> for wrapping role="region" aria-label="...".
    const window = html.slice(Math.max(0, start - 400), start);
    const regionWrap =
      /<(?:div|section)\b[^>]*\brole\s*=\s*["']region["'][^>]*\baria-label\s*=\s*["'][^"']+["']/i.test(
        window,
      );
    if (regionWrap) continue;
    findings.push({
      file,
      line: lineOf(html, start),
      reason: 'data <table> has <thead>/<th> but no <caption>, aria-labelledby, or aria-label',
    });
  }
  return findings;
}

async function main() {
  console.log(
    '=== Table-Data-Needs-Caption Audit (v7.7.76) — WCAG 1.3.1 + 4.1.2 conformance ===\n',
  );

  const files = walk(ROOT);
  const allFindings = [];

  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    const html = stripComments(raw);
    const findings = findCaptionViolationsIndexed(html, file);
    allFindings.push(...findings);
  }

  console.log(
    `Scanned ${files.length} source file(s) · ${allFindings.length} data-<table> accessibility-name violation(s)\n`,
  );

  if (allFindings.length === 0) {
    console.log(
      '✓ Every data <table> has an accessible name (via <caption>, aria-labelledby, aria-label, or wrapping region with aria-label).',
    );
    return;
  }

  console.error(`FAIL — ${allFindings.length} data-<table> accessible-name violation(s):\n`);
  for (const f of allFindings) {
    console.error(`  ✗ ${f.file}:${f.line}  — ${f.reason}`);
  }
  console.error(
    '\nFix: add a <caption> child element, OR aria-labelledby="..." pointing to a heading, OR aria-label="..." on the <table>.',
  );
  console.error(
    'Reference: WCAG 1.3.1 https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships',
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('table-data-needs-caption scan crashed:', e);
  process.exit(2);
});
