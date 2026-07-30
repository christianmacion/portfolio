// check-webp-availability.mjs — v7.7.33 WEBP-AVAILABILITY CI GATE
//
// Catches <img> tags referencing raster formats (PNG/JPG/JPEG) when no
// sibling .webp is available. Modern browsers support WebP and the file
// size is typically 25-35% smaller than PNG — meaningful for LCP (Largest
// Contentful Paint) on content-heavy pages.
//
// Companion gates:
//   - scripts/check-image-dimension-attributes.mjs (v7.7.32) — CLS dims
//   - scripts/check-image-alt-integrity.mjs (v7.7.23) — alt text
//   - scripts/check-perf-audit.mjs (v7.7.10) — bundle size + LCP
//
// Rules enforced:
//   1. Every <img src="*.png|jpg|jpeg"> in dist/ SHOULD have a sibling .webp
//      file at the same path with .webp extension
//   2. (Informational) report count of srcset-paired imgs (Astro emits
//      <picture><source type="image/webp"> + <img src=".png"> natively — exempt)
//
// Skips:
//   - imgs with data-no-webp="1" attribute (explicit opt-out)
//   - imgs inside <picture> with sibling <source type="image/webp">
//
// Exits 1 on any fail. Exits 0 otherwise.
// Used in: npm run ci (after image:dimension:attributes, before audit).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname, basename } from 'node:path';

const DIST = 'dist';

function* walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.endsWith('.html')) yield full;
  }
}

function fileExists(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
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
    tags.push({ src, optOut });
  }
  return tags;
}

function findWebpSibling(srcPath, htmlDir) {
  // Convert src path to candidate webp path in dist/.
  // Three forms to handle:
  //   1. Absolute site path: "/proof/foo.jpg"        → dist/proof/foo.webp
  //   2. Absolute + base:    "/portfolio/proof/foo"   → strip "/portfolio" → dist/proof/foo.webp
  //   3. Relative:           "figures/foo.png" (in dist/workbooks/ai-engineering/index.html)
  //                                                  → dist/workbooks/ai-engineering/figures/foo.webp
  // Also handles /_astro/foo.webp (already webp — skip).
  const ext = extname(srcPath).toLowerCase();
  if (!['.png', '.jpg', '.jpeg'].includes(ext)) return null;

  // Strip the BASE_PATH prefix if present (default '/portfolio')
  let cleanPath = srcPath;
  const basePrefixes = ['/portfolio', '/'];
  for (const bp of basePrefixes) {
    if (cleanPath.startsWith(bp + '/')) {
      cleanPath = cleanPath.slice(bp.length);
      break;
    }
  }

  let absolute;
  if (cleanPath.startsWith('/')) {
    // Absolute (with or without base stripped) — join to DIST
    absolute = join(DIST, cleanPath);
  } else if (cleanPath.startsWith('_astro/')) {
    absolute = join(DIST, cleanPath);
  } else {
    // Relative — resolve against the HTML file's directory
    absolute = join(htmlDir, cleanPath);
  }
  const dir = dirname(absolute);
  const name = basename(absolute, extname(absolute));
  return join(dir, `${name}.webp`);
}

function audit() {
  const issues = [];
  let totalImgs = 0;
  let rasterImgs = 0;
  let webpAvailable = 0;
  let optedOut = 0;
  let srcsetPaired = 0;

  for (const f of walk(DIST)) {
    const html = readFileSync(f, 'utf8');
    const tags = extractImgTags(html);
    totalImgs += tags.length;

    for (const tag of tags) {
      const ext = extname(tag.src).toLowerCase();
      if (!['.png', '.jpg', '.jpeg'].includes(ext)) continue;
      rasterImgs++;

      if (tag.optOut) {
        optedOut++;
        continue;
      }

      // Check if surrounding context includes <source type="image/webp">
      const ctxStart = Math.max(0, html.indexOf(tag.src) - 300);
      const ctxEnd = Math.min(html.length, html.indexOf(tag.src) + tag.src.length + 50);
      const context = html.slice(ctxStart, ctxEnd);
      if (/<source[^>]*type=["']image\/webp["']/i.test(context)) {
        srcsetPaired++;
        continue;
      }

      const webpPath = findWebpSibling(tag.src, dirname(f));
      if (!webpPath) continue;
      if (fileExists(webpPath)) {
        webpAvailable++;
      } else {
        issues.push({
          rule: 'missing-webp-sibling',
          msg: `${f} — <img src="${tag.src}"> has no sibling ${webpPath} (add data-no-webp="1" to opt out)`,
        });
      }
    }
  }

  return { issues, totalImgs, rasterImgs, webpAvailable, optedOut, srcsetPaired };
}

function main() {
  console.log('=== WebP-Availability Audit (v7.7.33) — <img> raster→webp sibling check ===\n');

  const { issues, totalImgs, rasterImgs, webpAvailable, optedOut, srcsetPaired } = audit();

  console.log(`Scanned ${totalImgs} <img> tag(s) · ${rasterImgs} raster (PNG/JPG) · ${webpAvailable} with webp sibling · ${optedOut} opted out · ${srcsetPaired} srcset-paired · ${issues.length} issue(s)\n`);

  if (issues.length === 0) {
    console.log(`✓ All ${rasterImgs} raster <img> tags have webp sibling (or are properly opted-out / srcset-paired).`);
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

  console.error(`\nFAIL — ${issues.length} webp-availability issue(s).`);
  process.exit(1);
}

try {
  main();
} catch (e) {
  console.error('webp-availability scan crashed:', e);
  process.exit(2);
}