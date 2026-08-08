import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const axeSrc = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
const url = process.argv[2] || 'https://57c71849.christianmacion-portfolio.pages.dev/';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 823 }, reducedMotion: 'reduce' });
const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(800);
await page.addScriptTag({ content: axeSrc });
const data = await page.evaluate(async () => await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'] }, resultTypes: ['violations'] }));
const v = data.violations || [];
console.log(`${url}: ${v.length} violation(s)`);
for (const x of v) {
  console.log(`  [${x.impact}] ${x.id} — ${x.nodes.length} node(s) — ${x.help}`);
  for (const n of x.nodes.slice(0, 5)) {
    console.log(`    ${n.target[0]}`);
  }
}
await browser.close();
