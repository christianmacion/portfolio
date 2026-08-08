import { chromium } from 'playwright';
const url = process.argv[2] || 'https://christianmacion-portfolio.pages.dev/';
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1320, height: 900 } });
const logs = [];
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`));
page.on('requestfailed', (req) => logs.push(`[FAIL] ${req.url()} ${req.failure()?.errorText}`));
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(5000);
const data = await page.evaluate(() => {
  const html = document.documentElement;
  const broadside = document.querySelector('.broadside');
  const hero = document.querySelector('.hero-flagship');
  return {
    rootClass: html.className,
    docReady: document.readyState,
    broadsideClass: broadside?.className,
    broadsideIsRevealed: broadside?.classList.contains('is-revealed'),
    broadsideComputed: {
      opacity: getComputedStyle(broadside).opacity,
      transform: getComputedStyle(broadside).transform,
    },
    heroIsRevealed: hero?.classList.contains('is-revealed'),
    homeSectionRevealBound: html.dataset.homeSectionRevealBound,
    scriptTags: Array.from(document.scripts).map(s => s.src || 'inline').slice(0, 20),
  };
});
console.log(JSON.stringify(data, null, 2));
console.log('--- console + errors ---');
console.log(logs.join('\n'));
await browser.close();
