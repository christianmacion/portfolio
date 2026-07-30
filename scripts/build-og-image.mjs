// scripts/build-og-image.mjs
//
// Composites the og:image banner used for LinkedIn / Slack / Twitter / Facebook previews.
// Input:  src/assets/portrait/headshot-source.jpg + public/cm-mark.svg (Stratum)
// Output: public/og-image.jpg          (1600×900, LinkedIn / Slack / Twitter large)
//         public/og-image-twitter.jpg  (1200×675, Twitter summary_large_image)
//         public/og-image-facebook.jpg  (1200×630, Facebook OG spec)
//
// v7.7.87 — switched monogram source from the legacy `cm-mark-amber.svg`
// (geometric monoline, pre-Stratum) to `cm-mark.svg` (Stratum typographic
// lockup). Keeps the OG social-share preview consistent with the live
// nav mark and the favicon set.
//
// Invoked by `npm run build` via the `prebuild` hook. Outputs are gitignored.

import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const headshotPath = join(root, 'src/assets/portrait/headshot-source.jpg');
const monogramPath = join(root, 'public/cm-mark.svg');
const publicDir = join(root, 'public');

// ── SVG composition ──────────────────────────────────────────────────────────
// Headshot anchored to the right third, dark gradient + amber rule on the left,
// CM monogram in the top-left corner (replacing the previous text-only mark).
// ── BrandMotif (33-cell lattice) ────────────────────────────────────────────
// Mirrors src/components/BrandMotif.astro. 33 cells = 31 gates + 1 ship + 1 block.
// Bakes the same identity signal into the social-share preview.
function buildBrandMotif({ originX, originY, motifW, motifH }) {
  const N = 33;
  const insetX = motifW * 0.04;
  const drawW = motifW - insetX * 2;
  const stepX = drawW / (N - 1);
  const cy = originY + motifH * 0.42;
  const r = motifH * 0.075;
  const haloR = r * 1.9;

  const shipIndex = 16;
  const blockIndex = 27;
  const dimFill = '#d4a017';
  const dimOpacity = 0.32;
  const captionY = originY + motifH * 0.92;
  const captionText = 'G1–G31 · ship(x) = 1 ⇔ ∀ gates pass';

  let cells = '';
  for (let i = 0; i < N; i++) {
    const cx = originX + insetX + stepX * i;
    if (i === shipIndex) {
      cells += `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${haloR.toFixed(2)}" fill="#d4a017" fill-opacity="0.18"/>`;
      cells += `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="#d4a017"/>`;
    } else if (i === blockIndex) {
      cells += `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="none" stroke="#d4a017" stroke-width="1.2"/>`;
    } else {
      cells += `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="${dimFill}" fill-opacity="${dimOpacity}"/>`;
    }
  }

  return `
  <g class="brand-motif">
    ${cells}
    <text x="${(originX + motifW / 2).toFixed(2)}" y="${captionY.toFixed(2)}" text-anchor="middle"
          font-family="ui-monospace, Menlo, monospace" font-size="${(motifH * 0.16).toFixed(2)}" letter-spacing="${(motifW * 0.0006).toFixed(3)}" fill="#d4a017" fill-opacity="0.55">
      ${captionText}
    </text>
  </g>`;
}

