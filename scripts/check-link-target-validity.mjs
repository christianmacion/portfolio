// check-link-target-validity.mjs — v7.7.19 + v7.7.55 LINK-TARGET-VALIDITY CI GATE
//
// Catches broken internal cross-page links + cross-page anchors + non-href
// source attributes that the other gates miss:
//   - check-link-rot.mjs (v7.7.6)              — EXTERNAL href targets (HEAD-checks)
//   - check-anchor-rot.mjs (v7.7.12)           — INTRA-page hash targets (#foo on same page)
//   - check-link-target-validity.mjs           — INTERNAL cross-page + cross-page anchors
//                                                  + src / poster / <track src> (v7.7.55)
//
// Rules enforced (per dist/**/index.html):
//   1. Every href="/foo" or href="/foo/" or href="../foo" or href="./foo"
//      must resolve to a route that exists in dist/. Specifically:
//      - Normalize the href to a dist-relative path
//      - The path must exist (as either index.html under a directory, or
//        a static file)
//   2. Every href="/foo#bar" must:
//      - Have route /foo exist in dist/ (per rule 1)
//      - If /foo exists, /foo must contain an element with id="bar" (the
//        target page must declare the anchor)
//   3. mailto: and tel: hrefs are allow-listed (out of scope)
//   4. External (http/https) hrefs are out of scope (link-rot handles those)
//   5. Same-page anchors (#foo) are out of scope (anchor-rot handles those)
//   6. href="#" / href="" allow-listed (scroll-to-top / no-op)
//   7. href="javascript:" allow-listed (framework placeholders)
//   8. href starting with "data:" allow-listed (data URIs)
//   9. v7.7.55 — Every src="/proof/foo.mp4", poster="/proof/foo.jpg",
//      <track src="/proof/foo.vtt">, <source src="/proof/foo.webp">
//      must resolve to a file that exists in dist/. These attributes are
//      structurally different from href because raw markdown content files
//      (e.g. src/content/experience/*.md) cannot use the Astro path() helper
//      and used to ship with hardcoded /portfolio/ prefixes — Lighthouse
//      caught 6 broken media assets on /experience as a result.
//
// Prefix tolerance is build-aware as of v7.7.55:
//   - If process.env.BASE_PATH is set (canonical at build time), only the
//     matching prefix is accepted. /portfolio/ is rejected on a / build, and
//     a missing prefix is rejected on a /portfolio/ build.
//   - If BASE_PATH is unset (legacy fallback), both forms are accepted.
//
// Exits 1 on any fail. Exits 0 otherwise.
// Used in: npm run ci (after anchor:rot, before live:integrity).

import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';

const DIST = 'dist';
const _CANONICAL_HOSTS = new Set([
  'christianmacion-portfolio.pages.dev',
  'christianmacion26.github.io',
]);

// Allow-list for hrefs that don't reference a target.
const HASH_SKIP = new Set(['', '!', 'main', 'top']);

// Schemes we don't validate (out of scope for this gate).
const SKIP_SCHEMES = new Set(['mailto:', 'tel:', 'javascript:', 'data:']);

// v7.7.55 — Build-aware prefix tolerance.
//   - BASE_PATH=/ (mirror build on Cloudflare Pages)   → /portfolio/ URLs MUST fail
//   - BASE_PATH=/portfolio (GH-Pages build)             → unprefixed URLs MUST fail
//   - BASE_PATH unset (auto-detect from dist/)         → scan dist/ for /portfolio/ refs
//   - BASE_PATH unset + no dist signal (legacy fallback) → both forms accepted
const BUILD_BASE_PATH = process.env.BASE_PATH || ''; // '' | '/' | '/portfolio'

// Auto-detect canonical prefix from dist/ when BASE_PATH is not explicit.
// If any dist/*.html file contains "/portfolio/" hrefs/srcs, the build is
// using /portfolio/ as the base — so accept only /portfolio/ URLs.
// Otherwise (Cloudflare Pages mirror build), accept only unprefixed URLs.
function detectCanonicalPrefix() {
  if (BUILD_BASE_PATH === '/portfolio') return 'portfolio/';
  if (BUILD_BASE_PATH === '/' || BUILD_BASE_PATH === '') {
    // BASE_PATH empty or '/' — could be either. Auto-detect.
    // Probe dist/index.html for /portfolio/ signal.
    try {
      const idxHtml = readFileSync(join(DIST, 'index.html'), 'utf8');
      // Look for href="/portfolio/" or src="/portfolio/" — definitive
      // signal that the build used the GH-Pages prefix.
      if (/\b(href|src)\s*=\s*["']\/portfolio\//i.test(idxHtml)) {
        return 'portfolio/';
      }
    } catch {
      // no dist/index.html — fall through
    }
  }
  return ''; // mirror build or no signal — unprefixed URLs are canonical
}

const CANONICAL_PREFIX = detectCanonicalPrefix();

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === 'data') continue; // skip data/
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else yield full;
  }
}

