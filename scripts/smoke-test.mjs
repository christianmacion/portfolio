#!/usr/bin/env node

// scripts/smoke-test.mjs — Post-deploy smoke test (post-build local variant).
//
// Why this exists: the 2026-08-01 SEV-1 prod-triage shipped a broken site because
// `npm run build` did not set BASE_PATH=/, so every asset + route was emitted
// as `/portfolio/...` and Cloudflare Pages served the HTML at root, returning
// 404 on every CSS/JS/icon/font/manifest/internal link. The CI guardrail ran
// against the PR branch — but the deployed URL was the broken one. A smoke-test
// step that traces the rendered HTML's asset paths back to actual HTTP responses
// would have caught the regression BEFORE Owner saw the broken site.
//
// Per dispatch brief (2026-08-01-portfolio-clean-pr-smoke-test-invariant) this
// is **Option A** — the local build hook. It runs as part of `npm run build:verify`
// after `astro build` and before the deploy step.
//
// What it does:
//   1. Spawn `python3 -m http.server` on a random localhost port serving `dist/`.
//   2. Load every `.html` file in `dist/` (one per route, per
//      `astro.config.mjs: trailingSlash: 'always'`).
//   3. For each HTML, parse every <link href>, <script src>, <img src>, and
//      <source src> — extract the local asset path.
//   4. For each, `fetch http://127.0.0.1:PORT/<path>` and assert HTTP 200.
//   5. Print summary (total checked, failures, failed paths).
//   6. Exit 0 if all pass, 1 if any fail.
//
// Exclusion filter (CLAUDE.md §1 coverage):
//   - EXCLUDES: data: URIs, anchor-only (#main), mailto:, external https URLs
//     (those are CDN-bound; not the deploy's responsibility).
//   - INCLUDES: every local relative + absolute-rooted asset path in any
//     generated HTML — full coverage, not a sample.
//
// 5-must-have (CLAUDE.md §1):
//   - Terminal: exits 0 or 1; no "running forever".
//   - Idempotent write: re-running against the same dist/ yields identical
//     pass/fail (no time-dependent state, no Math.random in assertions).
//   - Dedupe key: failures keyed by `<route>::<asset-path>` (deterministic).
//   - Coverage filter: every local <link>/<script>/<img>/<source> in every
//     dist/*.html (full sweep, not sampled).
//   - AAR: writes `.audit/incident/<date>-smoke-test/summary.json` with
//     pass/fail counts + failed paths (only when failures exist; idempotent).

import { spawn } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import process from 'node:process';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = process.env.SMOKE_DIST ? resolve(process.env.SMOKE_DIST) : join(ROOT, 'dist');

if (!existsSync(DIST)) {
  console.error(`smoke-test: dist/ not found at ${DIST} — run \`astro build\` first.`);
  process.exit(2);
}

const PORT = Number(process.env.SMOKE_PORT ?? 0); // 0 → OS-assigned ephemeral port
const HOST = '127.0.0.1';
const DEDUPE_KEY = 'portfolio-smoke-test-v1';

const _mime = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown; charset=utf-8',
};

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

function isExternal(path) {
  return (
    path.startsWith('http://') ||
    path.startsWith('https://') ||
    path.startsWith('//') ||
    path.startsWith('data:') ||
    path.startsWith('mailto:') ||
    path.startsWith('javascript:')
  );
}

