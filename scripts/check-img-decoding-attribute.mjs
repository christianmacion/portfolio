// check-img-decoding-attribute.mjs — v7.7.43 IMG-DECODING-ATTRIBUTE CI GATE
//
// Validates that every <img> in dist/ has an explicit decoding= attribute
// set to one of: "async" (default — defer decoding), "sync" (decode synchronously,
// for hero/LCP-critical), or "auto" (browser default — no preference).
//
// Why this matters: explicit decoding= gives the browser an intentional
// decode strategy. Without it, browsers default to "auto" which is similar
// to "sync" — meaning the browser blocks on image decode before continuing
// other work. Setting decoding="async" lets the browser decode in parallel,
// improving perceived performance.
//
// Rules enforced:
//   1. img-without-decoding-attribute — every <img> MUST have a decoding=
//      attribute with value "async", "sync", or "auto"
//
// Skips: NONE — every <img> should be intentional about its decode strategy
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
    const decodingMatch = full.match(/\bdecoding\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const decodingValue = decodingMatch ? (decodingMatch[1] ?? decodingMatch[2] ?? '') : null;
    tags.push({
      offset: m.index,
      full,
      hasDecoding: decodingMatch !== null,
      decodingValue,
    });
  }
  return tags;
}

function audit() {
  const issues = [];
  let totalImgs = 0;
  let imgsWithDecoding = 0;
  let imgsWithAsync = 0;
  let imgsWithSync = 0;
  let imgsWithAuto = 0;
  let imgsWithoutDecoding = 0;

  for (const f of walk(DIST)) {
    const html = readFileSync(f, 'utf8');
    const imgs = findImgTags(html);
    totalImgs += imgs.length;

    for (const i of imgs) {
      if (i.hasDecoding) {
        imgsWithDecoding++;
        if (i.decodingValue === 'async') imgsWithAsync++;
        else if (i.decodingValue === 'sync') imgsWithSync++;
        else if (i.decodingValue === 'auto') imgsWithAuto++;
      } else {
        imgsWithoutDecoding++;
        issues.push({
          rule: 'img-without-decoding-attribute',
          msg: `${f} — <img> at offset ${i.offset} has NO decoding= attribute (browser defaults to "auto" which behaves like sync — blocks main thread on image decode)`,
        });
      }
    }
  }

  return {
    issues,
    totalImgs,
    imgsWithDecoding,
    imgsWithAsync,
    imgsWithSync,
    imgsWithAuto,
    imgsWithoutDecoding,
  };
}

function main() {
  console.log('=== Img-Decoding-Attribute Audit (v7.7.43) — every <img> must have explicit decoding= attribute ===\n');

  const { issues, totalImgs, imgsWithDecoding, imgsWithAsync, imgsWithSync, imgsWithAuto, imgsWithoutDecoding } = audit();

  console.log(`Scanned ${totalImgs} <img> tag(s) · ${imgsWithDecoding} with decoding= · ${imgsWithAsync} async · ${imgsWithSync} sync · ${imgsWithAuto} auto · ${imgsWithoutDecoding} WITHOUT decoding= · ${issues.length} issue(s)\n`);

  if (issues.length === 0) {
    console.log(`✓ All ${totalImgs} <img> tag(s) have explicit decoding= attribute (browser knows how to decode each image).`);
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

  console.error(`\nFAIL — ${issues.length} img-without-decoding-attribute issue(s).`);
  process.exit(1);
}

try {
  main();
} catch (e) {
  console.error('img-decoding-attribute scan crashed:', e);
  process.exit(2);
}
