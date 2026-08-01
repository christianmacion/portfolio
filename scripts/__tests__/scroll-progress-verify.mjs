/**
 * scroll-progress-verify.mjs — Playwright capture of scroll-progress bar
 * at 0%, 50%, 100% scroll positions. Validates the --scroll-progress
 * CSS custom property binding fix.
 */
import { chromium } from 'playwright';

const URL = process.env.TARGET_URL || 'http://127.0.0.1:4321/';
const OUT = '/tmp/scroll-progress-verify';

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'no-preference',
  });
  const page = await ctx.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('[browser-console-error]', msg.text());
  });
  page.on('pageerror', (e) => console.error('[browser-pageerror]', e.message));

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 });

  // Sanity: static bar element exists in DOM.
  const barExists = await page.evaluate(() => !!document.querySelector('.scroll-progress > i'));
  console.log(`[verify] static .scroll-progress > i exists in DOM: ${barExists}`);

  const probe = async (label, scrollY) => {
    await page.evaluate((y) => window.scrollTo({ top: y, left: 0, behavior: 'instant' }), scrollY);
    // Wait for rAF tick + transition (80ms).
    await page.waitForTimeout(150);
    const data = await page.evaluate(() => {
      const cssVar = getComputedStyle(document.documentElement).getPropertyValue('--scroll-progress').trim();
      const inner = document.querySelector('.scroll-progress > i');
      const computedWidth = inner ? getComputedStyle(inner).width : null;
      const innerBoundingWidth = inner ? inner.getBoundingClientRect().width : null;
      const docWidth = document.documentElement.clientWidth;
      const pct = innerBoundingWidth !== null && docWidth > 0 ? (innerBoundingWidth / docWidth) * 100 : null;
      const scrollY = window.scrollY;
      const scrollHeight = document.documentElement.scrollHeight;
      const innerHeight = window.innerHeight;
      const expectedPct = ((scrollY / (scrollHeight - innerHeight)) * 100).toFixed(2);
      const isActive = document.querySelector('.scroll-progress')?.classList.contains('is-active');
      const ariaValuenow = document.querySelector('.scroll-progress')?.getAttribute('aria-valuenow');
      return {
        cssVar,
        computedWidth,
        innerBoundingWidth,
        docWidth,
        pct: pct === null ? null : pct.toFixed(2),
        scrollY,
        scrollHeight,
        innerHeight,
        expectedPct,
        isActive,
        ariaValuenow,
      };
    });
    const path = `${OUT}-${label}.png`;
    await page.screenshot({ path, fullPage: false });
    console.log(`[verify ${label}] ${JSON.stringify(data)}`);
    return data;
  };

  const top = await probe('0pct', 0);
  const mid = await probe('50pct', await page.evaluate(() => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    return Math.round(max * 0.5);
  }));
  const bot = await probe('100pct', await page.evaluate(() => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    return max;
  }));

  // Reduced-motion variant.
  console.log('--- reduced-motion variant ---');
  const ctx2 = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
  });
  const page2 = await ctx2.newPage();
  await page2.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page2.waitForLoadState('networkidle', { timeout: 15000 });
  await page2.evaluate(() => window.scrollTo({ top: 1500, left: 0, behavior: 'instant' }));
  await page2.waitForTimeout(150);
  const rm = await page2.evaluate(() => {
    const inner = document.querySelector('.scroll-progress > i');
    const computedWidth = inner ? getComputedStyle(inner).width : null;
    const cssVar = getComputedStyle(document.documentElement).getPropertyValue('--scroll-progress').trim();
    const transition = inner ? getComputedStyle(inner).transition : null;
    const cs = inner ? getComputedStyle(inner) : null;
    return { cssVar, computedWidth, transition, transitionDuration: cs?.transitionDuration };
  });
  console.log(`[verify reduced-motion @1500px] ${JSON.stringify(rm)}`);
  await page2.screenshot({ path: `${OUT}-reduced-motion.png`, fullPage: false });

  await browser.close();

  // === ASSERTIONS ===
  const errors = [];
  if (!top.cssVar || top.cssVar === '0%' && top.scrollY === 0) {
    /* OK — initial state can be 0% */
  }
  if (Number(mid.pct) < 30 || Number(mid.pct) > 70) {
    errors.push(`mid scroll: expected ~50%, got ${mid.pct}% (--scroll-progress=${mid.cssVar}, innerWidth=${mid.innerBoundingWidth}, docWidth=${mid.docWidth})`);
  }
  if (Number(bot.pct) < 90) {
    errors.push(`bottom scroll: expected ~100%, got ${bot.pct}%`);
  }
  if (mid.cssVar === '' || mid.cssVar === '0%') {
    errors.push(`--scroll-progress CSS custom property not set at mid-scroll (got "${mid.cssVar}")`);
  }
  // Reduced-motion: bar still tracks scroll, but transition-duration is 0s.
  if (!rm.transitionDuration || !rm.transitionDuration.includes('0s')) {
    errors.push(`reduced-motion: expected transition-duration 0s, got "${rm.transitionDuration}"`);
  }
  if (errors.length > 0) {
    console.error('=== VERIFY FAILED ===');
    for (const e of errors) console.error(' - ' + e);
    process.exit(1);
  } else {
    console.log('=== VERIFY PASS ===');
    console.log(`  top:    pct=${top.pct}%, cssVar="${top.cssVar}"`);
    console.log(`  mid:    pct=${mid.pct}%, cssVar="${mid.cssVar}"`);
    console.log(`  bottom: pct=${bot.pct}%, cssVar="${bot.cssVar}"`);
    console.log(`  reduced-motion @1500px: cssVar="${rm.cssVar}", transition-duration="${rm.transitionDuration}"`);
  }
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});
