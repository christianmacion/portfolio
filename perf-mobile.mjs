import { chromium, devices } from 'playwright';

const URL = process.env.TARGET_URL || 'https://christianmacion-portfolio.pages.dev/skills/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();

const t0 = Date.now();
await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
const navigationMs = Date.now() - t0;

const vitals = await page.evaluate(() => new Promise((resolve) => {
  const out = {};
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.name === 'first-contentful-paint') out.fcp = entry.startTime;
    }
  }).observe({ type: 'paint', buffered: true });

  new PerformanceObserver((list) => {
    const entries = list.getEntries();
    const last = entries[entries.length - 1];
    out.lcp = last?.startTime ?? null;
  }).observe({ type: 'largest-contentful-paint', buffered: true });

  let cls = 0;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!entry.hadRecentInput) cls += entry.value;
    }
    out.cls = cls;
  }).observe({ type: 'layout-shift', buffered: true });

  setTimeout(() => resolve(out), 2000);
}));

await browser.close();
const result = { url: URL, navigationMs, vitals, ts: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
const fcp = vitals.fcp ?? 9999;
const lcp = vitals.lcp ?? 9999;
const cls = vitals.cls ?? 999;
const score = (fcp < 1800 ? 1 : 0) + (lcp < 2500 ? 1 : 0) + (cls < 0.1 ? 1 : 0);
console.log(`\nMOBILE (iPhone 13) score: ${score}/3 — fcp=${fcp.toFixed(0)}ms, lcp=${lcp.toFixed(0)}ms, cls=${cls.toFixed(3)}`);
