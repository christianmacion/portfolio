#!/usr/bin/env node
// W2 verify — site-wide axe-core sweep on all 47 routes.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = 'http://localhost:4322';
const OUT_DIR = '/tmp/axe-w2-verify';
mkdirSync(OUT_DIR, { recursive: true });

const STATIC_ROUTES = [
  '/', '/about/', '/about-this-site/', '/ai/', '/certifications/', '/colophon/',
  '/comp/', '/contact/', '/desk/', '/engagement/', '/experience/', '/for-recruiters/',
  '/glossary/', '/markets/', '/methodology/', '/mistakes/', '/notes/', '/now/',
  '/papers/', '/positions/', '/prediction-markets/', '/proof/', '/publications/',
  '/reading/', '/repos/', '/research/', '/resume/', '/screening-call/', '/search/',
  '/skills/', '/solutions/', '/stack/', '/talks/', '/uses/', '/work/', '/workbooks/',
  '/case-studies/acion-rf-backtest/', '/case-studies/phase-e-cockpit/',
  '/case-studies/quant-overcoffee/', '/case-studies/v9-3-chrome/',
  '/research/frontier-models/', '/projects/',
];

const ALL_ROUTES = STATIC_ROUTES;
console.log(`[axe-w2] route plan: ${STATIC_ROUTES.length} static routes`);

const axeSource = readFileSync(resolve('node_modules/axe-core/axe.min.js'), 'utf8');

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });

const results = [];
let totalViolations = 0;
const byType = { 'color-contrast': 0, 'aria': 0, 'focus': 0, 'semantic': 0, 'other': 0 };
const typeByViolationId = new Map();

for (const route of ALL_ROUTES) {
  const url = `${BASE}${route}`;
  const page = await ctx.newPage();
  try {
    const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    const status = resp ? resp.status() : 0;
    if (status >= 400) {
      results.push({ route, status, error: `HTTP ${status}`, violations: 0, nodes: 0, top: null, detail: [] });
      await page.close();
      continue;
    }
    await page.evaluate(() => document.fonts.ready);
    await page.addScriptTag({ content: axeSource });
    const res = await page.evaluate(async () => {
      const r = await axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
        resultTypes: ['violations'],
      });
      return r.violations.map((v) => ({
        id: v.id, impact: v.impact, description: v.description, help: v.help, helpUrl: v.helpUrl,
        nodeCount: v.nodes.length,
        topSelectors: v.nodes.slice(0, 3).map((n) => (n.target || []).map(String).join(' ')),
      }));
    });
    const nodes = res.reduce((s, v) => s + v.nodeCount, 0);
    const top = res.slice().sort((a, b) => b.nodeCount - a.nodeCount)[0] || null;
    results.push({ route, status, violations: res.length, nodes, top, detail: res });
    totalViolations += res.length;
    for (const v of res) {
      const k = v.id === 'color-contrast' ? 'color-contrast' :
                /^aria-/.test(v.id) ? 'aria' :
                /focus|tabindex|focus-order/.test(v.id) ? 'focus' :
                /landmark|heading|list|dl|table|section|document-title|html-has-lang|page-has-heading-one|region/.test(v.id) ? 'semantic' : 'other';
      byType[k] += v.nodeCount;
      typeByViolationId.set(v.id, (typeByViolationId.get(v.id) || 0) + v.nodeCount);
    }
    console.log(`[axe-w2] ${route}  http=${status}  viol=${res.length}  nodes=${nodes}  top=${top ? `${top.id}(${top.nodeCount})` : '-'}`);
  } catch (e) {
    results.push({ route, status: 0, error: String(e.message || e), violations: 0, nodes: 0, top: null, detail: [] });
    console.log(`[axe-w2] ${route}  ERROR  ${e.message || e}`);
  } finally {
    await page.close();
  }
}

await browser.close();

const agg = {
  generatedAt: new Date().toISOString(),
  base: BASE,
  routesAudited: ALL_ROUTES.length,
  totalViolations,
  totalNodes: results.reduce((s, r) => s + r.nodes, 0),
  byTypeNodes: byType,
  violationsById: Object.fromEntries(typeByViolationId.entries()),
  perRoute: results,
};

writeFileSync(`${OUT_DIR}/w2-verify.json`, JSON.stringify(agg, null, 2));
console.log(`\n[axe-w2] DONE. ${ALL_ROUTES.length} routes, ${totalViolations} violations, ${agg.totalNodes} nodes.`);
console.log(`[axe-w2] by type (nodes): contrast=${byType['color-contrast']} aria=${byType.aria} focus=${byType.focus} semantic=${byType.semantic} other=${byType.other}`);
console.log(`[axe-w2] output: ${OUT_DIR}/w2-verify.json`);
