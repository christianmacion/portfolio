// scripts/validate-sitemap.ts — sitemap-valid gate (v7.24).
//
// Three-phase validation against the sitemap.org schema:
//
//   Phase 1 — extract every <loc> from sitemap-index.xml + sitemap-0.xml
//             and verify the corresponding dist/<path>/index.html exists.
//   Phase 2 — orphan detection: walk every dist/**/index.html and flag any
//             route that isn't in the sitemap (a route that ships but
//             Google can't find). Excludes _astro / _pagefind / .json / etc.
//   Phase 3 — canonical check: every dist/<route>/index.html must carry a
//             <link rel="canonical"> so search engines de-duplicate
//             www vs non-www, trailing-slash vs no-slash variants.
//
// Also flags duplicate <loc> entries within a single sitemap.
//
// Exits 1 on any violation. Used in: npm run ci (final gate).

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist');

// Routes to exclude from orphan detection (technical, not page routes).
const EXCLUDED_TOP_ROUTES = new Set(['_astro', '_pagefind']);

interface SitemapReport {
  locs: Set<string>; // normalized pathnames from <loc>
  duplicates: string[]; // <loc> values that appeared more than once
}

function extractLocs(xml: string): { locs: Set<string>; duplicates: string[] } {
  const locs = new Set<string>();
  const counts = new Map<string, number>();
  const duplicates: string[] = [];
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const raw = m[1];
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
    try {
      const u = new URL(raw);
      // Strip the configurable base path so that orphan detection works
      // for both `npm run build` (BASE_PATH=/portfolio/...) and
      // `npm run build:mirror` (BASE_PATH=/) without flagging false orphans.
      const stripped = u.pathname.replace(/^\/(?:portfolio|portfolio\/)/, '');
      const normalized = stripped.replace(/\/$/, '') || '/';
      locs.add(normalized);
    } catch {
      // skip — caught by malformed-URL check below
    }
  }
  for (const [loc, count] of counts) {
    if (count > 1) duplicates.push(`${loc} (×${count})`);
  }
  return { locs, duplicates };
}

const violations: string[] = [];
const reports: SitemapReport[] = [];

function validate(file: string): void {
  const full = join(distDir, file);
  if (!existsSync(full)) {
    violations.push(`Missing ${file} — astro build did not produce a sitemap`);
    return;
  }

  const xml = readFileSync(full, 'utf-8');

  if (!/<urlset|<sitemapindex/.test(xml)) {
    violations.push(`${file}: missing <urlset> or <sitemapindex> root element`);
    return;
  }

  const { locs, duplicates } = extractLocs(xml);
  if (locs.size === 0) {
    violations.push(`${file}: no <loc> entries found`);
    return;
  }
  reports.push({ locs, duplicates });
  for (const dup of duplicates) {
    violations.push(`${file}: duplicate <loc>${dup}</loc>`);
  }

  for (const loc of [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])) {
    try {
      const u = new URL(loc);
      const pathPart = u.pathname.replace(/^\/portfolio/, '');
      const fsPath = join(distDir, pathPart, 'index.html');
      if (!existsSync(fsPath)) {
        const fsPath2 = join(distDir, pathPart);
        if (!existsSync(fsPath2)) {
          violations.push(`${file}: <loc>${loc}</loc> does not resolve to a dist/ file`);
        }
      }
    } catch {
      violations.push(`${file}: malformed URL ${loc}`);
    }
  }
}

console.log('[sitemap-valid] scanning dist/ ...');

validate('sitemap-index.xml');
validate('sitemap-0.xml');

// Phase 2 — orphan detection: every dist/<route>/index.html should be in
// at least one sitemap. Top-level dirs we exclude are technical bundles.
function walkDistRoutes(dir: string, base = ''): string[] {
  const routes: string[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return routes;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) {
      routes.push(...walkDistRoutes(full, rel));
    } else if (e.name === 'index.html') {
      // dist/index.html → '/',  dist/<route>/index.html → '/<route>'
      const routePath = rel === 'index.html' ? '/' : '/' + rel.replace(/\/index\.html$/, '');
      routes.push(routePath);
    }
  }
  return routes;
}

const distRoutes = walkDistRoutes(distDir);
const allLocs = new Set<string>();
for (const r of reports) for (const l of r.locs) allLocs.add(l);

const orphans: string[] = [];
for (const route of distRoutes) {
  const top = route.split('/')[1]; // /<top>/<sub>
  if (EXCLUDED_TOP_ROUTES.has(top)) continue;
  const normalized = route.replace(/\/$/, '') || '/';
  if (!allLocs.has(normalized)) {
    orphans.push(route);
  }
}
if (orphans.length > 0) {
  for (const o of orphans) violations.push(`orphan route (in dist/ but not in sitemap): ${o}`);
}

// Phase 3 — canonical link check. Every index.html that ships should declare
// its canonical URL so search engines de-duplicate trailing-slash variants.
function checkCanonicals(dir: string, base = ''): void {
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) {
      checkCanonicals(full, rel);
    } else if (e.name === 'index.html') {
      const html = readFileSync(full, 'utf-8');
      const routePath = '/' + rel.replace(/\/index\.html$/, '');
      const top = routePath.split('/')[1];
      if (EXCLUDED_TOP_ROUTES.has(top)) continue;
      if (!/<link\s+rel=["']canonical["']/i.test(html)) {
        violations.push(`missing <link rel="canonical"> in ${rel}`);
      }
    }
  }
}
checkCanonicals(distDir);

// Report
console.log(`[sitemap-valid] sitemap URLs:    ${allLocs.size}`);
console.log(`[sitemap-valid] dist routes:     ${distRoutes.length}`);
const orphanTech = distRoutes.filter((r) => EXCLUDED_TOP_ROUTES.has(r.split('/')[1])).length;
console.log(`[sitemap-valid] excluded (tech): ${orphanTech}`);

if (violations.length) {
  console.error('\n[sitemap-valid] VIOLATIONS:');
  for (const v of violations) console.error(`  ✗ ${v}`);
  console.error(`\n[sitemap-valid] FAIL — ${violations.length} violation(s).`);
  process.exit(1);
} else {
  console.log('\n[sitemap-valid] OK — sitemap complete, orphans checked, canonicals present.');
}
