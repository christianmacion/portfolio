import { chromium } from 'playwright-core';

const urlBase = 'http://localhost:4321';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 823 }, reducedMotion: 'reduce' });
const page = await ctx.newPage();

const networkLog = [];
page.on('request', req => networkLog.push({ type: 'req', method: req.method(), url: req.url() }));
page.on('response', resp => networkLog.push({ type: 'resp', status: resp.status(), url: resp.url() }));

await page.goto(urlBase + '/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(2000);

// Try Ctrl+J with explicit keyboard
await page.evaluate(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, bubbles: true }));
});
await page.waitForTimeout(2000);

const state1 = await page.evaluate(() => {
  const m = document.querySelector('[data-worldview]');
  return { hidden: m?.hasAttribute('hidden'), open: m && !m.hasAttribute('hidden') };
});
console.log('After dispatch Ctrl+J:', state1);

if (state1.hidden) {
  // Try clicking a button or trigger
  await page.evaluate(() => {
    const btn = document.querySelector('[data-worldview-open], [aria-controls*="worldview"], button[data-j-shortcut], #wv-open');
    if (btn) btn.click();
  });
  await page.waitForTimeout(1500);
  const state2 = await page.evaluate(() => {
    const m = document.querySelector('[data-worldview]');
    return { hidden: m?.hasAttribute('hidden') };
  });
  console.log('After fallback click:', state2);
}

// Wait 30s for live data
console.log('Waiting 30s...');
await page.waitForTimeout(30000);

const ticker = await page.evaluate(() => {
  const ul = document.querySelector('[data-worldview-ticker]');
  if (!ul) return { error: 'no ul' };
  const items = ul.querySelectorAll('li');
  return {
    count: items.length,
    samples: Array.from(items).slice(0, 5).map(li => ({
      text: li.textContent?.trim().slice(0, 100),
      hasTimestamp: /\d{4}-\d{2}-\d{2}|\d{2}:\d{2}/.test(li.textContent || ''),
      hasPrice: /\$|€|¥|₱|\d+\.\d{2}/.test(li.textContent || ''),
      source: li.dataset?.source || li.querySelector('[data-source]')?.dataset?.source || ''
    }))
  };
});
console.log('Ticker:', JSON.stringify(ticker, null, 2));

console.log('--- Network log (yahoo/coingecko/gdelt/worker) ---');
for (const n of networkLog) {
  const u = n.url || '';
  if (u.includes('yahoo') || u.includes('coingecko') || u.includes('gdelt') || u.includes('worker') || u.includes('cdn-cgi') || u.includes('api.')) {
    console.log(`${n.type} ${n.status || n.method} ${u}`);
  }
}
await browser.close();
