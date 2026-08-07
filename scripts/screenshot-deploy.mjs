// screenshot-deploy.mjs — quick screenshot of a deployed alias for verification
// Usage: node scripts/screenshot-deploy.mjs <url> <out.png>
import { chromium } from 'playwright';
import { argv } from 'node:process';

const [url, outPath] = argv.slice(2);
if (!url || !outPath) {
  console.error('usage: node scripts/screenshot-deploy.mjs <url> <out.png>');
  process.exit(1);
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  reducedMotion: 'no-preference',
});
const page = await context.newPage();
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1500); // let any animations settle
await page.screenshot({ path: outPath, fullPage: true });
await browser.close();
console.log(`✓ screenshot saved → ${outPath}`);
