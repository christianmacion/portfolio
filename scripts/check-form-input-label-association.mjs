#!/usr/bin/env node
// scripts/check-form-input-label-association.mjs
// v7.7.48 — 52nd CI gate (a11y)
// Validates every form input in dist/*.html has an accessible label:
//   - <label for="ID"> exists OR
//   - aria-label attribute OR
//   - aria-labelledby attribute
// Skip rules:
//   - Inputs with type="hidden" (no rendered label needed)
//   - Inputs with type="submit" / "button" / "reset" (button label is the value/text)
//   - Inputs with aria-hidden="true" (decorative only)
//
// 1-rule contract: form-input-without-label

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const PATTERNS = [
  { ext: '.html', dir: DIST },
  { ext: '.html', dir: join(DIST, 'workbooks') },
];

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

const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'reset']);

let inputsScanned = 0;
let skippedInputs = 0;
let inputFilesScanned = 0;
let labelForIds = new Set();

function checkFile(filePath) {
  let html;
  try {
    html = readFileSync(filePath, 'utf8');
  } catch {
    return;
  }
  // Skip workbook print-PDF HTMLs (no forms in print artifacts)
  if (filePath.includes('/workbooks/')) return;
  inputFilesScanned++;

  // Strip script + style blocks so they don't pollute attribute extraction
  const stripped = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '');

  // Collect all <label for="X"> IDs (only labels inside <body>, not from JS strings)
  const localLabelForIds = new Set();
  const labelRe = /<label\b[^>]*\bfor\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let lm;
  while ((lm = labelRe.exec(stripped)) !== null) {
    localLabelForIds.add(lm[1]);
    labelForIds.add(lm[1]);
  }

  // Walk every <input>, <select>, <textarea>
  // Strategy: find <tag, then capture attrs up to the next > that is NOT inside a string
  const tagRe = /<(input|select|textarea)\b/gi;
  let tm;
  while ((tm = tagRe.exec(stripped)) !== null) {
    const tag = tm[1];
    const startIdx = tm.index + tm[0].length;
    // Walk forward from start, tracking quoted strings, until we find unquoted >
    let i = startIdx;
    let inSingle = false,
      inDouble = false;
    let found = false;
    let attrs = '';
    while (i < stripped.length) {
      const c = stripped[i];
      if (c === '"' && !inSingle) inDouble = !inDouble;
      else if (c === "'" && !inDouble) inSingle = !inSingle;
      else if (c === '>' && !inSingle && !inDouble) {
        attrs = stripped.slice(startIdx, i);
        found = true;
        break;
      }
      i++;
    }
    if (!found) continue;

    inputsScanned++;
    const inner = '';

    // Extract type=
    const typeMatch = attrs.match(/\btype\s*=\s*["']([^"']+)["']/i);
    const type = typeMatch ? typeMatch[1].toLowerCase() : 'text';

    // Skip button-like + hidden inputs
    if (SKIP_TYPES.has(type)) {
      skippedInputs++;
      continue;
    }

    // Skip aria-hidden="true" inputs (decorative)
    if (/\baria-hidden\s*=\s*["']true["']/i.test(attrs)) {
      skippedInputs++;
      continue;
    }

    // Extract id=
    const idMatch = attrs.match(/\bid\s*=\s*["']([^"']+)["']/i);
    const id = idMatch ? idMatch[1] : null;

    // Extract aria-label=
    const hasAriaLabel = /\baria-label\s*=\s*["'][^"']+["']/i.test(attrs);

    // Extract aria-labelledby=
    const hasAriaLabelledBy = /\baria-labelledby\s*=\s*["'][^"']+["']/i.test(attrs);

    // Check for label[for=id]
    const hasForLabel = id && localLabelForIds.has(id);

    // For <select>/<textarea>: they often have content text as label
    const hasContent = (tag === 'select' || tag === 'textarea') && inner.trim().length > 0;
    const hasTitle = /\btitle\s*=\s*["'][^"']+["']/i.test(attrs);

    const labelled = hasForLabel || hasAriaLabel || hasAriaLabelledBy || hasContent || hasTitle;

    if (!labelled) {
      ISSUE_LIST.push({ file: filePath, line: lineOf(html, tm.index), tag, type, id });
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

// Scan all dist html
for (const { dir } of PATTERNS) visit(dir);

const total = ISSUE_LIST.length;
const totalInputs = inputsScanned;
if (total === 0) {
  console.log(
    '=== Form-Input-Label-Association Audit (v7.7.48) — every form input must have accessible label ===',
  );
  console.log('');
  console.log(
    `Scanned ${inputFilesScanned} HTML page(s) · ${totalInputs} <input|select|textarea> tag(s) · ${totalInputs - skippedInputs} active (non-hidden/non-button/decorative) · ${labelForIds.size} <label for="..."> association(s) · 0 with missing label · 0 issue(s)`,
  );
  console.log('');
  console.log(
    '✓ All form inputs across dist/*.html have accessible labels (label[for=], aria-label, aria-labelledby, content, or title).',
  );
  console.log('');
  process.exit(0);
}

console.log('=== Form-Input-Label-Association Audit (v7.7.48) ===');
console.log('');
console.log(`${total} form input(s) without accessible label:\n`);
for (const issue of ISSUE_LIST) {
  console.log(
    `  ${issue.file}:${issue.line}  <${issue.tag}${issue.type ? ` type="${issue.type}"` : ''}${issue.id ? ` id="${issue.id}"` : ''}>`,
  );
}
console.log('');
console.log(
  'Fix options: add <label for="ID"> wrapping the input, OR add aria-label="..." attribute.',
);
console.log('Skip types (auto-skipped): hidden, submit, button, reset, aria-hidden="true".');
process.exit(1);
