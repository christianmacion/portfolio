#!/usr/bin/env node
// scripts/check-page-title-uniqueness.mjs
// v7.7.84 — 87th CI gate
// Catches the WCAG 2.4.2 (Page Titled, Level A) conformance bug class:
// every page MUST have a <title>, the title MUST be unique across the
// built site (case-insensitive after trim), and the title MUST be
// between 10 and 90 characters so it stays readable in tab strips,
// search results, and accessibility trees.
//
// We scan dist/ (post-build) because titles are computed from a mix
// of literal strings and Astro expressions (e.g. `title={profile.titles.primary}`)
// that resolve at build time. The built HTML is the user-visible truth.
//
// Rules enforced:
//   1. Each built page MUST have a <title>...</title> tag.
//   2. <title> MUST NOT be empty or whitespace-only.
//   3. <title> MUST be 10–90 characters (trimmed).
//   4. <title> MUST be unique across the site (case-insensitive).
//   5. <title> MUST NOT match the build placeholder "Christian T. Macion"
//      alone — it must carry disambiguation (role, page name, etc.).
//
// Mutation harness:
//   - M1: two pages with same <title> → caught (uniqueness).
//   - M2: <title> = "" → caught (presence + non-empty).
//   - M3: <title> = "A" → caught (length min).
//   - M4: <title> = "a".repeat(91) → caught (length max).
//   - M5: <title> = "Christian T. Macion" → caught (disambiguation).
//
// Usage: node scripts/check-page-title-uniqueness.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = 'dist';
const SKIP_PATHS = new Set([
  // sitemap + RSS feeds are not user-visible pages; they may have their own
  // title strings or none at all. We skip them to keep the gate focused on
  // navigable routes.
  'sitemap-0.xml',
  'sitemap-index.xml',
  'rss.xml',
]);
const MIN_LEN = 10;
const MAX_LEN = 90;

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, files);
    else if (entry.endsWith('.html')) files.push(full);
  }
  return files;
}

function extractTitle(html) {
  // Match the FIRST <title>...</title> (per HTML5 spec, only one allowed).
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  // Strip inline tags (rare but allowed per spec) and collapse whitespace.
  const raw = m[1]
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return raw;
}

function disambiguatable(title) {
  // A title that is ONLY the bare person-name is too generic to distinguish
  // tabs (recruiters open 10+ tabs). Require at least 2 word tokens or a
  // pipe / dash separator.
  if (!title) return false;
  if (title === 'Christian T. Macion') return false;
  // Allow if it contains a separator OR has more than 2 words.
  if (/[|·—-]/.test(title)) return true;
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length >= 3) return true;
  return false;
}

async function main() {
  console.log(
    '=== Page-Title-Uniqueness Audit (v7.7.84) — WCAG 2.4.2 conformance ===\n',
  );

  let files;
  try {
    files = walk(DIST).filter((f) => !SKIP_PATHS.has(relative(DIST, f)));
  } catch (e) {
    console.error(
      `dist/ not found — run \`npm run build\` before this gate. (${e.message})`,
    );
    process.exit(2);
  }

  const findings = [];
  const titleMap = new Map(); // normalized title → array of files
  let scanned = 0;

  for (const file of files) {
    scanned++;
    const html = readFileSync(file, 'utf8');
    const title = extractTitle(html);

    if (title === null) {
      findings.push({
        file: relative(DIST, file),
        kind: 'missing',
        detail: 'no <title> element',
      });
      continue;
    }
    if (title.length === 0) {
      findings.push({
        file: relative(DIST, file),
        kind: 'empty',
        detail: '<title> is empty or whitespace-only',
      });
      continue;
    }
    if (title.length < MIN_LEN) {
      findings.push({
        file: relative(DIST, file),
        kind: 'too-short',
        detail: `<title> is ${title.length} chars; minimum is ${MIN_LEN}`,
      });
    }
    if (title.length > MAX_LEN) {
      findings.push({
        file: relative(DIST, file),
        kind: 'too-long',
        detail: `<title> is ${title.length} chars; maximum is ${MAX_LEN}`,
      });
    }
    if (!disambiguatable(title)) {
      findings.push({
        file: relative(DIST, file),
        kind: 'bare-name',
        detail:
          '<title> is the bare person-name with no disambiguation (role, page, separator)',
      });
    }

    const key = title.toLowerCase();
    if (!titleMap.has(key)) titleMap.set(key, []);
    titleMap.get(key).push({ file: relative(DIST, file), title });
  }

  // Uniqueness findings — duplicate titles across files.
  for (const [_key, entries] of titleMap) {
    if (entries.length > 1) {
      for (const e of entries) {
        findings.push({
          file: e.file,
          kind: 'duplicate',
          detail: `<title> "${entries[0].title}" is shared by ${entries.length} page(s) (case-insensitive): ${entries
            .map((x) => x.file)
            .join(', ')}`,
        });
      }
    }
  }

  console.log(
    `Scanned ${scanned} built HTML page(s) · ${findings.length} title violation(s)\n`,
  );

  if (findings.length === 0) {
    console.log(
      `✓ Every page has a unique <title> (${MIN_LEN}–${MAX_LEN} chars, disambiguated).`,
    );
    return;
  }

  console.error(`FAIL — ${findings.length} page-title violation(s):\n`);
  for (const f of findings) {
    console.error(`  ✗ ${f.file}  [${f.kind}]  ${f.detail}`);
  }
  console.error(
    `\nFix: pass a unique \`title="..."\` prop to <BaseLayout> on every page.`,
  );
  console.error(
    'Reference: WCAG 2.4.2 https://www.w3.org/WAI/WCAG22/Understanding/page-titled',
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('page-title-uniqueness scan crashed:', e);
  process.exit(2);
});