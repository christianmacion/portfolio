import { chromium } from 'playwright-core';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 823 }, reducedMotion: 'reduce' });
const page = await ctx.newPage();

const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });

await page.goto('http://localhost:4321/', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// Check if WorldView client initialized
const init = await page.evaluate(() => {
  // Check if the global event listener is registered
  // We can check by attempting Ctrl+J — the listener should be on document
  const has = {
    root: !!document.querySelector('[data-worldview]'),
    svg: !!document.querySelector('[data-worldview-svg]'),
    ticker: !!document.querySelector('[data-worldview-ticker]'),
    status: !!document.querySelector('[data-worldview-status]'),
    hint: !!document.querySelector('[data-worldview-hint]'),
  };
  return has;
});
console.log('Init elements:', init);
console.log('Errors:', errors);

// Try Ctrl+J via Playwright keyboard (which dispatches a real key event)
await page.focus('body');
await page.keyboard.down('Control');
await page.keyboard.press('j');
await page.keyboard.up('Control');
await page.waitForTimeout(2000);

const state = await page.evaluate(() => {
  const m = document.querySelector('[data-worldview]');
  return {
    hidden: m.hasAttribute('hidden'),
    attrs: Array.from(m.attributes).map(a => `${a.name}="${a.value}"`).join(' ')
  };
});
console.log('After Ctrl+J:', state);
await browser.close();
