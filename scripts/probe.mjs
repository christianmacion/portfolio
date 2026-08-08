import { chromium } from 'playwright';
const url = process.argv[2] || 'https://3fd3b7bf.christianmacion-portfolio.pages.dev/';
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1320, height: 900 } });
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(3000);
const data = await page.evaluate(() => {
  const main = document.querySelector('main');
  const broadside = document.querySelector('.broadside');
  const hero = document.querySelector('.hero-flagship');
  const tape = document.querySelector('.tape');
  const cs = (el) => {
    if (!el) return null;
    const s = getComputedStyle(el);
    return { color: s.color, bg: s.backgroundColor, h: el.offsetHeight, w: el.offsetWidth, vis: s.visibility, op: s.opacity, tr: s.transform, pos: s.position, display: s.display };
  };
  return {
    docHeight: document.documentElement.scrollHeight,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    main: cs(main),
    broadside: cs(broadside),
    hero: cs(hero),
    tape: cs(tape),
  };
});
console.log(JSON.stringify(data, null, 2));
await browser.close();
