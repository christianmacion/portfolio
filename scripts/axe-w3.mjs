import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';

const axeSrc = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
const urlBase = process.argv[2] || 'http://localhost:4321';
const routeFile = process.argv[3] || '/tmp/main_47_routes.txt';
const outFile = process.argv[4] || '/tmp/axe-w3-results.json';

const routes = readFileSync(routeFile, 'utf8').trim().split('\n').map(r => r.trim()).filter(Boolean);

console.log(`axe sweep: ${urlBase}, ${routes.length} routes`);
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const results = [];
let total = 0, fails = 0;
for (const r of routes) {
  const url = urlBase + r + '/';
  const ctx = await browser.newContext({ viewport: { width: 412, height: 823 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(500);
    await page.addScriptTag({ content: axeSrc });
    const violations = await page.evaluate(async () => {
      const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2aa','wcag21aa','wcag22aa'] }, resultTypes: ['violations'] });
      return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length }));
    });
    total++;
    const vc = violations.length;
    if (vc > 0) fails++;
    results.push({ route: r, violations: vc, detail: violations });
    console.log(`${r.padEnd(40)} → ${vc} violation(s)${vc>0?' '+JSON.stringify(violations.map(v=>v.id+'/'+v.nodes).join(',')).slice(0,140):''}`);
  } catch (e) {
    total++;
    fails++;
    results.push({ route: r, error: e.message.slice(0, 80) });
    console.log(`${r.padEnd(40)} → ERROR: ${e.message.slice(0, 80)}`);
  }
  await ctx.close();
}
await browser.close();
writeFileSync(outFile, JSON.stringify({ urlBase, total, fails, results }, null, 2));
console.log(`\n${total} routes, ${fails} with violations`);