// Build a Set of all known routes (relative to dist/).
// - For directory with index.html → "foo/bar" (no trailing /)
// - For static file → "foo/bar.html"
// - Includes _astro/* (hashed asset references like /_astro/BaseLayout.24BolUMw.css
//   must resolve; the page only loads if the asset exists)
async function buildKnownRoutes() {
  const routes = new Set();

  async function walkRoutes(dir, prefix) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name === 'data') continue;
      const full = join(dir, e.name);
      const childPrefix = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        // Check for index.html inside
        try {
          await readFile(join(full, 'index.html'));
          routes.add(childPrefix); // directory-with-index → represent by dir path
        } catch {
          // no index.html — recurse, contents might be other routes
        }
        await walkRoutes(full, childPrefix);
      } else if (e.name === 'index.html' && prefix) {
        // already added above when checking the parent dir
        continue;
      } else if (e.name.endsWith('.html')) {
        routes.add(childPrefix);
      } else {
        // static asset (CSS, JS, images, etc.) — track so href="/_astro/...css" works
        routes.add(childPrefix);
      }
    }
  }

  // Register root route first — href="/" → ""
  try {
    await readFile(join(DIST, 'index.html'));
    routes.add('');
  } catch {
    // no root index.html
  }

  await walkRoutes(DIST, '');
  return routes;
}

