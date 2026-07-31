// check-bundle-budget.mjs — v9.2 BUNDLE BUDGET GATE
//
// Enforces gzip transfer budgets after every production build:
//   - 100 KB referenced JavaScript per HTML route
//   - 200 KB JavaScript site-wide
//   - 200 KB CSS site-wide
//   - 2 MB code (JS + CSS + HTML) site-wide
//
// A route total includes each directly referenced JavaScript asset and its
// transitive local JavaScript dependencies. Assets are gzipped individually,
// matching HTTP transfer behavior. Shared assets count once per route.

import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(PROJECT_ROOT, 'dist');
const BUDGETS = {
  jsPerRoute: 100 * 1024,
  jsTotal: 200 * 1024,
  cssTotal: 200 * 1024,
  codeTotal: 2 * 1024 * 1024,
};

const LOCAL_JS_LITERAL = /["']((?:(?:\.{1,2}\/)|\/)[^"']+?\.js(?:[?#][^"']*)?)["']/g;
const HTML_JS_ATTRIBUTE = /(?:src|href)=["']([^"']+?\.js(?:[?#][^"']*)?)["']/g;

async function walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(absolutePath)));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }

  return files;
}

function isInsideDist(absolutePath) {
  const pathFromDist = relative(DIST, absolutePath);
  return (
    pathFromDist !== '..' && !pathFromDist.startsWith(`..${sep}`) && !pathFromDist.startsWith(sep)
  );
}

