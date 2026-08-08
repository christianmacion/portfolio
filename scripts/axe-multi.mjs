import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const axeSrc = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
const urlBase = process.argv[2] || 'https://12b93f65.christianmacion-portfolio.pages.dev';
const paths = ['/', '/stella/', '/methodology/', '/for-recruiters/', '/resume/', '/proof/', '/screening-call/', '/certifications/', '/work/', '/stack/', '/notes/', '/repos/', '/engagement/', '/now/', '/contact/'];
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
let total = 0, fails = 0;
for (const p of paths) {
  const url = urlBase + p;
  const ctx = await browser.newContext({ viewport: { width: 412, height: 823 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(600);
    await page.addScriptTag({ content: axeSrc });
    const count = await page.evaluate(async () => {
      const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2aa','wcag21aa','wcag22aa'] }, resultTypes: ['violations'] });
      return r.violations.length;
    });
    total++; if (count > 0) fails++;
    console.log(`${p.padEnd(20)} → ${count} violation(s)`);
  } catch (e) { console.log(`${p.padEnd(20)} → ERROR: ${e.message.slice(0, 60)}`); }
  await ctx.close();
}
await browser.close();
console.log(`\n${total} routes, ${fails} with violations`);
