import { chromium } from 'playwright-core';

const urlBase = process.argv[2] || 'http://localhost:4321';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 823 }, reducedMotion: 'reduce' });
const page = await ctx.newPage();

// Capture network requests
const networkLog = [];
page.on('request', req => {
  const u = req.url();
  if (u.includes('yahoo') || u.includes('coingecko') || u.includes('gdelt') || u.includes('worker') || u.includes('cdn-cgi') || u.includes('api.')) {
    networkLog.push({ method: req.method(), url: u });
  }
});
page.on('response', resp => {
  const u = resp.url();
  if (u.includes('yahoo') || u.includes('coingecko') || u.includes('gdelt') || u.includes('worker') || u.includes('api.')) {
    networkLog.push({ event: 'response', url: u, status: resp.status() });
  }
});

await page.goto(urlBase + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(1500);

// Press Ctrl+J
await page.keyboard.press('Control+J');
await page.waitForTimeout(2000);

// Check modal state
const modalOpen = await page.evaluate(() => {
  const modal = document.querySelector('[data-worldview], #worldview, .worldview, dialog[open], [class*="modal"][open]');
  return {
    modalExists: !!modal,
    modalClass: modal?.className,
    modalVisible: modal ? getComputedStyle(modal).display !== 'none' : false,
    htmlSnippet: modal?.outerHTML?.slice(0, 200)
  };
});

console.log('--- Modal state ---');
console.log(JSON.stringify(modalOpen, null, 2));

console.log('\nWaiting 60s for ticker data...');
await page.waitForTimeout(60000);

const tickerInfo = await page.evaluate(() => {
  const wrap = document.querySelector('.wv__ticker-wrap');
  if (!wrap) return { error: 'No ticker wrap found' };
  const html = wrap.innerHTML.slice(0, 2000);
  const items = wrap.querySelectorAll('li, [data-tick], .wv__tick, .wv__ticker-row');
  return {
    wrapClass: wrap.className,
    itemCount: items.length,
    sampleHtml: html
  };
});

console.log('\n--- Ticker info after 60s ---');
console.log(JSON.stringify(tickerInfo, null, 2));

console.log('\n--- Network log ---');
for (const n of networkLog.slice(0, 50)) {
  console.log(n.event ? `${n.event} ${n.status} ${n.url}` : `${n.method} ${n.url}`);
}
await browser.close();
