// check-bundle-budget.mjs — v7.7 BUNDLE BUDGET GATE
//
// Enforces the front-end bundle budget on every CI build. Fails the
// build if code-side budget exceeds site totals:
//   - 200 KB JS gzipped site-wide (modules shared across routes)
//   - 200 KB total CSS gzipped per route
//   - 2 MB code (JS+CSS+HTML) site-wide
//
// Per-route JS is reported but not enforced as a hard gate (Astro
// shares modules across routes — site-wide sum is the right metric).
//
// Used in: npm run ci (between build and no-f14)

import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = 'dist';
const BUDGETS = {
  jsTotal: 200 * 1024, // 200 KB gzipped JS site-wide
  cssTotal: 200 * 1024, // 200 KB gzipped CSS site-wide
  codeTotal: 2 * 1024 * 1024, // 2 MB gzipped code (JS+CSS+HTML)
};

const ROUTES = new Set();

async function walk(dir, base = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  let jsSize = 0, cssSize = 0, htmlSize = 0, otherSize = 0;
  for (const e of entries) {
    const full = join(dir, e.name);
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) {
      const sub = await walk(full, rel);
      jsSize += sub.js;
      cssSize += sub.css;
      htmlSize += sub.html;
      otherSize += sub.other;
    } else {
      const ext = extname(e.name);
      const buf = await readFile(full);
      const gz = gzipSync(buf).length;
      if (ext === '.js') jsSize += gz;
      else if (ext === '.css') cssSize += gz;
      else if (ext === '.html') htmlSize += gz;
      else otherSize += gz;
    }
  }
  if (base) ROUTES.add(base);
  return { js: jsSize, css: cssSize, html: htmlSize, other: otherSize };
}

function fmt(b) {
  return `${(b / 1024).toFixed(1)} KB`;
}

function verdict(actual, budget) {
  return actual <= budget ? 'PASS' : 'FAIL';
}

async function main() {
  const totals = await walk(DIST);
  const codeGz = totals.js + totals.css + totals.html;

  console.log('=== Bundle Budget Audit (v7.7) ===\n');
  console.log(`Site totals (gzipped — code only):`);
  console.log(`  JS:   ${fmt(totals.js)} / ${fmt(BUDGETS.jsTotal)}  [${verdict(totals.js, BUDGETS.jsTotal)}]`);
  console.log(`  CSS:  ${fmt(totals.css)} / ${fmt(BUDGETS.cssTotal)}  [${verdict(totals.css, BUDGETS.cssTotal)}]`);
  console.log(`  HTML: ${fmt(totals.html)}`);
  console.log(`  CODE: ${fmt(codeGz)} / ${fmt(BUDGETS.codeTotal)}  [${verdict(codeGz, BUDGETS.codeTotal)}]`);
  console.log(`\nAssets (gzipped, informational — not enforced):`);
  console.log(`  Other (images/video/fonts): ${fmt(totals.other)}`);
  console.log(`  Grand total: ${fmt(codeGz + totals.other)}`);
  console.log(`\nRoutes: ${ROUTES.size}`);

  const failures = [];

  if (totals.js > BUDGETS.jsTotal) {
    failures.push(`JS ${fmt(totals.js)} exceeds ${fmt(BUDGETS.jsTotal)}`);
  }
  if (totals.css > BUDGETS.cssTotal) {
    failures.push(`CSS ${fmt(totals.css)} exceeds ${fmt(BUDGETS.cssTotal)}`);
  }
  if (codeGz > BUDGETS.codeTotal) {
    failures.push(`Code ${fmt(codeGz)} exceeds ${fmt(BUDGETS.codeTotal)}`);
  }

  console.log('\n=== Result ===');
  if (failures.length === 0) {
    console.log(`PASS — bundle within budget.`);
    process.exit(0);
  } else {
    console.log(`FAIL — bundle exceeds budget:`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('bundle-budget audit crashed:', e);
  process.exit(2);
});
