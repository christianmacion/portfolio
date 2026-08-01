#!/usr/bin/env node
// v9.3 QA — Comprehensive audit
const { chromium } = require('playwright');
const { writeFile, mkdir } = require('node:fs/promises');
const path = require('node:path');

const BASE = 'http://localhost:4399';
const OUT = '/Users/christianmacion/Contingency/christianmacion.github.io/.audit/qa-v9-3-2026-08-01';

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '375x812', width: 375, height: 812 },
];

const ROUTES = [
  '/', '/about/', '/ai/', '/for-recruiters/', '/proof/', '/workbooks/',
  '/methodology/', '/contact/', '/resume/', '/experience/', '/skills/',
  '/now/', '/colophon/', '/desk/', '/projects/', '/publications/',
];

async function captureRoute(browser, route, viewport, saveShot = true) {
  const ctx = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const consoleErr = [], consoleWarn = [], network4xx = [], pageErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErr.push(m.text()); if (m.type() === 'warning') consoleWarn.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('response', (r) => { if (r.status() >= 400) network4xx.push({ url: r.url(), status: r.status() }); });
  const start = Date.now();
  let status = 0;
  try {
    const resp = await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 30000 });
    status = resp?.status() || 0;
    await page.waitForTimeout(800);
  } catch (e) { pageErrors.push(`goto: ${e.message}`); }
  const wallMs = Date.now() - start;
  if (saveShot) {
    const safeRoute = route.replace(/\//g, '_').replace(/^_/, '') || 'root';
    const shotPath = path.join(OUT, 'visual-baseline', `${viewport.name}-${safeRoute}.png`);
    try { await page.screenshot({ path: shotPath, fullPage: false }); } catch (e) {}
  }
  const title = await page.title();
  const h1 = await page.locator('h1').first().textContent().catch(() => null);
  await ctx.close();
  return { route, viewport: viewport.name, status, wallMs, title: title?.slice(0, 80), h1: h1?.slice(0, 100), consoleErr, consoleWarn, network4xx, pageErrors };
}

