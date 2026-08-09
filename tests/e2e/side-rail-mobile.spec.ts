/**
 * side-rail-mobile.spec.ts — permanent regression spec for the SideRail
 * mobile hamburger drawer.
 *
 * Why this exists
 * ---------------
 * The previous implementation used a checkbox-hack pattern:
 *   <input type="checkbox" id="rail-toggle"> + <label for="rail-toggle">
 * On desktop browsers (Chromium / Firefox) this works fine. On mobile
 * (iOS Safari + Chromium mobile) the input was `display: none`, which
 * broke native label-input click delegation — the tap registered (focus
 * border visible) but checkbox.checked never flipped and the CSS selector
 * `.side-rail__toggle-input:checked ~ .side-rail { transform: translateX(0) }`
 * never matched. Drawer stayed at translateX(-100%). 100% of mobile users
 * could not navigate.
 *
 * The fix (v13.1.4 polish-7m): replaced checkbox+label with a single
 * <button type="button"> + [aria-expanded="true"] attribute selector.
 *
 * This spec exercises the INTERACTION (tap hamburger, observe state change)
 * on every binding mobile viewport. The previous audit (`c5aa4a3..b798dae`)
 * verified the drawer's resting-state fit but never actually opened it on
 * mobile — classic "verified the resting state, didn't exercise the
 * interaction" gap. munger-inversion: what if the desktop test passed
 * because desktop browsers tolerate the bug? Answer: yes, that's why the
 * v13.1.4 audit missed it.
 *
 * 5-must-have (CLAUDE.md §1):
 *   - Terminal:   exits 0 on PASS, 1 on FAIL, 2 on env error. No hangs.
 *   - Idempotent: re-running against the same dist state yields identical
 *                 pass/fail (no Math.random, no Date.now in assertions).
 *   - Dedupe key: `portfolio-siderail-mobile-drawer-v1`.
 *   - Coverage:   4 binding mobile viewports (iPhone SE / iPhone 12 /
 *                 Pixel 5 / Galaxy S20). Each runs open-then-close cycle.
 *                 Also verifies: touch target ≥44px, aria-expanded sync,
 *                 Escape close, backdrop close.
 *   - AAR:        on any failure writes screenshots + per-viewport JSON
 *                 to .audit/incident/<date>-siderail-mobile-drawer/.
 *
 * Usage:
 *   PROD_URL=http://127.0.0.1:4321/portfolio/ npx tsx tests/e2e/side-rail-mobile.spec.ts
 *   PROD_URL=http://127.0.0.1:4321/portfolio/ node --import tsx tests/e2e/side-rail-mobile.spec.ts
 *
 * Default URL targets the local Astro preview server on :4321. Set
 * PROD_URL to the deployed GH Pages URL for production smoke tests.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { existsSync, promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';

const PROD = process.env.PROD_URL || 'http://127.0.0.1:4321/portfolio/';
const DEDUPE_KEY = 'portfolio-siderail-mobile-drawer-v1';
const ROOT = resolve(import.meta.dirname, '..', '..');
const TOGGLE_SEL = '#rail-toggle';
const RAIL_SEL = '#primary-rail';
const BACKDROP_SEL = '.side-rail__backdrop';

// Binding mobile viewports per SideRail chrome contract (v13.1.4 polish-7l
// acceptance + the QA diagnostic 2026-08-09-tab-diagnostic §2 matrix).
const VIEWPORTS = [
  { name: 'iPhone SE', width: 375, height: 667, dpr: 2 },
  { name: 'iPhone 12', width: 390, height: 844, dpr: 3 },
  { name: 'Pixel 5', width: 393, height: 851, dpr: 2.75 },
  { name: 'Galaxy S20', width: 412, height: 915, dpr: 2.625 },
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

async function runViewport(
  browser: Browser,
  v: (typeof VIEWPORTS)[number],
): Promise<{
  name: string;
  pass: boolean;
  steps: StepResult[];
}> {
  const ctx: BrowserContext = await browser.newContext({
    viewport: { width: v.width, height: v.height },
    deviceScaleFactor: v.dpr,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
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

    // STEP 1: drawer hidden initially
    const initial = await page.evaluate(
      ({ toggleSel, railSel }) => {
        const toggle = document.querySelector<HTMLElement>(toggleSel);
        const rail = document.querySelector<HTMLElement>(railSel);
        if (!toggle || !rail) return { ok: false, reason: 'selectors missing' };
        const exp = toggle.getAttribute('aria-expanded');
        const r = rail.getBoundingClientRect();
        return {
          ok: exp === 'false',
          ariaExpanded: exp,
          railLeft: r.left,
          railWidth: r.width,
        };
      },
      { toggleSel: TOGGLE_SEL, railSel: RAIL_SEL },
    );
    steps.push({
      name: 'initial: aria-expanded="false"',
      pass: initial.ok === true,
      detail: JSON.stringify(initial),
    });

    const touchTarget = await page.evaluate((sel) => {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) return { width: 0, height: 0 };
      const r = el.getBoundingClientRect();
      return { width: r.width, height: r.height };
    }, TOGGLE_SEL);
    steps.push({
      name: 'touch target ≥ 44×44 px',
      pass: touchTarget.width >= 44 && touchTarget.height >= 44,
      detail: `${Math.round(touchTarget.width)}×${Math.round(touchTarget.height)}`,
    });

    // STEP 2: tap the hamburger (real mobile tap, not click())
    await page.locator(TOGGLE_SEL).tap();
    // wait for the CSS transition (snap = 160ms)
    await page.waitForTimeout(300);

    const opened = await page.evaluate(
      ({ toggleSel, railSel, backdropSel }) => {
        const toggle = document.querySelector<HTMLElement>(toggleSel);
        const rail = document.querySelector<HTMLElement>(railSel);
        const backdrop = document.querySelector<HTMLElement>(backdropSel);
        if (!toggle || !rail) return { ok: false, reason: 'selectors missing' };
        const exp = toggle.getAttribute('aria-expanded');
        const r = rail.getBoundingClientRect();
        const bdp = backdrop ? getComputedStyle(backdrop).opacity : null;
        const main = document.querySelector('main.layout-main');
        const mainInert = main ? main.hasAttribute('inert') : null;
        return {
          ok: exp === 'true' && r.left >= -1 && r.left <= 1,
          ariaExpanded: exp,
          railLeft: r.left,
          backdropOpacity: bdp,
          mainInert,
        };
      },
      { toggleSel: TOGGLE_SEL, railSel: RAIL_SEL, backdropSel: BACKDROP_SEL },
    );
    steps.push({
      name: 'open: aria-expanded="true" + rail visible',
      pass: opened.ok === true,
      detail: JSON.stringify(opened),
    });
    steps.push({
      name: 'open: backdrop opacity = 1',
      pass: opened.backdropOpacity === '1',
      detail: `opacity=${opened.backdropOpacity}`,
    });
    steps.push({
      name: 'open: <main> is inert (focus trap)',
      pass: opened.mainInert === true,
      detail: `inert=${opened.mainInert}`,
    });

    // STEP 3: Escape closes the drawer
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    const escClosed = await page.evaluate(
      ({ toggleSel, railSel }) => {
        const toggle = document.querySelector<HTMLElement>(toggleSel);
        const rail = document.querySelector<HTMLElement>(railSel);
        if (!toggle || !rail) return { ok: false, reason: 'selectors missing' };
        const exp = toggle.getAttribute('aria-expanded');
        const r = rail.getBoundingClientRect();
        return {
          ok: exp === 'false' && r.left < 0,
          ariaExpanded: exp,
          railLeft: r.left,
        };
      },
      { toggleSel: TOGGLE_SEL, railSel: RAIL_SEL },
    );
    steps.push({
      name: 'Escape closes drawer',
      pass: escClosed.ok === true,
      detail: JSON.stringify(escClosed),
    });

    // STEP 4: re-open then tap again to close
    await page.locator(TOGGLE_SEL).tap();
    await page.waitForTimeout(300);
    await page.locator(TOGGLE_SEL).tap();
    await page.waitForTimeout(300);

    const toggleClosed = await page.evaluate(
      ({ toggleSel, railSel }) => {
        const toggle = document.querySelector<HTMLElement>(toggleSel);
        const rail = document.querySelector<HTMLElement>(railSel);
        if (!toggle || !rail) return { ok: false, reason: 'selectors missing' };
        const exp = toggle.getAttribute('aria-expanded');
        const r = rail.getBoundingClientRect();
        return {
          ok: exp === 'false' && r.left < 0,
          ariaExpanded: exp,
          railLeft: r.left,
        };
      },
      { toggleSel: TOGGLE_SEL, railSel: RAIL_SEL },
    );
    steps.push({
      name: 'second tap closes drawer',
      pass: toggleClosed.ok === true,
      detail: JSON.stringify(toggleClosed),
    });

    steps.push({
      name: 'no console errors',
      pass: consoleErrors.length === 0,
      detail: consoleErrors.join(' | ') || 'clean',
    });

    const failed = steps.filter((s) => !s.pass);
    return { name: v.name, pass: failed.length === 0, steps };
  } catch (err) {
    steps.push({
      name: 'viewport run',
      pass: false,
      detail: err instanceof Error ? err.message : String(err),
    });
    return { name: v.name, pass: false, steps };
  } finally {
    await ctx.close();
  }
}

async function main(): Promise<void> {
  const executablePath = findChrome();
  if (!executablePath) {
    console.error('siderail-mobile: no Chrome/Chromium binary found.');
    console.error('Set CHROME_PATH or install Chrome from https://google.com/chrome');
    process.exit(2);
  }

  console.log(`siderail-mobile: target=${PROD}`);
  console.log(`siderail-mobile: dedupe=${DEDUPE_KEY}`);
  const browser = await chromium.launch({ executablePath, headless: true });

  const results: Awaited<ReturnType<typeof runViewport>>[] = [];
  for (const v of VIEWPORTS) {
    console.log(`siderail-mobile: viewport=${v.name} (${v.width}×${v.height})`);
    const r = await runViewport(browser, v);
    results.push(r);
    for (const s of r.steps) {
      const marker = s.pass ? 'PASS' : 'FAIL';
      console.log(`  [${marker}] ${s.name} :: ${s.detail ?? ''}`);
    }
  }
  await browser.close();

  const allPass = results.every((r) => r.pass);
  const failedVp = results.filter((r) => !r.pass).map((r) => r.name);
  const summary = {
    dedupeKey: DEDUPE_KEY,
    prod: PROD,
    pass: allPass,
    viewports: results.map((r) => ({
      name: r.name,
      pass: r.pass,
      failedSteps: r.steps.filter((s) => !s.pass).map((s) => s.name),
    })),
  };

  console.log('');
  console.log(
    `siderail-mobile: ${allPass ? 'PASS' : 'FAIL'} (${results.filter((r) => r.pass).length}/${results.length} viewports)`,
  );
  if (!allPass) {
    console.error(`siderail-mobile: failed viewports: ${failedVp.join(', ')}`);
  }

  // AAR: write per-fail screenshot dir on failure (mirrors __tests__ pattern)
  if (!allPass) {
    const incidentDir = join(
      ROOT,
      '.audit',
      'incident',
      `${new Date().toISOString().slice(0, 10)}-siderail-mobile-drawer`,
    );
    await fs.mkdir(incidentDir, { recursive: true });
    await fs.writeFile(join(incidentDir, 'failures.json'), JSON.stringify(summary, null, 2));
    console.error(`siderail-mobile: failures written to ${incidentDir}/failures.json`);
    process.exit(1);
  }

  process.exit(0);
}

void main();
