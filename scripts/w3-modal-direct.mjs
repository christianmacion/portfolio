import { chromium } from 'playwright-core';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 823 }, reducedMotion: 'reduce' });
const page = await ctx.newPage();

const networkLog = [];
page.on('request', req => {
  const u = req.url();
  if (u.includes('yahoo') || u.includes('coingecko') || u.includes('gdelt') || u.includes('worker') || u.includes('cdn-cgi')) {
    networkLog.push(`${req.method()} ${u}`);
  }
});

await page.goto('http://localhost:4321/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

// Direct JS call to open modal
const result = await page.evaluate(() => {
  const m = document.querySelector('[data-worldview]');
  return {
    exists: !!m,
    attrs: m ? Array.from(m.attributes).map(a => `${a.name}="${a.value}"`).join(' ') : 'no modal'
  };
});
console.log('Before:', result);

// Try to call openModal if exposed
const result2 = await page.evaluate(() => {
  // The client uses openModal() but it's not globally exposed
  // Try to dispatch the right event
  const event = new KeyboardEvent('keydown', {
    key: 'j',
    code: 'KeyJ',
    ctrlKey: true,
    bubbles: true,
    cancelable: true
  });
  // Dispatch on document and window
  document.dispatchEvent(event);
  window.dispatchEvent(event);
  const m = document.querySelector('[data-worldview]');
  return {
    attrs: m ? Array.from(m.attributes).map(a => `${a.name}="${a.value}"`).join(' ') : 'no modal'
  };
});
console.log('After dispatch:', result2);

// Wait and check
console.log('Waiting 30s...');
await page.waitForTimeout(30000);

const ticker = await page.evaluate(() => {
  const ul = document.querySelector('[data-worldview-ticker]');
  return {
    count: ul?.querySelectorAll('li').length || 0,
    modalAttrs: ul ? Array.from(document.querySelector('[data-worldview]').attributes).map(a => `${a.name}="${a.value}"`).join(' ') : 'no ul',
    networkLog: window.__wvLog || 'no log'
  };
});
console.log('Ticker:', JSON.stringify(ticker, null, 2));

console.log('Network:', networkLog.slice(0, 20).join('\n'));
await browser.close();
