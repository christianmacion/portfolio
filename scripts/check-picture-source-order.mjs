// check-picture-source-order.mjs — v7.7.37 PICTURE-SOURCE-ORDER CI GATE
//
// Validates that within each <picture>...</picture> block, every <source>
// declaration appears BEFORE the <img> fallback. Browsers pick the first
// matching source — if <source> comes after <img>, the <img> wins (which
// is the original browser-picking behavior, defeating the whole purpose
// of <picture>).
//
// Companion to v7.7.34 picture-source-pairing (39th, checks presence) and
// v7.7.36 picture-count (40th, checks count parity). v7.7.37 checks ORDER.
//
// Rules enforced:
//   1. source-after-img-ordering — every <source> inside a <picture> block
//      MUST appear before the <img> tag within that block
//
// Skips: <picture> blocks with no <img> (unusual but valid).
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

function findSourceAndImgOffsets(inner) {
  // Return array of {type: 'source'|'img', offset} in document order
  const tagRe = /<(source|img)\b[^>]*\/?>/gi;
  const tags = [];
  let m;
  while ((m = tagRe.exec(inner)) !== null) {
    tags.push({ type: m[1].toLowerCase(), offset: m.index });
  }
  return tags;
}

function audit() {
  const issues = [];
  let totalPictureBlocks = 0;
  let blocksWithSource = 0;
  let blocksCorrectlyOrdered = 0;
  let blocksMisordered = 0;
  let blocksWithNoImg = 0;

  for (const f of walk(DIST)) {
    const html = readFileSync(f, 'utf8');
    const blocks = extractPictureBlocks(html);
    totalPictureBlocks += blocks.length;

    for (const b of blocks) {
      const tags = findSourceAndImgOffsets(b.inner);
      const sources = tags.filter((t) => t.type === 'source');
      const imgs = tags.filter((t) => t.type === 'img');

      if (imgs.length === 0) {
        blocksWithNoImg++;
        continue;
      }

      if (sources.length === 0) {
        // No source at all — caught by v7.7.34; not our concern
        blocksCorrectlyOrdered++; // trivially correct
        continue;
      }

      blocksWithSource++;

      // Find the FIRST <img> offset. Any <source> after that = misordered.
      const firstImgOffset = imgs[0].offset;
      const offendingSources = sources.filter((s) => s.offset > firstImgOffset);
      if (offendingSources.length === 0) {
        blocksCorrectlyOrdered++;
      } else {
        blocksMisordered++;
        issues.push({
          rule: 'source-after-img-ordering',
          msg: `${f} — <picture> block at offset ${b.start}: ${offendingSources.length} <source> tag(s) appear AFTER the <img> fallback (browsers will pick <img>, not <source>)`,
        });
      }
    }
  }

  return {
    issues,
    totalPictureBlocks,
    blocksWithSource,
    blocksCorrectlyOrdered,
    blocksMisordered,
    blocksWithNoImg,
  };
}

function main() {
  console.log('=== Picture-Source-Order Audit (v7.7.37) — <source> must precede <img> inside <picture> ===\n');

  const { issues, totalPictureBlocks, blocksWithSource, blocksCorrectlyOrdered, blocksMisordered, blocksWithNoImg } = audit();

  console.log(`Scanned ${totalPictureBlocks} <picture> block(s) · ${blocksWithSource} have <source> · ${blocksCorrectlyOrdered} correctly ordered · ${blocksMisordered} misordered · ${blocksWithNoImg} no-<img> · ${issues.length} issue(s)\n`);

  if (issues.length === 0) {
    console.log(`✓ All ${blocksWithSource} <picture> block(s) with <source> have source(s) before <img> fallback (browsers will pick the first matching source).`);
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

  console.error(`\nFAIL — ${issues.length} picture-source-order issue(s).`);
  process.exit(1);
}

try {
  main();
} catch (e) {
  console.error('picture-source-order scan crashed:', e);
  process.exit(2);
}