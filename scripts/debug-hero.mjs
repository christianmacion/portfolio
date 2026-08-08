import { chromium } from 'playwright';
const url = process.argv[2] || 'https://christianmacion-portfolio.pages.dev/';
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1320, height: 900 } });
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(5000);
const data = await page.evaluate(() => {
  const hero = document.querySelector('section.hero-flagship');
  const broadside = document.querySelector('section.broadside');
  return {
    heroClass: hero?.className,
    heroIsRevealed: hero?.classList.contains('is-revealed'),
    heroComputed: {
      opacity: getComputedStyle(hero).opacity,
      transform: getComputedStyle(hero).transform,
      rect: hero?.getBoundingClientRect(),
    },
    broadsideComputed: {
      opacity: getComputedStyle(broadside).opacity,
      transform: getComputedStyle(broadside).transform,
      rect: broadside?.getBoundingClientRect(),
    },
    heroParent: hero?.parentElement?.tagName,
    heroParentClass: hero?.parentElement?.className,
  };
});
console.log(JSON.stringify(data, null, 2));
await browser.close();
