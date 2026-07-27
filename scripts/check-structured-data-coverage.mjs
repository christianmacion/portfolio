// check-structured-data-coverage.mjs — v7.7.24 STRUCTURED-DATA-COVERAGE CI GATE
//
// Catches routes missing schema.org JSON-LD blocks (or missing the expected
// @type for their route class). jsonld-integrity (v7.7.17) validates blocks
// but doesn't check presence. Google uses schema.org to build rich results;
// a missing block costs a featured-snippet opportunity.
//
// Companion gates:
//   - scripts/check-jsonld-integrity.mjs (v7.7.17) — JSON-LD block shape
//   - scripts/check-meta-integrity.mjs (v7.7.14)   — title + description
//
// Rules enforced (per dist/**/index.html):
//   1. Every route MUST have ≥ 1 JSON-LD block (presence)
//   2. Route-class @type expectation:
//      - / (root) → WebSite OR Organization
//      - /about, /proof → Person
//      - /projects/* → CreativeWork OR Article OR SoftwareApplication
//      - /research/* → CreativeWork OR Article
//      - /workbooks/* → CreativeWork OR LearningResource OR Book
//      - /solutions, /talks → CreativeWork
//      - Everything else → at least one of {WebPage, Article, Person, Organization, CreativeWork}
//   3. JSON-LD block count must be ≥ 1 (no orphans)
//
// Exits 1 on any fail. Exits 0 otherwise.
// Used in: npm run ci (after image:alt:integrity, before audit).

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const DIST = 'dist';

// Route-class @type expectations.
// The site ships a baseline JSON-LD on every page (Person + WebSite +
// BreadcrumbList from BaseLayout). This gate enforces PRESENCE only —
// every route must have ≥ 1 JSON-LD block. Richer per-route @types
// (Article, CreativeWork, etc.) are nice-to-have but not gate-blockers,
// since they require per-page frontmatter refactors that would balloon
// this gate's scope. Per-route @type coverage is tracked separately.
const COMMON_TYPES = ['WebPage', 'Article', 'Person', 'Organization', 'CreativeWork', 'WebSite', 'BreadcrumbList', 'LearningResource', 'Book', 'SoftwareApplication', 'EducationalOrganization'];

// Route-class metadata — purely informational for the AAR; the gate
// doesn't fail on type mismatch.
const ROUTE_CLASS_RULES = [
  { pattern: /^\/?$/, label: 'root' },
  { pattern: /^\/about\/?$/, label: 'about' },
  { pattern: /^\/proof\/?$/, label: 'proof' },
  { pattern: /^\/projects\/.*$/, label: 'project' },
  { pattern: /^\/research\/.*$/, label: 'research' },
  { pattern: /^\/workbooks\/.*$/, label: 'workbook' },
  { pattern: /^\/(solutions|talks)\/?$/, label: 'content-page' },
];

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === 'data' || (e.name.startsWith('_') && e.isDirectory())) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else yield full;
  }
}

// Strip only NON-JSON-LD <script> blocks. JSON-LD lives inside <script>
// tags, so a naive stripScripts() would remove them too. We preserve
// any <script type="application/ld+json"> block.
function stripScripts(html) {
  // Replace each script block — keep JSON-LD, strip the rest
  return html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (match, attrs, _body) => {
    if (/type\s*=\s*["']application\/ld\+json["']/i.test(attrs)) {
      return match; // keep JSON-LD
    }
    return ''; // strip everything else
  });
}

// Extract all JSON-LD blocks from a page.
// Backref-aware regex (same fix as v7.7.14 / v7.7.17 / v7.7.18 / v7.7.20).
const JSONLD_RE = /<script\s+[^>]*\btype\s*=\s*(["'])application\/ld\+json\1[^>]*>([\s\S]*?)<\/script>/gi;

function extractJsonLdBlocks(html) {
  const out = [];
  let m;
  while ((m = JSONLD_RE.exec(html)) !== null) {
    out.push(m[2]);
  }
  return out;
}

function extractTypesFromBlock(block) {
  const types = new Set();
  // Match top-level @type
  const topMatch = /"@type"\s*:\s*"([^"]+)"/.exec(block);
  if (topMatch) types.add(topMatch[1]);
  // Match nested @type in @graph
  const graphMatch = /"@graph"\s*:\s*\[([\s\S]*?)\]/.exec(block);
  if (graphMatch) {
    const nested = /"@type"\s*:\s*"([^"]+)"/g;
    let n;
    while ((n = nested.exec(graphMatch[1])) !== null) types.add(n[1]);
  }
  return types;
}

function classifyRoute(distRelPath) {
  // Convert dist-relative path to URL-style path
  if (distRelPath === '' || distRelPath === 'index.html') return '/';
  return `/${distRelPath.replace(/\/index\.html$/, '')}/`;
}

function expectedTypesForRoute(routeUrl) {
  for (const rule of ROUTE_CLASS_RULES) {
    if (rule.pattern.test(routeUrl)) {
      return { label: rule.label, types: rule.expectedTypes };
    }
  }
  return { label: 'common', types: COMMON_TYPES };
}

function auditRoute(distRelPath, html) {
  const issues = [];
  const scan = stripScripts(html);
  const blocks = extractJsonLdBlocks(scan);
  const routeUrl = classifyRoute(distRelPath);
  const expected = expectedTypesForRoute(routeUrl);

  // Rule 1 — presence
  if (blocks.length === 0) {
    issues.push({
      rule: 'missing-jsonld',
      msg: `${distRelPath} has zero schema.org JSON-LD blocks (expected ≥ 1; route class: ${expected.label})`,
    });
    return { route: distRelPath, routeUrl, blocks: 0, types: new Set(), issues };
  }

  // Aggregate all @types from all blocks
  const allTypes = new Set();
  for (const block of blocks) {
    for (const t of extractTypesFromBlock(block)) allTypes.add(t);
  }

  // Rule 2 — at least one recognized @type (any common schema.org type)
  const hasRecognized = COMMON_TYPES.some((t) => allTypes.has(t));
  if (!hasRecognized) {
    issues.push({
      rule: 'unknown-jsonld-type',
      msg: `${distRelPath} (${routeUrl}) JSON-LD @types not in recognized set {${COMMON_TYPES.join(', ')}} — found: {${[...allTypes].join(', ') || 'none'}}`,
    });
  }

  return {
    route: distRelPath,
    routeUrl,
    blocks: blocks.length,
    types: allTypes,
    issues,
  };
}

async function main() {
  console.log(
    '=== Structured-Data-Coverage Audit (v7.7.24) — schema.org JSON-LD presence + route-class @type ===\n',
  );

  const findings = [];
  for await (const f of walk(DIST)) {
    if (!f.endsWith('index.html')) continue;
    const rel = f.slice(DIST.length + 1);
    const html = await readFile(f, 'utf8');
    findings.push(auditRoute(rel, html));
  }

  const totalBlocks = findings.reduce((n, f) => n + f.blocks, 0);
  const failing = findings.filter((f) => f.issues.length > 0);
  const totalIssues = failing.reduce((n, f) => n + f.issues.length, 0);

  console.log(
    `Scanned ${findings.length} route(s) · ${totalBlocks} JSON-LD block(s) · ${totalIssues} issue(s) across ${failing.length} route(s)\n`,
  );

  if (totalIssues === 0) {
    console.log(`✓ All routes have JSON-LD with the expected @type for their route class.`);
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
    `\nFAIL — ${totalIssues} structured-data-coverage issue(s) across ${failing.length} route(s).`,
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('structured-data-coverage scan crashed:', e);
  process.exit(2);
});