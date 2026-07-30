// scripts/asset-audit.mjs
//
// Enforces asset budgets on public/ before deploy:
//   - All public/**/*.{jpg,jpeg,png,webp} ≤ 500 KB unless explicitly approved
//   - All public/proof/*.mp4 ≤ 10 MB
//   - No accidental PNG-of-a-photo (PNG with width ≥ 600 — convert to WebP/AVIF)
//   - All public/pwa-* / apple-touch-* / favicon-* PNGs exist (post-favicons step)
//
// Run after `npm run build` via the `postbuild` hook. Exits 1 on any violation.

import { statSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const publicDir = join(root, 'public');

const IMAGE_BUDGET = 500 * 1024;       // 500 KB per static image
const VIDEO_BUDGET = 10 * 1024 * 1024; // 10 MB per video
const PNG_PHOTO_MIN_W = 600;           // PNGs ≥ 600px wide are flagged as accidental photos

const violations = [];
const ok = [];

function walk(dir, exts) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, exts));
    else if (exts.some(e => entry.name.toLowerCase().endsWith(e))) out.push(full);
  }
  return out;
}

// v7.7.10 — wrap all top-level await in an async main(). Top-level
// await is fragile across compile / bundle changes and dead-states in
// CJS contexts. Async main() is portable + testable.
async function main() {

// ── Images ───────────────────────────────────────────────────────────────────
const imageExts = ['.jpg', '.jpeg', '.png', '.webp'];
const images = walk(publicDir, imageExts);
for (const f of images) {
  const rel = f.replace(root + '/', '');
  const size = statSync(f).size;
  const meta = await sharp(f).metadata().catch(() => ({}));

  if (size > IMAGE_BUDGET) {
    violations.push(`${rel}: ${(size / 1024).toFixed(1)} KB > ${IMAGE_BUDGET / 1024} KB image budget`);
    continue;
  }

  if (meta.format === 'png' && meta.width && meta.width >= PNG_PHOTO_MIN_W) {
    violations.push(`${rel}: PNG ${meta.width}×${meta.height} — likely a photo. Convert to WebP/AVIF.`);
    continue;
  }

  ok.push(`${rel}: ${(size / 1024).toFixed(1)} KB  ${meta.width}×${meta.height} ${meta.format}`);
}

// ── Videos ───────────────────────────────────────────────────────────────────
const proofDir = join(publicDir, 'proof');
if (existsSync(proofDir)) {
  const videos = walk(proofDir, ['.mp4']);
  for (const f of videos) {
    const rel = f.replace(root + '/', '');
    const size = statSync(f).size;
    if (size > VIDEO_BUDGET) {
      violations.push(`${rel}: ${(size / 1024 / 1024).toFixed(2)} MB > ${VIDEO_BUDGET / 1024 / 1024} MB video budget`);
    } else {
      ok.push(`${rel}: ${(size / 1024 / 1024).toFixed(2)} MB`);
    }
  }
}

// ── Required favicon set (post-favicons-generator) ──────────────────────────
// v6.9.15 — modern browsers use the SVG <link rel="icon"> (cm-mark.svg)
// so the legacy 32×32 / 192×192 / 512×512 PNGs + .ico + maskable dup
// were dead weight. Apple iOS requires the 180×180 PNG (SVG is ignored
// per WebKit spec) so that one stays. Net: 5 files removed (~32 KB).
const requiredFavicons = [
  'apple-touch-icon-180x180.png',
];
for (const f of requiredFavicons) {
  const full = join(publicDir, f);
  if (!existsSync(full)) {
    violations.push(`Missing required favicon asset: ${f}`);
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log('\n[asset-audit] scanning public/ ...\n');
for (const line of ok) console.log(`  ✓ ${line}`);
if (violations.length) {
  console.error('\n[asset-audit] VIOLATIONS:');
  for (const v of violations) console.error(`  ✗ ${v}`);
  console.error(`\n[asset-audit] FAIL — ${violations.length} violation(s).`);
  process.exit(1);
} else {
  console.log(`\n[asset-audit] OK — ${ok.length} asset(s) within budget.`);
}

} // end main()

main().catch((e) => {
  console.error('[asset-audit] crashed:', e);
  process.exit(2);
});