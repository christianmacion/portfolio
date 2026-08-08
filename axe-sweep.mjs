#!/usr/bin/env node
// Site-wide axe-core sweep.
// Visits every .astro route + dynamic expansion, runs axe-core, aggregates.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = 'http://localhost:4322/portfolio';
const OUT_DIR = '/tmp/axe-wave1';
mkdirSync(OUT_DIR, { recursive: true });

// 1. Hardcoded route list (all 47 .astro files expanded).
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

const AI_PROJECT_SLUGS = [
  '01-rag-recall', '02-toolcall-agent', '03-judge-harness', '04-eval-mcp-server',
  '05-reflect-revise', '06-slop-scanner',
];
const QUANT_PROJECT_SLUGS = [
  '01-deflated-sharpe', '02-cross-sectional-momentum', '03-timeseries-momentum-voltarget',
  '04-variance-risk-premium', '05-pairs-cointegration', '06-funding-carry',
  '07-macro-regime-overlay', '08-backtest-engine-costs', '09-lookahead-bias-audit',
];
const GLOSSARY_SLUGS = [
  'agent-charter', 'alpha', 'block-bootstrap', 'bonferroni-holm', 'cscv-pbo',
  'cointegration', 'deflated-sharpe', 'drawdown', 'embargo', 'eval-harness',
  'frozen-spec', 'g1-g31', 'json-schema', 'llm-as-judge', 'mcp', 'minbtl',
  'multi-agent', 'oos', 'pbo', 'rag', 'regime', 'sharpe', 'slippage',
  'survivorship-bias', 'walk-forward',
];

const dynamicRoutes = [];
for (const s of AI_PROJECT_SLUGS) {
  dynamicRoutes.push(`/projects/ai/${s}/`);
  dynamicRoutes.push(`/research/ai/${s}/`);
}
for (const s of QUANT_PROJECT_SLUGS) {
  dynamicRoutes.push(`/projects/quant/${s}/`);
  dynamicRoutes.push(`/research/quant/${s}/`);
}
for (const s of GLOSSARY_SLUGS) dynamicRoutes.push(`/glossary/${s}/`);

const ALL_ROUTES = [...STATIC_ROUTES, ...dynamicRoutes];
console.log(`[axe] route plan: ${STATIC_ROUTES.length} static + ${dynamicRoutes.length} dynamic = ${ALL_ROUTES.length} URLs`);

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
    // Wait for fonts to settle so axe contrast isn't measured against fallback.
    await page.evaluate(() => document.fonts.ready);
    await page.addScriptTag({ content: axeSource });
    const res = await page.evaluate(async () => {
      // @ts-ignore
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
      const k = classify(v.id);
      byType[k] += v.nodeCount;
      typeByViolationId.set(v.id, (typeByViolationId.get(v.id) || 0) + v.nodeCount);
    }
    console.log(`[axe] ${route}  http=${status}  viol=${res.length}  nodes=${nodes}  top=${top ? `${top.id}(${top.nodeCount})` : '-'}`);
  } catch (e) {
    results.push({ route, status: 0, error: String(e.message || e), violations: 0, nodes: 0, top: null, detail: [] });
    console.log(`[axe] ${route}  ERROR  ${e.message || e}`);
  } finally {
    await page.close();
  }
}

await browser.close();

function classify(id) {
  if (id === 'color-contrast') return 'color-contrast';
  if (/^aria-/.test(id)) return 'aria';
  if (/focus|tabindex|focus-order/.test(id)) return 'focus';
  if (/landmark|heading|list|definition|dl|table|section|document-title|html-has-lang|html-lang-valid|page-has-heading-one|region/.test(id)) return 'semantic';
  return 'other';
}

const agg = {
  generatedAt: new Date().toISOString(),
  base: BASE,
  routesAudited: ALL_ROUTES.length,
  staticRoutes: STATIC_ROUTES.length,
  dynamicRoutes: dynamicRoutes.length,
  totalViolations,
  totalNodes: results.reduce((s, r) => s + r.nodes, 0),
  byTypeNodes: byType,
  violationsById: Object.fromEntries(typeByViolationId.entries()),
  perRoute: results,
};

writeFileSync(`${OUT_DIR}/baseline.json`, JSON.stringify(agg, null, 2));
console.log(`\n[axe] DONE. ${ALL_ROUTES.length} routes, ${totalViolations} violations, ${agg.totalNodes} nodes.`);
console.log(`[axe] by type (nodes): contrast=${byType['color-contrast']} aria=${byType.aria} focus=${byType.focus} semantic=${byType.semantic} other=${byType.other}`);
console.log(`[axe] output: ${OUT_DIR}/baseline.json`);
