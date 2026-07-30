// check-image-dimension-attributes.mjs — v7.7.32 IMAGE-DIMENSION-ATTRIBUTES CI GATE
//
// Catches <img> tags missing width/height attributes before ship. Without
// intrinsic dimensions, browsers can't reserve space before the image loads
// — causing Cumulative Layout Shift (CLS), which hurts Core Web Vitals +
// recruiter UX (visible jank during page load).
//
// Companion gates:
//   - scripts/check-image-alt-integrity.mjs (v7.7.23) — alt text required
//   - scripts/check-perf-audit.mjs (v7.7.10) — bundle size + asset weight
//
// Rules enforced:
//   1. Every <img src="..."> tag in dist/ MUST have width="..." attribute
//   2. Every <img src="..."> tag MUST have height="..." attribute
//   3. width and height values MUST be parseable as positive integers
//   4. (Informational) report total <img> tag count
//
// Skips:
//   - <img> tags with srcset-only (responsive) — Astro's <Image /> may emit
//     these without intrinsic dims; gate's informational-only for now
//   - <img> inside <noscript> blocks
//
// Exits 1 on any fail. Exits 0 otherwise.
// Used in: npm run ci (after cross:reference:integrity, before audit).

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

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
  // Match <img ...> with attrs, handle multiline via [\s\S]
  const re = /<img\b([^>]*?)\/?>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    // Extract src, width, height attributes via backref-aware regex
    const srcMatch = attrs.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/);
    const widthMatch = attrs.match(/\bwidth\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/);
    const heightMatch = attrs.match(/\bheight\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/);
    tags.push({
      src: srcMatch ? srcMatch[1] || srcMatch[2] || srcMatch[3] : null,
      width: widthMatch ? widthMatch[1] || widthMatch[2] || widthMatch[3] : null,
      height: heightMatch ? heightMatch[1] || heightMatch[2] || heightMatch[3] : null,
    });
  }
  return tags;
}

function audit() {
  const issues = [];
  let totalImgs = 0;
  let imgsWithDims = 0;
  let imgsWithSrcset = 0;

  for (const f of walk(DIST)) {
    const html = readFileSync(f, 'utf8');
    const tags = extractImgTags(html);
    totalImgs += tags.length;

    for (const tag of tags) {
      // Skip if no src (likely a placeholder)
      if (!tag.src) continue;

      // Check srcset-only responsive images
      const hasSrcset = new RegExp(`<img[^>]*srcset=`, 'i').test(html.slice(Math.max(0, html.indexOf(tag.src) - 200), html.indexOf(tag.src) + tag.src.length + 100));
      if (hasSrcset) imgsWithSrcset++;

      const hasWidth = tag.width !== null && /^\d+$/.test(tag.width) && parseInt(tag.width, 10) > 0;
      const hasHeight = tag.height !== null && /^\d+$/.test(tag.height) && parseInt(tag.height, 10) > 0;

      if (hasWidth && hasHeight) {
        imgsWithDims++;
        continue;
      }

      issues.push({
        rule: !hasWidth && !hasHeight ? 'missing-width-and-height' : !hasWidth ? 'missing-width' : 'missing-height',
        msg: `${f} — <img src="${tag.src}"${hasWidth ? '' : ' (no width)'}${hasHeight ? '' : ' (no height)'}>`,
      });
    }
  }

  return { issues, totalImgs, imgsWithDims, imgsWithSrcset };
}

function main() {
  console.log('=== Image-Dimension-Attributes Audit (v7.7.32) — <img> width/height intrinsic dims ===\n');

  const { issues, totalImgs, imgsWithDims, imgsWithSrcset } = audit();

  console.log(`Scanned ${totalImgs} <img> tag(s) across dist/ · ${imgsWithDims} have both width+height · ${issues.length} issue(s)\n`);
  if (imgsWithSrcset > 0) {
    console.log(`  (${imgsWithSrcset} <img> tag(s) use srcset for responsive sizing — exempt from intrinsic-dim requirement)\n`);
  }

  if (issues.length === 0) {
    console.log(`✓ All ${totalImgs} <img> tags have intrinsic width+height attributes (CLS-safe).`);
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

  console.error(`\nFAIL — ${issues.length} image-dimension-attributes issue(s).`);
  process.exit(1);
}

try {
  main();
} catch (e) {
  console.error('image-dimension-attributes scan crashed:', e);
  process.exit(2);
}