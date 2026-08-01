#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright-core';
import axe from 'axe-core';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  return [key, rest.join('=')];
}));
const baseUrl = (args.base ?? '').replace(/\/$/, '');
const outDir = resolve(args.out ?? '.audit/incident/unknown');
const phase = args.phase ?? 'unknown';
if (!baseUrl) throw new Error('--base=https://... is required');

const DEDUPE_KEY = `portfolio-prod-triage-${phase}-v1`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const primaryRoutes = ['/', '/about/', '/ai/', '/for-recruiters/', '/work/', '/notes/', '/bookshelf/', '/contact/', '/proof/'];
const a11yTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

function slug(route) {
  return route === '/' ? 'root' : route.replace(/^\//, '').replace(/\/$/, '').replaceAll('/', '__') || 'root';
}

const base = new URL(`${baseUrl}/`);
const basePath = base.pathname === '/' ? '' : base.pathname.replace(/\/$/, '');

function relativeRoute(absoluteUrl) {
  const pathname = new URL(absoluteUrl).pathname;
  if (basePath && pathname.startsWith(`${basePath}/`)) return pathname.slice(basePath.length) || '/';
  if (basePath && pathname === basePath) return '/';
  return pathname;
}

async function getAuditRoutes() {
  const indexText = await (await fetch(`${baseUrl}/sitemap-index.xml`)).text();
  const sitemapUrls = [...indexText.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const routes = [];
  for (const sitemapUrl of sitemapUrls) {
    const text = await (await fetch(sitemapUrl)).text();
    for (const match of text.matchAll(/<loc>([^<]+)<\/loc>/g)) routes.push(relativeRoute(match[1]));
  }
  routes.push('/404', '/500');
  return [...new Set(routes)].sort();
}

await fs.mkdir(outDir, { recursive: true });
const auditRoutes = await getAuditRoutes();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  reducedMotion: 'no-preference',
  serviceWorkers: 'block',
});

const routeResults = [];
const primarySet = new Set(primaryRoutes);
const coverageRoutes = [...new Set([...auditRoutes, ...primaryRoutes])];

try {
  for (const route of coverageRoutes) {
    const page = await context.newPage();
    const consoleEvents = [];
    const networkEvents = [];
    const pageErrors = [];
    page.on('console', (message) => consoleEvents.push({
      type: message.type(),
      text: message.text(),
      location: message.location(),
    }));
    page.on('pageerror', (error) => pageErrors.push({ name: error.name, message: error.message, stack: error.stack }));
    page.on('requestfailed', (request) => networkEvents.push({
      kind: 'requestfailed',
      method: request.method(),
      resourceType: request.resourceType(),
      url: request.url(),
      error: request.failure()?.errorText ?? 'unknown',
    }));
    page.on('response', (response) => {
      networkEvents.push({
        kind: 'response',
        status: response.status(),
        resourceType: response.request().resourceType(),
        url: response.url(),
      });
    });

    let response;
    let navigationError = null;
    try {
      response = await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle', timeout: 45_000 });
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
      wordCount: document.querySelectorAll('.word').length,
      wordsDoneCount: document.querySelectorAll('[data-words-done="true"]').length,
      astroIslandCount: document.querySelectorAll('astro-island').length,
      hydratedIslandCount: [...document.querySelectorAll('astro-island')].filter((el) => !el.hasAttribute('ssr')).length,
      fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
      domContentLoaded: performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd ?? null,
      loadEventEnd: performance.getEntriesByType('navigation')[0]?.loadEventEnd ?? null,
    }));

    let interactivity = null;
    if (route === '/') {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(500);
      const afterScroll = await page.evaluate(() => {
        const button = document.getElementById('back-to-top');
        const progress = document.querySelector('.scroll-progress');
        const fill = progress?.querySelector('i');
        return {
          scrollY: window.scrollY,
          maxScroll: document.documentElement.scrollHeight - innerHeight,
          backToTopVisible: Boolean(button && !button.hasAttribute('hidden')),
          progressActive: progress?.classList.contains('is-active') ?? false,
          progressCustomProperty: getComputedStyle(document.documentElement).getPropertyValue('--scroll-progress').trim(),
          progressFillWidth: fill ? getComputedStyle(fill).width : null,
        };
      });
      let clickWorked = false;
      if (afterScroll.backToTopVisible) {
        await page.locator('#back-to-top').click();
        await page.waitForTimeout(1_200);
        clickWorked = (await page.evaluate(() => window.scrollY)) < 20;
      }
      const islandApplicable = initialState.astroIslandCount > 0;
      interactivity = {
        dataWordsAnimated: initialState.wordCount > 0 && initialState.wordsDoneCount > 0,
        backToTopWorks: afterScroll.backToTopVisible && clickWorked,
        scrollProgressAdvances: afterScroll.progressActive && afterScroll.progressFillWidth !== '0px',
        hydrationIslandsMount: islandApplicable ? initialState.hydratedIslandCount === initialState.astroIslandCount : null,
        hydrationIslandsApplicable: islandApplicable,
        ...afterScroll,
        finalScrollY: await page.evaluate(() => window.scrollY),
      };
    }

    const siteConsoleEvents = [...consoleEvents];
    const sitePageErrors = [...pageErrors];
    let axeResult = { violations: [], error: null };
    if (auditRoutes.includes(route)) {
      try {
        await page.evaluate(axe.source);
        const result = await page.evaluate(async (tags) => globalThis.axe.run(document, {
          runOnly: { type: 'tag', values: tags },
          resultTypes: ['violations'],
        }), a11yTags);
        axeResult.violations = result.violations.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          help: violation.help,
          helpUrl: violation.helpUrl,
          nodes: violation.nodes.map((node) => ({ target: node.target, html: node.html, failureSummary: node.failureSummary })),
        }));
      } catch (error) {
        axeResult.error = String(error);
      }
    }

    if (primarySet.has(route)) {
      await page.screenshot({ path: join(outDir, `${slug(route)}.png`), fullPage: true });
      await fs.writeFile(join(outDir, `${slug(route)}-console.json`), `${JSON.stringify({ route, consoleEvents: siteConsoleEvents, pageErrors: sitePageErrors }, null, 2)}\n`);
      await fs.writeFile(join(outDir, `${slug(route)}-network.json`), `${JSON.stringify({ route, networkEvents }, null, 2)}\n`);
    }

    routeResults.push({
      route,
      requestedUrl: `${baseUrl}${route}`,
      finalUrl: page.url(),
      navigationError,
      documentStatus: response?.status() ?? null,
      responseHeaders: response ? await response.allHeaders() : {},
      initialState,
      interactivity,
      console: {
        total: siteConsoleEvents.length,
        errors: siteConsoleEvents.filter((event) => event.type === 'error'),
        cspViolations: siteConsoleEvents.filter((event) => /content security policy|refused to (execute|load|apply)|violates the following content security policy/i.test(event.text)),
      },
      pageErrors: sitePageErrors,
      network: {
        total: networkEvents.length,
        failed: networkEvents.filter((event) => event.kind === 'requestfailed'),
        http4xx5xx: networkEvents.filter((event) => event.kind === 'response' && event.status >= 400),
        http200: networkEvents.filter((event) => event.kind === 'response' && event.status === 200).length,
      },
      axe: axeResult,
    });
    await page.close();
    process.stdout.write(`${phase} ${route}\n`);
  }
} finally {
  await context.close();
  await browser.close();
}

