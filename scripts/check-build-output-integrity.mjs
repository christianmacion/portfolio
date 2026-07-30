// check-build-output-integrity.mjs — v7.7.27 BUILD-OUTPUT-INTEGRITY CI GATE
//
// Catches Astro build failures / silent route drops before ship. Currently
// we ship `npm run build` and trust the route count + subdir set; a build
// error, a typo in getStaticPaths(), or a missing content-collection entry
// can silently produce fewer routes (or none at all) without surfacing.
//
// Companion gates:
//   - scripts/check-sitemap-integrity.mjs   (v7.7.16) — sitemap URLs
//   - scripts/check-meta-integrity.mjs       (v7.7.14) — <meta> tags
//
// Rules enforced:
//   1. dist/ MUST exist (build succeeded)
//   2. dist/**/index.html count MUST match expected (currently 90)
//   3. dist/index.html (root) MUST exist
//   4. dist/404.html MUST exist
//   5. Every dynamic-route directory MUST be present:
//        - dist/projects/  (≥ 1 index.html)
//        - dist/research/  (≥ 1 index.html)
//        - dist/glossary/  (≥ 1 index.html)
//        - dist/workbooks/ (≥ 1 index.html)
//   6. dist/rss.xml MUST exist (RSS feed)
//   7. dist/_astro/ MUST exist with ≥ 1 hashed asset
//   8. dist/sitemap-index.xml or dist/sitemap-0.xml MUST exist
//
// Exits 1 on any fail. Exits 0 otherwise.
// Used in: npm run ci (after security:headers:integrity, before audit).

import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';

// Baseline counts — these match the route taxonomy as of v7.7.27.
// If you intentionally add a new route class, update the baseline + bump
// the gate version.
const EXPECTED = {
  totalRoutes: 90,
  rootIndex: 'dist/index.html',
  notFound: 'dist/404.html',
  rss: 'dist/feed.xml',
  sitemapAny: ['dist/sitemap-index.xml', 'dist/sitemap-0.xml'],
  dynamicDirs: {
    'dist/projects': 1, // ≥ 1 (index.astro)
    'dist/research': 1, // ≥ 1 (frontier-models.astro)
    'dist/glossary': 1, // ≥ 1 (term pages)
    'dist/workbooks': 1, // ≥ 1 (static HTML)
  },
  astroAssetDir: 'dist/_astro',
  minAstroAssets: 1,
};

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (
      e.name === 'data' ||
      (e.name.startsWith('_') && e.isDirectory() && e.name !== '_astro' && e.name !== '_pagefind')
    )
      continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else yield full;
  }
}

async function audit() {
  const issues = [];

  // Rule 1 — dist/ exists
  if (!existsSync(DIST)) {
    issues.push({
      rule: 'missing-dist',
      msg: `${DIST}/ does not exist (build may have failed silently)`,
    });
    return { issues };
  }

  // Rule 2 — total route count
  let routeCount = 0;
  for await (const f of walk(DIST)) {
    if (f.endsWith('index.html')) routeCount++;
  }
  if (routeCount !== EXPECTED.totalRoutes) {
    issues.push({
      rule: 'route-count-drift',
      msg: `Expected ${EXPECTED.totalRoutes} routes, found ${routeCount} (drift: ${routeCount - EXPECTED.totalRoutes}). A route was added or dropped silently — update the baseline if intentional.`,
    });
  }

  // Rule 3 — root index
  if (!existsSync(EXPECTED.rootIndex)) {
    issues.push({
      rule: 'missing-root',
      msg: `${EXPECTED.rootIndex} missing (root route dropped)`,
    });
  }

  // Rule 4 — 404
  if (!existsSync(EXPECTED.notFound)) {
    issues.push({ rule: 'missing-404', msg: `${EXPECTED.notFound} missing (404 route dropped)` });
  }

  // Rule 5 — dynamic-route directories
  for (const [dirPath, min] of Object.entries(EXPECTED.dynamicDirs)) {
    if (!existsSync(dirPath)) {
      issues.push({
        rule: 'missing-dynamic-dir',
        msg: `${dirPath}/ missing (dynamic-route directory dropped — likely a getStaticPaths error)`,
      });
      continue;
    }
    let count = 0;
    try {
      for await (const f of walk(dirPath)) {
        if (f.endsWith('index.html')) count++;
      }
    } catch (e) {
      issues.push({
        rule: 'dynamic-dir-unreadable',
        msg: `${dirPath}/ not readable: ${e.message}`,
      });
      continue;
    }
    if (count < min) {
      issues.push({
        rule: 'dynamic-dir-empty',
        msg: `${dirPath}/ has ${count} index.html (expected ≥ ${min})`,
      });
    }
  }

  // Rule 6 — RSS feed
  if (!existsSync(EXPECTED.rss)) {
    issues.push({ rule: 'missing-rss', msg: `${EXPECTED.rss} missing (RSS feed dropped)` });
  }

  // Rule 7 — _astro hashed assets
  if (!existsSync(EXPECTED.astroAssetDir)) {
    issues.push({
      rule: 'missing-astro-assets',
      msg: `${EXPECTED.astroAssetDir}/ missing (Astro produced no hashed assets — build broken)`,
    });
  } else {
    const entries = await readdir(EXPECTED.astroAssetDir);
    if (entries.length < EXPECTED.minAstroAssets) {
      issues.push({
        rule: 'no-astro-assets',
        msg: `${EXPECTED.astroAssetDir}/ has ${entries.length} files (expected ≥ ${EXPECTED.minAstroAssets})`,
      });
    }
  }

  // Rule 8 — sitemap
  const sitemapExists = EXPECTED.sitemapAny.some((p) => existsSync(p));
  if (!sitemapExists) {
    issues.push({
      rule: 'missing-sitemap',
      msg: `None of ${EXPECTED.sitemapAny.join(', ')} exist (sitemap generation failed)`,
    });
  }

  return { issues, routeCount };
}

async function main() {
  console.log('=== Build-Output-Integrity Audit (v7.7.27) — dist/ shape ===\n');

  const { issues, routeCount } = await audit();

  console.log(`Scanned dist/ · ${routeCount} routes · ${issues.length} issue(s)\n`);

  if (issues.length === 0) {
    console.log(
      `✓ dist/ is well-formed: ${routeCount} routes match baseline, all key paths present.`,
    );
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

  console.error(`\nFAIL — ${issues.length} build-output-integrity issue(s).`);
  process.exit(1);
}

main().catch((e) => {
  console.error('build-output-integrity scan crashed:', e);
  process.exit(2);
});
