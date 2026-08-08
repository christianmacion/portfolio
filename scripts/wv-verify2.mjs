import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const reqs = [];
page.on('response', r => { if (r.status() >= 400) reqs.push(r.status() + ' ' + r.url()); });

await page.goto('http://127.0.0.1:8088/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(800);
await page.keyboard.press('Meta+J');
await page.waitForTimeout(8000);

console.log('PAGE ERRORS:', errors.filter(e => e.startsWith('PAGEERROR')));
console.log('4xx RESPONSES:', reqs.slice(0, 10));

const info = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-worldview-ticker] li')].map(li => li.textContent.trim());
  return {
    dialogVisible: document.querySelector('[data-worldview]') && !document.querySelector('[data-worldview]').hasAttribute('hidden'),
    tickerRowCount: rows.length,
    tickerRows: rows,
    svgShapes: document.querySelectorAll('.wv-globe__land-shape').length,
    svgPins: document.querySelectorAll('circle[data-pin-id]').length,
    status: document.querySelector('[data-worldview-status]')?.textContent,
  };
});
console.log('INFO:', JSON.stringify(info, null, 2));

await page.screenshot({ path: '/tmp/wv-open.png', fullPage: false });
console.log('SCREENSHOT:', '/tmp/wv-open.png');

await browser.close();
