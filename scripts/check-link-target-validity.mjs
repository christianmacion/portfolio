// check-link-target-validity.mjs — v7.7.19 LINK-TARGET-VALIDITY CI GATE
//
// Catches broken internal cross-page links + cross-page anchors that the
// other gates miss:
//   - check-link-rot.mjs (v7.7.6)     — EXTERNAL href targets (HEAD-checks)
//   - check-anchor-rot.mjs (v7.7.12)  — INTRA-page hash targets (#foo on same page)
//   - check-link-target-validity.mjs  — INTERNAL cross-page + cross-page anchors
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
//
// Exits 1 on any fail. Exits 0 otherwise.
// Used in: npm run ci (after anchor:rot, before live:integrity).

import { readFile, readdir } from 'node:fs/promises';
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
// So when checking resolvedPath "portfolio/foo", we strip the prefix and
// check "foo" against the known set; and vice versa.
function checkResolved(resolvedPath, knownRoutes) {
  if (resolvedPath === '') {
    return knownRoutes.has('') ? { ok: true, target: '' } : { ok: false, target: '' };
  }
  if (knownRoutes.has(resolvedPath)) {
    return { ok: true, target: resolvedPath };
  }
  // Try stripping the GH-Pages basePath prefix
  if (resolvedPath === 'portfolio') {
    // bare /portfolio/ href → maps to root
    if (knownRoutes.has('')) return { ok: true, target: '' };
  }
  const stripped = resolvedPath.replace(/^portfolio\//, '');
  if (stripped !== resolvedPath && knownRoutes.has(stripped)) {
    return { ok: true, target: stripped };
  }
  // Try adding the prefix (if href dropped it but we're on GH build)
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
      issues.push({
        rule: 'broken-internal-href',
        msg: `href="${href}" → resolved path "${resolved.resolvedPath}" does not exist in dist/`,
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

  return {
    route: currentRoute,
    hrefCount: hrefs.length,
    issues,
  };
}

async function main() {
  console.log(
    '=== Link-Target-Validity Audit (v7.7.19) — internal cross-page + cross-page anchors ===\n',
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

  console.log(
    `Scanned ${findings.length} route(s) · ${totalHrefs} internal href(s) · ${totalIssues} broken link(s) across ${failing.length} route(s)\n`,
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