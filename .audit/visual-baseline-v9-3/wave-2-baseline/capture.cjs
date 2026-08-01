// .audit/visual-baseline-v9-3/wave-2-baseline/capture.cjs
// Wave 2 visual baseline — captures every primary route at 3 viewports
// against the mirror build served at http://127.0.0.1:4178/
//
// Outputs to .audit/visual-baseline-v9-3/wave-2-baseline/{route}-{viewport}.png
// Writes index.json with status + console-error capture.

const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const HOST = process.env.WAVE2_HOST || 'http://127.0.0.1:4178';
const OUT = '/Users/christianmacion/Contingency/christianmacion.github.io/.audit/visual-baseline-v9-3/wave-2-baseline';
fs.mkdirSync(OUT, { recursive: true });

const ROUTES = [
  { path: '/',                              name: 'home',                       viewport: null },
  { path: '/for-recruiters/',               name: 'for-recruiters',             viewport: null },
  { path: '/about/',                        name: 'about',                      viewport: null },
  { path: '/proof/',                        name: 'proof',                      viewport: null },
  { path: '/projects/quant/01-deflated-sharpe/', name: 'project-deflated-sharpe', viewport: null },
  { path: '/methodology/',                  name: 'methodology',                viewport: null },
];

const VIEWPORTS = [
  { tag: 'desktop-1440', width: 1440, height: 900, deviceScaleFactor: 2 },
  { tag: 'tablet-768',   width: 768,  height: 1024, deviceScaleFactor: 2 },
  { tag: 'mobile-375',   width: 375,  height: 812, deviceScaleFactor: 2 },
];

(async () => {
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const results = [];
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.deviceScaleFactor,
      colorScheme: 'light',
    });
    for (const route of ROUTES) {
      const page = await ctx.newPage();
      const consoleErrors = [];
      const pageErrors = [];
      const failedReqs = [];
      page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
      page.on('pageerror', e => pageErrors.push(e.message.slice(0, 200)));
      page.on('response', r => {
        if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) {
          failedReqs.push({ url: r.url().slice(0, 150), status: r.status() });
        }
      });
      const file = path.join(OUT, `${route.name}__${vp.tag}.png`);
      const traceFile = path.join(OUT, `${route.name}__${vp.tag}.trace.json`);
      let status = 'ERR';
      let title = '';
      try {
        const resp = await page.goto(`${HOST}${route.path}`, { waitUntil: 'networkidle', timeout: 30000 });
        status = resp ? resp.status().toString() : '0';
        title = (await page.title()).slice(0, 80);
        await page.waitForTimeout(800);
        await page.screenshot({ path: file, fullPage: false });
        status = 'OK';
      } catch (e) {
        console.error(`ERR ${route.name} ${vp.tag}: ${e.message.slice(0, 120)}`);
      }
      results.push({
        route: route.path, name: route.name, viewport: vp.tag,
        status, title, file,
        consoleErrors, pageErrors, failedReqs,
      });
      console.log(`${status} ${vp.tag} ${route.name}`);
      await page.close();
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(results, null, 2));
  console.log(`\n=== Wave 2 visual baseline ===`);
  console.log(`Saved to ${OUT}`);
  console.log(`Screenshots: ${results.filter(r => r.status === 'OK').length}/${results.length}`);
  const withErrs = results.filter(r => r.consoleErrors.length || r.pageErrors.length || r.failedReqs.length);
  if (withErrs.length) {
    console.log(`Routes with errors:`);
    for (const r of withErrs) {
      console.log(`  ${r.name} ${r.viewport}: ${r.consoleErrors.length} console, ${r.pageErrors.length} page, ${r.failedReqs.length} net`);
    }
  } else {
    console.log(`No console/network errors detected.`);
  }
})();
