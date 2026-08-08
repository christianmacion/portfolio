import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto('http://127.0.0.1:8088/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(800);
await page.keyboard.press('Meta+J');
await page.waitForTimeout(6000);

const dialogVisible = await page.evaluate(() => {
  const d = document.querySelector('[data-worldview]');
  return d && !d.hasAttribute('hidden');
});
const tickerRows = await page.evaluate(() => {
  const t = document.querySelector('[data-worldview-ticker]');
  return t ? t.children.length : 0;
});
const svgState = await page.evaluate(() => {
  const s = document.querySelector('[data-worldview-svg]');
  if (!s) return { ok: false };
  return {
    ok: true,
    landShapes: s.querySelectorAll('.wv-globe__land-shape').length,
    pins: s.querySelectorAll('circle[data-pin-id]').length,
    circleCount: s.querySelectorAll('circle').length,
    pathCount: s.querySelectorAll('path').length,
  };
});
const status = await page.evaluate(() => document.querySelector('[data-worldview-status]')?.textContent || '');

console.log('Dialog visible after ⌘J:', dialogVisible);
console.log('Ticker rows:', tickerRows);
console.log('SVG state:', JSON.stringify(svgState));
console.log('Status line:', status);

await page.screenshot({ path: '/tmp/wv-open.png', fullPage: false });

const notable = errors.filter(e => !e.includes('favicon') && !e.includes('Pagefind') && !e.includes('webp'));
if (notable.length) console.log('NOTABLE ERRORS:', notable.slice(0, 5));
else console.log('No notable errors');

await browser.close();
