// scan-a11y.mjs — v7.27 AXE-CORE A11Y SCAN CI GATE
//
// Walks dist/**/index.html, loads each into jsdom, runs axe-core, and
// fails the build on any violation with impact ≥ serious.
//
// Rules excluded: color-contrast (axe-core needs computed styles for
// accurate contrast; jsdom doesn't compute them). The no-bulbs + no-f14
// + no-halo gates + tokens.css manual review cover visual contrast.
//
// Exits 1 on any serious/critical violation. Exits 0 otherwise.
// Used in: npm run ci (after perf:audit).

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import axeCore from 'axe-core';

// Silence axe-core's noisy "You have not configured..." warnings about
// the standards settings — we intentionally skip color-contrast.
const SKIPPED_RULES = ['color-contrast'];

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else yield full;
  }
}

async function auditRoute(htmlPath) {
  const html = await readFile(htmlPath, 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const { window } = dom;
  // Inject axe-core into the jsdom window.
  const script = new window.Function(`
    ${axeCore.source}
    return axe;
  `);
  const axe = script();
  const result = await axe.run(window.document, {
    rules: Object.fromEntries(SKIPPED_RULES.map((r) => [r, { enabled: false }])),
    resultTypes: ['violations'],
  });
  window.close();
  return result.violations.map((v) => ({
    ruleId: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.length,
    targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
  }));
}

async function main() {
  console.log('=== A11y Audit (v7.27) — axe-core via jsdom ===\n');
  console.log('Excluded rules (require computed styles):', SKIPPED_RULES.join(', '), '\n');

  const routes = [];
  for await (const file of walk('dist')) {
    if (!file.endsWith('index.html')) continue;
    const parts = file.split('/');
    if (parts.includes('_astro') || parts.includes('_pagefind')) continue;
    routes.push(file);
  }
  routes.sort();

  const findings = [];
  let scanned = 0;
  for (const route of routes) {
    const violations = await auditRoute(route);
    scanned++;
    for (const v of violations) {
      if (v.impact === 'serious' || v.impact === 'critical') {
        findings.push({ route: route.replace('dist', ''), ...v });
      }
    }
  }

  console.log(`Scanned ${scanned} routes · ${findings.length} serious/critical violation(s)\n`);

  if (findings.length === 0) {
    console.log('✓ No serious or critical a11y violations.');
    return;
  }

  // Group by route for the report.
  const byRoute = new Map();
  for (const f of findings) {
    if (!byRoute.has(f.route)) byRoute.set(f.route, []);
    byRoute.get(f.route).push(f);
  }
  for (const [route, list] of byRoute) {
    console.log(`\n${route}:`);
    for (const v of list) {
      console.log(`  ✗ [${v.impact}] ${v.ruleId} — ${v.help}`);
      console.log(`      nodes: ${v.nodes}  ${v.targets.join(' | ')}`);
    }
  }
  console.error(`\nFAIL — ${findings.length} a11y violation(s) ≥ serious.`);
  process.exit(1);
}

main().catch((e) => {
  console.error('a11y scan crashed:', e);
  process.exit(2);
});