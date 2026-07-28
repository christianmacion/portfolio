#!/usr/bin/env node
// scripts/check-external-link-target-noopener.mjs
// v7.7.69 — 73rd CI gate
// Catches the OWASP / MDN tabnabbing bug class:
// every <a target="_blank"> element MUST have rel="noopener" or
// rel="noreferrer" (or a rel value that contains either token).
//
// Why:
// When a page opens another origin via target="_blank" without
// rel="noopener", the new tab receives a `window.opener` reference
// back to the originating document. That allows the destination page
// to call window.opener.location = "phishing-url" — silently
// redirecting the source tab to a phishing clone while the user is
// looking at the new tab.
//
// Reference: https://owasp.org/www-community/attacks/Reverse_Tabnabbing
// Reference: https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/rel/noopener
//
// Acceptable rel values (any-of substring match):
//   rel="noopener"
//   rel="noreferrer"
//   rel="noopener noreferrer"
//   rel="noreferrer noopener"
//   rel="..." (any value containing the substring "noopener" or "noreferrer")
//
// Detection strategy: walk src/**/*.astro + src/pages/**/*.md. For every
// <a ...> opening tag that contains target="_blank", check the same
// opening tag (attrs bounded by closing >) also contains rel="..."
// with noopener or noreferrer as a token.
//
// Mutation harness:
//   - M1: inject `<a href="x" target="_blank">x</a>` (no rel) → caught.
//   - M2: inject `<a href="x" target="_blank" rel="noopener noreferrer">x</a>` → pass.
//   - M3: positive control (final revert clean).
//
// Usage: node scripts/check-external-link-target-noopener.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
const SCAN_EXT = new Set(['.astro', '.md']);

// Find every <a ...> opening tag with target="_blank" lacking a safe rel.
function findUnsafeTargetBlank(html, file) {
  const findings = [];
  // Match <a ...attrs...> opening tag (non-greedy, bounded by >).
  // Capture attributes only (group 1), file line of tag start (computed).
  const aRe = /<\s*a\b([^>]*?)>/g;
  let m;
  while ((m = aRe.exec(html)) !== null) {
    const attrs = m[1];
    if (!/target\s*=\s*["']_blank["']/i.test(attrs)) continue;
    // Check for rel="..." with noopener or noreferrer token.
    const relMatch = /\brel\s*=\s*["']([^"']+)["']/i.exec(attrs);
    const relValue = relMatch ? relMatch[1].toLowerCase() : '';
    const hasSafeRel =
      relValue && (relValue.includes('noopener') || relValue.includes('noreferrer'));
    if (!hasSafeRel) {
      const line = lineOf(html, m.index);
      // Extract href for diagnostic context (best-effort).
      const hrefMatch = /\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(attrs);
      const href = hrefMatch ? hrefMatch[1] : '?';
      findings.push({ file, line, href, attrs: attrs.trim() });
    }
  }
  return findings;
}

function lineOf(haystack, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < haystack.length; i++) if (haystack.charCodeAt(i) === 10) line++;
  return line;
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

async function main() {
  console.log(
    '=== External-Link target=_blank rel=noopener Audit (v7.7.69) — OWASP reverse-tabnabbing guard ===\n',
  );

  const files = walk(ROOT);
  const allFindings = [];

  for (const file of files) {
    const html = readFileSync(file, 'utf8');
    const findings = findUnsafeTargetBlank(html, file);
    allFindings.push(...findings);
  }

  console.log(
    `Scanned ${files.length} source file(s) · ${allFindings.length} unsafe target="_blank" without rel="noopener|noreferrer"\n`,
  );

  if (allFindings.length === 0) {
    console.log(
      '✓ Every <a target="_blank"> element has rel="noopener" or rel="noreferrer".',
    );
    return;
  }

  console.error(
    `FAIL — ${allFindings.length} <a target="_blank"> element(s) without safe rel:\n`,
  );
  for (const f of allFindings) {
    console.error(`  ✗ ${f.file}:${f.line}  href="${f.href}"`);
    console.error(`    attrs: ${f.attrs.slice(0, 140)}${f.attrs.length > 140 ? '…' : ''}`);
  }
  console.error(
    '\nFix: add rel="noopener" (or rel="noopener noreferrer") to the <a target="_blank"> element to prevent reverse-tabnabbing.',
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('external-link-target-noopener scan crashed:', e);
  process.exit(2);
});