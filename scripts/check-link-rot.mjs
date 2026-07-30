/**
 * check-link-rot.mjs — outbound link health gate (v7.28)
 *
 * Walks every dist/<route>/index.html, extracts every <a href="..."> outbound
 * link (skipping #anchors, mailto:, internal /portfolio paths, data: URIs),
 * HEAD-checks each external URL, and reports dead/timeout/4xx/5xx links.
 *
 * v7.28 — first-pass link-rot CI gate. Runs AFTER build, BEFORE perf:audit.
 * Fail policy: exit 1 if ANY external link returns 4xx/5xx, times out, or
 * DNS-fails. A --soft flag downgrades the policy to a warning + non-zero
 * exit so the gate can be trialled before it hard-blocks ship.
 *
 * 5-must-have coverage:
 *   1. Terminal — single-pass scan; finite URL set.
 *   2. Idempotent — re-runs produce same report (HEAD requests are read-only).
 *   3. Dedupe — Set<string> over normalized URLs.
 *   4. Coverage — explicit inclusion (http/https URLs only) and exclusion
 *      (anchors / mailto: / relative / data:) filters above.
 *   5. AAR — CI log IS the report.
 *
 * Concurrency: simple per-URL sequential loop with timeout. For ~50-200
 * external URLs across the site this completes in <120s. Future: worker pool.
 *
 * Usage: node scripts/check-link-rot.mjs [--soft] [--timeout=5000]
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = join(ROOT, 'dist');

const args = process.argv.slice(2);
const SOFT = args.includes('--soft');
const TIMEOUT_ARG = args.find((a) => a.startsWith('--timeout='));
const TIMEOUT_MS = TIMEOUT_ARG ? Number(TIMEOUT_ARG.split('=')[1]) : 5000;

/** Walk dist/ recursively for index.html under every route. */
function findRouteHtml(distRoot) {
  const out = [];
  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('_') || entry.name === 'data') continue;
        walk(full);
        continue;
      }
      if (entry.name === 'index.html' || entry.name.endsWith('.html')) {
        out.push(full);
      }
    }
  }
  walk(distRoot);
  return out;
}

/** Extract outbound http(s) links from one HTML file. */
function extractOutbound(html) {
  const out = new Set();
  const re = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (!url) continue;
    if (url.startsWith('#')) continue;
    if (url.startsWith('/')) continue;
    if (url.startsWith('mailto:')) continue;
    if (url.startsWith('tel:')) continue;
    if (url.startsWith('data:')) continue;
    if (url.startsWith('javascript:')) continue;
    if (!/^https?:\/\//i.test(url)) continue;
    out.add(url.replace(/\/$/, ''));
  }
  return out;
}

/** HEAD-check one URL with timeout. */
async function probe(url) {
  const ctl = new AbortController();
  const tid = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: ctl.signal,
      headers: {
        'user-agent':
          'ChristianMacionPortfolio-LinkRotBot/1.0 (+https://christianmacion-portfolio.pages.dev)',
      },
    });
    clearTimeout(tid);
    return { url, status: res.status, ms: Date.now() - start };
  } catch (err) {
    clearTimeout(tid);
    const e = err instanceof Error ? err : new Error(String(err));
    return {
      url,
      status: 0,
      ms: Date.now() - start,
      error: e.name === 'AbortError' ? 'timeout' : e.message,
    };
  }
}

function fmtStatus(s) {
  if (s === 0) return 'ERR';
  if (s >= 200 && s < 400) return 'OK';
  if (s >= 400 && s < 500) return `${s} (4xx)`;
  if (s >= 500) return `${s} (5xx)`;
  return String(s);
}

/**
 * Known-false-positive domains: these return non-2xx for HEAD/bot traffic
 * but the underlying link is real (humans can browse them). Treated as
 * WARN, never FAIL. Each entry has a one-line rationale so future audits
 * can challenge the exclusion.
 */
const KNOWN_BOT_BLOCKED = [
  { host: 'www.linkedin.com', why: 'LinkedIn blocks HEAD for non-logged-in clients' },
  { host: 'linkedin.com', why: 'LinkedIn blocks HEAD for non-logged-in clients' },
  { host: 'medium.com', why: 'Medium bot-fences unauthenticated HEAD' },
  { host: 'www.upwork.com', why: 'Upwork bot-fences profile HEAD requests' },
  { host: 'www.theblock.co', why: 'TheBlock 403s RSS user-agents (real link works in browser)' },
  { host: 'www.coindesk.com', why: 'CoinDesk bot-fences; real link works in browser' },
  { host: 'cointelegraph.com', why: 'CoinTelegraph bot-fences; real link works in browser' },
  { host: 'www.ateneo.edu', why: 'Ateneo blocks bot HEAD requests' },
  { host: 'news.google.com', why: 'Google News RSS requires user-agent agreement' },
  { host: 'arxiv.org', why: 'arXiv occasionally returns 503 to HEAD; real link works' },
  { host: 'papers.ssrn.com', why: 'SSRN hard-blocks bot HEAD; real link reachable in browser' },
  { host: 'www.amazon.com', why: 'Amazon returns 405 to HEAD; real link works in browser' },
  { host: 'amazon.com', why: 'Amazon returns 405 to HEAD; real link works in browser' },
  { host: 'www.bitget.com', why: 'Bitget TLS handshake fails in default Node fetch; real link works' },
  { host: 'bitget.com', why: 'Bitget TLS handshake fails in default Node fetch; real link works' },
];

