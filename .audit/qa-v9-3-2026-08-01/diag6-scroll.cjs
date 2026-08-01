// Verify scroll-progress is actually broken
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('http://localhost:4399/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const el = page.locator('.scroll-progress').first();
  console.log(`progress element count: ${await el.count()}`);

  // Track across scroll positions
  const measurements = [];
  for (const scrollPct of [0, 10, 25, 50, 75, 100]) {
    await page.evaluate((pct) => {
      const max = document.body.scrollHeight - window.innerHeight;
      window.scrollTo(0, max * pct / 100);
    }, scrollPct);
    await page.waitForTimeout(400);
    const m = await el.evaluate((e) => ({
      transform: getComputedStyle(e).transform,
      width: getComputedStyle(e).width,
      height: getComputedStyle(e).height,
      opacity: getComputedStyle(e).opacity,
      display: getComputedStyle(e).display,
      scrollY: window.scrollY,
      scrollMax: document.body.scrollHeight - window.innerHeight,
    }));
    measurements.push({ scrollPct, ...m });
  }
  measurements.forEach((m) => console.log(`scroll=${m.scrollPct.toString().padStart(3)}% y=${m.scrollY}/${m.scrollMax} transform=${m.transform} width=${m.width} opacity=${m.opacity} display=${m.display}`));

  // Check what the .scroll-progress rule does
  const rules = await page.evaluate(() => {
    const list = [];
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules || []) {
          if (rule.cssText && rule.cssText.includes('scroll-progress')) {
            list.push(rule.cssText.slice(0, 300));
          }
        }
      } catch {}
    }
    return list;
  });
  console.log('\n=== scroll-progress CSS rules ===');
  rules.forEach((r) => console.log(r + '\n'));

  await browser.close();
})();
