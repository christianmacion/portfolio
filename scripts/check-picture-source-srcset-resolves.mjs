// check-picture-source-srcset-resolves.mjs — v7.7.39 PICTURE-SOURCE-SRCSET-RESOLVES CI GATE
//
// Validates that every srcset= attribute on a <source> inside <picture>
// resolves to a file that ACTUALLY EXISTS on disk in dist/. A srcset that
// points to a 404 file would silently break WebP delivery — browsers fall
// through to <img> and the user gets the larger PNG/JPG fallback.
//
// Companion to the picture-triad gates:
//   v7.7.33 webp-availability (38th, file-level existence of *.webp siblings)
//   v7.7.34 picture-source-pairing (39th, presence of <picture>+<source>)
//   v7.7.36 picture-count         (40th, count parity)
//   v7.7.37 picture-source-order   (41st, ordering)
//   v7.7.38 picture-source-srcset  (42nd, srcset= attribute present)
//   v7.7.39 picture-source-srcset-resolves (43rd, srcset RESOLVES to a file)
//
// Rules enforced:
//   1. source-srcset-unresolved — every <source srcset="..."> MUST resolve
//      to a file that exists in dist/ (otherwise browsers silently fall
//      through to <img> and ship the larger PNG/JPG)
//
// Path forms supported:
//   - Absolute site path:   "/proof/foo.webp"           → dist/proof/foo.webp
//   - Absolute+BASE_PATH:   "/portfolio/proof/foo.webp"  → strip prefix → dist/proof/foo.webp
//   - Relative (workbook):  "figures/01_konigsberg.webp" → resolve against dirname(html-file)
//
// Exits 1 on any fail. Exits 0 otherwise.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const DIST = 'dist';

function* walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = `${dir}/${e.name}`;
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.endsWith('.html')) yield full;
  }
}

function extractPictureBlocks(html) {
  const blocks = [];
  const re = /<picture\b[^>]*>([\s\S]*?)<\/picture>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    blocks.push({ start: m.index, end: m.index + m[0].length, inner: m[1], full: m[0] });
  }
  return blocks;
}

function findSourceSrcsetValues(inner) {
  // Return array of {offset, srcsetValue, full}
  const tagRe = /<source\b[^>]*\/?>/gi;
  const tags = [];
  let m;
  while ((m = tagRe.exec(inner)) !== null) {
    const full = m[0];
    const srcsetMatch = full.match(/\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const srcsetValue = srcsetMatch ? (srcsetMatch[1] ?? srcsetMatch[2] ?? '') : null;
    if (srcsetValue) tags.push({ offset: m.index, srcsetValue, full });
  }
  return tags;
}

function resolveSrcsetPath(srcsetValue, htmlFile) {
  // Strip leading whitespace
  const v = srcsetValue.trim();

  // Skip srcset descriptors (e.g., "image.webp 2x", "image.webp 480w")
  // For our use case, we take the FIRST URL in the descriptor list
  const firstUrl = v.split(',')[0].trim().split(/\s+/)[0];
  if (!firstUrl) return null;

  // Absolute site path: starts with /
  if (firstUrl.startsWith('/')) {
    // Strip BASE_PATH prefix if present (default "/portfolio")
    let p = firstUrl;
    if (p.startsWith('/portfolio/')) p = p.slice('/portfolio'.length);
    // Resolve against dist/
    return join(DIST, p);
  }

  // Relative path: resolve against dirname(html-file)
  return join(dirname(htmlFile), firstUrl);
}

function audit() {
  const issues = [];
  let totalPictureBlocks = 0;
  let blocksWithSource = 0;
  let totalSources = 0;
  let sourcesResolved = 0;
  let sourcesUnresolved = 0;

  for (const f of walk(DIST)) {
    const html = readFileSync(f, 'utf8');
    const blocks = extractPictureBlocks(html);
    totalPictureBlocks += blocks.length;

    for (const b of blocks) {
      const sources = findSourceSrcsetValues(b.inner);
      if (sources.length === 0) continue;
      blocksWithSource++;
      totalSources += sources.length;

      for (const s of sources) {
        const resolvedPath = resolveSrcsetPath(s.srcsetValue, f);
        if (resolvedPath && existsSync(resolvedPath)) {
          sourcesResolved++;
        } else {
          sourcesUnresolved++;
          issues.push({
            rule: 'source-srcset-unresolved',
            msg: `${f} — <picture> block at offset ${b.start}: <source srcset="${s.srcsetValue}"> resolves to "${resolvedPath}" which does NOT exist on disk (browser would fall through to <img> and ship the larger PNG/JPG fallback)`,
          });
        }
      }
    }
  }

  return {
    issues,
    totalPictureBlocks,
    blocksWithSource,
    totalSources,
    sourcesResolved,
    sourcesUnresolved,
  };
}

function main() {
  console.log('=== Picture-Source-Srcset-Resolves Audit (v7.7.39) — every <source srcset> must resolve to an existing file ===\n');

  const { issues, totalPictureBlocks, blocksWithSource, totalSources, sourcesResolved, sourcesUnresolved } = audit();

  console.log(`Scanned ${totalPictureBlocks} <picture> block(s) · ${blocksWithSource} with <source> · ${totalSources} <source> tag(s) total · ${sourcesResolved} resolved to existing file · ${sourcesUnresolved} unresolved · ${issues.length} issue(s)\n`);

  if (issues.length === 0) {
    console.log(`✓ All ${totalSources} <source> tag(s) resolve to existing files in dist/ (WebP delivery guaranteed).`);
    return;
  }

  const byRule = new Map();
  for (const i of issues) {
    if (!byRule.has(i.rule)) byRule.set(i.rule, []);
    byRule.get(i.rule).push(i.msg);
  }
  for (const [rule, msgs] of byRule) {
    console.log(`\n[${rule}] — ${msgs.length} site(s):`);
    for (const m of msgs.slice(0, 8)) console.log(`  ${m}`);
    if (msgs.length > 8) console.log(`  ... and ${msgs.length - 8} more`);
  }

  console.error(`\nFAIL — ${issues.length} picture-source-srcset-resolves issue(s).`);
  process.exit(1);
}

try {
  main();
} catch (e) {
  console.error('picture-source-srcset-resolves scan crashed:', e);
  process.exit(2);
}
