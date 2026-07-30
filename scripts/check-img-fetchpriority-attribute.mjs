// check-img-fetchpriority-attribute.mjs — v7.7.44 IMG-FETCHPRIORITY-ATTRIBUTE CI GATE
//
// Validates that every <img> in dist/ has an explicit fetchpriority= attribute
// set to one of: "high" (hero/LCP-critical — request earlier),
// "auto" (browser default — no preference), or "low" (defer to other work).
//
// Why this matters: browsers default to fetchpriority="auto" for <img>
// without an explicit attribute. With auto, all imgs compete equally for
// bandwidth, which can cause the LCP-critical hero to be delayed behind
// less-important images. Setting fetchpriority="high" on the hero tells the
// browser to fetch it earlier in the resource load waterfall. Setting
// fetchpriority="low" on below-fold decorative imgs defers them.
//
// Rules enforced:
//   1. img-without-fetchpriority-attribute — every <img> MUST have a fetchpriority=
//      attribute with value "high", "auto", or "low"
//
// Skips: NONE — every <img> should be intentional about its fetch priority
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
    const priorityMatch = full.match(/\bfetchpriority\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const priorityValue = priorityMatch ? (priorityMatch[1] ?? priorityMatch[2] ?? '') : null;
    tags.push({
      offset: m.index,
      full,
      hasFetchpriority: priorityMatch !== null,
      priorityValue,
    });
  }
  return tags;
}

function audit() {
  const issues = [];
  let totalImgs = 0;
  let imgsWithFetchpriority = 0;
  let imgsWithHigh = 0;
  let imgsWithAuto = 0;
  let imgsWithLow = 0;
  let imgsWithoutFetchpriority = 0;

  for (const f of walk(DIST)) {
    const html = readFileSync(f, 'utf8');
    const imgs = findImgTags(html);
    totalImgs += imgs.length;

    for (const i of imgs) {
      if (i.hasFetchpriority) {
        imgsWithFetchpriority++;
        if (i.priorityValue === 'high') imgsWithHigh++;
        else if (i.priorityValue === 'auto') imgsWithAuto++;
        else if (i.priorityValue === 'low') imgsWithLow++;
      } else {
        imgsWithoutFetchpriority++;
        issues.push({
          rule: 'img-without-fetchpriority-attribute',
          msg: `${f} — <img> at offset ${i.offset} has NO fetchpriority= attribute (browser defaults to "auto" — competes equally with all imgs, hurting LCP for hero and crowding network for below-fold decorative imgs)`,
        });
      }
    }
  }

  return {
    issues,
    totalImgs,
    imgsWithFetchpriority,
    imgsWithHigh,
    imgsWithAuto,
    imgsWithLow,
    imgsWithoutFetchpriority,
  };
}

function main() {
  console.log('=== Img-Fetchpriority-Attribute Audit (v7.7.44) — every <img> must have explicit fetchpriority= attribute ===\n');

  const { issues, totalImgs, imgsWithFetchpriority, imgsWithHigh, imgsWithAuto, imgsWithLow, imgsWithoutFetchpriority } = audit();

  console.log(`Scanned ${totalImgs} <img> tag(s) · ${imgsWithFetchpriority} with fetchpriority= · ${imgsWithHigh} high · ${imgsWithAuto} auto · ${imgsWithLow} low · ${imgsWithoutFetchpriority} WITHOUT fetchpriority= · ${issues.length} issue(s)\n`);

  if (issues.length === 0) {
    console.log(`✓ All ${totalImgs} <img> tag(s) have explicit fetchpriority= attribute (browser knows how to prioritize each image).`);
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

  console.error(`\nFAIL — ${issues.length} img-without-fetchpriority-attribute issue(s).`);
  process.exit(1);
}

try {
  main();
} catch (e) {
  console.error('img-fetchpriority-attribute scan crashed:', e);
  process.exit(2);
}
