// check-picture-source-pairing.mjs — v7.7.34 PICTURE-SOURCE-PAIRING CI GATE
//
// Companion to v7.7.33 webp-availability. Catches <img src="*.png|jpg|jpeg">
// tags that are NOT wrapped in <picture> with a sibling <source type="image/webp">.
// The webp-availability gate (v7.7.33) ensures WebP files EXIST in dist/. This
// gate ensures they're REFERENCED via <picture><source type="image/webp"> so
// browsers that support WebP actually pick WebP over the raster.
//
// Without <picture>, browsers always fetch the raster (the <img src>)
// regardless of WebP support. <picture> + <source> lets browsers pick
// the first format they support.
//
// Rules enforced:
//   1. missing-picture-wrapper — every <img src="*.png|jpg|jpeg"> SHOULD be
//      inside <picture> with sibling <source type="image/webp" srcset="*.webp">
//   2. (Skips) <img> with data-no-webp="1" (already opted out of WebP)
//   3. (Skips) <img src="*.webp"> (already serving WebP)
//
// Exits 1 on any fail. Exits 0 otherwise.

import { readFileSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const DIST = 'dist';

function* walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.endsWith('.html')) yield full;
  }
}

function extractImgTags(html) {
  const tags = [];
  const re = /<img\b([^>]*?)\/?>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const srcMatch = attrs.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/);
    const optOut = /\bdata-no-webp\s*=\s*"?1"?/i.test(attrs);
    if (!srcMatch) continue;
    const src = srcMatch[1] || srcMatch[2] || srcMatch[3];
    tags.push({
      src,
      optOut,
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return tags;
}

function isInsidePicture(html, imgStart) {
  // Look backwards from imgStart for the nearest <picture ...> opening tag
  // that's not closed. If we find one before any </picture>, the img is inside.
  const before = html.slice(0, imgStart);
  const lastOpen = before.lastIndexOf('<picture');
  if (lastOpen === -1) return false;
  const lastClose = before.lastIndexOf('</picture>');
  if (lastClose > lastOpen) return false;
  // Confirm the <picture> tag actually opens (not <picturebook> or similar)
  const afterOpen = html.slice(lastOpen, lastOpen + 9);
  if (!/^<picture[\s>]/.test(afterOpen)) return false;
  return true;
}

function hasWebpSourceBefore(html, imgStart) {
  // Between <picture> opening and <img>, is there a <source ... type="image/webp" ...>?
  const before = html.slice(0, imgStart);
  const lastOpen = before.lastIndexOf('<picture');
  if (lastOpen === -1) return false;
  const segment = html.slice(lastOpen, imgStart);
  return /<source\b[^>]*type=["']image\/webp["'][^>]*>/i.test(segment);
}

function audit() {
  const issues = [];
  let totalImgs = 0;
  let rasterImgs = 0;
  let webpSrc = 0;
  let optedOut = 0;
  let pictureWrapped = 0;
  let pictureButNoWebpSource = 0;

  for (const f of walk(DIST)) {
    const html = readFileSync(f, 'utf8');
    const tags = extractImgTags(html);
    totalImgs += tags.length;

    for (const tag of tags) {
      const ext = extname(tag.src).toLowerCase();
      if (ext === '.webp') {
        webpSrc++;
        continue;
      }
      if (!['.png', '.jpg', '.jpeg'].includes(ext)) continue;
      rasterImgs++;

      if (tag.optOut) {
        optedOut++;
        continue;
      }

      if (!isInsidePicture(html, tag.start)) {
        issues.push({
          rule: 'missing-picture-wrapper',
          msg: `${f} — <img src="${tag.src}"> not wrapped in <picture> with <source type="image/webp"> (modern browsers won't pick WebP)`,
        });
        continue;
      }
      pictureWrapped++;

      if (!hasWebpSourceBefore(html, tag.start)) {
        issues.push({
          rule: 'missing-webp-source',
          msg: `${f} — <img src="${tag.src}"> inside <picture> but missing <source type="image/webp"> preceding it`,
        });
        pictureButNoWebpSource++;
      }
    }
  }

  return { issues, totalImgs, rasterImgs, webpSrc, optedOut, pictureWrapped, pictureButNoWebpSource };
}

function main() {
  console.log('=== Picture-Source-Pairing Audit (v7.7.34) — <picture><source type=image/webp> wrapping raster <img> ===\n');

  const { issues, totalImgs, rasterImgs, webpSrc, optedOut, pictureWrapped, pictureButNoWebpSource } = audit();

  console.log(`Scanned ${totalImgs} <img> tag(s) · ${rasterImgs} raster (PNG/JPG) · ${webpSrc} already-webp · ${optedOut} opted out · ${pictureWrapped} picture-wrapped · ${pictureButNoWebpSource} picture-but-no-webp-source · ${issues.length} issue(s)\n`);

  if (issues.length === 0) {
    console.log(`✓ All ${rasterImgs} raster <img> tags are inside <picture> with <source type="image/webp"> (browsers will pick WebP).`);
    return;
  }

  const byRule = new Map();
  for (const i of issues) {
    if (!byRule.has(i.rule)) byRule.set(i.rule, []);
    byRule.get(i.rule).push(i.msg);
  }
  for (const [rule, msgs] of byRule) {
    console.log(`\n[${rule}] — ${msgs.length} site(s):`);
    for (const m of msgs.slice(0, 10)) console.log(`  ${m}`);
    if (msgs.length > 10) console.log(`  ... and ${msgs.length - 10} more`);
  }

  console.error(`\nFAIL — ${issues.length} picture-source-pairing issue(s).`);
  process.exit(1);
}

try {
  main();
} catch (e) {
  console.error('picture-source-pairing scan crashed:', e);
  process.exit(2);
}