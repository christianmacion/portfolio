import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const axeSrc = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
const targets = [
  ['https://christianmacion-portfolio.pages.dev/', 'home'],
  ['https://christianmacion-portfolio.pages.dev/work/', 'work'],
  ['https://christianmacion-portfolio.pages.dev/notes/', 'notes'],
  ['https://christianmacion-portfolio.pages.dev/stack/', 'stack'],
  ['https://christianmacion-portfolio.pages.dev/repos/', 'repos'],
  ['https://christianmacion-portfolio.pages.dev/engagement/', 'engagement'],
];

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const summary = [];
for (const [url, slug] of targets) {
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 823 },
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(800);
    await page.addScriptTag({ content: axeSrc });
    const data = await page.evaluate(async () => {
      return await window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'] },
        resultTypes: ['violations'],
      });
    });
    const violations = data.violations || [];
    summary.push({ slug, url, count: violations.length, items: violations.map(v => ({
      id: v.id, impact: v.impact, nodes: v.nodes.length, firstTarget: v.nodes[0]?.target?.[0] || '',
    })) });
    console.log(`${slug} (${url}): ${violations.length} violations`);
    for (const v of violations) {
      console.log(`  [${v.impact}] ${v.id} ${v.nodes.length}node -- first ${v.nodes[0]?.target?.[0] || ''}`);
    }
  } catch (e) {
    console.log(`${slug}: ERR ${e.message}`);
  }
  await ctx.close();
}
await browser.close();
process.exit(0);
