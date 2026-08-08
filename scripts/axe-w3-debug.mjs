import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const axeSrc = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
const urlBase = 'http://localhost:4321';
const route = process.argv[2] || '/about/';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 823 }, reducedMotion: 'reduce' });
const page = await ctx.newPage();
await page.goto(urlBase + route, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(800);
await page.addScriptTag({ content: axeSrc });
const violations = await page.evaluate(async () => {
  const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2aa','wcag21aa','wcag22aa'] }, resultTypes: ['violations'] });
  return r.violations.map(v => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map(n => ({ html: n.html.slice(0, 200), target: n.target, message: n.any?.[0]?.message }))
  }));
});
console.log(JSON.stringify(violations, null, 2));
await browser.close();