// Strip <script>...</script> blocks before scanning. Without this,
// the scanner matches template literals like `href="/foo/${bar}"` that
// are inside inline JS — false positives on every page that has a
// client-side dynamic link builder.
function stripScripts(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

// Extract all <a href="..."> from a route. Skips:
//   - mailto:, tel:, javascript:, data:
//   - external http/https
//   - empty / skip-list hashes
function extractHrefs(html) {
  const scan = stripScripts(html);
  const re = /\bhref\s*=\s*["']([^"']+)["']/gi;
  const out = [];
  let m;
  while ((m = re.exec(scan)) !== null) {
    const href = m[1].trim();
    if (!href) continue;
    if (HASH_SKIP.has(href.replace(/^#/, ''))) continue;
    // Skip schemes we don't validate
    const lower = href.toLowerCase();
    let isExternal = false;
    for (const scheme of SKIP_SCHEMES) {
      if (lower.startsWith(scheme)) {
        isExternal = true;
        break;
      }
    }
    if (isExternal) continue;
    if (lower.startsWith('http://') || lower.startsWith('https://')) continue;
    out.push(href);
  }
  return out;
}

// v7.7.55 — Extract src/poster/<track src>/<source src>/<iframe src> attributes.
// These are the media source attributes that broke silently on /experience
// when raw markdown content shipped with hardcoded /portfolio/ prefixes.
// Returns [{ attr, value, line, snippet }] so auditRoute can apply the same
// route-resolution + prefix-tolerance logic as href.
//
// Skips:
//   - srcset (covered by image:dimension-attributes / picture:* gates)
//   - javascript: / data: schemes (not file refs)
//   - external http/https (out of scope)
//   - dynamic template literals like src="${base}/foo" — flagged but as
//     a separate "dynamic-src-not-validated" rule rather than a hard fail
function extractSrcAttrs(html) {
  const scan = stripScripts(html);
  // Match <img src>, <video src>, <audio src>, <iframe src>, and <track|src> inside <track|audio|video>.
  // The HTML5 void elements + <iframe> use src as a top-level attr;
  // <track> uses src as a top-level attr on its own; <source> uses src
  // for media fallback. <picture><source srcset> is covered by picture:* gates.
  // Use a quoted-string-aware pattern that captures the attr name too.
  const re = /\b(src|poster)\s*=\s*["']([^"']+)["']/gi;
  const out = [];
  let m;
  while ((m = re.exec(scan)) !== null) {
    const attr = m[1].toLowerCase();
    const value = m[2].trim();
    if (!value) continue;
    // Compute line number from offset
    let line = 1;
    for (let i = 0; i < m.index && i < scan.length; i++) {
      if (scan.charCodeAt(i) === 10) line++;
    }
    const lower = value.toLowerCase();
    if (lower.startsWith('javascript:')) continue;
    if (lower.startsWith('data:')) continue;
    if (lower.startsWith('http://') || lower.startsWith('https://')) continue;
    out.push({ attr, value, line, snippet: `${attr}="${value}"` });
  }
  // Also catch <track src="..."> — same regex above already catches it
  // because <track> uses src= as a top-level attribute. Verified.
  return out;
}

// Resolve an href relative to the current route's path.
// currentRoute is a dist-relative path like "projects/ai/01-rag-recall/index.html".
// Returns: { kind: 'route'|'hash-only'|'cross-route-hash', resolvedPath: 'foo/bar',
//            hash?: 'baz' } or null if unresolvable (e.g. absolute external).
function resolveHref(currentRoute, href) {
  // Strip fragment
  const hashIdx = href.indexOf('#');
  const hash = hashIdx >= 0 ? href.slice(hashIdx + 1) : null;
  const pathPart = hashIdx >= 0 ? href.slice(0, hashIdx) : href;

  // Skip query strings for route resolution (but keep them in the record)
  const qIdx = pathPart.indexOf('?');
  const cleanPath = qIdx >= 0 ? pathPart.slice(0, qIdx) : pathPart;

  if (!cleanPath) {
    // href="#foo" → same-page hash, out of scope (anchor-rot)
    return null;
  }

  let resolvedPath;
  if (cleanPath.startsWith('/')) {
    // Absolute path within site — strip leading slash
    resolvedPath = cleanPath.replace(/^\/+/, '');
  } else {
    // Relative path — resolve against currentRoute's directory
    const curDir = dirname(currentRoute);
    resolvedPath = normalize(join(curDir, cleanPath)).replace(/^[/]+/, '');
  }

  // Normalize: strip trailing slash (except for root)
  resolvedPath = resolvedPath.replace(/\/+$/, '');
  if (resolvedPath === '') resolvedPath = '';

  return {
    kind: hash ? 'cross-route-hash' : 'route',
    resolvedPath,
    hash,
  };
}

// Check if a resolved path corresponds to a real route in the known set.
// Returns: { ok: boolean, target: string } — `target` is the actual key found.
//
// Two URL conventions exist in dist/ HTML:
//   - GH Pages build: hrefs retain the /portfolio/ prefix (site is hosted at
//     github.io/portfolio/) — resolved path "portfolio/foo"
//   - Mirror build: hrefs strip the prefix (site is hosted at
//     christianmacion-portfolio.pages.dev/) — resolved path "foo"
//
// v7.7.55 — build-aware. If BASE_PATH is set, only the matching prefix
// form is accepted (so a stale /portfolio/ URL fails on a mirror build,
// and an unprefixed URL fails on a GH-Pages build). If BASE_PATH is unset
// (legacy fallback), both forms are still accepted for portability.
function checkResolved(resolvedPath, knownRoutes) {
  if (resolvedPath === '') {
    return knownRoutes.has('') ? { ok: true, target: '' } : { ok: false, target: '' };
  }
  if (knownRoutes.has(resolvedPath)) {
    return { ok: true, target: resolvedPath };
  }

  // v7.7.55 — Build-aware prefix handling.
  // Special case: bare "portfolio" path maps to the GH-Pages site root
  // (href="/portfolio/" → knownRoutes['']).
  const hasPortfolioPrefix =
    resolvedPath === 'portfolio' || resolvedPath.startsWith('portfolio/');
  const bare = hasPortfolioPrefix ? resolvedPath.replace(/^portfolio\/?/, '') : resolvedPath;

  if (CANONICAL_PREFIX === '') {
    // Mirror build (BASE_PATH=/) — /portfolio/ URLs MUST fail.
    // Unprefixed URLs are the only valid form.
    if (hasPortfolioPrefix) {
      // Surface a more diagnostic message: was a /portfolio/ prefix used on
      // a mirror build? Tell the author to strip it.
      return { ok: false, target: resolvedPath, stalePrefix: 'portfolio/' };
    }
    if (knownRoutes.has(bare)) {
      return { ok: true, target: bare };
    }
    return { ok: false, target: resolvedPath };
  }

  if (CANONICAL_PREFIX === 'portfolio/') {
    // GH-Pages build (BASE_PATH=/portfolio) — unprefixed URLs MUST fail.
    // /portfolio/ URLs are the only valid form. Bare "portfolio" maps to root.
    if (resolvedPath === 'portfolio' || bare === '') {
      return knownRoutes.has('') ? { ok: true, target: '' } : { ok: false, target: resolvedPath };
    }
    if (!hasPortfolioPrefix) {
      return { ok: false, target: resolvedPath, missingPrefix: 'portfolio/' };
    }
    if (knownRoutes.has(bare)) {
      return { ok: true, target: bare };
    }
    if (knownRoutes.has(`portfolio/${bare}`)) {
      return { ok: true, target: `portfolio/${bare}` };
    }
    return { ok: false, target: resolvedPath };
  }

  // Legacy fallback — accept both forms for portability
  if (hasPortfolioPrefix) {
    if (resolvedPath === 'portfolio') {
      if (knownRoutes.has('')) return { ok: true, target: '' };
    }
    if (knownRoutes.has(bare)) {
      return { ok: true, target: bare };
    }
  }
  if (knownRoutes.has(resolvedPath)) {
    return { ok: true, target: resolvedPath };
  }
  if (knownRoutes.has(`portfolio/${resolvedPath}`)) {
    return { ok: true, target: `portfolio/${resolvedPath}` };
  }
  return { ok: false, target: resolvedPath };
}

// Extract all `id="..."` values from a known HTML route.
// Used to verify cross-page anchors (#foo on /bar → /bar must have id="foo").
async function extractIds(routeFile) {
  let html;
  try {
    html = await readFile(join(DIST, routeFile), 'utf8');
  } catch {
    return new Set();
  }
  const scan = stripScripts(html);
  const re = /\bid\s*=\s*["']([^"']+)["']/gi;
  const out = new Set();
  let m;
  while ((m = re.exec(scan)) !== null) {
    out.add(m[1]);
  }
  return out;
}

function auditRoute(currentRoute, html, knownRoutes) {
  const issues = [];
  const hrefs = extractHrefs(html);
  const seen = new Set(); // dedupe hrefs within a page

  for (const href of hrefs) {
    if (seen.has(href)) continue;
    seen.add(href);

    const resolved = resolveHref(currentRoute, href);
    if (!resolved) continue; // same-page hash or other out-of-scope

    // Rule 1 — route must exist
    const routeCheck = checkResolved(resolved.resolvedPath, knownRoutes);
    if (!routeCheck.ok) {
      const extra = routeCheck.stalePrefix
        ? ` (stale ${routeCheck.stalePrefix} prefix on a mirror build — strip it)`
        : routeCheck.missingPrefix
          ? ` (missing ${routeCheck.missingPrefix} prefix on a GH-Pages build — add it or use Astro path())`
          : '';
      issues.push({
        rule: 'broken-internal-href',
        msg: `href="${href}" → resolved path "${resolved.resolvedPath}" does not exist in dist/${extra}`,
        href,
        resolved: resolved.resolvedPath,
      });
      continue;
    }

    // Rule 2 — for cross-route anchors, target page must declare the id
    if (resolved.kind === 'cross-route-hash' && resolved.hash) {
      // Note: extractIds is async; we'll collect these in main() instead
      issues.push({
        rule: 'cross-page-anchor-pending', // re-classified after async check
        msg: `href="${href}" → cross-page anchor check pending`,
        href,
        resolvedPath: routeCheck.target,
        hash: resolved.hash,
      });
    }
  }

  // v7.7.55 — also audit src/poster/<track src>/<source src> attrs against
  // the same known-routes set. These are the media source attributes that
  // /experience shipped broken for (raw markdown with hardcoded /portfolio/
  // prefixes bypassed the path() helper and the previous gate).
  const srcAttrs = extractSrcAttrs(html);
  const seenSrc = new Set();
  for (const s of srcAttrs) {
    const key = `${s.attr}=${s.value}`;
    if (seenSrc.has(key)) continue;
    seenSrc.add(key);

    // src on <track> can include the .vtt path; src on <img>/<video> etc
    // resolves via the same path logic as href (rooted at currentRoute).
    const srcValue = s.value.replace(/^\.\//, ''); // strip ./ prefix
    // src/poster/track src cannot be hash-only — must be a path
    const qIdx = srcValue.indexOf('?');
    const cleanPath = qIdx >= 0 ? srcValue.slice(0, qIdx) : srcValue;
    let resolvedPath;
    if (cleanPath.startsWith('/')) {
      resolvedPath = cleanPath.replace(/^\/+/, '').replace(/\/+$/, '');
    } else {
      const curDir = dirname(currentRoute);
      resolvedPath = normalize(join(curDir, cleanPath)).replace(/^[/]+/, '').replace(/\/+$/, '');
    }
    if (resolvedPath === '') resolvedPath = '';

    const routeCheck = checkResolved(resolvedPath, knownRoutes);
    if (!routeCheck.ok) {
      const extra = routeCheck.stalePrefix
        ? ` (stale ${routeCheck.stalePrefix} prefix on a mirror build — strip it)`
        : routeCheck.missingPrefix
          ? ` (missing ${routeCheck.missingPrefix} prefix on a GH-Pages build — add it or use Astro path())`
          : '';
      issues.push({
        rule: 'broken-internal-src',
        msg: `${s.snippet} → resolved path "${resolvedPath}" does not exist in dist/${extra}`,
        src: s.value,
        attr: s.attr,
        resolved: resolvedPath,
        line: s.line,
      });
    }
  }

  return {
    route: currentRoute,
    hrefCount: hrefs.length,
    srcCount: srcAttrs.length,
    issues,
  };
}

async function main() {
  console.log(
    '=== Link-Target-Validity Audit (v7.7.55) — internal cross-page + cross-page anchors + src/poster/track[src] ===\n',
  );

  // Build known routes once
  const knownRoutes = await buildKnownRoutes();
  console.log(`Known routes: ${knownRoutes.size}\n`);

  // Pre-compute id sets per route (for cross-page anchors)
  const idCache = new Map();
  for (const r of knownRoutes) {
    if (!r.endsWith('.html') && r !== '') {
      // directory route — has index.html inside
      idCache.set(r, await extractIds(join(r, 'index.html')));
    } else if (r.endsWith('.html')) {
      idCache.set(r, await extractIds(r));
    }
  }

  // Walk every route
  const findings = [];
  for await (const f of walk(DIST)) {
    if (!f.endsWith('index.html')) continue;
    const rel = f.slice(DIST.length + 1); // strip 'dist/'
    const html = await readFile(f, 'utf8');
    findings.push(auditRoute(rel, html, knownRoutes));
  }

  // Re-classify pending cross-page anchor issues
  const _finalIssues = [];
  for (const f of findings) {
    const realIssues = [];
    for (const i of f.issues) {
      if (i.rule === 'cross-page-anchor-pending') {
        const ids = idCache.get(i.resolvedPath) || new Set();
        if (!ids.has(i.hash)) {
          realIssues.push({
            rule: 'broken-cross-page-anchor',
            msg: `href="${i.href}" → target "${i.resolvedPath}" has no element with id="${i.hash}"`,
            href: i.href,
            resolvedPath: i.resolvedPath,
            hash: i.hash,
          });
        }
      } else {
        realIssues.push(i);
      }
    }
    findings[findings.indexOf(f)] = { ...f, issues: realIssues };
  }

  const failing = findings.filter((f) => f.issues.length > 0);
  const totalIssues = failing.reduce((n, f) => n + f.issues.length, 0);
  const totalHrefs = findings.reduce((n, f) => n + f.hrefCount, 0);
  const totalSrcs = findings.reduce((n, f) => n + f.srcCount, 0);

  console.log(
    `Scanned ${findings.length} route(s) · ${totalHrefs} internal href(s) · ${totalSrcs} src/poster/track src attr(s) · ${totalIssues} broken link(s) across ${failing.length} route(s)\n`,
  );

  if (totalIssues === 0) {
    console.log('✓ All internal hrefs resolve to real routes and cross-page anchors match.');
    return;
  }

  const byRule = new Map();
  for (const f of failing) {
    for (const i of f.issues) {
      if (!byRule.has(i.rule)) byRule.set(i.rule, []);
      byRule.get(i.rule).push({ route: f.route, msg: i.msg });
    }
  }
  for (const [rule, list] of byRule) {
    console.log(`\n[${rule}] — ${list.length} site(s):`);
    for (const x of list) {
      console.log(`  ${x.route}  →  ${x.msg}`);
    }
  }

  console.error(
    `\nFAIL — ${totalIssues} broken internal link(s) across ${failing.length} route(s).`,
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('link-target-validity scan crashed:', e);
  process.exit(2);
});