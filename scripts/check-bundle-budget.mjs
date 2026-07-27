// check-bundle-budget.mjs — v7.23 BUNDLE BUDGET GATE
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
// v7.23 — emit a per-route breakdown table sorted by total gzipped bytes.
// Top-N (default 10) routes get a row each; remaining routes get a summary.
// The breakdown makes regressions visible without burying them in the
// site-total number.
//
// Used in: npm run ci (between build and no-f14)

import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = 'dist';
const TOP_N_ROUTES = 10;
const BUDGETS = {
  jsTotal: 200 * 1024, // 200 KB gzipped JS site-wide
  cssTotal: 200 * 1024, // 200 KB gzipped CSS site-wide
  codeTotal: 2 * 1024 * 1024, // 2 MB gzipped code (JS+CSS+HTML)
};

const ROUTES = new Set();
const ROUTE_STATS = new Map(); // route -> { js, css, html, other }

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
  if (base) {
    ROUTES.add(base);
    // Roll up into the top-level route bucket. Astro builds produce
    // dist/<route>/index.html + dist/<route>/_astro/*.js, so the first
    // path segment is the route key.
    const topRoute = base.split('/')[0];
    const cur = ROUTE_STATS.get(topRoute) ?? { js: 0, css: 0, html: 0, other: 0 };
    cur.js += jsSize;
    cur.css += cssSize;
    cur.html += htmlSize;
    cur.other += otherSize;
    ROUTE_STATS.set(topRoute, cur);
  }
  return { js: jsSize, css: cssSize, html: htmlSize, other: otherSize };
}

function fmt(b) {
  return `${(b / 1024).toFixed(1)} KB`;
}

function verdict(actual, budget) {
  return actual <= budget ? 'PASS' : 'FAIL';
}

function pad(s, w) {
  s = String(s);
  if (s.length >= w) return s;
  return s + ' '.repeat(w - s.length);
}

function renderRouteTable() {
  const rows = Array.from(ROUTE_STATS.entries())
    .map(([route, s]) => ({
      route,
      js: s.js,
      css: s.css,
      html: s.html,
      other: s.other,
      total: s.js + s.css + s.html,
    }))
    .sort((a, b) => b.total - a.total);

  if (rows.length === 0) return;

  const top = rows.slice(0, TOP_N_ROUTES);
  const rest = rows.slice(TOP_N_ROUTES);

  console.log(`\n=== Top ${top.length} routes by total gzipped ===`);
  console.log(`${pad('ROUTE', 28)}  ${pad('JS', 9)}  ${pad('CSS', 9)}  ${pad('HTML', 9)}  ${pad('OTHER', 9)}  ${pad('TOTAL', 9)}`);
  console.log(`${'-'.repeat(28)}  ${'-'.repeat(9)}  ${'-'.repeat(9)}  ${'-'.repeat(9)}  ${'-'.repeat(9)}  ${'-'.repeat(9)}`);
  for (const r of top) {
    console.log(
      `${pad('/' + r.route, 28)}  ${pad(fmt(r.js), 9)}  ${pad(fmt(r.css), 9)}  ${pad(fmt(r.html), 9)}  ${pad(fmt(r.other), 9)}  ${pad(fmt(r.total), 9)}`,
    );
  }
  if (rest.length > 0) {
    const restTotal = rest.reduce((acc, r) => acc + r.total, 0);
    console.log(`${pad(`(${rest.length} more routes)`, 28)}  ${pad('', 9)}  ${pad('', 9)}  ${pad('', 9)}  ${pad('', 9)}  ${pad(fmt(restTotal), 9)}`);
  }
}

async function main() {
  const totals = await walk(DIST);
  const codeGz = totals.js + totals.css + totals.html;

  console.log('=== Bundle Budget Audit (v7.23) ===\n');
  console.log(`Site totals (gzipped — code only):`);
  console.log(`  JS:   ${fmt(totals.js)} / ${fmt(BUDGETS.jsTotal)}  [${verdict(totals.js, BUDGETS.jsTotal)}]`);
  console.log(`  CSS:  ${fmt(totals.css)} / ${fmt(BUDGETS.cssTotal)}  [${verdict(totals.css, BUDGETS.cssTotal)}]`);
  console.log(`  HTML: ${fmt(totals.html)}`);
  console.log(`  CODE: ${fmt(codeGz)} / ${fmt(BUDGETS.codeTotal)}  [${verdict(codeGz, BUDGETS.codeTotal)}]`);
  console.log(`\nAssets (gzipped, informational — not enforced):`);
  console.log(`  Other (images/video/fonts): ${fmt(totals.other)}`);
  console.log(`  Grand total: ${fmt(codeGz + totals.other)}`);
  console.log(`\nRoutes: ${ROUTES.size}`);

  renderRouteTable();

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