const audited = routeResults.filter((result) => auditRoutes.includes(result.route));
const primary = routeResults.filter((result) => primarySet.has(result.route));
const report = {
  schemaVersion: 1,
  dedupeKey: DEDUPE_KEY,
  terminalState: 'done',
  phase,
  baseUrl,
  generatedAt: new Date().toISOString(),
  coverage: {
    included: '89 sitemap routes plus generated /404 and /500 documents; requested primary routes added for browser diagnostics',
    excluded: 'Gated worker endpoints and non-document static assets except assets loaded by audited documents',
    sitemapRouteCount: auditRoutes.length - 2,
    a11yRouteCount: auditRoutes.length,
    diagnosticRouteCount: coverageRoutes.length,
    primaryRoutes,
    auditRoutes,
  },
  summary: {
    cspViolationCount: routeResults.reduce((sum, result) => sum + result.console.cspViolations.length, 0),
    consoleErrorCount: routeResults.reduce((sum, result) => sum + result.console.errors.length + result.pageErrors.length, 0),
    failedRequestCount: routeResults.reduce((sum, result) => sum + result.network.failed.length, 0),
    http4xx5xxCount: routeResults.reduce((sum, result) => sum + result.network.http4xx5xx.length, 0),
    axeViolationCount: audited.reduce((sum, result) => sum + result.axe.violations.length, 0),
    axeViolationNodeCount: audited.reduce((sum, result) => sum + result.axe.violations.reduce((nodeSum, violation) => nodeSum + violation.nodes.length, 0), 0),
    axeExecutionErrors: audited.filter((result) => result.axe.error).length,
    primaryDocumentStatuses: Object.fromEntries(primary.map((result) => [result.route, result.documentStatus])),
    homeInteractivity: routeResults.find((result) => result.route === '/')?.interactivity ?? null,
  },
  routes: routeResults,
};
await fs.writeFile(join(outDir, 'browser-axe-report.json'), `${JSON.stringify(report, null, 2)}\n`);
await fs.writeFile(join(outDir, 'routes.txt'), `${auditRoutes.join('\n')}\n`);
console.log(JSON.stringify(report.summary, null, 2));
