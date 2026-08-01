const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  // Fresh context — no BFCache, no SW state
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const responses = [];
  page.on('response', (r) => { if (r.status() >= 400) responses.push(`${r.status()} ${r.url()}`); });
  
  console.log('=== /contact/ in fresh context ===');
  await page.goto('http://localhost:4399/contact/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  console.log(`4xx/5xx: ${responses.length}`);
  responses.slice(0, 25).forEach((r) => console.log(`  ${r}`));
  
  // Look at all loaded JS modules
  const scripts = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('script')).map((s) => ({
      src: s.src,
      type: s.type,
      inline: s.src === '',
      preview: s.src || s.textContent.slice(0, 100),
    }));
  });
  console.log('\n=== scripts on /contact/ ===');
  scripts.forEach((s) => console.log(`  src=${s.src || 'INLINE'} type=${s.type || 'n/a'} inline=${s.inline}`));
  
  // Check service worker
  const swRegistered = await page.evaluate(() => {
    if (!navigator.serviceWorker) return 'no API';
    return navigator.serviceWorker.controller ? 'controller present' : 'no controller';
  });
  console.log(`\n=== service worker: ${swRegistered} ===`);
  
  // Look at <link> tags
  const links = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('link')).map((l) => l.href);
  });
  console.log('\n=== links on /contact/ ===');
  links.forEach((l) => console.log(`  ${l}`));
  
  await browser.close();
})();
