#!/usr/bin/env node
// qa-post-fix.mjs — QA verification of post-fix prod state.
// Captures axe-core audit, CSP console violations, and interactivity markers
// on the live deploy (https://christianmacion-portfolio.pages.dev).
// Idempotent: re-runs over-write the post-fix evidence directory with a fresh
// report keyed by `dedupeKey` (no separate dedupe side-table).
//
// Output: post-fix/{a11y,csp-console,interactivity}/

import { promises as fs } from 'node:fs';
import { resolve, join } from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright-core';
import axe from 'axe-core';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...rest] = a.replace(/^--/, '').split('=');
  return [k, rest.join('=')];
}));

const BASE = (args.base ?? 'https://christianmacion-portfolio.pages.dev').replace(/\/$/, '');
const OUT = resolve(args.out ?? '.audit/incident/2026-08-01-prod-triage/post-fix');
const DEDUPE_KEY = 'portfolio-prod-triage-qa-post-fix-v1';
const CHROME = process.env.CHROME_PATH
  ?? '/Users/christianmacion/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

const A11Y_ROUTES = ['/', '/about/', '/ai/', '/for-recruiters/'];
const INTERACTIVITY_ROUTE = '/';
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

function slug(route) {
  return route === '/' ? 'root' : route.replace(/^\//, '').replace(/\/$/, '').replaceAll('/', '__') || 'root';
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  reducedMotion: 'no-preference',
  serviceWorkers: 'block',
  userAgent: 'Mozilla/5.0 (qa-post-fix-2026-08-01) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
});

const routeResults = [];

