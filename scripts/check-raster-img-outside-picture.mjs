// check-raster-img-outside-picture.mjs — v7.7.41 RASTER-IMG-OUTSIDE-PICTURE CI GATE
//
// Validates that every raster <img src="*.png|*.jpg|*.jpeg"> in dist/ is
// wrapped inside a <picture> block. The inverse of v7.7.34 picture-source-
// pairing (which validates imgs IN <picture> are correctly structured).
//
// Catches the bug class:
//   <img src="/foo.jpg" alt="..." />           ← NOT inside <picture>
//   instead of:
//   <picture>
//     <source type="image/webp" srcset="/foo.webp" />
//     <img src="/foo.jpg" alt="..." />
//   </picture>
//
// Why this matters: any unwrapped raster img means the browser gets the
// larger PNG/JPG instead of the optimized WebP. This is exactly the
// optimization v7.7.33 → v7.7.40 enforces, but only for imgs that ARE
// in <picture>. This gate closes the loop by finding imgs that AREN'T.
//
// Skips:
//   - _astro/* (Astro-generated optimized images are already WebP)
//   - favicon-*.png (browser-required PNG, can't be WebP)
//   - og-image*.jpg (crawler-only, not user-visible)
//
// Rules enforced:
//   1. raster-img-outside-picture — every raster <img src=*.png|*.jpg|*.jpeg>
//      (excluding favicon + og + _astro) MUST be inside a <picture> block
//
// Exits 1 on any fail. Exits 0 otherwise.

import { readFileSync, readdirSync } from 'node:fs';

const DIST = 'dist';

function* walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = `${dir}/${e.name}`;
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.endsWith('.html')) yield full;
  }
}

function isSkippedSrc(src) {
  // Skip _astro/* (Astro auto-generated WebP)
  if (src.startsWith('/_astro/')) return true;
  // Skip favicon-*.png (browser-required PNG)
  if (/\/favicon-[^/]*\.png$/i.test(src)) return true;
  // Skip og-image*.jpg (crawler-only)
  if (/\/og-image[^/]*\.jpe?g$/i.test(src)) return true;
  return false;
}

function isRasterImgSrc(src) {
  return /\.(png|jpg|jpeg)(\?.*)?$/i.test(src);
}

function extractPictureRanges(html) {
  // Return array of {start, end} for each <picture>...</picture> block
  const ranges = [];
  const re = /<picture\b[^>]*>([\s\S]*?)<\/picture>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length });
  }
  return ranges;
}

function findImgTags(html) {
  // Return array of {offset, srcValue, full}
  const tagRe = /<img\b[^>]*\/?>/gi;
  const tags = [];
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const full = m[0];
    const srcMatch = full.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const srcValue = srcMatch ? (srcMatch[1] ?? srcMatch[2] ?? '') : null;
    tags.push({ offset: m.index, srcValue: srcValue ?? '', full });
  }
  return tags;
}

function isInsidePicture(offset, pictureRanges) {
  return pictureRanges.some((r) => offset >= r.start && offset < r.end);
}

function audit() {
  const issues = [];
  let totalImgs = 0;
  let rasterImgs = 0;
  let rasterImgsSkipped = 0; // favicon + og + _astro
  let rasterImgsInPicture = 0;
  let rasterImgsOutOfPicture = 0;

  for (const f of walk(DIST)) {
    const html = readFileSync(f, 'utf8');
    const pictureRanges = extractPictureRanges(html);
    const imgs = findImgTags(html);

    for (const i of imgs) {
      totalImgs++;
      if (!isRasterImgSrc(i.srcValue)) continue; // not a raster image
      rasterImgs++;

      if (isSkippedSrc(i.srcValue)) {
        rasterImgsSkipped++;
        continue;
      }

      if (isInsidePicture(i.offset, pictureRanges)) {
        rasterImgsInPicture++;
      } else {
        rasterImgsOutOfPicture++;
        issues.push({
          rule: 'raster-img-outside-picture',
          msg: `${f} — <img src="${i.srcValue}"> at offset ${i.offset} is OUTSIDE any <picture> block (browser gets larger PNG/JPG instead of WebP)`,
        });
      }
    }
  }

  return {
    issues,
    totalImgs,
    rasterImgs,
    rasterImgsSkipped,
    rasterImgsInPicture,
    rasterImgsOutOfPicture,
  };
}

function main() {
  console.log('=== Raster-Img-Outside-Picture Audit (v7.7.41) — every raster <img> must be inside <picture> ===\n');

  const { issues, totalImgs, rasterImgs, rasterImgsSkipped, rasterImgsInPicture, rasterImgsOutOfPicture } = audit();

  console.log(`Scanned ${totalImgs} <img> tag(s) total · ${rasterImgs} raster (PNG/JPG) · ${rasterImgsSkipped} skipped (favicon + og + _astro) · ${rasterImgsInPicture} in <picture> · ${rasterImgsOutOfPicture} OUTSIDE <picture> · ${issues.length} issue(s)\n`);

  if (issues.length === 0) {
    console.log(`✓ All ${rasterImgs - rasterImgsSkipped} raster <img> tag(s) (excluding favicon + og + _astro) are inside <picture> blocks (WebP delivery guaranteed).`);
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

  console.error(`\nFAIL — ${issues.length} raster-img-outside-picture issue(s).`);
  process.exit(1);
}

try {
  main();
} catch (e) {
  console.error('raster-img-outside-picture scan crashed:', e);
  process.exit(2);
}
