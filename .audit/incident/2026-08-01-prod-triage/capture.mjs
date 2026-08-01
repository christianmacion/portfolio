// capture.mjs — Playwright verification of the prod-fix
// Captures a screenshot of every primary route + console errors + network failures
// for the 2026-08-01 prod-triage incident.

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = new URL('./', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const ROUTES = [
  { path: '/', label: 'home' },
  { path: '/about/', label: 'about' },
  { path: '/ai/', label: 'ai' },
  { path: '/for-recruiters/', label: 'for-recruiters' },
  { path: '/contact/', label: 'contact' },
  { path: '/proof/', label: 'proof' },
  { path: '/resume/', label: 'resume' },
  { path: '/experience/', label: 'experience' },
  { path: '/methodology/', label: 'methodology' },
  { path: '/skills/', label: 'skills' },
  { path: '/now/', label: 'now' },
  { path: '/colophon/', label: 'colophon' },
  { path: '/desk/', label: 'desk' },
  { path: '/markets/', label: 'markets' },
  { path: '/publications/', label: 'publications' },
  { path: '/workbooks/', label: 'workbooks' },
  { path: '/screening-call/', label: 'screening-call' },
  { path: '/projects/', label: 'projects' },
];

const BASE = 'https://christianmacion-portfolio.pages.dev';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  userAgent: 'Mozilla/5.0 (qa-triage-2026-08-01) Chrome/130.0',
});

const summary = [];

for (const { path, label } of ROUTES) {
  const page = await context.newPage();
  const consoleErrors = [];
  const networkFailures = [];
  const requestUrls = [];

  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`console: ${msg.text()}`);
  });
  page.on('response', (r) => {
    const url = r.url();
    requestUrls.push(`${r.status()} ${url}`);
    if (r.status() >= 400 && !url.includes('chrome-extension')) {
      networkFailures.push(`${r.status()} ${url}`);
    }
  });

  const t0 = Date.now();
  try {
    const resp = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 20_000 });
    const status = resp?.status() ?? 0;
    // Give CSS transitions a moment to land
    await page.waitForTimeout(300);
    const screenshotPath = join(OUT, `${label}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    const wallMs = Date.now() - t0;
    summary.push({
      path, label, status, wallMs,
      screenshot: screenshotPath,
      consoleErrors: consoleErrors.slice(0, 5),
      networkFailures: networkFailures.slice(0, 10),
      requestCount: requestUrls.length,
    });
  } catch (e) {
    summary.push({
      path, label, status: 'EXCEPTION', error: String(e?.message ?? e),
      consoleErrors, networkFailures,
    });
  }
  await page.close();
}

await browser.close();

writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));

// Print a compact one-line summary
for (const r of summary) {
  const ok = r.status === 200 && (r.networkFailures?.length ?? 0) === 0 && (r.consoleErrors?.length ?? 0) === 0;
  const flag = ok ? 'OK' : 'FLG';
  console.log(`${flag}  ${String(r.status).padEnd(4)}  ${String(r.wallMs ?? '?').padEnd(6)} ms  ${r.path}  (nf=${r.networkFailures?.length ?? 0} ce=${r.consoleErrors?.length ?? 0})`);
}