function buildSvg({ width, height, headshotBox, monogramSize }) {
  const scale = width / 1600; // normalize to 1600 design grid
  const s = (n) => Math.round(n * scale);

  // Headshot placement: anchored to right side, vertically centered
  const hsX = Math.round(width - headshotBox - s(80));
  const hsY = Math.round((height - headshotBox) / 2);

  // Monogram: top-left, sits in the gutter above the eyebrow line
  const monoX = s(120);
  const monoY = s(80);

  // BrandMotif accent strip — anchored bottom-left, between the type stack
  // footer line and the URL line.
  const motifW = Math.min(s(900), width - monoX - s(40));
  const motifH = s(56);
  const motifX = monoX;
  const motifY = s(700);

  return `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a0e14"/>
      <stop offset="50%" stop-color="#11161d"/>
      <stop offset="100%" stop-color="#1a1f24"/>
    </linearGradient>
    <linearGradient id="amber" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#d4a017"/>
      <stop offset="100%" stop-color="#e8b53a"/>
    </linearGradient>
    <pattern id="grid" x="0" y="0" width="${s(60)}" height="${s(60)}" patternUnits="userSpaceOnUse">
      <path d="M ${s(60)} 0 L 0 0 0 ${s(60)}" fill="none" stroke="#d4a017" stroke-opacity="0.06" stroke-width="1"/>
    </pattern>
  </defs>

  <!-- Background -->
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect width="${width}" height="${height}" fill="url(#grid)"/>

  <!-- Amber left rule -->
  <rect x="${s(60)}" y="${s(80)}" width="${s(6)}" height="${height - s(160)}" fill="url(#amber)"/>

  <!-- CM monogram in top-left gutter -->
  <image href="${monogramPath}" x="${monoX}" y="${monoY}" width="${monogramSize}" height="${monogramSize}"/>

  <!-- Type stack — shifted right of the monogram -->
  <g font-family="Helvetica, Arial, sans-serif" fill="#ffffff">
    <text x="${s(120)}" y="${s(220)}" font-size="${s(32)}" letter-spacing="${s(6)}" fill="#d4a017" font-weight="600">
      CHRISTIAN T. MACION, CTA®
    </text>
    <text x="${s(120)}" y="${s(360)}" font-size="${s(86)}" font-weight="700" letter-spacing="${s(-3)}">
      I do solutions.
    </text>
    <text x="${s(120)}" y="${s(470)}" font-size="${s(62)}" font-weight="600" letter-spacing="${s(-1)}" fill="#d4a017">
      Two hats. One method.
    </text>
    <text x="${s(120)}" y="${s(580)}" font-size="${s(32)}" fill="#869098">
      Quant Researcher · AI Engineer · Eval-first
    </text>
    <text x="${s(120)}" y="${s(630)}" font-size="${s(24)}" fill="#7c8693">
      Multiple-testing-aware systematic strategies &amp; multi-agent LLM systems.
    </text>
    <text x="${s(120)}" y="${s(820)}" font-size="${s(20)}" letter-spacing="${s(2)}" fill="#5a6473" font-family="ui-monospace, Menlo, monospace">
      christianmacion-portfolio.pages.dev
    </text>
  </g>

  ${buildBrandMotif({ originX: motifX, originY: motifY, motifW, motifH })}

  <!-- Headshot slot -->
  <rect x="${hsX}" y="${hsY}" width="${headshotBox}" height="${headshotBox}" fill="#0a0e14" stroke="#d4a017" stroke-width="${s(4)}"/>
</svg>`;
}

// ── Pipeline ─────────────────────────────────────────────────────────────────
async function buildOne({ width, height, outFile, headshotBox, monogramSize, quality }) {
  // Resize headshot: crop-to-square at headshotBox, focus on attention area
  const headshotBuf = await sharp(headshotPath)
    .resize(headshotBox, headshotBox, { fit: 'cover', position: 'attention' })
    .png()
    .toBuffer();

  const svg = buildSvg({ width, height, headshotBox, monogramSize });
  const compositeX = Math.round(width - headshotBox - (80 * width) / 1600);
  const compositeY = Math.round((height - headshotBox) / 2);

  await sharp(Buffer.from(svg))
    .composite([{ input: headshotBuf, left: compositeX, top: compositeY }])
    .jpeg({ quality, mozjpeg: true, progressive: true })
    .toFile(outFile);

  const stats = await sharp(outFile).metadata();
  console.log(`✓ ${outFile}  ${stats.width}×${stats.height}  ${(stats.size / 1024).toFixed(1)} KB`);
}

// Read the monogram SVG once so we can verify it exists (fail fast on missing asset).
try { readFileSync(monogramPath); }
catch {
  console.error(`✗ Missing monogram: ${monogramPath}`);
  console.error(`  Re-run after restoring public/cm-mark.svg (Stratum source)`);
  process.exit(1);
}

// 1600×900 — LinkedIn / Slack / generic large card (the canonical og:image)
await buildOne({
  width: 1600,
  height: 900,
  outFile: join(publicDir, 'og-image.jpg'),
  headshotBox: 640,
  monogramSize: 88,
  quality: 82,
});

// 1200×675 — Twitter summary_large_image (16:9-ish)
await buildOne({
  width: 1200,
  height: 675,
  outFile: join(publicDir, 'og-image-twitter.jpg'),
  headshotBox: 480,
  monogramSize: 72,
  quality: 82,
});

// 1200×630 — Facebook OG spec (the one we were missing — 1200×675 is Twitter-only)
await buildOne({
  width: 1200,
  height: 630,
  outFile: join(publicDir, 'og-image-facebook.jpg'),
  headshotBox: 440,
  monogramSize: 68,
  quality: 82,
});