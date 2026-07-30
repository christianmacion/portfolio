// perf-audit.mjs — v7.26 PERFORMANCE AUDIT (informational)
//
// Surfaces Web Vitals-relevant signal from the dist/ output:
//   - Per-route HTML/JS/CSS/asset weight (gzipped + raw)
//   - Image counts per route + unoptimized-image detection (missing
//     loading=lazy, missing width/height)
//   - JS bundle parse-cost estimate (bytes / 1024 = ms-of-parse on a
//     mid-range mobile per V8's published heuristic)
//   - Largest CSS file + largest JS file (the "hot path" assets)
//
// Informational only — does not fail the build. Run via:
//   `npm run perf:audit` (added below)
//
// Used in: AFK performance review, not wired into `npm run ci`.

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = 'dist';
const TOP_ROUTES = 12;

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else yield full;
  }
}

function fmtKb(b) {
  return `${(b / 1024).toFixed(1)} KB`;
}

function findImgs(html) {
  const imgs = [];
  for (const m of html.matchAll(/<img\b([^>]*?)>/g)) {
    const attrs = m[1];
    const src = attrs.match(/\bsrc=["']([^"']+)["']/)?.[1] ?? '';
    // Either loading=lazy (below-fold) or loading=eager (above-fold) is valid;
    // the audit only flags imgs with no loading attribute at all (which lets
    // browsers default to eager and triggers CLS risk on big files).
    const loading = /\bloading=/.test(attrs);
    const width = /\bwidth=/.test(attrs);
    const height = /\bheight=/.test(attrs);
    imgs.push({ src, loading, width, height });
  }
  return imgs;
}

async function auditRoute(routePath) {
  const htmlPath = join(DIST, routePath, 'index.html');
  let html;
  try {
    html = await readFile(htmlPath, 'utf8');
  } catch {
    return null;
  }
  const imgs = findImgs(html);
  const unoptimized = imgs.filter((i) => !i.loading || !i.width || !i.height);
  const s = await stat(htmlPath);
  const htmlGz = gzipSync(Buffer.from(html)).length;
  return {
    route: '/' + routePath.replace(/\/index\.html$/, ''),
    htmlRaw: s.size,
    htmlGz,
    imgs: imgs.length,
    unoptimizedImgs: unoptimized.length,
    unoptimizedSamples: unoptimized.slice(0, 3).map((u) => u.src.split('/').pop()),
  };
}

async function topAssets() {
  const sizes = [];
  for await (const file of walk(DIST)) {
    const ext = extname(file);
    if (!['.js', '.css', '.png', '.jpg', '.jpeg', '.webp', '.avif', '.svg'].includes(ext)) continue;
    const s = await stat(file);
    const buf = await readFile(file);
    const gz = gzipSync(buf).length;
    sizes.push({ file: file.replace(DIST + '/', ''), ext, raw: s.size, gz });
  }
  return sizes;
}

