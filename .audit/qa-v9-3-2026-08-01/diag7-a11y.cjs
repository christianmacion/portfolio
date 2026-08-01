const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('http://localhost:4322/proof/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const scrollables = await page.evaluate(() => {
    const out = [];
    const all = document.querySelectorAll('*');
    for (const el of all) {
      const cs = getComputedStyle(el);
      const overflowY = cs.overflowY;
      const overflowX = cs.overflowX;
      const isScrollable = (overflowY === 'auto' || overflowY === 'scroll' || overflowX === 'auto' || overflowX === 'scroll') &&
                           (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
      if (isScrollable) {
        out.push({
          tag: el.tagName,
          cls: String(el.className).slice(0, 60),
          id: el.id,
          role: el.getAttribute('role'),
          tabindex: el.getAttribute('tabindex'),
          ariaLabel: el.getAttribute('aria-label'),
          scrollH: el.scrollHeight,
          clientH: el.clientHeight,
        });
      }
    }
    return out;
  });
  console.log(`scrollable regions on /proof/: ${scrollables.length}`);
  scrollables.slice(0, 15).forEach((s) => console.log(`  <${s.tag}> cls="${s.cls}" id="${s.id}" role=${s.role} tabindex=${s.tabindex} aria-label=${s.ariaLabel} sh=${s.scrollH} ch=${s.clientH}`));

  await browser.close();
})();
