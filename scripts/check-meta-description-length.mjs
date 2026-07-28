#!/usr/bin/env node
// scripts/check-meta-description-length.mjs
// v7.7.66 — 70th CI gate
// Catches the SEO + recruiter-preview bug class:
// every page must declare a meta description that fits the 70-200 char
// sweet spot for LinkedIn/Slack preview + Google rich-results.
//
// Reference:
// - LinkedIn truncates ~155 chars (post-2024 ~210)
// - Slack preview truncates ~150 chars
// - Google rich-results prefers 70-160 chars
// - <meta name="description" content="..."> is the SEO source of truth
//
// Why 70 minimum?
//   Below 70 chars the description is too sparse to convey value to a
//   recruiter scanning search results. The page "looks thin" in SERPs.
//
// Why 200 maximum?
//   LinkedIn + Slack + Twitter truncate beyond ~200 chars. Anything
//   longer is invisible to the actual preview surface.
//
// Detection strategy: walk src/pages/**/*.astro + src/components/**/*.astro.
// For every <BaseLayout ... description="literal"> opening tag (description
// passed as a string literal in JSX), validate the literal is 70-200 chars.
// JSX expression values (description={var}) are skipped — gate can't
// statically trace the runtime value of `var`.
//
// Out of scope:
//   - Description passed via JSX expression (description={var}) — gate
//     skips these as the value is determined at runtime.
//   - Description sourced from a layout helper that doesn't pass through
//     BaseLayout's `description` prop.
//
// Mutation harness:
//   - M1: shorten description to 40 chars → caught.
//   - M2: lengthen description to 250 chars → caught.
//   - M3: positive control (final revert clean).
//
// Usage: node scripts/check-meta-description-length.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
const SCAN_EXT = new Set(['.astro']);

const MIN_LEN = 70;
const MAX_LEN = 200;

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, files);
    else if (SCAN_EXT.has(full.slice(full.lastIndexOf('.')))) files.push(full);
  }
  return files;
}

function lineOf(haystack, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < haystack.length; i++) if (haystack.charCodeAt(i) === 10) line++;
  return line;
}

// Find every `<BaseLayout ... description="literal">` opening tag and check
// the literal length. Handles description that spans multiple lines via
// [\s\S] in the multiline regex.
function findDescriptionIssues(html, file) {
  const findings = [];
  // Match <BaseLayout ... description="literal"...> with description on the
  // same tag (multi-line allowed). The capture group is the literal value.
  const re = /<\s*BaseLayout\b([^>]*?)description\s*=\s*"([^"]+)"([^>]*)>/gms;
  let m;
  while ((m = re.exec(html)) !== null) {
    const desc = m[2];
    const len = desc.length;
    if (len < MIN_LEN || len > MAX_LEN) {
      findings.push({
        file,
        line: lineOf(html, m.index),
        length: len,
        description: desc,
      });
    }
  }
  return findings;
}

async function main() {
  console.log('=== Meta Description Length Audit (v7.7.66) — SEO / LinkedIn-Slack preview ===\n');
  console.log(`Acceptable range: ${MIN_LEN}..${MAX_LEN} chars (LinkedIn/Slack truncation sweet spot)\n`);

  const files = walk(ROOT);
  const allFindings = [];
  let scannedCount = 0;

  for (const file of files) {
    const html = readFileSync(file, 'utf8');
    // Count every <BaseLayout ... description="literal"> for the report footer.
    const re = /<\s*BaseLayout\b([^>]*?)description\s*=\s*"([^"]+)"/gms;
    let _m;
    while ((_m = re.exec(html)) !== null) scannedCount++;
    const findings = findDescriptionIssues(html, file);
    allFindings.push(...findings);
  }

  console.log(
    `Scanned ${files.length} source file(s) · ${scannedCount} literal description(s) · ${allFindings.length} out-of-range\n`,
  );

  if (allFindings.length === 0) {
    console.log(`✓ Every literal meta description is ${MIN_LEN}..${MAX_LEN} chars.`);
    return;
  }

  console.error(`FAIL — ${allFindings.length} meta description(s) outside ${MIN_LEN}..${MAX_LEN} chars:\n`);
  for (const f of allFindings) {
    const direction = f.length < MIN_LEN ? 'TOO SHORT' : 'TOO LONG';
    console.error(`  ✗ ${f.file}:${f.line}  ${direction}: ${f.length} chars`);
    console.error(`      "${f.description.slice(0, 100)}${f.description.length > 100 ? '…' : ''}"`);
  }
  console.error(
    `\nFix: rewrite description to be ${MIN_LEN}..${MAX_LEN} chars. SEO + LinkedIn/Slack preview surface`,
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('meta-description-length scan crashed:', e);
  process.exit(2);
});
