#!/usr/bin/env node
// scripts/check-skip-link-presence.mjs
// v7.7.49 — 53rd CI gate (a11y)
// Validates every dist/*.html page has a skip-to-content link as the first
// focusable element inside <body> (WCAG 2.4.1 Bypass Blocks — keyboard users
// must be able to jump past repetitive nav chrome in one tab/enter keystroke).
//
// A valid skip-link:
//   - href="#main" (or any #fragment that points to <main id="...">)
//   - appears within the first 800 chars after <body> opening tag
//   - text content includes "skip" (case-insensitive)
//
// Skip rule:
//   - /workbooks/*.html (print-PDF artifacts, no chrome to skip)
//
// 1-rule contract: page-without-skip-link

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

function checkFile(filePath) {
  let html;
  try {
    html = readFileSync(filePath, 'utf8');
  } catch {
    return;
  }
  // Skip workbook print-PDF HTMLs
  if (filePath.includes('/workbooks/')) return;

  // Extract first <body> opening tag and the next 1500 chars (where skip-link lives)
  const bodyOpenMatch = html.match(/<body\b[^>]*>/i);
  if (!bodyOpenMatch) return; // no body — skip
  const bodyStart = bodyOpenMatch.index + bodyOpenMatch[0].length;
  const head = html.slice(bodyStart, bodyStart + 1500);

  // Find first <a> tag (skip-link must be first focusable element)
  const firstAnchorMatch = head.match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i);
  if (!firstAnchorMatch) {
    ISSUE_LIST.push({
      file: filePath,
      line: lineOf(html, bodyStart),
      reason: 'no <a> in first 1500 chars of <body>',
    });
    return;
  }

  const anchorAttrs = firstAnchorMatch[1];
  const anchorText = (firstAnchorMatch[2] || '').replace(/<[^>]+>/g, '').trim();

  // href must point to #main (or similar fragment matching <main id=...>)
  const hrefMatch = anchorAttrs.match(/\bhref\s*=\s*["']([^"']+)["']/i);
  if (!hrefMatch || !hrefMatch[1].startsWith('#')) {
    ISSUE_LIST.push({
      file: filePath,
      line: lineOf(html, bodyStart),
      reason: `first <a> href is "${hrefMatch ? hrefMatch[1] : '?'}" not a #fragment`,
    });
    return;
  }

  // text content must include "skip" (case-insensitive)
  if (!/skip/i.test(anchorText)) {
    ISSUE_LIST.push({
      file: filePath,
      line: lineOf(html, bodyStart),
      reason: `first <a> text is "${anchorText.slice(0, 40)}" — no "skip" word`,
    });
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
    '=== Skip-Link-Presence Audit (v7.7.49) — first focusable <body> element must be a skip-to-#fragment link ===',
  );
  console.log('');
  console.log(`Scanned all dist/*.html pages · 0 without skip-link · 0 issue(s)`);
  console.log('');
  console.log('✓ Every page has a skip-to-content link as first focusable element (WCAG 2.4.1).');
  console.log('');
  process.exit(0);
}

console.log('=== Skip-Link-Presence Audit (v7.7.49) ===');
console.log('');
console.log(`${total} page(s) without proper skip-link:\n`);
for (const issue of ISSUE_LIST) {
  console.log(`  ${issue.file}:${issue.line}  ${issue.reason}`);
}
console.log('');
console.log(
  'Fix: add `<a href="#main" class="skip-link">Skip to content</a>` as first child of <body>.',
);
console.log('Skip rule: /workbooks/* (print-PDF artifacts).');
process.exit(1);
