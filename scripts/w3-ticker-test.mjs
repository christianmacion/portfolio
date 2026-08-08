import { chromium } from 'playwright-core';

const urlBase = process.argv[2] || 'http://localhost:4321';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 823 }, reducedMotion: 'reduce' });
const page = await ctx.newPage();

await page.goto(urlBase + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(1500);

// Press Ctrl+J to open WorldView
await page.keyboard.press('Control+J');
await page.waitForTimeout(2000);

// Wait 30s for ticker data
console.log('Waiting 30s for ticker entries...');
await page.waitForTimeout(30000);

// Capture ticker state
const tickerInfo = await page.evaluate(() => {
  const ticker = document.querySelector('[data-ticker], .ticker, .worldview-ticker, #worldview-ticker, [class*="ticker"]');
  if (!ticker) return { error: 'No ticker element found', tickerCandidates: Array.from(document.querySelectorAll('[class*="ticker"],[class*="Ticker"]')).map(e => e.className) };
  const entries = ticker.querySelectorAll('li, [data-tick], tr, .ticker-entry, [class*="entry"]');
  return {
    tickerClass: ticker.className,
    entryCount: entries.length,
    sampleEntries: Array.from(entries).slice(0, 10).map(e => e.textContent?.trim().slice(0, 120))
  };
});

console.log(JSON.stringify(tickerInfo, null, 2));
await browser.close();
