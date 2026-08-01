const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const responses = [];
  page.on('response', (r) => { if (r.status() >= 400) responses.push(`${r.status()} ${r.url()}`); });
  const consoleErr = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErr.push(m.text().slice(0, 200)); });
  
  await page.goto('http://localhost:4399/contact/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  console.log('=== /contact/ 4xx/5xx ===');
  responses.forEach((r) => console.log(`  ${r}`));
  console.log('\n=== /contact/ console errors ===');
  consoleErr.forEach((e) => console.log(`  ${e}`));
  
  // Scroll progress test
  console.log('\n=== SCROLL PROGRESS TEST ===');
  await page.goto('http://localhost:4399/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const sel = '[data-progress], [role="progressbar"], .scroll-progress, [class*="progress"], [id*="progress"]';
  const el = page.locator(sel).first();
  console.log(`progress element count: ${await el.count()}`);
  if (await el.count() > 0) {
    const tag = await el.evaluate((e) => e.tagName);
    const cls = await el.evaluate((e) => e.className);
    const id = await el.evaluate((e) => e.id);
    const attrs = await el.evaluate((e) => Array.from(e.attributes).map(a => `${a.name}=${a.value.slice(0,40)}`));
    console.log(`tag=${tag} cls="${cls}" id="${id}"`);
    console.log(`attrs: ${attrs.join(', ')}`);
    
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    const before = await el.evaluate((e) => ({
      style: e.getAttribute('style'),
      transform: getComputedStyle(e).transform,
      width: getComputedStyle(e).width,
      scrollY: window.scrollY,
    }));
    console.log(`before: scrollY=${before.scrollY} transform=${before.transform} width=${before.width}`);
    
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await page.waitForTimeout(500);
    const mid = await el.evaluate((e) => ({
      transform: getComputedStyle(e).transform,
      width: getComputedStyle(e).width,
      scrollY: window.scrollY,
    }));
    console.log(`mid:   scrollY=${mid.scrollY} transform=${mid.transform} width=${mid.width}`);
    
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    const after = await el.evaluate((e) => ({
      transform: getComputedStyle(e).transform,
      width: getComputedStyle(e).width,
      scrollY: window.scrollY,
    }));
    console.log(`after: scrollY=${after.scrollY} transform=${after.transform} width=${after.width}`);
  }
  
  // Contact form
  console.log('\n=== CONTACT FORM ===');
  await page.goto('http://localhost:4399/contact/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const forms = await page.locator('form').count();
  console.log(`form count: ${forms}`);
  // Look for inputs
  const inputs = await page.locator('input').count();
  const textareas = await page.locator('textarea').count();
  console.log(`input count: ${inputs}, textarea count: ${textareas}`);
  // Look for cf-turnstile or other form-like containers
  const turnstile = await page.locator('[cf-turnstile], [data-sitekey]').count();
  console.log(`cf-turnstile count: ${turnstile}`);
  // Check for cal.com iframe
  const calFrames = await page.locator('iframe[src*="cal.com"]').count();
  console.log(`cal.com iframe count: ${calFrames}`);
  
  // Hamburger
  console.log('\n=== HAMBURGER (mobile 375) ===');
  await ctx.close();
  const mctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const mp = await mctx.newPage();
  await mp.goto('http://localhost:4399/', { waitUntil: 'networkidle' });
  await mp.waitForTimeout(1000);
  const menuButtons = await mp.locator('button').count();
  console.log(`total buttons on mobile: ${menuButtons}`);
  // Look for any visible nav toggle
  const allBtns = await mp.evaluate(() => Array.from(document.querySelectorAll('button')).map(b => ({
    text: b.textContent.trim().slice(0, 30),
    aria: b.getAttribute('aria-label') || b.getAttribute('aria-expanded'),
    cls: String(b.className).slice(0, 60),
    visible: b.offsetWidth > 0 && b.offsetHeight > 0,
  })));
  console.log('buttons:', JSON.stringify(allBtns, null, 2));
  
  await browser.close();
})();
