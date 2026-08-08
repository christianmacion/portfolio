import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:4322/', { waitUntil: 'networkidle' });
const cta = await page.evaluate(() => {
  const el = document.querySelector('.hero-flagship__cta-primary');
  const s = window.getComputedStyle(el);
  return { color: s.color, bg: s.backgroundColor };
});
console.log(JSON.stringify(cta, null, 2));
await browser.close();
