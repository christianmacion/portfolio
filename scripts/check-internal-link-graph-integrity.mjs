// check-internal-link-graph-integrity.mjs — v7.7.28 INTERNAL-LINK-GRAPH-INTEGRITY CI GATE
//
// Catches dangling nav/footer links before ship. Currently cross-page nav
// is checked transitively via link:target:validity (v7.7.19) — but only
// for links that appear IN a page's HTML. Nav links that appear in
// BaseLayout/Nav/Footer but never get re-rendered into any page's href
// list would slip through. This gate scans nav + footer components
// directly and verifies each anchor resolves to a real dist/**/index.html.
//
// Companion gates:
//   - scripts/check-link-target-validity.mjs  (v7.7.19) — in-page hrefs
//   - scripts/check-build-output-integrity.mjs (v7.7.27) — dist/ shape
//
// Rules enforced:
//   1. src/components/Nav.astro MUST exist (presence)
//   2. src/components/Footer.astro MUST exist (presence)
//   3. Every `path('/...')` literal in Nav.astro + Footer.astro + NavMore.astro
//      MUST resolve to a real dist/**/index.html (excludes mailto/tel/external)
//   4. Anchor count MUST be ≥ 25 (sanity: nav should have many links, not just 3)
//
// Exits 1 on any fail. Exits 0 otherwise.
// Used in: npm run ci (after build:output:integrity, before audit).

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const NAV_FILES = [
  'src/components/Nav.astro',
  'src/components/Footer.astro',
  'src/components/NavMore.astro',
];
const DIST = 'dist';
const GH_BASEPATH_PREFIX = 'portfolio';

// Extract all `path('/...')` literals — handles both single + double quotes.
const PATH_LITERAL_RE = /path\(\s*(['"])(\/[^'"]*?)\1\s*\)/g;

// Extract `href={path('/...')}` (handled by the same regex — path() is the helper).

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === 'data' || (e.name.startsWith('_') && e.isDirectory())) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else yield full;
  }
}

async function loadAllRoutes() {
  const routes = new Set();
  for await (const f of walk(DIST)) {
    // Routes can be either HTML pages or static files served from public/
    // (e.g. /humans.md, /llms.txt, /llms-full.txt, /favicon.svg, etc.)
    if (
      f.endsWith('index.html') ||
      f.match(/\.(md|txt|xml|pdf|svg|png|jpg|jpeg|ico|webp|css|js)$/i)
    ) {
      routes.add(f);
    }
  }
  return routes;
}

// Normalize an href to its dist-relative file. Handles bare-portfolio
// mapping, GH-prefix tolerance, and trailing slash.
function hrefToDistPath(href, allRoutes) {
  // Strip query/fragment
  const clean = href.split('?')[0].split('#')[0];
  if (!clean || clean === '/') return 'dist/index.html';

  // Strip leading slash
  let path = clean.replace(/^\//, '');
  const isBareFile = path.match(/\.[a-z0-9]+$/i); // /humans.md, /favicon.svg, etc.

  if (isBareFile) {
    // Try bare file as-is, then with /portfolio/ prefix
    const candidates = [`dist/${path}`, `dist/${GH_BASEPATH_PREFIX}/${path}`];
    for (const c of candidates) {
      if (allRoutes.has(c)) return c;
    }
    return null;
  }

  // Directory-style routes — normalize trailing slash
  if (!path.endsWith('/')) path = path + '/';

  // Try as-is (mirror build)
  const candidates = [
    `dist/${path}index.html`,
    `dist/${GH_BASEPATH_PREFIX}/${path}index.html`, // GH build
  ];

  for (const c of candidates) {
    if (allRoutes.has(c)) return c;
  }

  // Wildcard match: scan for routes that START with this prefix
  // (e.g. /projects → dist/projects/some-slug/index.html)
  for (const route of allRoutes) {
    const routeUrl = '/' + route.slice(5).replace(/\/index\.html$/, '/');
    if (routeUrl === clean || routeUrl === clean + '/') return route;
  }

  return null; // not found
}

async function audit() {
  const issues = [];
  const anchors = new Map(); // href → [{file, line}]

  // Rule 1 — Nav.astro present
  if (!existsSync(NAV_FILES[0])) {
    issues.push({ rule: 'missing-nav-file', msg: `${NAV_FILES[0]} does not exist` });
    return { issues, anchors };
  }
  // Rule 2 — Footer.astro present
  if (!existsSync(NAV_FILES[1])) {
    issues.push({ rule: 'missing-footer-file', msg: `${NAV_FILES[1]} does not exist` });
    return { issues, anchors };
  }

  // Collect all path() literals from nav files
  for (const file of NAV_FILES) {
    if (!existsSync(file)) continue;
    const text = await readFile(file, 'utf8');
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m;
      PATH_LITERAL_RE.lastIndex = 0;
      while ((m = PATH_LITERAL_RE.exec(line)) !== null) {
        const href = m[2];
        if (!anchors.has(href)) anchors.set(href, []);
        anchors.get(href).push({ file, line: i + 1 });
      }
    }
  }

  // Rule 4 — sanity: ≥ 25 anchors (catches accidental nav wipe)
  if (anchors.size < 25) {
    issues.push({
      rule: 'low-anchor-count',
      msg: `Only ${anchors.size} anchors found in nav files (expected ≥ 25 — nav may have been wiped)`,
    });
  }

  // Rule 3 — every anchor resolves to a real dist route
  const allRoutes = await loadAllRoutes();
  const failing = [];
  for (const [href, sources] of anchors.entries()) {
    // Skip mailto/tel/external anchors (already filtered by regex but be safe)
    if (href.startsWith('mailto:') || href.startsWith('tel:')) continue;
    const resolved = hrefToDistPath(href, allRoutes);
    if (!resolved) {
      failing.push({ href, sources });
    }
  }

  if (failing.length > 0) {
    for (const f of failing) {
      for (const src of f.sources) {
        issues.push({
          rule: 'dangling-nav-anchor',
          msg: `href="${f.href}" in ${src.file}:${src.line} does not resolve to any dist/**/index.html`,
        });
      }
    }
  }

  return { issues, anchors };
}

async function main() {
  console.log(
    '=== Internal-Link-Graph-Integrity Audit (v7.7.28) — Nav + Footer href resolution ===\n',
  );

  const { issues, anchors } = await audit();

  console.log(
    `Scanned ${NAV_FILES.length} nav files · ${anchors.size} unique anchors · ${issues.length} issue(s)\n`,
  );

  if (issues.length === 0) {
    console.log(`✓ All ${anchors.size} nav anchors resolve to real dist routes.`);
    return;
  }

  const byRule = new Map();
  for (const i of issues) {
    if (!byRule.has(i.rule)) byRule.set(i.rule, []);
    byRule.get(i.rule).push(i.msg);
  }
  for (const [rule, msgs] of byRule) {
    console.log(`\n[${rule}] — ${msgs.length} site(s):`);
    for (const m of msgs) {
      console.log(`  ${m}`);
    }
  }

  console.error(`\nFAIL — ${issues.length} internal-link-graph-integrity issue(s).`);
  process.exit(1);
}

main().catch((e) => {
  console.error('internal-link-graph-integrity scan crashed:', e);
  process.exit(2);
});
