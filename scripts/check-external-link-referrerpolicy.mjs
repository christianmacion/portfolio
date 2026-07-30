#!/usr/bin/env node
// scripts/check-external-link-referrerpolicy.mjs
// v7.7.70 — 74th CI gate
// Catches the privacy / referrer-leak bug class:
// every <a target="_blank"> element MUST have referrerpolicy="..." (a
// non-empty value). Without it, the browser sends the FULL URL of the
// current page (including path + query string) in the Referer header
// to the destination.
//
// Why:
// The default browser referrer policy leaks the originating URL path
// to third-party destinations. For pages with sensitive URLs (search
// queries, internal IDs, A/B test variants), this leaks analytics +
// user-state to the destination. Referrer-Policy lets the author
// downgrade this to no-referrer (full leak prevention) or
// strict-origin-when-cross-origin (only the origin is sent).
//
// Reference: https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/referrerpolicy
// Reference: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referrer-Policy
//
// Detection strategy: walk src/**/*.astro + src/pages/**/*.md. For every
// <a ...> opening tag with target="_blank", check the same opening tag
// declares a non-empty referrerpolicy="..." attribute.
//
// Companion to v7.7.69 (external-link-target-noopener). Together they
// form the external-link hardening pair (noopener for tabnabbing +
// referrerpolicy for privacy).
//
// Mutation harness:
//   - M1: inject `<a href="x" target="_blank" rel="noopener">x</a>` (no referrerpolicy) → caught.
//   - M2: inject `<a href="x" target="_blank" referrerpolicy="strict-origin-when-cross-origin">x</a>` → pass.
//   - M3: positive control (final revert clean).
//
// Usage: node scripts/check-external-link-referrerpolicy.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
const SCAN_EXT = new Set(['.astro', '.md']);

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

// Find every <a ...> opening tag with target="_blank" lacking referrerpolicy.
function findMissingReferrerpolicy(html, file) {
  const findings = [];
  const aRe = /<\s*a\b([^>]*?)>/g;
  let m;
  while ((m = aRe.exec(html)) !== null) {
    const attrs = m[1];
    if (!/target\s*=\s*["']_blank["']/i.test(attrs)) continue;
    const rpMatch = /\breferrerpolicy\s*=\s*["']([^"']+)["']/i.exec(attrs);
    const rpValue = rpMatch ? rpMatch[1].trim() : '';
    if (!rpValue) {
      const line = lineOf(html, m.index);
      const hrefMatch = /\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(attrs);
      const href = hrefMatch ? hrefMatch[1] : '?';
      findings.push({ file, line, href, attrs: attrs.trim() });
    }
  }
  return findings;
}

async function main() {
  console.log(
    '=== External-Link target=_blank referrerpolicy Audit (v7.7.70) — referrer-leak guard ===\n',
  );

  const files = walk(ROOT);
  const allFindings = [];

  for (const file of files) {
    const html = readFileSync(file, 'utf8');
    const findings = findMissingReferrerpolicy(html, file);
    allFindings.push(...findings);
  }

  console.log(
    `Scanned ${files.length} source file(s) · ${allFindings.length} <a target="_blank"> without referrerpolicy\n`,
  );

  if (allFindings.length === 0) {
    console.log(
      '✓ Every <a target="_blank"> element declares referrerpolicy="...".',
    );
    return;
  }

  console.error(
    `FAIL — ${allFindings.length} <a target="_blank"> element(s) without referrerpolicy:\n`,
  );
  for (const f of allFindings) {
    console.error(`  ✗ ${f.file}:${f.line}  href="${f.href}"`);
    console.error(`    attrs: ${f.attrs.slice(0, 140)}${f.attrs.length > 140 ? '…' : ''}`);
  }
  console.error(
    '\nFix: add referrerpolicy="strict-origin-when-cross-origin" (or no-referrer) to every <a target="_blank"> element to prevent referrer URL leakage.',
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('external-link-referrerpolicy scan crashed:', e);
  process.exit(2);
});