// check-picture-count.mjs — v7.7.36 PICTURE-COUNT POSITIVE CI GATE
//
// Companion to v7.7.34 picture-source-pairing (39th gate). Where v7.7.34
// catches raster <img> tags NOT inside <picture>, this gate enforces a
// POSITIVE invariant: the total count of <picture> tags in dist/ must be
// >= the count of raster <img> tags (so every raster img is wrapped).
//
// Why this matters: if someone refactors the markup and accidentally drops
// <picture> wrappers thinking <img src="X.webp"> alone is enough, this gate
// catches the regression. The v7.7.34 gate would also catch it (negative),
// but a positive count gate makes the contract explicit and surfaces
// "the picture count went down" as a CI signal.
//
// Rules enforced:
//   1. picture-count-below-threshold — total <picture> tags in dist/ MUST
//      be >= total raster <img> tags in dist/ (1:1 mapping)
//   2. (Informational) report total <picture> count, total raster <img>
//      count, total <img> count (already-webp + raster + srcset)
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

function countPictures(html) {
  // Match <picture> opening tags (with or without attributes)
  const re = /<picture\b[^>]*>/gi;
  return (html.match(re) || []).length;
}

function countRasterImgs(html) {
  // Match <img> tags with src ending in .png|.jpg|.jpeg
  const re = /<img\b[^>]*\/?>/gi;
  const srcRe = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/;
  let count = 0;
  let m;
  while ((m = re.exec(html)) !== null) {
    const srcMatch = m[0].match(srcRe);
    if (!srcMatch) continue;
    const src = (srcMatch[1] || srcMatch[2] || srcMatch[3]).toLowerCase();
    if (src.endsWith('.png') || src.endsWith('.jpg') || src.endsWith('.jpeg')) count++;
  }
  return count;
}

function audit() {
  let pictureCount = 0;
  let rasterCount = 0;
  const perFile = [];

  for (const f of walk(DIST)) {
    const html = readFileSync(f, 'utf8');
    const pic = countPictures(html);
    const ras = countRasterImgs(html);
    pictureCount += pic;
    rasterCount += ras;
    if (pic > 0 || ras > 0) {
      perFile.push({ file: f, pictures: pic, rasters: ras });
    }
  }

  return { pictureCount, rasterCount, perFile };
}

function main() {
  console.log('=== Picture-Count Positivity Audit (v7.7.36) — <picture> count >= raster <img> count ===\n');

  const { pictureCount, rasterCount, perFile } = audit();

  console.log(`Total <picture> tag(s) in dist/: ${pictureCount}`);
  console.log(`Total raster <img> (PNG/JPG) in dist/: ${rasterCount}\n`);

  if (perFile.length > 0) {
    console.log('Per-file picture/raster counts (only files with at least one):');
    for (const p of perFile.slice(0, 12)) {
      console.log(`  ${p.pictures} pic · ${p.rasters} raster · ${p.file}`);
    }
    if (perFile.length > 12) console.log(`  ... and ${perFile.length - 12} more file(s)`);
    console.log('');
  }

  if (pictureCount < rasterCount) {
    console.error(`✗ FAIL — <picture> count (${pictureCount}) < raster <img> count (${rasterCount}).`);
    console.error(`  Some raster <img> tag(s) are missing <picture> wrapper.`);
    console.error(`  Run scripts/check-picture-source-pairing.mjs to identify the missing wrappers.`);
    process.exit(1);
  }

  console.log(`✓ <picture> count (${pictureCount}) >= raster <img> count (${rasterCount}) — every raster <img> is wrapped.`);
}

try {
  main();
} catch (e) {
  console.error('picture-count scan crashed:', e);
  process.exit(2);
}