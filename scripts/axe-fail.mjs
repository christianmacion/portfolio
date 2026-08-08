import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const axeSrc = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 823 }, reducedMotion: 'reduce' });
const page = await ctx.newPage();
await page.goto(process.argv[2] || 'https://57c71849.christianmacion-portfolio.pages.dev/', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(800);
await page.addScriptTag({ content: axeSrc });
const data = await page.evaluate(async () => {
  function findBg(el) {
    while (el) {
      const bg = window.getComputedStyle(el).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg + ' [' + (el.tagName.toLowerCase()) + (el.className ? '.' + String(el.className).split(' ').slice(0,2).join('.') : '') + ']';
      el = el.parentElement;
    }
    return 'none';
  }
  function findFg(el) {
    let n = el; while (n) { const c = window.getComputedStyle(n).color; if (c) return c + ' [' + (n.tagName.toLowerCase()) + (n.className ? '.' + String(n.className).split(' ').slice(0,2).join('.') : '') + ']'; n = null; }
    return 'none';
  }
  const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2aa','wcag21aa','wcag22aa'] }, resultTypes: ['violations'] });
  const out = [];
  for (const v of r.violations) {
    for (const n of v.nodes.slice(0, 5)) {
      const el = document.querySelector(n.target[0]);
      if (!el) continue;
      const styles = window.getComputedStyle(el);
      out.push({ target: n.target[0], fg: findFg(el), bg: findBg(el), fontSize: styles.fontSize, fontWeight: styles.fontWeight, msg: (n.any?.[0]?.message || n.failureSummary || '').slice(0, 200) });
    }
  }
  return out;
});
console.log(JSON.stringify(data, null, 2));
await browser.close();
