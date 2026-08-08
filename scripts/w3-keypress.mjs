import { chromium } from 'playwright-core';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 823 }, reducedMotion: 'reduce' });
const page = await ctx.newPage();

await page.goto('http://localhost:4321/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);

// Use page.keyboard.press with Control+J
await page.keyboard.press('Control+KeyJ');
await page.waitForTimeout(1500);
const s1 = await page.evaluate(() => document.querySelector('[data-worldview]')?.hasAttribute('hidden'));
console.log('After Control+KeyJ:', s1);

// Try Meta+J
await page.keyboard.press('Meta+KeyJ');
await page.waitForTimeout(1500);
const s2 = await page.evaluate(() => document.querySelector('[data-worldview]')?.hasAttribute('hidden'));
console.log('After Meta+KeyJ:', s2);

// Try focus body first then keypress
await page.click('body');
await page.keyboard.press('Control+J');
await page.waitForTimeout(1500);
const s3 = await page.evaluate(() => document.querySelector('[data-worldview]')?.hasAttribute('hidden'));
console.log('After body+Control+J:', s3);

// Force open via JS
const s4 = await page.evaluate(() => {
  const m = document.querySelector('[data-worldview]');
  if (m) m.removeAttribute('hidden');
  return !m.hasAttribute('hidden');
});
console.log('After JS removeAttribute:', s4);

// Wait and check ticker
await page.waitForTimeout(30000);
const ticker = await page.evaluate(() => {
  const ul = document.querySelector('[data-worldview-ticker]');
  return {
    count: ul?.querySelectorAll('li').length || 0,
    html: ul?.innerHTML?.slice(0, 1000) || 'no ul'
  };
});
console.log('Ticker after JS open:', JSON.stringify(ticker, null, 2));
await browser.close();