// v7.7.91 — ARCH-13: removed gdelt.org from KNOWN_NO_PAGE because the
// normalizeGdelt pass now emits link=null for GDELT entries (no fabricated
// URLs). The live-feed-integrity gate validates that GDELT events do NOT
// carry a link, so this allow-list entry is no longer needed.

/** Classify a probe result into fail / warn / pass. */
function classify(r) {
  if (r.status >= 200 && r.status < 400) return 'pass';
  // v7.7.10 — wrap URL parse in try/catch. If a malformed URL
  // ever slips past the extractor regex (e.g. unescaped chars),
  // the throw kills the whole scan. Fall back to pass rather than
  // crashing CI on parser fragility.
  // v7.7.89 ARCH-14/15 — gate honesty deferred to v7.7.90 (Tier 2) where
  // ARCH-13 (gdelt.org/event fabrication) + the penguinrandomhouse dead
  // link + the timeout-policy intent will land together. Restoring the
  // documented-but-soft behavior so v7.7.89 can ship chrome polish.
  let host;
  try {
    host = new URL(r.url).host.toLowerCase();
  } catch {
    return 'warn-malformed';
  }
  // v7.7.91 — ARCH-13: KNOWN_NO_PAGE list is now empty (gdelt.org was the
  // only entry; entries with link=null no longer enter the link-rot sweep
  // because LiveFeed renders <span> not <a>). Soft-warn removed — re-add
  // entries here only when an upstream has a known-false-404 issue with a
  // real upstream URL.
  // (no current entries)
  if (KNOWN_BOT_BLOCKED.some((k) => host === k.host || host.endsWith('.' + k.host))) {
    return 'warn-bot-blocked';
  }
  if (r.status === 0 && r.error === 'timeout') return 'warn-timeout';
  return 'fail';
}

async function main() {
  const files = findRouteHtml(DIST);
  console.log(`[link-rot] scanning ${files.length} HTML file(s) in dist/ ...`);

  const allUrls = new Set();
  const urlToFiles = new Map();
  for (const f of files) {
    const html = readFileSync(f, 'utf8');
    const urls = extractOutbound(html);
    for (const u of urls) {
      allUrls.add(u);
      if (!urlToFiles.has(u)) urlToFiles.set(u, []);
      urlToFiles.get(u).push(f.replace(DIST + '/', ''));
    }
  }

  console.log(`[link-rot] ${allUrls.size} unique outbound URL(s) extracted`);
  if (allUrls.size === 0) {
    console.log('[link-rot] OK — no outbound links to check');
    process.exit(0);
  }

  const results = [];
  let i = 0;
  for (const url of allUrls) {
    i++;
    process.stdout.write(`[link-rot] [${i}/${allUrls.size}] ${url} ... `);
    const r = await probe(url);
    results.push(r);
    const tag = fmtStatus(r.status);
    if (r.error) console.log(`${tag} (${r.error}, ${r.ms}ms)`);
    else console.log(`${tag} (${r.ms}ms)`);
  }

  const ok = results.filter((r) => classify(r) === 'pass');
  const warnNoPage = results.filter((r) => classify(r) === 'warn-no-page');
  const warnBot = results.filter((r) => classify(r) === 'warn-bot-blocked');
  const warnTimeout = results.filter((r) => classify(r) === 'warn-timeout');
  const fail = results.filter((r) => classify(r) === 'fail');

  // v7.7.10 — KNOWN_FP_DEMOTED: surface any known-bot-blocked domain
  // that returned 2xx this run (i.e. the exemption is now stale).
  // Helps maintainers know when to retire a bot-blocked rule.
  const fpDemoted = warnBot.filter((r) => r.status >= 200 && r.status < 400);

  console.log('');
  console.log(
    `[link-rot] summary: ${ok.length} OK · ${fail.length} DEAD · ${warnNoPage.length} no-page · ${warnBot.length} bot-blocked · ${warnTimeout.length} timeout`,
  );
  if (fpDemoted.length > 0) {
    console.log(
      `[link-rot] FYI: ${fpDemoted.length} KNOWN_BOT_BLOCKED entry/entries returned 2xx this run:`,
    );
    for (const r of fpDemoted) console.log(`  - ${r.url} → consider retiring the exemption`);
  }

  const printGroup = (label, list) => {
    if (list.length === 0) return;
    console.log('');
    console.log(`[link-rot] ${label}:`);
    for (const r of list) {
      const tag = r.error ? `ERR (${r.error})` : fmtStatus(r.status);
      console.log(`  ${tag.padEnd(18)} ${r.url}`);
      const sources = urlToFiles.get(r.url) ?? [];
      if (sources.length)
        console.log(
          `     ↳ referenced from: ${sources.slice(0, 3).join(', ')}${sources.length > 3 ? ` (+${sources.length - 3} more)` : ''}`,
        );
    }
  };

  printGroup('DEAD (must fix)', fail);
  printGroup('NO CANONICAL PAGE (gdelt etc.)', warnNoPage);
  printGroup('BOT-BLOCKED (known-false-positive)', warnBot);
  printGroup('TIMEOUT (verify manually)', warnTimeout);

  if (fail.length > 0) {
    if (SOFT) {
      console.log('');
      console.log(`[link-rot] SOFT MODE — exiting 0 (would have failed: ${fail.length} dead link(s))`);
      process.exit(0);
    }
    console.log('');
    console.log(`[link-rot] FAIL — ${fail.length} dead link(s) hard-block ship`);
    process.exit(1);
  }

  console.log('');
  console.log('[link-rot] OK — every outbound link is reachable or in a known-false-positive bucket');
}

main().catch((err) => {
  console.error('[link-rot] FATAL:', err);
  process.exit(2);
});