function resolveLocalReference(reference, sourcePath) {
  if (/^(?:[a-z]+:)?\/\//i.test(reference)) return null;

  let pathOnly;
  try {
    pathOnly = decodeURIComponent(reference.split(/[?#]/, 1)[0]);
  } catch {
    return null;
  }

  const astroAssetIndex = pathOnly.indexOf('_astro/');
  let absolutePath;

  if (astroAssetIndex >= 0) {
    absolutePath = resolve(DIST, pathOnly.slice(astroAssetIndex));
  } else if (pathOnly.startsWith('/')) {
    absolutePath = resolve(DIST, pathOnly.replace(/^\/+/, ''));
  } else {
    absolutePath = resolve(dirname(sourcePath), pathOnly);
  }

  return isInsideDist(absolutePath) ? absolutePath : null;
}

function extractReferences(source, sourcePath, pattern) {
  const references = new Set();
  pattern.lastIndex = 0;

  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const absolutePath = resolveLocalReference(match[1], sourcePath);
    if (absolutePath) references.add(absolutePath);
  }

  return references;
}

function routeName(htmlPath) {
  const relativePath = relative(DIST, htmlPath).split(sep).join('/');
  if (relativePath === 'index.html') return '/';
  if (relativePath.endsWith('/index.html'))
    return `/${relativePath.slice(0, -'index.html'.length)}`;
  return `/${relativePath}`;
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function verdict(actual, budget) {
  return actual <= budget ? 'PASS' : 'FAIL';
}

async function main() {
  const files = await walkFiles(DIST);
  const gzipBytes = new Map();
  const sourceCache = new Map();
  const htmlFiles = [];
  const jsFiles = new Set();
  const totals = { js: 0, css: 0, html: 0, other: 0 };

  for (const filePath of files) {
    const content = await readFile(filePath);
    const compressedBytes = gzipSync(content).length;
    const extension = extname(filePath);

    gzipBytes.set(filePath, compressedBytes);
    if (extension === '.js') {
      jsFiles.add(filePath);
      totals.js += compressedBytes;
    } else if (extension === '.css') {
      totals.css += compressedBytes;
    } else if (extension === '.html') {
      htmlFiles.push(filePath);
      totals.html += compressedBytes;
    } else {
      totals.other += compressedBytes;
    }
  }

  async function sourceFor(filePath) {
    if (!sourceCache.has(filePath)) {
      sourceCache.set(filePath, await readFile(filePath, 'utf8'));
    }
    return sourceCache.get(filePath);
  }

  async function routeJavaScript(htmlPath) {
    const html = await sourceFor(htmlPath);
    const queue = [
      ...extractReferences(html, htmlPath, HTML_JS_ATTRIBUTE),
      ...extractReferences(html, htmlPath, LOCAL_JS_LITERAL),
    ];
    const referenced = new Set();

    while (queue.length > 0) {
      const candidate = queue.pop();
      if (!candidate || referenced.has(candidate) || !jsFiles.has(candidate)) continue;

      referenced.add(candidate);
      const javaScript = await sourceFor(candidate);
      for (const dependency of extractReferences(javaScript, candidate, LOCAL_JS_LITERAL)) {
        if (!referenced.has(dependency)) queue.push(dependency);
      }
    }

    const compressedBytes = [...referenced].reduce(
      (sum, filePath) => sum + (gzipBytes.get(filePath) ?? 0),
      0,
    );

    return { compressedBytes, assets: referenced.size };
  }

  const routes = [];
  for (const htmlPath of htmlFiles) {
    routes.push({
      route: routeName(htmlPath),
      ...(await routeJavaScript(htmlPath)),
    });
  }
  routes.sort((left, right) => left.route.localeCompare(right.route));

  const codeGzipBytes = totals.js + totals.css + totals.html;
  const failures = [];

  console.log('=== Bundle Budget Audit (v9.2) ===\n');
  console.log(`Per-route JavaScript (gzipped, limit ${formatBytes(BUDGETS.jsPerRoute)}):`);
  for (const route of routes) {
    const routeVerdict = verdict(route.compressedBytes, BUDGETS.jsPerRoute);
    console.log(
      `  ${routeVerdict.padEnd(4)} ${formatBytes(route.compressedBytes).padStart(9)}  ${String(route.assets).padStart(2)} assets  ${route.route}`,
    );
    if (routeVerdict === 'FAIL') {
      failures.push(
        `Route ${route.route} references ${formatBytes(route.compressedBytes)} JS; limit is ${formatBytes(BUDGETS.jsPerRoute)}`,
      );
    }
  }

  console.log('\nSite totals (gzipped, code only):');
  console.log(
    `  JS:   ${formatBytes(totals.js)} / ${formatBytes(BUDGETS.jsTotal)}  [${verdict(totals.js, BUDGETS.jsTotal)}]`,
  );
  console.log(
    `  CSS:  ${formatBytes(totals.css)} / ${formatBytes(BUDGETS.cssTotal)}  [${verdict(totals.css, BUDGETS.cssTotal)}]`,
  );
  console.log(`  HTML: ${formatBytes(totals.html)}`);
  console.log(
    `  CODE: ${formatBytes(codeGzipBytes)} / ${formatBytes(BUDGETS.codeTotal)}  [${verdict(codeGzipBytes, BUDGETS.codeTotal)}]`,
  );
  console.log('\nAssets (gzipped, informational):');
  console.log(`  Other: ${formatBytes(totals.other)}`);
  console.log(`  Grand total: ${formatBytes(codeGzipBytes + totals.other)}`);
  console.log(`  Routes checked: ${routes.length}`);

  if (totals.js > BUDGETS.jsTotal) {
    failures.push(`Site JS ${formatBytes(totals.js)} exceeds ${formatBytes(BUDGETS.jsTotal)}`);
  }
  if (totals.css > BUDGETS.cssTotal) {
    failures.push(`Site CSS ${formatBytes(totals.css)} exceeds ${formatBytes(BUDGETS.cssTotal)}`);
  }
  if (codeGzipBytes > BUDGETS.codeTotal) {
    failures.push(
      `Site code ${formatBytes(codeGzipBytes)} exceeds ${formatBytes(BUDGETS.codeTotal)}`,
    );
  }

  console.log('\n=== Result ===');
  if (failures.length === 0) {
    console.log('PASS — every route and site total is within budget.');
    process.exit(0);
  }

  console.log('FAIL — bundle exceeds budget:');
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}

main().catch((error) => {
  console.error('bundle-budget audit crashed:', error);
  process.exit(2);
});
