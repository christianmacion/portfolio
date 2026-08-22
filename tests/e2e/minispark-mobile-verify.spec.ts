/**
 * minispark-mobile-verify.spec.ts — verification of the fix at commit 694fbab.
 *
 * Why this exists
 * ---------------
 * Before fix: MiniSpark had `preserveAspectRatio="none"` + viewBox="0 0 220 26".
 * Inside `.mk-stats__spark` (flex parent, align-items: center), on /markets
 * ≤540px the SVG was being squashed to ~143-162px wide. With "none" the
 * polyline stretched non-uniformly (~26-35% X-axis compression), breaking
 * the 30-day shape read on iPhone SE / iPhone 12 / Pixel 5 / Galaxy S20.
 *
 * The fix (commit 694fbab): dropped preserveAspectRatio="none" (defaults to
 * xMidYMid meet) and added min-width:0 + max-width:100% + height:auto to
 * .mini-spark. Polyline now letterboxes (uniform scale) when a flex parent
 * constrains the SVG below its intrinsic 220x26.
 *
 * This spec verifies on each mobile viewport:
 *   1. chart renders (SVG present, path drawn)
 *   2. data is legible (polyline shape preserved: aspect ratio close to 8.46:1)
 *   3. no horizontal overflow (document.documentElement.scrollWidth ≤ viewport width + 1)
 *   4. no console errors
 *   5. touch target ≥44×44 if interactive (N/A for static SVG decoration, but
 *      we still confirm parent cells are ≥44px tall for accessibility)
 *
 * 5-must-have (CLAUDE.md §1):
 *   - Terminal:   exits 0 on PASS, 1 on FAIL.
 *   - Idempotent: re-running against the same dist state yields identical results.
 *   - Dedupe key: `minispark-mobile-verify-v1`.
 *   - Coverage:   5 binding mobile/tablet viewports (iPhone SE / iPhone 12 /
 *                 Pixel 5 / Galaxy S20 / iPad portrait).
 *   - AAR:        on any failure writes screenshots + per-viewport JSON
 *                 to .audit/incident/2026-08-10-minispark-mobile-verify/.
 *
 * Usage:
 *   PROD_URL=http://127.0.0.1:4321/portfolio/markets/ \
 *     node --import tsx tests/e2e/minispark-mobile-verify.spec.ts
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { existsSync, promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';

const PROD = process.env.PROD_URL || 'http://127.0.0.1:4321/portfolio/markets/';
const DEDUPE_KEY = 'minispark-mobile-verify-v1';
const ROOT = resolve(import.meta.dirname, '..', '..');
const INCIDENT = join(ROOT, '.audit', 'incident', '2026-08-10-minispark-mobile-verify');

const VIEWPORTS = [
  { name: 'iPhone SE', width: 375, height: 667, dpr: 2 },
  { name: 'iPhone 12', width: 390, height: 844, dpr: 3 },
  { name: 'Pixel 5', width: 393, height: 851, dpr: 2.75 },
  { name: 'Galaxy S20', width: 412, height: 915, dpr: 2.625 },
  { name: 'iPad portrait', width: 768, height: 1024, dpr: 2 },
];

function findChrome(): string | undefined {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
  ].filter((c): c is string => Boolean(c));
  return candidates.find(existsSync);
}

type StepResult = { name: string; pass: boolean; detail?: string };
type ViewportResult = {
  name: string;
  width: number;
  height: number;
  pass: boolean;
  steps: StepResult[];
  consoleErrors: string[];
};

async function runViewport(
  browser: Browser,
  v: (typeof VIEWPORTS)[number],
): Promise<ViewportResult> {
  const ctx: BrowserContext = await browser.newContext({
    viewport: { width: v.width, height: v.height },
    deviceScaleFactor: v.dpr,
    isMobile: v.width < 768,
    hasTouch: v.width < 768,
    userAgent:
      v.width < 768
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
        : 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    reducedMotion: 'no-preference',
  });
  const page: Page = await ctx.newPage();

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

  const steps: StepResult[] = [];

  try {
    await page.goto(PROD, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 });

    // Capture a screenshot of the stats row for visual evidence
    const screenshotPath = join(INCIDENT, `${v.name.replace(/\s+/g, '-').toLowerCase()}.png`);
    try {
      const stats = page.locator('.mk-stats').first();
      if (await stats.count()) {
        await stats.screenshot({ path: screenshotPath });
      } else {
        await page.screenshot({ path: screenshotPath, fullPage: false });
      }
    } catch {
      await page.screenshot({ path: screenshotPath, fullPage: false });
    }

    // PROBE 1: chart renders (at least one MiniSpark SVG with non-empty path d=)
    const chartRender = await page.evaluate(() => {
      const svgs = Array.from(document.querySelectorAll('svg.mini-spark'));
      const withPath = svgs.filter((s) => {
        const p = s.querySelector('path');
        return p && (p.getAttribute('d') || '').trim().length > 0;
      });
      const firstPath = withPath[0]?.querySelector('path')?.getAttribute('d') || '';
      return {
        ok: svgs.length >= 1 && withPath.length >= 1 && firstPath.includes('M') && firstPath.includes('L'),
        svgCount: svgs.length,
        drawnCount: withPath.length,
        samplePathStart: firstPath.slice(0, 80),
      };
    });
    steps.push({
      name: 'chart renders (≥1 MiniSpark SVG with non-empty path)',
      pass: chartRender.ok === true,
      detail: JSON.stringify(chartRender),
    });

    // PROBE 2: data is legible — aspect ratio of the rendered SVG (visualBox)
    // should be close to the viewBox aspect (220/26 ≈ 8.46). If preserveAspectRatio
    // was "none", the rendered SVG would still be 220x26 (intrinsic) but the
    // parent would measure the SVG at the flex-shrunk width with a stretched path.
    // We measure the rendered bbox of each SVG vs its viewBox: width/height.
    const aspectCheck = await page.evaluate(() => {
      const svgs = Array.from(document.querySelectorAll('svg.mini-spark'));
      const results = svgs.map((s) => {
        const r = (s as SVGGraphicsElement).getBoundingClientRect();
        const vb = s.getAttribute('viewBox') || '';
        const [, , vbW, vbH] = vb.split(/\s+/).map(parseFloat);
        const renderedAspect = r.width / Math.max(r.height, 0.0001);
        const viewBoxAspect = vbW / Math.max(vbH, 0.0001);
        // With preserveAspectRatio="xMidYMid meet" (the fix), when the parent
        // constrains width < intrinsic, height shrinks proportionally. The
        // renderedAspect should equal viewBoxAspect (within rounding).
        // With preserveAspectRatio="none" (the bug), renderedAspect would
        // diverge from viewBoxAspect by > 5%.
        const drift = Math.abs(renderedAspect - viewBoxAspect) / viewBoxAspect;
        return {
          rendered: { w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100 },
          viewBox: { w: vbW, h: vbH },
          renderedAspect: Math.round(renderedAspect * 100) / 100,
          viewBoxAspect: Math.round(viewBoxAspect * 100) / 100,
          drift: Math.round(drift * 10000) / 10000,
        };
      });
      const maxDrift = results.reduce((m, r) => Math.max(m, r.drift), 0);
      return {
        ok: maxDrift < 0.05, // 5% tolerance
        maxDrift,
        results,
      };
    });
    steps.push({
      name: 'data is legible (rendered aspect ≈ viewBox aspect, drift < 5%)',
      pass: aspectCheck.ok === true,
      detail: `maxDrift=${aspectCheck.maxDrift} count=${aspectCheck.results.length}`,
    });

    // PROBE 3: no horizontal overflow
    const overflowCheck = await page.evaluate(() => {
      const docW = document.documentElement.scrollWidth;
      const winW = window.innerWidth;
      const overflow = docW > winW + 1;
      const bodyW = document.body.scrollWidth;
      return { ok: !overflow, docW, winW, bodyW, overflow };
    });
    steps.push({
      name: 'no horizontal overflow (scrollWidth ≤ viewport)',
      pass: overflowCheck.ok === true,
      detail: JSON.stringify(overflowCheck),
    });

    // PROBE 4: no console errors
    steps.push({
      name: 'no console errors',
      pass: consoleErrors.length === 0,
      detail: consoleErrors.length === 0 ? '0 errors' : consoleErrors.join(' | '),
    });

    // PROBE 5: touch targets ≥ 44×44 on the parent cell (the SVG is decorative;
    // the parent .mk-stats__spark provides the visual hit area, but the actual
    // tap targets on /markets are the stat cells themselves). For mobile the
    // stat cell containing MiniSpark should be ≥44px tall.
    const tapArea = await page.evaluate(() => {
      const cells = Array.from(document.querySelectorAll('.mk-stats__cell'));
      const sizes = cells.map((c) => {
        const r = (c as HTMLElement).getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      });
      const minH = sizes.reduce((m, s) => Math.min(m, s.h), Infinity);
      return { ok: minH >= 44, minH, sizes };
    });
    steps.push({
      name: 'stat-cell height ≥ 44px (touch target for embedded chart context)',
      pass: tapArea.ok === true,
      detail: `minH=${tapArea.minH}`,
    });
  } catch (e) {
    steps.push({
      name: 'navigation/render',
      pass: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  } finally {
    await ctx.close();
  }

  return {
    name: v.name,
    width: v.width,
    height: v.height,
    pass: steps.every((s) => s.pass),
    steps,
    consoleErrors,
  };
}

async function main(): Promise<void> {
  await fs.mkdir(INCIDENT, { recursive: true });

  const chrome = findChrome();
  if (!chrome) {
    console.error('FAIL: no Chrome/Chromium found');
    process.exit(2);
  }

  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox'],
  });

  const results: ViewportResult[] = [];
  for (const v of VIEWPORTS) {
    const r = await runViewport(browser, v);
    results.push(r);
    const icon = r.pass ? 'PASS' : 'FAIL';
    console.log(
      `[${icon}] ${v.name} (${v.width}x${v.height}) — ${r.steps.filter((s) => s.pass).length}/${r.steps.length} probes`,
    );
    for (const s of r.steps) {
      const sIcon = s.pass ? '  ✓' : '  ✗';
      console.log(`${sIcon} ${s.name} — ${s.detail}`);
    }
  }

  await browser.close();

  // Write per-viewport JSON
  await fs.writeFile(
    join(INCIDENT, 'results.json'),
    JSON.stringify({ dedupe_key: DEDUPE_KEY, results }, null, 2),
  );

  const passedCount = results.filter((r) => r.pass).length;
  const verdict = passedCount === results.length ? 'PASS' : passedCount > 0 ? 'PARTIAL' : 'FAIL';

  console.log(`\nDEDUPE_KEY: ${DEDUPE_KEY}`);
  console.log(`VERDICT: ${verdict} (${passedCount}/${results.length} viewports)`);
  console.log(`SCREENSHOTS: ${INCIDENT}`);

  process.exit(verdict === 'PASS' ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(2);
});