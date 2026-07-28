// check-picture-img-fallback-resolves.mjs — v7.7.40 PICTURE-IMG-FALLBACK-RESOLVES CI GATE
//
// Validates that every <img src=...> INSIDE a <picture> block resolves
// to a file that ACTUALLY EXISTS on disk in dist/. The <img> is the
// fallback for browsers that don't support WebP (rare today, but real
// on older Safari/IE and some embedded browsers). If the <img> src
// points to a 404 file, those browsers silently break.
//
// Companion to the picture-chain gates:
//   v7.7.33 webp-availability (38th)
//   v7.7.34 picture-source-pairing (39th)
//   v7.7.36 picture-count (40th)
//   v7.7.37 picture-source-order (41st)
//   v7.7.38 picture-source-srcset (42nd)
//   v7.7.39 picture-source-srcset-resolves (43rd, validates <source>)
//   v7.7.40 picture-img-fallback-resolves (44th, validates <img>)
//
// Rules enforced:
//   1. img-fallback-unresolved — every <img src="..."> inside a <picture>
//      MUST resolve to a file that exists in dist/ (otherwise legacy
//      browsers silently 404 the entire picture)
//
// Path forms supported:
//   - Absolute site path:   "/proof/foo.jpg"           → dist/proof/foo.jpg
//   - Absolute+BASE_PATH:   "/portfolio/proof/foo.jpg"  → strip prefix → dist/proof/foo.jpg
//   - Relative (workbook):  "figures/01_konigsberg.png" → resolve against dirname(html-file)
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

function findImgSrcValues(inner) {
  // Return array of {offset, srcValue, full, hasSrc}
  const tagRe = /<img\b[^>]*\/?>/gi;
  const tags = [];
  let m;
  while ((m = tagRe.exec(inner)) !== null) {
    const full = m[0];
    const srcMatch = full.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const srcValue = srcMatch ? (srcMatch[1] ?? srcMatch[2] ?? null) : null;
    tags.push({ offset: m.index, srcValue, full, hasSrc: srcMatch !== null });
  }
  return tags;
}

function resolveImgPath(srcValue, htmlFile) {
  // Strip leading whitespace
  const v = (srcValue ?? '').trim();
  if (!v) return { kind: 'empty' };

  // Skip data URIs (base64 inline images — can't 404)
  if (v.startsWith('data:')) return { kind: 'data-uri' };

  // Absolute site path: starts with /
  if (v.startsWith('/')) {
    // Strip BASE_PATH prefix if present (default "/portfolio")
    let p = v;
    if (p.startsWith('/portfolio/')) p = p.slice('/portfolio'.length);
    // Resolve against dist/
    return { kind: 'path', resolved: join(DIST, p) };
  }

  // Relative path: resolve against dirname(html-file)
  return { kind: 'path', resolved: join(dirname(htmlFile), v) };
}

function audit() {
  const issues = [];
  let totalPictureBlocks = 0;
  let blocksWithImg = 0;
  let totalImgs = 0;
  let imgsResolved = 0;
  let imgsUnresolved = 0;
  let imgsSkipped = 0; // data: URIs

  for (const f of walk(DIST)) {
    const html = readFileSync(f, 'utf8');
    const blocks = extractPictureBlocks(html);
    totalPictureBlocks += blocks.length;

    for (const b of blocks) {
      const imgs = findImgSrcValues(b.inner);
      if (imgs.length === 0) continue;
      blocksWithImg++;
      totalImgs += imgs.length;

      for (const i of imgs) {
        if (!i.hasSrc) {
          // No src attribute at all — fail
          imgsUnresolved++;
          issues.push({
            rule: 'img-fallback-unresolved',
            msg: `${f} — <picture> block at offset ${b.start}: <img> has NO src attribute (legacy browsers would 404 the entire picture)`,
          });
          continue;
        }
        const result = resolveImgPath(i.srcValue, f);
        if (result.kind === 'data-uri') {
          imgsSkipped++;
          continue;
        }
        if (result.kind === 'empty') {
          imgsUnresolved++;
          issues.push({
            rule: 'img-fallback-unresolved',
            msg: `${f} — <picture> block at offset ${b.start}: <img src=""> has empty src attribute (legacy browsers would 404 the entire picture)`,
          });
          continue;
        }
        if (existsSync(result.resolved)) {
          imgsResolved++;
        } else {
          imgsUnresolved++;
          issues.push({
            rule: 'img-fallback-unresolved',
            msg: `${f} — <picture> block at offset ${b.start}: <img src="${i.srcValue}"> resolves to "${result.resolved}" which does NOT exist on disk (legacy browsers would 404 the entire picture)`,
          });
        }
      }
    }
  }

  return {
    issues,
    totalPictureBlocks,
    blocksWithImg,
    totalImgs,
    imgsResolved,
    imgsUnresolved,
    imgsSkipped,
  };
}

function main() {
  console.log('=== Picture-Img-Fallback-Resolves Audit (v7.7.40) — every <img> inside <picture> must resolve to an existing file ===\n');

  const { issues, totalPictureBlocks, blocksWithImg, totalImgs, imgsResolved, imgsUnresolved, imgsSkipped } = audit();

  console.log(`Scanned ${totalPictureBlocks} <picture> block(s) · ${blocksWithImg} with <img> · ${totalImgs} <img> tag(s) total · ${imgsResolved} resolved to existing file · ${imgsUnresolved} unresolved · ${imgsSkipped} skipped (data: URIs) · ${issues.length} issue(s)\n`);

  if (issues.length === 0) {
    console.log(`✓ All ${totalImgs} <img> tag(s) inside <picture> resolve to existing files in dist/ (legacy browser fallback guaranteed).`);
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

  console.error(`\nFAIL — ${issues.length} picture-img-fallback-resolves issue(s).`);
  process.exit(1);
}

try {
  main();
} catch (e) {
  console.error('picture-img-fallback-resolves scan crashed:', e);
  process.exit(2);
}
