import { chromium } from 'playwright-core';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 823 }, reducedMotion: 'reduce' });
const page = await ctx.newPage();

// 1. home post-palette
await page.goto('http://localhost:4321/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await page.screenshot({ path: '/tmp/w3-home.png', fullPage: false });
console.log('home screenshot saved');

// 2. ⌘J open with live ticker — try Ctrl+J but it won't open due to missing status
// Take screenshot of home with the (broken) modal still hidden
await page.keyboard.press('Control+KeyJ');
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/w3-worldview.png', fullPage: false });
console.log('worldview screenshot saved (modal hidden due to missing data-worldview-status element)');

// 3. ⌘K open
await page.keyboard.press('Control+KeyK');
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/w3-cmdk.png', fullPage: false });
console.log('cmdk screenshot saved');

// 4. /engagement/
await page.goto('http://localhost:4321/engagement/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/w3-engagement.png', fullPage: false });
console.log('engagement screenshot saved');

// 5. /now/
await page.goto('http://localhost:4321/now/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/w3-now.png', fullPage: false });
console.log('now screenshot saved');

// 6. /for-recruiters/
await page.goto('http://localhost:4321/for-recruiters/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/w3-recruiters.png', fullPage: false });
console.log('recruiters screenshot saved');

await browser.close();
