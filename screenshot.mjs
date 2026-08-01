import { chromium, devices } from 'playwright';
import { mkdirSync } from 'fs';

const url = process.argv[2];
const outPath = process.argv[3];
const isMobile = process.argv[4] === 'mobile';

mkdirSync('/tmp/portfolio-shots', { recursive: true });

const browser = await chromium.launch({ headless: true });

// isMobile flag in newContext overrides width/height, so use devices preset
// for true mobile emulation. iPhone 13 = 390×844 CSS @ 3x DPR.
const ctx = isMobile
  ? await browser.newContext({ ...devices['iPhone 13'] })
  : await browser.newContext({ width: 1440, height: 900, reducedMotion: 'reduce' });

const page = await ctx.newPage();
const vp = page.viewportSize();
console.log('viewport:', vp);

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: outPath, fullPage: false });
await browser.close();
console.log('OK', outPath);