#!/usr/bin/env node
// scripts/check-link-accessible-name.mjs
// v7.7.51 — 55th CI gate (a11y)
// Validates every <a> in dist/*.html has accessible name via:
//   - text content (non-whitespace inner text, stripping nested tags)
//   - aria-label attribute
//   - aria-labelledby attribute
//   - title attribute
//
// Skip rules:
//   - /workbooks/*.html (print-PDF artifacts)
//   - <a> with aria-hidden="true" (decorative)
//   - <a> with no href (anchor placeholders, scroll targets)
//
// 1-rule contract: link-without-accessible-name

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

let linkFilesScanned = 0;
let linksScanned = 0;
let linksSkipped = 0;

function checkFile(filePath) {
  let html;
  try {
    html = readFileSync(filePath, 'utf8');
  } catch {
    return;
  }
  if (filePath.includes('/workbooks/')) return;
  linkFilesScanned++;

  const stripped = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '');

  const anchorOpenRe = /<a\b/gi;
  let am;
  while ((am = anchorOpenRe.exec(stripped)) !== null) {
    const startIdx = am.index + am[0].length;
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

    let inner = '';
    if (stripped[openEnd - 1] !== '/') {
      const closeIdx = stripped.toLowerCase().indexOf('</a>', openEnd);
      if (closeIdx !== -1) {
        inner = stripped.slice(openEnd + 1, closeIdx);
      }
    }

    linksScanned++;

    // Skip aria-hidden="true"
    if (/\baria-hidden\s*=\s*["']true["']/i.test(attrs)) {
      linksSkipped++;
      continue;
    }

    // Skip <a> with no href (placeholder)
    if (!/\bhref\s*=/i.test(attrs)) {
      linksSkipped++;
      continue;
    }

    const hasAriaLabel = /\baria-label\s*=\s*["'][^"']+["']/i.test(attrs);
    const hasAriaLabelledBy = /\baria-labelledby\s*=\s*["'][^"']+["']/i.test(attrs);
    const hasTitle = /\btitle\s*=\s*["'][^"']+["']/i.test(attrs);
    // Strip nested HTML tags + img alt text to detect "real" inner content
    const textContent = inner
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const hasTextContent = textContent.length > 0;

    // Also count <img alt="X"> inside as valid name
    const hasImgAlt = /<img\b[^>]*\balt\s*=\s*["'][^"']+["']/i.test(inner);

    const named = hasAriaLabel || hasAriaLabelledBy || hasTitle || hasTextContent || hasImgAlt;

    if (!named) {
      ISSUE_LIST.push({
        file: filePath,
        line: lineOf(html, am.index),
        snippet: stripped.slice(Math.max(0, am.index - 5), openEnd + 1).slice(0, 120),
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
  console.log('=== Link-Accessible-Name Audit (v7.7.51) — every <a> must have accessible name ===');
  console.log('');
  console.log(
    `Scanned ${linkFilesScanned} HTML page(s) · ${linksScanned} <a> tag(s) · ${linksSkipped} skipped (decorative/no-href) · ${linksScanned - linksSkipped} active · 0 without accessible name · 0 issue(s)`,
  );
  console.log('');
  console.log(
    '✓ All links across dist/*.html have accessible names (text content, aria-label, aria-labelledby, title, or img alt).',
  );
  console.log('');
  process.exit(0);
}

console.log('=== Link-Accessible-Name Audit (v7.7.51) ===');
console.log('');
console.log(`${total} link(s) without accessible name:\n`);
for (const issue of ISSUE_LIST) {
  console.log(`  ${issue.file}:${issue.line}  ${issue.snippet}`);
}
console.log('');
console.log('Fix: add text content, aria-label, aria-labelledby, title, or <img alt="...">.');
console.log('Skip rules: aria-hidden="true", no href, /workbooks/*.');
process.exit(1);
