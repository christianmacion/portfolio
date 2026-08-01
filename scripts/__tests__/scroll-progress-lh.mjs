/**
 * scroll-progress-lh.mjs — minimal Lighthouse-style perf probe for the
 * scroll-progress fix. Captures the Web Vitals for the target URL using
 * the PerformanceObserver + manual timing. Cheap, no external deps.
 */
import { chromium } from 'playwright';

const URL = process.env.TARGET_URL || 'http://127.0.0.1:4321/markets/';

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'no-preference',
  });
  const page = await ctx.newPage();

  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  const navigationMs = Date.now() - t0;

  const vitals = await page.evaluate(() => {
    return new Promise((resolve) => {
      const out = {};
      // FCP
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === 'first-contentful-paint') {
            out.fcp = entry.startTime;
          }
        }
      }).observe({ type: 'paint', buffered: true });

      // LCP
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        out.lcp = last?.startTime ?? null;
      }).observe({ type: 'largest-contentful-paint', buffered: true });

      // CLS
      let cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) cls += entry.value;
        }
        out.cls = cls;
      }).observe({ type: 'layout-shift', buffered: true });

      // Wait 2s for LCP to settle
      setTimeout(() => resolve(out), 2000);
    });
  });

  // Scroll-progress functional check
  await page.evaluate(() => window.scrollTo({ top: 2000, left: 0, behavior: 'instant' }));
  await page.waitForTimeout(200);
  const scrollCheck = await page.evaluate(() => {
    const inner = document.querySelector('.scroll-progress > i');
    const cssVar = getComputedStyle(document.documentElement).getPropertyValue('--scroll-progress').trim();
    return {
      cssVar,
      innerWidthPx: inner?.getBoundingClientRect().width ?? 0,
      isActive: document.querySelector('.scroll-progress')?.classList.contains('is-active') ?? false,
    };
  });

  await browser.close();

  const result = {
    url: URL,
    navigationMs,
    vitals,
    scrollCheck,
    ts: new Date().toISOString(),
  };
  console.log(JSON.stringify(result, null, 2));

  // Score estimate
  const fcp = vitals.fcp ?? 9999;
  const lcp = vitals.lcp ?? 9999;
  const cls = vitals.cls ?? 999;
  // Heuristic mapping: fcp < 1.8s = good, lcp < 2.5s = good, cls < 0.1 = good
  const score = (fcp < 1800 ? 1 : 0) + (lcp < 2500 ? 1 : 0) + (cls < 0.1 ? 1 : 0);
  console.log(`\nHeuristic vitals score: ${score}/3 (fcp<1.8s, lcp<2.5s, cls<0.1)`);
  if (score < 3) {
    console.log('  WARN: at least one vital above target — investigate before claiming >=95 perf');
  } else {
    console.log('  OK: all 3 vitals within target band');
  }
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});
