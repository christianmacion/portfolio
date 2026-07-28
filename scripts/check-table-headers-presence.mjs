#!/usr/bin/env node
// scripts/check-table-headers-presence.mjs
// v7.7.53 — 57th CI gate (a11y)
// Validates every <table> in dist/*.html has at least one <th> child
// (HTML table semantic — WCAG 1.3.1 Info and Relationships).
//
// Also validates ARIA table pattern (role="table" + role="row" + role="cell")
// has aria-label or aria-labelledby on the table container.
//
// Skip rule: /workbooks/*.html
//
// 1-rule contract: table-without-headers

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const ISSUE_LIST = [];

const visit = (dir) => {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) visit(p);
    else if (name.endsWith('.html')) checkFile(p);
  }
};

let tableFilesScanned = 0;
let htmlTablesScanned = 0;
let htmlTablesWithTh = 0;
let ariaTablesScanned = 0;

function checkFile(filePath) {
  let html;
  try {
    html = readFileSync(filePath, 'utf8');
  } catch {
    return;
  }
  if (filePath.includes('/workbooks/')) return;
  tableFilesScanned++;

  const stripped = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '');

  // === Pattern 1: <table>...</table> ===
  const tableRe = /<table\b([\s\S]*?)>([\s\S]*?)<\/table>/gi;
  let m;
  while ((m = tableRe.exec(stripped)) !== null) {
    htmlTablesScanned++;
    const inner = m[2] || '';
    // Look for <th>...</th> (anywhere inside the table — including nested in thead/tbody/tr)
    const hasTh = /<th\b/i.test(inner);
    if (hasTh) {
      htmlTablesWithTh++;
    } else {
      ISSUE_LIST.push({
        file: filePath,
        line: lineOf(html, m.index),
        snippet: `<table> without <th>`,
      });
    }
  }

  // === Pattern 2: role="table" divs (ARIA table pattern) ===
  const ariaTableRe = /<div\b[^>]*\brole\s*=\s*["']table["'][^>]*>/gi;
  let am;
  while ((am = ariaTableRe.exec(stripped)) !== null) {
    ariaTablesScanned++;
    const attrs = am[0];
    const hasAccessibleName =
      /\baria-label\s*=\s*["'][^"']+["']/i.test(attrs) ||
      /\baria-labelledby\s*=\s*["'][^"']+["']/i.test(attrs);
    if (!hasAccessibleName) {
      ISSUE_LIST.push({
        file: filePath,
        line: lineOf(html, am.index),
        snippet: `role="table" without aria-label or aria-labelledby`,
      });
    }
  }
}

function lineOf(haystack, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < haystack.length; i++) {
    if (haystack.charCodeAt(i) === 10) line++;
  }
  return line;
}

visit(DIST);

const total = ISSUE_LIST.length;
if (total === 0) {
  console.log(
    '=== Table-Headers-Presence Audit (v7.7.53) — every <table> has <th>; every role="table" has aria-label/labelledby ===',
  );
  console.log('');
  console.log(
    `Scanned ${tableFilesScanned} HTML page(s) · ${htmlTablesScanned} <table> tag(s) · ${htmlTablesWithTh} with <th> · ${ariaTablesScanned} role="table" div(s) · 0 issue(s)`,
  );
  console.log('');
  console.log('✓ All tables (HTML + ARIA) have headers / accessible names (WCAG 1.3.1).');
  console.log('');
  process.exit(0);
}

console.log('=== Table-Headers-Presence Audit (v7.7.53) ===');
console.log('');
console.log(`${total} table(s) without headers:\n`);
for (const issue of ISSUE_LIST) {
  console.log(`  ${issue.file}:${issue.line}  ${issue.snippet}`);
}
console.log('');
console.log(
  'Fix: add <th> inside <table> for HTML tables; add aria-label or aria-labelledby to role="table" containers.',
);
console.log('Skip rule: /workbooks/*.');
process.exit(1);
