#!/usr/bin/env node
// scripts/check-button-accessible-name.mjs
// v7.7.50 — 54th CI gate (a11y)
// Validates every <button> in dist/*.html has accessible name via:
//   - text content (non-whitespace inner text)
//   - aria-label attribute
//   - aria-labelledby attribute
//   - title attribute
//
// Skip rules:
//   - /workbooks/*.html (print-PDF artifacts, no interactive buttons)
//   - buttons with type="hidden" (none should exist; defensive)
//
// 1-rule contract: button-without-accessible-name

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

let buttonFilesScanned = 0;
let buttonsScanned = 0;

function checkFile(filePath) {
  let html;
  try {
    html = readFileSync(filePath, 'utf8');
  } catch {
    return;
  }
  // Skip workbook print-PDF HTMLs
  if (filePath.includes('/workbooks/')) return;
  buttonFilesScanned++;

  // Strip script + style blocks (button tags can appear in JS strings)
  const stripped = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '');

  // Find every <button ...>...</button> OR <button .../>
  // Handle multiline attrs + quoted-string-aware attribute extraction
  const buttonOpenRe = /<button\b/gi;
  let bm;
  while ((bm = buttonOpenRe.exec(stripped)) !== null) {
    const startIdx = bm.index + bm[0].length;
    // Walk forward to find unquoted > that ends the open tag
    let i = startIdx;
    let inSingle = false,
      inDouble = false;
    let openEnd = -1;
    while (i < stripped.length) {
      const c = stripped[i];
      if (c === '"' && !inSingle) inDouble = !inDouble;
      else if (c === "'" && !inDouble) inSingle = !inSingle;
      else if (c === '>' && !inSingle && !inDouble) {
        openEnd = i;
        break;
      }
      i++;
    }
    if (openEnd === -1) continue;

    const attrs = stripped.slice(startIdx, openEnd);

    // Self-closing <button ... /> — empty content (still valid HTML5 for void buttons, no text)
    let inner = '';
    if (stripped[openEnd - 1] === '/') {
      // Self-close: no inner content to check
    } else {
      // Find matching </button>
      const closeIdx = stripped.toLowerCase().indexOf('</button>', openEnd);
      if (closeIdx !== -1) {
        inner = stripped.slice(openEnd + 1, closeIdx);
      }
    }

    buttonsScanned++;

    // Extract accessible name candidates
    const hasAriaLabel = /\baria-label\s*=\s*["'][^"']+["']/i.test(attrs);
    const hasAriaLabelledBy = /\baria-labelledby\s*=\s*["'][^"']+["']/i.test(attrs);
    const hasTitle = /\btitle\s*=\s*["'][^"']+["']/i.test(attrs);
    const hasTextContent = inner.replace(/<[^>]+>/g, '').trim().length > 0;

    const named = hasAriaLabel || hasAriaLabelledBy || hasTitle || hasTextContent;

    if (!named) {
      ISSUE_LIST.push({
        file: filePath,
        line: lineOf(html, bm.index),
        snippet: stripped.slice(Math.max(0, bm.index - 10), openEnd + 1).slice(0, 100),
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
    '=== Button-Accessible-Name Audit (v7.7.50) — every <button> must have accessible name ===',
  );
  console.log('');
  console.log(
    `Scanned ${buttonFilesScanned} HTML page(s) · ${buttonsScanned} <button> tag(s) · 0 without accessible name · 0 issue(s)`,
  );
  console.log('');
  console.log(
    '✓ All buttons across dist/*.html have accessible names (text content, aria-label, aria-labelledby, or title).',
  );
  console.log('');
  process.exit(0);
}

console.log('=== Button-Accessible-Name Audit (v7.7.50) ===');
console.log('');
console.log(`${total} button(s) without accessible name:\n`);
for (const issue of ISSUE_LIST) {
  console.log(`  ${issue.file}:${issue.line}  ${issue.snippet}`);
}
console.log('');
console.log('Fix: add text content, aria-label, aria-labelledby, or title attribute.');
console.log('Skip rule: /workbooks/* (print-PDF artifacts).');
process.exit(1);