try {
  for (const route of A11Y_ROUTES) {
    const page = await context.newPage();
    const consoleEvents = [];
    const pageErrors = [];
    page.on('console', (message) => consoleEvents.push({
      type: message.type(),
      text: message.text(),
      location: message.location(),
    }));
    page.on('pageerror', (error) => pageErrors.push({ name: error.name, message: error.message }));

    let response = null;
    let navigationError = null;
    try {
      response = await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 45_000 });
    } catch (error) {
      navigationError = String(error);
    }
    await page.waitForTimeout(1_200);

    const initialState = await page.evaluate(() => ({
      title: document.title,
      finalUrl: location.href,
      metaCsp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? null,
      inlineScripts: document.querySelectorAll('script:not([src])').length,
      moduleScripts: document.querySelectorAll('script[type="module"][src]').length,
      scriptsWithNonce: document.querySelectorAll('script[nonce]').length,
      wordCount: document.querySelectorAll('.word').length,
      wordsDoneCount: document.querySelectorAll('[data-words-done="true"]').length,
      astroIslandCount: document.querySelectorAll('astro-island').length,
      hydratedIslandCount: [...document.querySelectorAll('astro-island')].filter((el) => !el.hasAttribute('ssr')).length,
      fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
      domContentLoaded: performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd ?? null,
      loadEventEnd: performance.getEntriesByType('navigation')[0]?.loadEventEnd ?? null,
    }));

    // axe-core audit (WCAG 2.2 AA)
    let axeResult = { violations: [], error: null };
    try {
      await page.addScriptTag({ content: axe.source });
      const result = await page.evaluate(async (tags) => globalThis.axe.run(document, {
        runOnly: { type: 'tag', values: tags },
        resultTypes: ['violations'],
      }), AXE_TAGS);
      axeResult.violations = result.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        helpUrl: v.helpUrl,
        nodes: v.nodes.map((n) => ({ target: n.target, html: n.html, failureSummary: n.failureSummary })),
      }));
    } catch (error) {
      axeResult.error = String(error);
    }

    // CSP console capture (5-second post-load dwell to catch deferred reports)
    await page.waitForTimeout(5_000);
    const cspViolations = consoleEvents.filter((event) => /content security policy|refused to (execute|load|apply)|violates the following content security policy/i.test(event.text));

    // Per-route write — a11y + csp-console
    await fs.writeFile(join(OUT, 'a11y', `${slug(route)}-axe.json`), `${JSON.stringify({
      route,
      axeVersion: axe.version,
      tags: AXE_TAGS,
      generatedAt: new Date().toISOString(),
      violationCount: axeResult.violations.length,
      violations: axeResult.violations,
    }, null, 2)}\n`);

    await fs.writeFile(join(OUT, 'csp-console', `${slug(route)}-console.json`), `${JSON.stringify({
      route,
      generatedAt: new Date().toISOString(),
      consoleEvents,
      pageErrors,
      cspViolations,
      summary: {
        total: consoleEvents.length,
        errors: consoleEvents.filter((e) => e.type === 'error'),
        cspViolations: cspViolations.length,
        pageErrors: pageErrors.length,
      },
    }, null, 2)}\n`);

    routeResults.push({
      route,
      requestedUrl: `${BASE}${route}`,
      finalUrl: page.url(),
      documentStatus: response?.status() ?? null,
      navigationError,
      initialState,
      axe: {
        violationCount: axeResult.violations.length,
        violations: axeResult.violations.map((v) => ({ id: v.id, impact: v.impact, nodeCount: v.nodes.length })),
        error: axeResult.error,
      },
      cspConsole: {
        total: consoleEvents.length,
        errorCount: consoleEvents.filter((e) => e.type === 'error').length,
        cspViolationCount: cspViolations.length,
        pageErrorCount: pageErrors.length,
      },
    });
    process.stdout.write(`audit ${route}  axe=${axeResult.violations.length}  csp=${cspViolations.length}  console=${consoleEvents.length}\n`);
    await page.close();
  }

  // Interactivity check on the home route — scrolls, clicks, captures
  // back-to-top + scroll-progress + data-words + island hydration.
  const page = await context.newPage();
  const consoleEvents = [];
  page.on('console', (m) => consoleEvents.push({ type: m.type(), text: m.text() }));
  let response = null;
  try {
    response = await page.goto(`${BASE}${INTERACTIVITY_ROUTE}`, { waitUntil: 'networkidle', timeout: 45_000 });
  } catch (error) {
    process.stderr.write(`interactivity nav error: ${String(error)}\n`);
  }
  await page.waitForTimeout(1_500);

  // Pre-scroll
  const preScroll = await page.evaluate(() => ({
    scrollY: window.scrollY,
    docHeight: document.documentElement.scrollHeight,
    viewport: innerHeight,
    wordCount: document.querySelectorAll('.word').length,
    wordsDoneCount: document.querySelectorAll('[data-words-done="true"]').length,
    backToTopVisible: !document.getElementById('back-to-top')?.hasAttribute('hidden'),
    progressActive: document.querySelector('.scroll-progress')?.classList.contains('is-active') ?? false,
    progressFillWidth: (() => {
      const fill = document.querySelector('.scroll-progress i');
      return fill ? getComputedStyle(fill).width : null;
    })(),
    astroIslandCount: document.querySelectorAll('astro-island').length,
    hydratedIslandCount: [...document.querySelectorAll('astro-island')].filter((el) => !el.hasAttribute('ssr')).length,
  }));

  // Scroll to bottom, wait, capture
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(1_500);
  const postScroll = await page.evaluate(() => ({
    scrollY: window.scrollY,
    maxScroll: document.documentElement.scrollHeight - innerHeight,
    backToTopVisible: !document.getElementById('back-to-top')?.hasAttribute('hidden'),
    progressActive: document.querySelector('.scroll-progress')?.classList.contains('is-active') ?? false,
    progressFillWidth: (() => {
      const fill = document.querySelector('.scroll-progress i');
      return fill ? getComputedStyle(fill).width : null;
    })(),
  }));

  // Back-to-top click
  let clickWorked = false;
  if (postScroll.backToTopVisible) {
    await page.locator('#back-to-top').click();
    await page.waitForTimeout(1_500);
    const finalScrollY = await page.evaluate(() => window.scrollY);
    clickWorked = finalScrollY < 20;
  }

  // Screenshots: top, mid-scroll, bottom, post-click
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, 'interactivity', 'home-top.png'), fullPage: false });
  await page.evaluate(() => window.scrollTo(0, Math.floor(document.documentElement.scrollHeight * 0.5)));
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, 'interactivity', 'home-mid.png'), fullPage: false });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, 'interactivity', 'home-bottom.png'), fullPage: false });

  const interactivityReport = {
    route: '/',
    generatedAt: new Date().toISOString(),
    documentStatus: response?.status() ?? null,
    preScroll,
    postScroll,
    backToTopClickWorked: clickWorked,
    summary: {
      dataWordsAnimated: preScroll.wordCount > 0 && preScroll.wordsDoneCount > 0,
      backToTopVisible: postScroll.backToTopVisible,
      backToTopClickWorked: clickWorked,
      scrollProgressAdvances: postScroll.progressActive && postScroll.progressFillWidth !== '0px',
      hydrationIslandsMount: preScroll.astroIslandCount > 0
        ? preScroll.hydratedIslandCount === preScroll.astroIslandCount
        : null,
      hydrationIslandsApplicable: preScroll.astroIslandCount > 0,
    },
  };
  await fs.writeFile(join(OUT, 'interactivity', 'home-report.json'), `${JSON.stringify(interactivityReport, null, 2)}\n`);
  await page.close();
} finally {
  await context.close();
  await browser.close();
}

const report = {
  schemaVersion: 1,
  dedupeKey: DEDUPE_KEY,
  terminalState: 'done',
  phase: 'post-fix',
  baseUrl: BASE,
  generatedAt: new Date().toISOString(),
  coverage: {
    included: 'A11y routes per playbook: /, /about/, /ai/, /for-recruiters/; interactivity only on /',
    excluded: 'Worker endpoints, non-document static assets, and all non-primary routes (Phase 4 visual-regression covers the 5 critical-path routes separately)',
    a11yRoutes: A11Y_ROUTES,
    interactivityRoute: INTERACTIVITY_ROUTE,
  },
  summary: {
    axeViolationCount: routeResults.reduce((s, r) => s + r.axe.violationCount, 0),
    axeNodeCount: routeResults.reduce((s, r) => s + r.axe.violations.reduce((n, v) => n + v.nodeCount, 0), 0),
    cspViolationCount: routeResults.reduce((s, r) => s + r.cspConsole.cspViolationCount, 0),
    consoleErrorCount: routeResults.reduce((s, r) => s + r.cspConsole.errorCount + r.cspConsole.pageErrorCount, 0),
    primaryDocumentStatuses: Object.fromEntries(routeResults.map((r) => [r.route, r.documentStatus])),
  },
  routes: routeResults,
};
await fs.writeFile(join(OUT, 'a11y', 'axe-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.summary, null, 2));
