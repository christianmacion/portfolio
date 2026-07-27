// verify-anchors.mjs — v7.18 ANCHOR VERIFICATION GATE
//
// Per v7.17 AAR's "what I'd do differently": before shipping any
// deep-link TOC, verify every `chapters[]` anchor in Astro frontmatter
// actually exists in the target HTML file.
//
// Sources of truth for the deep-links:
//   - src/pages/workbooks.astro — `workbooks[].chapters[]` frontmatter
//   - public/workbooks/<id>/index.html — target HTML viewer
//
// For each chapter in each workbook:
//   - Extract `anchor` (#ch-N) and `href` (/workbooks/<id>/)
//   - Resolve href → file under public/
//   - Read target file
//   - Grep for `id="{anchor-without-hash}"`
//
// Exit 0 if every anchor present, 1 if any missing. Wired into `npm run ci`
// between `build` and `bundle:budget`.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const WORKBOOKS_PAGE = 'src/pages/workbooks.astro';
const PUBLIC_ROOT = 'public';

/**
 * Extract chapter anchors + target hrefs from the `workbooks` constant
 * in workbooks.astro frontmatter.
 *
 * We avoid a full TS/Astro parse — a focused regex pulls the two fields
 * we need (href + chapters[] array). Robust enough for the v7.18 case;
 * if the workbooks array grows beyond 2 entries, this still works.
 */
function parseWorkbooks(src) {
  const workbooks = [];

  // Each workbook block starts at `  {` and contains `id:`, `href:`, `chapters: [...]`
  // Match the entire object via a tolerant pattern: capture `href:` line
  // and the chapters array that follows.
  const wbRegex =
    /\{\s*id:\s*'(w\d+)'[\s\S]*?href:\s*'([^']+)'[\s\S]*?chapters:\s*\[([\s\S]*?)\],?\s*\}/g;

  let m;
  while ((m = wbRegex.exec(src)) !== null) {
    const [, id, href, chaptersBlock] = m;
    const chapters = [];
    // Each chapter: { num: N, name: '...', anchor: '#ch-X' },
    const chRegex =
      /\{\s*num:\s*(\d+)\s*,\s*name:\s*'([^']*)'\s*,\s*anchor:\s*'(#ch-\d+)'\s*,?\s*\}/g;
    let cm;
    while ((cm = chRegex.exec(chaptersBlock)) !== null) {
      chapters.push({ num: parseInt(cm[1], 10), name: cm[2], anchor: cm[3] });
    }
    workbooks.push({ id, href, chapters });
  }

  return workbooks;
}

/**
 * Resolve a public path like /workbooks/ai-engineering/ to a file under public/.
 * Convention: <href>index.html
 */
function resolveTarget(href) {
  const clean = href.startsWith('/') ? href.slice(1) : href;
  const withSlash = clean.endsWith('/') ? clean : `${clean}/`;
  return join(PUBLIC_ROOT, `${withSlash}index.html`);
}

async function main() {
  console.log('=== Anchor Verification Gate (v7.18) ===\n');

  let src;
  try {
    src = await readFile(WORKBOOKS_PAGE, 'utf8');
  } catch (e) {
    console.error(`FAIL: cannot read ${WORKBOOKS_PAGE}:`, e.message);
    process.exit(2);
  }

  const workbooks = parseWorkbooks(src);
  if (workbooks.length === 0) {
    console.error(`FAIL: no workbook entries parsed from ${WORKBOOKS_PAGE}.`);
    console.error('      (Frontmatter structure may have changed — update the parser.)');
    process.exit(2);
  }

  console.log(`Parsed ${workbooks.length} workbook(s):`);
  for (const wb of workbooks) {
    console.log(`  ${wb.id}  href=${wb.href}  chapters=${wb.chapters.length}`);
  }
  console.log('');

  const failures = [];
  let totalChecked = 0;

  for (const wb of workbooks) {
    const target = resolveTarget(wb.href);
    let html;
    try {
      html = await readFile(target, 'utf8');
    } catch (e) {
      failures.push(`${wb.id}: cannot read target ${target}: ${e.message}`);
      continue;
    }

    console.log(`[${wb.id}] ${target}`);
    for (const ch of wb.chapters) {
      totalChecked++;
      // The anchor on the chapter heading is `id="ch-N"` — strip the leading '#'.
      const idAttr = ch.anchor.startsWith('#') ? ch.anchor.slice(1) : ch.anchor;
      // Look for the id attribute — must be exactly `id="ch-N"` (boundary-aware).
      const re = new RegExp(`id=["']${idAttr}["']`);
      const found = re.test(html);
      const status = found ? '✓' : '✗';
      console.log(`  ${status} ch.${String(ch.num).padStart(2, '0')}  ${ch.anchor}  ${ch.name}`);
      if (!found) {
        failures.push(`${wb.id}: missing ${ch.anchor} on ${ch.name} in ${target}`);
      }
    }
  }

  console.log(`\nChecked ${totalChecked} anchor(s) across ${workbooks.length} workbook(s).`);

  if (failures.length === 0) {
    console.log('PASS — every chapter anchor resolves to an id in the target HTML.');
    process.exit(0);
  } else {
    console.log(`FAIL — ${failures.length} missing anchor(s):`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('verify-anchors crashed:', e);
  process.exit(2);
});
