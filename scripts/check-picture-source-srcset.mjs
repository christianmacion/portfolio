// check-picture-source-srcset.mjs — v7.7.38 PICTURE-SOURCE-SRCSET CI GATE
//
// Validates that every <source> inside a <picture> block carries an actual
// file reference (either srcset= or src= attribute). Without srcset, the
// <source> tag is a no-op — browsers skip it and fall through to <img>,
// defeating the entire purpose of <picture>.
//
// Companion to the picture triad:
//   v7.7.34 picture-source-pairing (39th, checks presence of type=webp)
//   v7.7.36 picture-count         (40th, checks count parity)
//   v7.7.37 picture-source-order   (41st, checks ordering)
//   v7.7.38 picture-source-srcset  (42nd, checks source POINTS to a file)
//
// Rules enforced:
//   1. source-without-srcset — every <source> inside a <picture> block MUST
//      have a non-empty srcset= or src= attribute (a source that doesn't
//      point anywhere is dead markup)
//
// Skips: <picture> blocks with no <source> (trivially OK — caught by v7.7.34).
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

function extractPictureBlocks(html) {
  const blocks = [];
  const re = /<picture\b[^>]*>([\s\S]*?)<\/picture>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    blocks.push({ start: m.index, end: m.index + m[0].length, inner: m[1], full: m[0] });
  }
  return blocks;
}

function findSourceTags(inner) {
  // Return array of {offset, full, hasSrcset, hasSrc, srcsetValue}
  const tagRe = /<source\b[^>]*\/?>/gi;
  const tags = [];
  let m;
  while ((m = tagRe.exec(inner)) !== null) {
    const full = m[0];
    // Extract srcset= value (handles single + double quotes)
    const srcsetMatch = full.match(/\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const srcsetValue = srcsetMatch ? (srcsetMatch[1] ?? srcsetMatch[2] ?? '') : null;
    const hasSrc = /\bsrc\s*=\s*(?:"[^"]+"|'[^']+')/i.test(full);
    tags.push({
      offset: m.index,
      full,
      hasSrcset: srcsetMatch !== null,
      hasSrc,
      srcsetValue,
    });
  }
  return tags;
}

function audit() {
  const issues = [];
  let totalPictureBlocks = 0;
  let blocksWithSource = 0;
  let totalSources = 0;
  let sourcesWithSrcset = 0;
  let sourcesWithSrc = 0;
  let sourcesWithoutFileRef = 0;

  for (const f of walk(DIST)) {
    const html = readFileSync(f, 'utf8');
    const blocks = extractPictureBlocks(html);
    totalPictureBlocks += blocks.length;

    for (const b of blocks) {
      const sources = findSourceTags(b.inner);
      if (sources.length === 0) continue; // no source — v7.7.34's problem
      blocksWithSource++;
      totalSources += sources.length;

      for (const s of sources) {
        // A source is OK if it has EITHER srcset (non-empty) OR src (non-empty)
        const srcsetOk = s.hasSrcset && s.srcsetValue && s.srcsetValue.trim().length > 0;
        const srcOk = s.hasSrc;
        if (srcsetOk) sourcesWithSrcset++;
        else if (srcOk) sourcesWithSrc++;

        if (!srcsetOk && !srcOk) {
          sourcesWithoutFileRef++;
          issues.push({
            rule: 'source-without-srcset',
            msg: `${f} — <picture> block at offset ${b.start}: <source> tag has no srcset= and no src= (browsers will skip this source and fall through to <img>): ${s.full.slice(0, 120)}`,
          });
        }
      }
    }
  }

  return {
    issues,
    totalPictureBlocks,
    blocksWithSource,
    totalSources,
    sourcesWithSrcset,
    sourcesWithSrc,
    sourcesWithoutFileRef,
  };
}

function main() {
  console.log('=== Picture-Source-Srcset Audit (v7.7.38) — every <source> must point to a file (srcset= or src=) ===\n');

  const { issues, totalPictureBlocks, blocksWithSource, totalSources, sourcesWithSrcset, sourcesWithSrc, sourcesWithoutFileRef } = audit();

  console.log(`Scanned ${totalPictureBlocks} <picture> block(s) · ${blocksWithSource} with <source> · ${totalSources} <source> tag(s) total · ${sourcesWithSrcset} with srcset · ${sourcesWithSrc} with src (fallback) · ${sourcesWithoutFileRef} without file ref · ${issues.length} issue(s)\n`);

  if (issues.length === 0) {
    console.log(`✓ All ${totalSources} <source> tag(s) point to actual files (have srcset= or src= attribute). Browsers can resolve every source.`);
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

  console.error(`\nFAIL — ${issues.length} picture-source-srcset issue(s).`);
  process.exit(1);
}

try {
  main();
} catch (e) {
  console.error('picture-source-srcset scan crashed:', e);
  process.exit(2);
}
