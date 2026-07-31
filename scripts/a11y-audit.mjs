#!/usr/bin/env node

import { createReadStream, existsSync, promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright-core';
import axe from 'axe-core';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const REPORT = resolve(ROOT, process.argv.includes('--output')
  ? process.argv[process.argv.indexOf('--output') + 1]
  : '.audit/a11y/axe-report.json');
const PORT = Number(process.env.A11Y_PORT ?? 4178);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DEDUPE_KEY = 'portfolio-wcag22-aa-route-audit-v1';
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const mime = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

function routeFor(htmlPath) {
  const rel = relative(DIST, htmlPath).split(sep).join('/');
  if (rel === 'index.html') return '/';
  if (rel.endsWith('/index.html')) return `/${rel.slice(0, -10)}`;
  return `/${rel}`;
}

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
  ].filter(Boolean);
  return candidates.find(existsSync);
}

function staticServer() {
  return createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, BASE_URL).pathname);
      let target = resolve(DIST, `.${pathname}`);
      if (!target.startsWith(`${DIST}${sep}`) && target !== DIST) throw new Error('path traversal');
      const stat = await fs.stat(target).catch(() => null);
      if (stat?.isDirectory()) target = join(target, 'index.html');
      if (!existsSync(target) && !extname(target)) target = join(target, 'index.html');
      if (!existsSync(target)) {
        response.writeHead(404).end('Not found');
        return;
      }
      response.writeHead(200, {
        'content-type': mime[extname(target)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      createReadStream(target).pipe(response);
    } catch (error) {
      response.writeHead(500).end(String(error));
    }
  });
}

if (!existsSync(DIST)) {
  console.error('BLOCKED: dist/ is missing. Run npm run build:mirror first.');
  process.exit(2);
}

const executablePath = chromePath();
if (!executablePath) {
  console.error('BLOCKED: Chrome/Chromium not found. Set CHROME_PATH.');
  process.exit(2);
}

const htmlFiles = (await walk(DIST)).filter((path) => path.endsWith('.html'));
const routes = htmlFiles.map(routeFor);
const server = staticServer();
await new Promise((resolveListen) => server.listen(PORT, '127.0.0.1', resolveListen));

const browser = await chromium.launch({ executablePath, headless: true });
const findings = [];
let consoleErrors = 0;

try {
  for (const route of routes) {
    const page = await browser.newPage({ reducedMotion: 'reduce', viewport: { width: 412, height: 823 } });
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors += 1;
    });
    await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.addScriptTag({ content: axe.source });
    const result = await page.evaluate(async (tags) => globalThis.axe.run(document, {
      runOnly: { type: 'tag', values: tags },
      resultTypes: ['violations'],
    }), AXE_TAGS);
    findings.push({
      route,
      url: `${BASE_URL}${route}`,
      violations: result.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        description: violation.description,
        help: violation.help,
        helpUrl: violation.helpUrl,
        tags: violation.tags,
        nodes: violation.nodes.map((node) => ({
          impact: node.impact,
          html: node.html,
          target: node.target,
          failureSummary: node.failureSummary,
          any: node.any,
          all: node.all,
          none: node.none,
        })),
      })),
    });
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}

const violationCount = findings.reduce((sum, page) => sum + page.violations.length, 0);
const nodeCount = findings.reduce((sum, page) => sum + page.violations.reduce((n, v) => n + v.nodes.length, 0), 0);
const report = {
  schemaVersion: 1,
  dedupeKey: DEDUPE_KEY,
  terminalState: violationCount === 0 ? 'converged' : 'blocked',
  standard: 'WCAG 2.2 AA',
  axeVersion: axe.version,
  coverage: {
    included: 'Every generated dist/**/*.html document',
    excluded: 'Non-HTML assets and API endpoints',
    routeCount: routes.length,
    routes,
  },
  browser: executablePath,
  prefersReducedMotion: 'reduce',
  consoleErrors,
  violationCount,
  nodeCount,
  findings,
};
await fs.mkdir(resolve(REPORT, '..'), { recursive: true });
await fs.writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`);

console.log(`axe ${axe.version}: ${routes.length} routes, ${violationCount} violations, ${nodeCount} nodes`);
for (const finding of findings.filter((page) => page.violations.length)) {
  console.log(`FAIL ${finding.route}`);
  for (const violation of finding.violations) console.log(`  ${violation.id} (${violation.impact}): ${violation.nodes.length} node(s)`);
}
console.log(`Evidence: ${REPORT}`);
process.exit(violationCount === 0 ? 0 : 1);
