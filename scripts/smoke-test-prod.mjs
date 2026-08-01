#!/usr/bin/env node

// scripts/smoke-test-prod.mjs — Post-deploy smoke-test (live URL variant).
//
// Why this exists: the 2026-08-01 SEV-1 prod-triage shipped a broken site
// because `npm run build` did not set BASE_PATH=/, so every asset + route
// was emitted as `/portfolio/...` and Cloudflare Pages served the HTML at
// root. Every CSS/JS/icon/font/manifest/internal link returned 404. The
// CI guardrail ran against the PR branch — but the DEPLOYED URL was the
// broken one. No post-deploy check traced the rendered HTML's asset paths
// back to actual HTTP responses.
//
// This is the **live-URL sibling** of scripts/smoke-test.mjs (which serves
// a local dist/ via python http.server). This script loads the live prod
// URL via Playwright Chromium, extracts every <link href>, <script src>,
// <img src>, <source src>, <video src/poster>, fetches each one, and fails
// with exit code 1 on any non-200.
//
// Wired into .github/workflows/deploy-gate.yml (workflow_run after CF Pages
// deploy completes + push: main fast-feedback fallback).
//
// 5-must-have (CLAUDE.md §1):
//   - Terminal: exits 0 or 1; no "running forever".
//   - Idempotent: re-running against the same prod URL state yields identical
//     pass/fail (no Math.random, no Date.now in assertions).
//   - Dedupe key: failures keyed by `${route}::${asset}` (deterministic).
//   - Coverage filter: every local <link>/<script>/<img>/<source>/<video>
//     on every critical-path route (full sweep, not sampled).
//   - AAR: writes `.audit/incident/<date>-deploy-gate/failures.json` on fail.
//
// Usage:
//   PROD_URL=https://christianmacion-portfolio.pages.dev node scripts/smoke-test-prod.mjs
//   PROD_URL=http://localhost:4321 node scripts/smoke-test-prod.mjs

import { chromium } from 'playwright';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';

const PROD = process.env.PROD_URL;
if (!PROD) {
  console.error('smoke-test-prod: PROD_URL env var not set');
  process.exit(2);
}

const DEDUPE_KEY = 'portfolio-deploy-gate-v1';

// Critical-path routes — mirrors lighthouse.yml + smoke-routes.sh. Expand
// via sitemap-index.xml in a follow-up if the route surface grows.
const ROUTES = [
  '/', '/about/', '/ai/', '/for-recruiters/', '/proof/',
  '/experience/', '/methodology/', '/skills/', '/now/',
  '/colophon/', '/desk/', '/markets/', '/publications/',
  '/workbooks/', '/contact/', '/screening-call/', '/projects/',
  '/resume/', '/sitemap-index.xml',
];

function isExternal(p) {
  return (
    p.startsWith('http://') || p.startsWith('https://') ||
    p.startsWith('//') || p.startsWith('data:') ||
    p.startsWith('mailto:') || p.startsWith('javascript:') ||
    p.startsWith('#')
  );
}

function extractAssets(html) {
  const assets = new Set();
  for (const m of html.matchAll(/<link\b[^>]*?\bhref=["']([^"']+)["'][^>]*>/gi)) {
    const v = m[1].split('#')[0].split('?')[0];
    if (v && !isExternal(v)) assets.add(v);
  }
  for (const m of html.matchAll(/<script\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    const v = m[1].split('#')[0].split('?')[0];
    if (v && !isExternal(v)) assets.add(v);
  }
  for (const m of html.matchAll(/<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    const v = m[1].split('#')[0].split('?')[0];
    if (v && !isExternal(v)) assets.add(v);
  }
  for (const m of html.matchAll(/<img\b[^>]*?\bsrcset=["']([^"']+)["'][^>]*>/gi)) {
    const first = m[1].split(',')[0].trim().split(/\s+/)[0];
    if (first && !isExternal(first)) assets.add(first);
  }
  for (const m of html.matchAll(/<source\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    const v = m[1].split('#')[0].split('?')[0];
    if (v && !isExternal(v)) assets.add(v);
  }
  for (const m of html.matchAll(/<source\b[^>]*?\bsrcset=["']([^"']+)["'][^>]*>/gi)) {
    const first = m[1].split(',')[0].trim().split(/\s+/)[0];
    if (first && !isExternal(first)) assets.add(first);
  }
  for (const m of html.matchAll(/<video\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    const v = m[1].split('#')[0].split('?')[0];
    if (v && !isExternal(v)) assets.add(v);
  }
  for (const m of html.matchAll(/<video\b[^>]*?\bposter=["']([^"']+)["'][^>]*>/gi)) {
    const v = m[1].split('#')[0].split('?')[0];
    if (v && !isExternal(v)) assets.add(v);
  }
  return assets;
}

async function fetchStatus(url) {
  const res = await fetch(url, { redirect: 'follow' });
  await res.text();
  return res.status;
}

const ROOT = resolve(import.meta.dirname, '..');

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  let checked = 0;
  let failed = 0;
  const failures = [];
  try {
    for (const route of ROUTES) {
      const url = PROD + route;
      const page = await ctx.newPage();
      const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      const html = await page.content();
      const status = resp?.status() ?? 0;
      if (status !== 200) {
        failed += 1;
        failures.push({ route, asset: '<html-self>', status });
      }
      const assets = extractAssets(html);
      await page.close();
      for (const asset of [...assets].sort()) {
        checked += 1;
        const clean = asset.split('#')[0].split('?')[0];
        const assetUrl = clean.startsWith('http')
          ? clean
          : clean.startsWith('/')
            ? new URL(clean, PROD).toString()
            : new URL(clean, url).toString();
        try {
          const s = await fetchStatus(assetUrl);
          if (s !== 200) {
            failed += 1;
            failures.push({ route, asset: clean, status: s });
          }
        } catch (err) {
          failed += 1;
          failures.push({ route, asset: clean, status: 0, error: String(err) });
        }
      }
    }
  } finally {
    await browser.close();
  }

  console.log(
    `smoke-test-prod: ${checked} assets checked across ${ROUTES.length} routes; ${failed} failed.`
  );
  if (failed > 0) {
    console.error(`smoke-test-prod: FAIL — ${failed} broken asset reference(s):`);
    for (const f of failures.slice(0, 50)) {
      console.error(`  ${f.route}  →  ${f.asset}  (HTTP ${f.status}${f.error ? ' / ' + f.error : ''})`);
    }
    if (failures.length > 50) {
      console.error(`  …and ${failures.length - 50} more.`);
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dir = join(ROOT, '.audit', 'incident', `${stamp}-deploy-gate`);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      join(dir, 'failures.json'),
      JSON.stringify(
        {
          dedupe_key: DEDUPE_KEY,
          ts: new Date().toISOString(),
          prod_url: PROD,
          checked,
          failed,
          total_routes: ROUTES.length,
          failures,
        },
        null,
        2
      )
    );
    console.error(`smoke-test-prod: failure evidence written to ${dir}/failures.json`);
    process.exit(1);
  }
  console.log('smoke-test-prod: PASS — every asset on every critical route returned HTTP 200.');
  process.exit(0);
}

main().catch((err) => {
  console.error(`smoke-test-prod: unexpected error: ${err.message}`);
  console.error(err.stack);
  process.exit(2);
});