(async () => {
  await mkdir(`${OUT}/visual-baseline`, { recursive: true });
  await mkdir(`${OUT}/playwright`, { recursive: true });
  console.log(`[1/4] Console + network audit (desktop 1440x900)…`);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const results = { routes: {}, e2e: {} };
  for (const r of ROUTES) {
    const result = await captureRoute(browser, r, VIEWPORTS[0], false);
    results.routes[`1440x900-${r}`] = result;
    console.log(`  ${r.padEnd(28)} ${String(result.status).padStart(3)} ${String(result.wallMs).padStart(6)}ms  err=${result.consoleErr.length} warn=${result.consoleWarn.length} 4xx=${result.network4xx.length} pe=${result.pageErrors.length}`);
  }
  console.log(`\n[2/4] Visual baseline @ 1440x900 + 768x1024 + 375x812…`);
  let shotCount = 0;
  for (const vp of VIEWPORTS) {
    for (const r of ROUTES) {
      await captureRoute(browser, r, vp, true);
      shotCount++;
    }
  }
  console.log(`  captured ${shotCount} screenshots`);
  console.log(`\n[3/4] E2E interactive features…`);
  // backToTop
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await p.waitForTimeout(500);
    const sel = 'button[aria-label*="top" i], a[href="#top"], button:has-text("top"), [data-back-to-top], button[title*="top" i]';
    const btn = p.locator(sel).first();
    const present = (await btn.count()) > 0;
    let action = null;
    if (present) {
      const beforeY = await p.evaluate(() => window.scrollY);
      await btn.click({ timeout: 3000 }).catch((e) => { action = `click-fail: ${e.message.slice(0, 80)}`; });
      await p.waitForTimeout(800);
      const afterY = await p.evaluate(() => window.scrollY);
      action = `before=${beforeY} after=${afterY} scrolls=${afterY < 100 ? 'YES' : 'NO'}`;
    }
    results.e2e.backToTop = { present, action };
    console.log(`  backToTop: present=${present} action=${action || 'n/a'}`);
    await ctx.close();
  }
  // scrollProgress
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const sel = '[data-progress], [role="progressbar"], .scroll-progress, [class*="progress"], [id*="progress"]';
    const el = p.locator(sel).first();
    const present = (await el.count()) > 0;
    let details = { present };
    if (present) {
      await p.evaluate(() => window.scrollTo(0, 0));
      await p.waitForTimeout(300);
      const before = await el.evaluate((e) => ({ style: e.getAttribute('style'), transform: getComputedStyle(e).transform, width: getComputedStyle(e).width }));
      await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await p.waitForTimeout(600);
      const after = await el.evaluate((e) => ({ style: e.getAttribute('style'), transform: getComputedStyle(e).transform, width: getComputedStyle(e).width }));
      details = { ...details, before, after, advances: JSON.stringify(before) !== JSON.stringify(after) };
    }
    results.e2e.scrollProgress = details;
    console.log(`  scrollProgress: present=${present} advances=${details.advances || 'n/a'}`);
    await ctx.close();
  }
  // hamburger
  {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const sel = 'button[aria-label*="menu" i], button[aria-label*="nav" i], button[aria-controls*="nav" i], [data-hamburger], [class*="hamburger"], button[aria-expanded]';
    const btn = p.locator(sel).first();
    const present = (await btn.count()) > 0;
    let details = { present };
    if (present) {
      const navBefore = await p.locator('nav, [role="navigation"]').first().isVisible().catch(() => false);
      await btn.click({ timeout: 3000 }).catch((e) => { details.clickError = e.message.slice(0, 80); });
      await p.waitForTimeout(500);
      const navAfter = await p.locator('nav, [role="navigation"]').first().isVisible().catch(() => false);
      details = { ...details, navBefore, navAfter, togglesNav: navBefore !== navAfter };
    }
    results.e2e.hamburger = details;
    console.log(`  hamburger: present=${present} toggles=${details.togglesNav || 'n/a'}`);
    await ctx.close();
  }
  // contactForm
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/contact/`, { waitUntil: 'networkidle' });
    const form = p.locator('form').first();
    const present = (await form.count()) > 0;
    let details = { present };
    if (present) {
      const fields = await form.evaluate((f) => Array.from(f.querySelectorAll('input, textarea, select')).map((el) => ({ name: el.getAttribute('name'), type: el.getAttribute('type') || el.tagName.toLowerCase(), required: el.hasAttribute('required') })));
      const submitBtn = form.locator('button[type="submit"], input[type="submit"]').first();
      let validationOnEmpty = false;
      if ((await submitBtn.count()) > 0) {
        await submitBtn.click().catch(() => null);
        await p.waitForTimeout(800);
        const invalid = await p.locator('[aria-invalid="true"], :invalid').count();
        validationOnEmpty = invalid > 0;
      }
      details = { ...details, fieldCount: fields.length, fields, validationOnEmpty };
    }
    results.e2e.contactForm = details;
    console.log(`  contactForm: present=${present} fields=${details.fieldCount || 0} validatesOnEmpty=${details.validationOnEmpty || false}`);
    await ctx.close();
  }
  // reducedMotion
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(500);
    const offenders = await p.evaluate(() => {
      const list = [];
      for (const el of document.querySelectorAll('*')) {
        const cs = getComputedStyle(el);
        const dur = parseFloat(cs.transitionDuration);
        const animDur = parseFloat(cs.animationDuration);
        if (dur > 0 && cs.transitionProperty !== 'none') list.push({ tag: el.tagName, cls: String(el.className).slice(0, 40), kind: 'transition', dur: cs.transitionDuration });
        if (animDur > 0 && cs.animationName !== 'none') list.push({ tag: el.tagName, cls: String(el.className).slice(0, 40), kind: 'animation', dur: cs.animationDuration });
        if (list.length >= 20) break;
      }
      return list;
    });
    results.e2e.reducedMotion = { offendersCount: offenders.length, sample: offenders.slice(0, 10) };
    console.log(`  reducedMotion: offenders=${offenders.length}`);
    await ctx.close();
  }
  // mobile320
  {
    const ctx = await browser.newContext({ viewport: { width: 320, height: 568 } });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const dims = await p.evaluate(() => ({ bodyScrollWidth: document.body.scrollWidth, windowInnerWidth: window.innerWidth, horizontalOverflow: document.body.scrollWidth > window.innerWidth }));
    results.e2e.mobile320 = dims;
    console.log(`  mobile320: body=${dims.bodyScrollWidth} viewport=${dims.windowInnerWidth} overflow=${dims.horizontalOverflow}`);
    await ctx.close();
  }
  // printStylesheet
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/about/`, { waitUntil: 'networkidle' });
    await p.emulateMedia({ media: 'print' });
    await p.waitForTimeout(300);
    const printRules = await p.evaluate(() => {
      let found = 0;
      const samples = [];
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules || []) {
            if (rule.type === CSSRule.MEDIA_RULE && rule.conditionText?.includes('print')) {
              found++;
              if (samples.length < 3) samples.push(rule.cssText.slice(0, 200));
            }
          }
        } catch {}
      }
      return { found, samples };
    });
    results.e2e.printStylesheet = printRules;
    console.log(`  printStylesheet: rules=${printRules.found}`);
    await ctx.close();
  }
  // themeSwitcher
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const themeBtn = p.locator('[data-theme-toggle], [aria-label*="theme" i], button:has-text("theme")').first();
    const present = (await themeBtn.count()) > 0;
    results.e2e.themeSwitcher = { present };
    console.log(`  themeSwitcher: present=${present}`);
    await ctx.close();
  }
  await browser.close();
  await writeFile(`${OUT}/playwright/full-results.json`, JSON.stringify(results, null, 2));
  console.log(`\n[done] Wrote ${OUT}/playwright/full-results.json`);
})().catch((err) => { console.error('FATAL:', err); process.exit(1); });
