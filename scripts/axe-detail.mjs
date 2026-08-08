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
const data = await page.evaluate(async () => {
  const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2aa','wcag21aa','wcag22aa'] }, resultTypes: ['violations'] });
  return r.violations.map(v => ({ id: v.id, impact: v.impact, count: v.nodes.length, samples: v.nodes.slice(0, 8).map(n => ({
    target: n.target[0],
    msg: n.failureSummary?.split('\n')[0] || n.any?.[0]?.message?.split('\n')[0] || '',
  })) }));
});
console.log(JSON.stringify(data, null, 2));
await browser.close();