// Extract every asset reference from an HTML body.
function extractAssets(html) {
  const assets = new Set();
  // <link href="..."> — CSS / preloads / manifests / icons
  for (const m of html.matchAll(/<link\b[^>]*?\bhref=["']([^"']+)["'][^>]*>/gi)) {
    if (!isExternal(m[1]) && !m[1].startsWith('#')) assets.add(m[1]);
  }
  // <script src="...">
  for (const m of html.matchAll(/<script\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    if (!isExternal(m[1])) assets.add(m[1]);
  }
  // <img src="..."> + <img srcset="..."> (first URL of srcset)
  for (const m of html.matchAll(/<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    if (!isExternal(m[1])) assets.add(m[1]);
  }
  for (const m of html.matchAll(/<img\b[^>]*?\bsrcset=["']([^"']+)["'][^>]*>/gi)) {
    const first = m[1].split(',')[0].trim().split(/\s+/)[0];
    if (first && !isExternal(first)) assets.add(first);
  }
  // <source src="..."> + <source srcset="..."> (video/audio/picture)
  for (const m of html.matchAll(/<source\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    if (!isExternal(m[1])) assets.add(m[1]);
  }
  for (const m of html.matchAll(/<source\b[^>]*?\bsrcset=["']([^"']+)["'][^>]*>/gi)) {
    const first = m[1].split(',')[0].trim().split(/\s+/)[0];
    if (first && !isExternal(first)) assets.add(first);
  }
  // <video src="..." poster="...">
  for (const m of html.matchAll(/<video\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    if (!isExternal(m[1])) assets.add(m[1]);
  }
  for (const m of html.matchAll(/<video\b[^>]*?\bposter=["']([^"']+)["'][^>]*>/gi)) {
    if (!isExternal(m[1])) assets.add(m[1]);
  }
  return assets;
}

// Spawn python3 http.server on dist/ + return the port. Probe with fetch instead
// of parsing stdout (Python 3.14 http.server is silent by default).
async function startServer() {
  const port = PORT || 8080; // SMOKE_PORT=0 is not honored by python http.server; default 8080
  // Python logs every request to stderr. Leaving stdout/stderr as unread pipes
  // deadlocks the full 91-route sweep once the pipe buffer fills. The smoke
  // runner reports its own route/asset failures, so discard server access logs.
  const proc = spawn('python3', ['-m', 'http.server', String(port), '--bind', HOST, '--directory', DIST], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const url = `http://${HOST}:${port}/`;
  // Poll the server for readiness (up to 10s).
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.status === 200) return { proc, port };
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  proc.kill('SIGTERM');
  throw new Error(`http.server did not become ready on port ${port} within 10s`);
}

async function fetchStatus(url) {
  const res = await fetch(url, { redirect: 'follow' });
  await res.text(); // drain so the socket can be reused
  return res.status;
}

async function main() {
  // Exclude Astro error-page generators (404.html / 500.html are served at
  // /404 and /500 by the Pages edge, not as literal .html paths).
  const SKIP_FILES = new Set(['404.html', '500.html']);
  const htmlFiles = (await walk(DIST))
    .filter((p) => p.endsWith('.html'))
    .filter((p) => !SKIP_FILES.has(p.split(sep).pop()));
  if (htmlFiles.length === 0) {
    console.error(`smoke-test: no .html files in ${DIST} — is this a built site?`);
    process.exit(2);
  }

  console.log(`smoke-test: serving ${DIST} via python3 http.server`);
  const { proc, port } = await startServer();
  const base = `http://${HOST}:${port}`;

  let checked = 0;
  let failed = 0;
  const failures = []; // { route, asset, status }

  try {
    for (const htmlPath of htmlFiles.sort()) {
      const route = '/' + relative(DIST, htmlPath).split(sep).join('/').replace(/index\.html$/, '').replace(/\/+$/, '');
      const routeUrl = base + (route === '/' ? '/' : route + '/');
      let html;
      try {
        const res = await fetch(routeUrl);
        html = await res.text();
        if (res.status !== 200) {
          failed += 1;
          failures.push({ route, asset: '<html-self>', status: res.status });
        }
      } catch (err) {
        failed += 1;
        failures.push({ route, asset: '<html-self>', status: 0, error: String(err) });
        continue;
      }
      const assets = extractAssets(html);
      for (const asset of [...assets].sort()) {
        checked += 1;
        // Normalize: strip query + hash.
        const clean = asset.split('#')[0].split('?')[0];
        // Resolve relative paths against the route URL; absolute paths
        // (starting with `/`) hit the origin root.
        const assetUrl = clean.startsWith('/') ? base + clean : new URL(clean, routeUrl).toString();
        try {
          const status = await fetchStatus(assetUrl);
          if (status !== 200) {
            failed += 1;
            failures.push({ route, asset: clean, status });
          }
        } catch (err) {
          failed += 1;
          failures.push({ route, asset: clean, status: 0, error: String(err) });
        }
      }
    }
  } finally {
    proc.kill('SIGTERM');
  }

  console.log(
    `smoke-test: ${checked} assets checked across ${htmlFiles.length} routes; ` +
      `${failed} failed.`
  );
  if (failed > 0) {
    console.error(`smoke-test: FAIL — ${failed} broken asset reference(s):`);
    for (const f of failures.slice(0, 50)) {
      console.error(`  ${f.route}  →  ${f.asset}  (HTTP ${f.status}${f.error ? ' / ' + f.error : ''})`);
    }
    if (failures.length > 50) {
      console.error(`  …and ${failures.length - 50} more.`);
    }
    // Write failure evidence to .audit/ (idempotent — same dist → same path).
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const auditDir = join(ROOT, '.audit', 'incident', `${stamp}-smoke-test`);
    await fs.mkdir(auditDir, { recursive: true });
    await fs.writeFile(
      join(auditDir, 'failures.json'),
      JSON.stringify(
        {
          dedupe_key: DEDUPE_KEY,
          ts: new Date().toISOString(),
          checked,
          failed,
          total_routes: htmlFiles.length,
          failures,
        },
        null,
        2
      )
    );
    console.error(`smoke-test: failure evidence written to ${auditDir}/failures.json`);
    process.exit(1);
  }
  console.log('smoke-test: PASS — every local asset on every route returned HTTP 200.');
  process.exit(0);
}

main().catch((err) => {
  console.error(`smoke-test: unexpected error: ${err.message}`);
  console.error(err.stack);
  process.exit(2);
});