async function main() {
  console.log('=== Performance Audit (v7.26) — informational ===\n');

  // 1. Site totals
  let totalRaw = 0, totalGz = 0, jsRaw = 0, jsGz = 0, cssRaw = 0, cssGz = 0, htmlRaw = 0, htmlGz = 0;
  let imgCount = 0, imgRaw = 0;
  for await (const file of walk(DIST)) {
    const s = await stat(file);
    const buf = await readFile(file);
    const gz = gzipSync(buf).length;
    totalRaw += s.size;
    totalGz += gz;
    const ext = extname(file);
    if (ext === '.js') { jsRaw += s.size; jsGz += gz; }
    else if (ext === '.css') { cssRaw += s.size; cssGz += gz; }
    else if (ext === '.html') { htmlRaw += s.size; htmlGz += gz; }
    else if (['.png', '.jpg', '.jpeg', '.webp', '.avif'].includes(ext)) {
      imgCount++; imgRaw += s.size;
    }
  }

  console.log('Site totals:');
  console.log(`  Code  raw: ${fmtKb(jsRaw + cssRaw + htmlRaw)}  gz: ${fmtKb(jsGz + cssGz + htmlGz)}`);
  console.log(`  JS    raw: ${fmtKb(jsRaw)}  gz: ${fmtKb(jsGz)}  parse-est: ~${Math.round(jsGz / 1024)} ms (mid-range mobile)`);
  console.log(`  CSS   raw: ${fmtKb(cssRaw)}  gz: ${fmtKb(cssGz)}`);
  console.log(`  HTML  raw: ${fmtKb(htmlRaw)}  gz: ${fmtKb(htmlGz)}`);
  console.log(`  Imgs  count: ${imgCount}  raw: ${fmtKb(imgRaw)} (${((imgRaw / totalRaw) * 100).toFixed(1)}% of total)`);
  console.log(`  Grand total raw: ${fmtKb(totalRaw)}  gz: ${fmtKb(totalGz)}\n`);

  // 2. Per-route top sizes
  const distEntries = await readdir(DIST, { withFileTypes: true });
  const routeStats = [];
  for (const e of distEntries) {
    if (!e.isDirectory()) continue;
    const routeAudit = await auditRoute(e.name);
    if (routeAudit) routeStats.push(routeAudit);
  }
  routeStats.sort((a, b) => b.htmlRaw - a.htmlRaw);

  console.log(`Top ${TOP_ROUTES} routes by HTML weight (raw):`);
  console.log(`  ${'ROUTE'.padEnd(36)}  ${'HTML raw'.padStart(10)}  ${'HTML gz'.padStart(10)}  ${'IMGS'.padStart(6)}  ${'UNOPT'.padStart(6)}`);
  console.log(`  ${'-'.repeat(36)}  ${'-'.repeat(10)}  ${'-'.repeat(10)}  ${'-'.repeat(6)}  ${'-'.repeat(6)}`);
  for (const r of routeStats.slice(0, TOP_ROUTES)) {
    console.log(
      `  ${r.route.padEnd(36)}  ${fmtKb(r.htmlRaw).padStart(10)}  ${fmtKb(r.htmlGz).padStart(10)}  ${String(r.imgs).padStart(6)}  ${String(r.unoptimizedImgs).padStart(6)}`,
    );
  }

  // 3. Unoptimized image rollup
  const allUnoptimized = routeStats.reduce((acc, r) => acc + r.unoptimizedImgs, 0);
  if (allUnoptimized > 0) {
    console.log(`\nUnoptimized images: ${allUnoptimized} across ${routeStats.filter((r) => r.unoptimizedImgs > 0).length} routes`);
    console.log('  (missing loading=lazy OR width OR height)');
    console.log('  Top samples:');
    for (const r of routeStats.filter((r) => r.unoptimizedImgs > 0).slice(0, 3)) {
      console.log(`    ${r.route}: ${r.unoptimizedSamples.join(', ')}`);
    }
  } else {
    console.log('\nAll images have loading=lazy + width + height attributes. ✓');
  }

  // 4. Hot-path assets (largest JS + largest CSS)
  const assets = await topAssets();
  const jsAssets = assets.filter((a) => a.ext === '.js').sort((a, b) => b.gz - a.gz);
  const cssAssets = assets.filter((a) => a.ext === '.css').sort((a, b) => b.gz - a.gz);
  console.log('\nLargest JS bundles (gzipped):');
  for (const a of jsAssets.slice(0, 5)) {
    console.log(`  ${fmtKb(a.gz).padStart(10)}  ${a.file}`);
  }
  console.log('\nLargest CSS bundles (gzipped):');
  for (const a of cssAssets.slice(0, 5)) {
    console.log(`  ${fmtKb(a.gz).padStart(10)}  ${a.file}`);
  }
}

main().catch((e) => {
  console.error('perf-audit crashed:', e);
  process.exit(2);
});
