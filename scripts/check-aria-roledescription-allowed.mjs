#!/usr/bin/env node
// scripts/check-aria-roledescription-allowed.mjs
// v7.7.81 — 85th CI gate
// Catches the WAI-ARIA 1.2 §6.6.7 conformance bug class:
// aria-roledescription is ONLY meaningful on elements that have an explicit
// role attribute. Without role, the attribute is silently ignored by
// assistive tech.
//
// Per WAI-ARIA 1.2 spec: "Authors MUST NOT use the aria-roledescription
// property on elements that do not have an explicit WAI-ARIA role."
// Reference: https://www.w3.org/TR/wai-aria-1.2/#aria-roledescription
//
// Common usage: ARIA Authoring Practices Guide (APG) carousel pattern
//   <div role="group" aria-roledescription="carousel" aria-label="...">
//     <article role="group" aria-roledescription="slide" aria-label="...">
//       ...
//     </article>
//   </div>
//
// Without role, both aria-roledescription and the role semantics are lost.
//
// Comment-strip handles JS/HTML/Astro comment false positives.
//
// Mutation harness:
//   - M1: inject <div aria-roledescription="carousel"> → caught.
//   - M2: inject <div role="group" aria-roledescription="carousel"> → pass.
//   - M3: inject <article role="group" aria-roledescription="slide"> → pass.
//
// Usage: node scripts/check-aria-roledescription-allowed.mjs

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

// Find each aria-roledescription attribute; check the tag that contains it
// has an explicit role= attribute.
function findMisingRole(html, file) {
  const findings = [];
  const re = /\baria-roledescription\s*=\s*(?:"[^"]+"|'[^']+'|\{[^}]+\})/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    // Walk backward to find the most recent <tag opening before m.index.
    // We need to find the start of the opening tag that contains this attr.
    const start = Math.max(0, m.index - 600);
    const pre = html.slice(start, m.index);
    // Find the LAST <tag ... > opening tag that isn't yet closed.
    // Match <tagName followed by attrs, ending right before the aria-roledescription.
    // Use the regex <([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)$ matching up to current pos.
    const tagMatch = /<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)$/i.exec(pre);
    if (!tagMatch) continue;
    const tagName = tagMatch[1];
    const tagAttrs = tagMatch[2];
    // Has role attribute?
    const hasRole = /\brole\s*=\s*(?:"[^"]+"|'[^']+'|\{[^}]+\})/i.test(tagAttrs);
    if (!hasRole) {
      findings.push({
        file,
        line: lineOf(html, m.index),
        tag: tagName,
        reason: `<${tagName}> has aria-roledescription but no role attribute — WAI-ARIA 1.2 §6.6.7 requires explicit role`,
      });
    }
  }
  return findings;
}

async function main() {
  console.log(
    '=== Aria-RoleDescription-Allowed Audit (v7.7.81) — WAI-ARIA 1.2 §6.6.7 conformance ===\n',
  );

  const files = walk(ROOT);
  const allFindings = [];

  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    const html = stripComments(raw);
    const findings = findMisingRole(html, file);
    allFindings.push(...findings);
  }

  console.log(
    `Scanned ${files.length} source file(s) · ${allFindings.length} aria-roledescription-without-role violation(s)\n`,
  );

  if (allFindings.length === 0) {
    console.log(
      '✓ Every aria-roledescription attribute is paired with an explicit role= attribute on the same element.',
    );
    return;
  }

  console.error(`FAIL — ${allFindings.length} aria-roledescription-without-role violation(s):\n`);
  for (const f of allFindings) {
    console.error(`  ✗ ${f.file}:${f.line}  — ${f.reason}`);
  }
  console.error(
    '\nFix: add role="..." to the element (e.g., role="group" for a carousel container, role="tabpanel" for a tab panel). Without an explicit role, aria-roledescription is silently ignored by assistive tech.',
  );
  console.error(
    'Reference: WAI-ARIA 1.2 §6.6.7 https://www.w3.org/TR/wai-aria-1.2/#aria-roledescription',
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('aria-roledescription-allowed scan crashed:', e);
  process.exit(2);
});
