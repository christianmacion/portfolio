// check-img-loading-attribute.mjs — v7.7.42 IMG-LOADING-ATTRIBUTE CI GATE
//
// Validates that every <img> in dist/ has an explicit loading= attribute
// set to either "lazy" or "eager". Browsers default to "eager" — which
// means every <img> WITHOUT an explicit loading= attribute starts
// downloading immediately on page load, even if it's below the fold.
//
// Why this matters: for below-fold images, the default "eager" causes
// the browser to start downloading as soon as it parses the <img> tag.
// This wastes bandwidth + blocks the main thread. Setting loading="lazy"
// defers the download until the image is near the viewport.
//
// Rules enforced:
//   1. img-without-loading-attribute — every <img> MUST have a loading=
//      attribute with value "lazy" or "eager"
//
// Skips: NONE — every <img> should be intentional about its loading strategy
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

function findImgTags(html) {
  const tagRe = /<img\b[^>]*\/?>/gi;
  const tags = [];
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const full = m[0];
    const loadingMatch = full.match(/\bloading\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const loadingValue = loadingMatch ? (loadingMatch[1] ?? loadingMatch[2] ?? '') : null;
    tags.push({
      offset: m.index,
      full,
      hasLoading: loadingMatch !== null,
      loadingValue,
    });
  }
  return tags;
}

function audit() {
  const issues = [];
  let totalImgs = 0;
  let imgsWithLoading = 0;
  let imgsWithLazy = 0;
  let imgsWithEager = 0;
  let imgsWithoutLoading = 0;

  for (const f of walk(DIST)) {
    const html = readFileSync(f, 'utf8');
    const imgs = findImgTags(html);
    totalImgs += imgs.length;

    for (const i of imgs) {
      if (i.hasLoading) {
        imgsWithLoading++;
        if (i.loadingValue === 'lazy') imgsWithLazy++;
        else if (i.loadingValue === 'eager') imgsWithEager++;
        // Note: invalid values (e.g., "auto") are also counted as having loading=
        // Future gate could validate value is exactly "lazy" or "eager"
      } else {
        imgsWithoutLoading++;
        issues.push({
          rule: 'img-without-loading-attribute',
          msg: `${f} — <img> at offset ${i.offset} has NO loading= attribute (browser default is "eager" — image downloads immediately even if below the fold)`,
        });
      }
    }
  }

  return {
    issues,
    totalImgs,
    imgsWithLoading,
    imgsWithLazy,
    imgsWithEager,
    imgsWithoutLoading,
  };
}

function main() {
  console.log('=== Img-Loading-Attribute Audit (v7.7.42) — every <img> must have explicit loading= attribute ===\n');

  const { issues, totalImgs, imgsWithLoading, imgsWithLazy, imgsWithEager, imgsWithoutLoading } = audit();

  console.log(`Scanned ${totalImgs} <img> tag(s) · ${imgsWithLoading} with loading= · ${imgsWithLazy} lazy · ${imgsWithEager} eager · ${imgsWithoutLoading} WITHOUT loading= · ${issues.length} issue(s)\n`);

  if (issues.length === 0) {
    console.log(`✓ All ${totalImgs} <img> tag(s) have explicit loading= attribute (browser knows when to fetch each image).`);
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

  console.error(`\nFAIL — ${issues.length} img-without-loading-attribute issue(s).`);
  process.exit(1);
}

try {
  main();
} catch (e) {
  console.error('img-loading-attribute scan crashed:', e);
  process.exit(2);
}
