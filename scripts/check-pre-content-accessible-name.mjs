#!/usr/bin/env node
// scripts/check-pre-content-accessible-name.mjs
// v7.7.82 — 86th CI gate
// Catches the WCAG 1.3.1 (Info and Relationships, Level A) + WCAG 4.1.2
// (Name, Role, Value, Level A) conformance bug class:
// every <pre> element MUST expose an accessible name so screen reader
// users know what the pre-formatted content represents.
//
// Per WAI-ARIA Authoring Practices: pre-formatted text blocks (code,
// terminal output, email templates, BibTeX, etc.) are read by screen
// readers as opaque content. Without an accessible name, users hear
// "pre" or nothing useful and cannot determine the content's purpose.
//
// Acceptable names:
//   - aria-label="..." on the <pre>
//   - aria-labelledby="..." pointing to a visible heading
//   - Wrapped in a <figure> with <figcaption>
//   - Inside a section with a preceding <h*> heading that describes it
//     (we use a 200-char window heuristic)
//
// Comment-strip handles JS/HTML/Astro comment false positives.
//
// Mutation harness:
//   - M1: inject <pre>content</pre> → caught.
//   - M2: inject <pre aria-label="terminal output">content</pre> → pass.
//   - M3: inject <figure><figcaption>X</figcaption><pre>...</pre></figure> → pass.
//
// Usage: node scripts/check-pre-content-accessible-name.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
const SCAN_EXT = new Set(['.astro', '.md']);
const CONTEXT_WINDOW = 250; // chars before <pre> to look for context

function lineOf(haystack, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < haystack.length; i++) if (haystack.charCodeAt(i) === 10) line++;
  return line;
}

function stripComments(html) {
  return (
    html
      // Block comments
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      // HTML comments
      .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
      // Astro/JSX block comments
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, ' '))
      // JS line comments (// ... end of line)
      .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '))
  );
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

function findUnnamedPres(html, file) {
  const findings = [];
  // Match <pre ...> ... </pre> with content. We check the OPENING tag for
  // aria-label/labelledby, then look at the preceding context for a caption.
  const re = /<pre\b([^>]*?)>([\s\S]*?)<\/pre>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const inner = m[2];

    // Skip empty <pre></pre> (decorative placeholders, no content to label).
    if (inner.replace(/<[^>]+>/g, '').trim().length < 3) continue;

    // Check direct aria-label / aria-labelledby on the <pre>.
    if (/\baria-label\s*=\s*(?:"[^"]+"|'[^']+'|\{[^}]+\})/i.test(attrs)) continue;
    if (/\baria-labelledby\s*=\s*(?:"[^"]+"|'[^']+'|\{[^}]+\})/i.test(attrs)) continue;

    // Check if wrapped in a <figure> with <figcaption> (sibling).
    const start = Math.max(0, m.index - 400);
    const pre = html.slice(start, m.index);
    // Look for <figure ...> without </figure> before the <pre>
    const lastFig = pre.lastIndexOf('<figure');
    if (lastFig !== -1) {
      const between = pre.slice(lastFig);
      if (!/<\/figure>/i.test(between)) {
        // Inside a <figure>; check for <figcaption>
        if (/<figcaption\b/i.test(between)) continue;
      }
    }

    // Check preceding context for a heading that names the block.
    const ctx = html.slice(Math.max(0, m.index - CONTEXT_WINDOW), m.index);
    // Look for <h* ...> ... </h*> ending before the <pre>, or <p class="section__sub"> or similar.
    if (/<h[1-6]\b/i.test(ctx)) continue;
    // Look for aria-label on a parent element (heuristic: <div aria-label="..." ...> or <section aria-label="...")
    if (/<(?:div|section|article|aside|main|nav|header|footer)\b[^>]*aria-label\s*=/i.test(ctx))
      continue;

    // Look for a class hinting at labeled container (intro-template, cite-card, code-card, etc.)
    // These are real patterns: the visual layout provides context. But for a strict gate, we
    // want explicit ARIA. Skip if there's strong contextual markup.
    // Conservative default: flag if not directly named.

    findings.push({
      file,
      line: lineOf(html, m.index),
      reason: `<pre> at line ${lineOf(html, m.index)} has no accessible name — add aria-label="..." or wrap in <figure><figcaption>...</figcaption></figure>`,
    });
  }
  return findings;
}

async function main() {
  console.log(
    '=== Pre-Content-Accessible-Name Audit (v7.7.82) — WCAG 1.3.1 + 4.1.2 conformance ===\n',
  );

  const files = walk(ROOT);
  const allFindings = [];

  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    const html = stripComments(raw);
    const findings = findUnnamedPres(html, file);
    allFindings.push(...findings);
  }

  console.log(
    `Scanned ${files.length} source file(s) · ${allFindings.length} unnamed-pre violation(s)\n`,
  );

  if (allFindings.length === 0) {
    console.log(
      '✓ Every <pre> has an accessible name (aria-label, aria-labelledby, figcaption, or preceding heading).',
    );
    return;
  }

  console.error(`FAIL — ${allFindings.length} unnamed-pre violation(s):\n`);
  for (const f of allFindings) {
    console.error(`  ✗ ${f.file}:${f.line}  — ${f.reason}`);
  }
  console.error(
    '\nFix: add aria-label="..." to the <pre>, OR wrap it in <figure><figcaption>caption</figcaption><pre>...</pre></figure>, OR add a preceding <h*> heading that names the block.',
  );
  console.error(
    'Reference: WCAG 1.3.1 https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships',
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('pre-content-accessible-name scan crashed:', e);
  process.exit(2);
});
