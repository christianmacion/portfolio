// scripts/optimize-assets.mjs
//
// One-off script: convert legacy PNG chart figures to WebP (smaller, faster,
// satisfies the postbuild asset-audit). Also generate the required favicon set
// from the existing `public/cm-mark.svg` (used as the SVG favicon) and
// `public/cm-mark-amber.svg` (used as the apple-touch-icon).
//
// Idempotent — safe to re-run.

import sharp from 'sharp';
import { readdirSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const publicDir = join(root, 'public');

async function convertPngs() {
  const figDir = join(publicDir, 'figures', 'quant');
  if (!existsSync(figDir)) return 0;
  const files = readdirSync(figDir).filter((f) => f.endsWith('.png'));
  let total = 0;
  for (const f of files) {
    const src = join(figDir, f);
    const dst = join(figDir, f.replace(/\.png$/, '.webp'));
    const before = statSync(src).size;
    await sharp(src)
      .webp({ quality: 88, effort: 4 })
      .toFile(dst);
    const after = statSync(dst).size;
    unlinkSync(src);
    console.log(
      `  ${f.replace('.png', '')}.png → .webp  ${(before / 1024).toFixed(1)}KB → ${(after / 1024).toFixed(1)}KB`,
    );
    total++;
  }
  return total;
}

async function generateFavicons() {
  const sources = {
    default: join(publicDir, 'cm-mark.svg'),
    amber: join(publicDir, 'cm-mark-amber.svg'),
  };
  if (!existsSync(sources.default) && !existsSync(sources.amber)) {
    console.error('  ✗ no cm-mark SVG source found; skipping favicon set');
    return 0;
  }
  const src = existsSync(sources.default) ? sources.default : sources.amber;
  const out = publicDir;

  // Required by scripts/asset-audit.mjs
  const tasks = [
    { name: 'favicon-32x32.png', size: 32, fit: 'contain', bg: { r: 250, g: 247, b: 240, alpha: 0 } },
    { name: 'favicon-192x192.png', size: 192, fit: 'contain', bg: { r: 250, g: 247, b: 240, alpha: 0 } },
    { name: 'favicon-512x512.png', size: 512, fit: 'contain', bg: { r: 250, g: 247, b: 240, alpha: 0 } },
    { name: 'apple-touch-icon-180x180.png', size: 180, fit: 'contain', bg: { r: 250, g: 247, b: 240, alpha: 0 } },
    { name: 'maskable-icon-512x512.png', size: 512, fit: 'contain', bg: '#0a0e14' /* padding ring for maskable */ },
  ];

  // Render at higher density first then resize for sharp
  let total = 0;
  for (const t of tasks) {
    const dst = join(out, t.name);
    const buf = await sharp(src, { density: 384 })
      .resize(t.size, t.size, { fit: t.fit, background: t.bg })
      .png()
      .toBuffer();
    await sharp(buf).toFile(dst);
    const size = statSync(dst).size;
    console.log(`  ${t.name}  ${t.size}×${t.size}  ${(size / 1024).toFixed(1)}KB`);
    total++;
  }

  // favicon.ico from 32×32 PNG (modern browsers accept PNG-in-ICO)
  const ico32 = await sharp(src, { density: 384 })
    .resize(32, 32, { fit: 'contain', background: { r: 250, g: 247, b: 240, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp(ico32).toFile(join(out, 'favicon.ico'));
  const icoSize = statSync(join(out, 'favicon.ico')).size;
  console.log(`  favicon.ico  32×32  ${(icoSize / 1024).toFixed(1)}KB`);
  total++;

  return total;
}

async function generateWebpSiblings() {
  // Categories that should have .webp alongside the original (LCP-critical):
  //   - /headshot.jpg               — hero image on homepage
  //   - /proof/*.jpg                 — cert photos on /proof and /certifications
  //   - /workbooks/*/figures/*.png   — workbook chapter figures
  //
  // Categories that intentionally stay raster-only (browser-required formats):
  //   - favicon-*.png, apple-touch-icon*.png, maskable-icon*.png
  //     (browsers require PNG for these, no benefit from webp sibling)
  //   - og-image*.jpg
  //     (used as <meta og:image> — only crawlers consume them, no LCP)
  //
  // Idempotent: skips files that already have a .webp sibling.
  const targets = [
    join(publicDir, 'headshot.jpg'),
    ...['ai-workflow.jpg', 'ateneo-american-corner-2025-11.jpg', 'bida-meta-aiccelerate-2025-11.jpg', 'bitget-b4y-2026.jpg', 'cryptoneeds-christ-chart.jpg', 'cta-cert-portrait-2026-01.jpg', 'usep-lecture.jpg'].map((f) => join(publicDir, 'proof', f)),
  ];
  // workbook figures
  const workbookRoots = [
    join(publicDir, 'workbooks', 'ai-engineering', 'figures'),
    join(publicDir, 'workbooks', 'graph-engineering', 'figures'),
  ];
  for (const dir of workbookRoots) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((f) => /\.(png|jpg|jpeg)$/i.test(f))) {
      targets.push(join(dir, f));
    }
  }
  let total = 0, skipped = 0;
  for (const src of targets) {
    if (!existsSync(src)) continue;
    const dst = src.replace(/\.(png|jpg|jpeg)$/i, '.webp');
    if (existsSync(dst)) {
      skipped++;
      continue;
    }
    const before = statSync(src).size;
    await sharp(src).webp({ quality: 88, effort: 4 }).toFile(dst);
    const after = statSync(dst).size;
    console.log(`  ${src.replace(publicDir + '/', '')} → .webp  ${(before / 1024).toFixed(1)}KB → ${(after / 1024).toFixed(1)}KB  (kept original)`);
    total++;
  }
  return { total, skipped };
}

async function main() {
  console.log('[optimize-assets] generating WebP siblings (LCP-critical) ...');
  const { total: webpCount, skipped: webpSkipped } = await generateWebpSiblings();
  console.log(`\n[optimize-assets] converting PNG figures → WebP ...`);
  const pngCount = await convertPngs();
  console.log(`\n[optimize-assets] generating favicon set ...`);
  const favCount = await generateFavicons();
  console.log(
    `\n[optimize-assets] done — ${webpCount} webp sibling(s) generated (${webpSkipped} already existed), ${pngCount} PNG(s) converted, ${favCount} favicon(s) generated.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
