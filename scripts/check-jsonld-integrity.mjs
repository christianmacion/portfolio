// check-jsonld-integrity.mjs — v7.7.17 JSON-LD-INTEGRITY CI GATE
//
// Catches malformed JSON-LD blocks before ship. dist/**/index.html embeds
// <script type="application/ld+json"> blocks for Google rich-results
// (Person, WebSite, BreadcrumbList, Article, Organization, WebPage).
// If any block is unparseable, missing required fields, has a malformed
// @context, or carries a non-https URL, the rich-result silently drops.
//
// Rules enforced (per dist/**/index.html):
//   - Every JSON-LD block parses as JSON
//   - @context is a URL (or array with a schema.org URL)
//   - @type is a non-empty string
//   - Per-@type required fields:
//     Person         → name
//     WebSite        → name, url
//     BreadcrumbList → itemListElement (non-empty array of ListItem)
//     Article        → headline, author, datePublished
//     Organization   → name, url
//     WebPage        → name
//     (any)          → anything we don't recognise just needs @context+@type
//   - All url / image / @id values are absolute https:// URLs
//   - No duplicate @type blocks per page (rich-result dedup)
//
// Exits 1 on any fail. Exits 0 otherwise.
// Used in: npm run ci (after sitemap:integrity, before audit).

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

// (CANONICAL_HOSTS reserved — currently the URL field check only validates
// the protocol is https, not that the host matches the deploy target. If a
// future rule wants to assert "url must point to pages.dev OR github.io",
// the set is already declared here.)
const _CANONICAL_HOSTS = new Set([
  'christianmacion-portfolio.pages.dev',
  'christianmacion26.github.io',
]);

// Required fields per @type — mirrors schema.org's "minimum required"
// for Google rich-results eligibility.
const REQUIRED_BY_TYPE = {
  Person: ['name'],
  WebSite: ['name', 'url'],
  BreadcrumbList: ['itemListElement'],
  Article: ['headline', 'author', 'datePublished'],
  Organization: ['name', 'url'],
  WebPage: ['name'],
  Product: ['name'],
  FAQPage: ['mainEntity'],
  HowTo: ['name', 'step'],
  SoftwareApplication: ['name'],
  Course: ['name', 'provider'],
  JobPosting: ['title', 'description', 'datePosted'],
};

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else yield full;
  }
}

// Extract every JSON-LD block from an HTML file
function extractJsonLdBlocks(html) {
  const re = /<script[^>]*type\s*=\s*(["'])application\/ld\+json\1[^>]*>([\s\S]*?)<\/script>/gi;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push(m[2]);
  }
  return out;
}

// Validate a single parsed JSON-LD object against schema.org rules
function validateObject(obj, route, blockIdx) {
  const issues = [];
  const label = `${route}#jsonld${blockIdx + 1}`;

  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    issues.push({
      rule: 'not-object',
      msg: `${label} is not a JSON object (got ${Array.isArray(obj) ? 'array' : typeof obj})`,
    });
    return issues;
  }

  // @context — must be a URL string or array of URLs (the schema.org convention)
  if (!('@context' in obj)) {
    issues.push({ rule: 'no-context', msg: `${label} has no @context` });
  } else {
    const ctx = obj['@context'];
    if (typeof ctx === 'string') {
      try {
        const u = new URL(ctx);
        if (u.protocol !== 'https:') {
          issues.push({
            rule: 'non-https-context',
            msg: `${label} @context="${ctx}" is not https://`,
          });
        }
      } catch {
        issues.push({
          rule: 'malformed-context',
          msg: `${label} @context="${ctx}" is not a valid URL`,
        });
      }
    } else if (Array.isArray(ctx)) {
      if (ctx.length === 0) {
        issues.push({
          rule: 'empty-context-array',
          msg: `${label} @context is an empty array`,
        });
      }
      // first element should be schema.org
      const first = ctx[0];
      if (typeof first !== 'string' || !first.includes('schema.org')) {
        issues.push({
          rule: 'non-schema-context',
          msg: `${label} @context[0]="${first}" should reference schema.org`,
        });
      }
    } else {
      issues.push({
        rule: 'bad-context-type',
        msg: `${label} @context must be string or array, got ${typeof ctx}`,
      });
    }
  }

  // @type — must be a non-empty string
  if (!('@type' in obj)) {
    issues.push({ rule: 'no-type', msg: `${label} has no @type` });
  } else if (typeof obj['@type'] !== 'string' || obj['@type'].trim() === '') {
    issues.push({
      rule: 'bad-type',
      msg: `${label} @type must be a non-empty string, got "${obj['@type']}"`,
    });
  } else {
    const t = obj['@type'];
    const required = REQUIRED_BY_TYPE[t];
    if (required) {
      for (const field of required) {
        if (
          !(field in obj) ||
          obj[field] === null ||
          obj[field] === '' ||
          (Array.isArray(obj[field]) && obj[field].length === 0)
        ) {
          issues.push({
            rule: `missing-required-${t}.${field}`,
            msg: `${label} ${t} is missing required field "${field}"`,
          });
        }
      }
    }

    // url + image + @id (if present) must be https
    for (const urlField of ['url', 'image', '@id']) {
      const v = obj[urlField];
      if (v !== undefined && typeof v === 'string' && v !== '') {
        try {
          const u = new URL(v);
          if (u.protocol !== 'https:') {
            issues.push({
              rule: `non-https-${urlField.replace('@', '')}`,
              msg: `${label} ${urlField}="${v}" is not https://`,
            });
          }
        } catch {
          issues.push({
            rule: `malformed-${urlField.replace('@', '')}`,
            msg: `${label} ${urlField}="${v}" is not a valid URL`,
          });
        }
      }
    }

    // sameAs array — every entry must be a string URL
    if (obj.sameAs !== undefined) {
      if (!Array.isArray(obj.sameAs)) {
        issues.push({
          rule: 'bad-sameAs',
          msg: `${label} sameAs must be an array, got ${typeof obj.sameAs}`,
        });
      } else {
        obj.sameAs.forEach((s, i) => {
          if (typeof s !== 'string') return;
          try {
            const u = new URL(s);
            if (u.protocol !== 'https:') {
              issues.push({
                rule: 'non-https-sameAs',
                msg: `${label} sameAs[${i}]="${s}" is not https://`,
              });
            }
          } catch {
            issues.push({
              rule: 'malformed-sameAs',
              msg: `${label} sameAs[${i}]="${s}" is not a valid URL`,
            });
          }
        });
      }
    }

    // BreadcrumbList: itemListElement must contain ListItem objects with position + name + item
    if (t === 'BreadcrumbList' && Array.isArray(obj.itemListElement)) {
      for (const [i, li] of obj.itemListElement.entries()) {
        if (typeof li !== 'object' || li === null) continue;
        if (!('position' in li) || !('name' in li) || !('item' in li)) {
          issues.push({
            rule: 'bad-listitem',
            msg: `${label} itemListElement[${i}] missing position/name/item`,
          });
        }
      }
    }
  }

  return issues;
}

// @graph is allowed — each member is validated independently
function validateBlock(rawJson, route, blockIdx) {
  const issues = [];
  const label = `${route}#jsonld${blockIdx + 1}`;

  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch (e) {
    return [
      {
        rule: 'parse-fail',
        msg: `${label} JSON parse failed: ${e.message}`,
      },
    ];
  }

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      issues.push({ rule: 'empty-array', msg: `${label} is an empty array` });
    }
    parsed.forEach((obj, i) => {
      issues.push(...validateObject(obj, route, blockIdx * 1000 + i));
    });
  } else if (parsed && typeof parsed === 'object' && '@graph' in parsed) {
    const graph = parsed['@graph'];
    if (!Array.isArray(graph) || graph.length === 0) {
      issues.push({
        rule: 'empty-graph',
        msg: `${label} @graph is empty`,
      });
    } else {
      graph.forEach((obj, i) => {
        issues.push(...validateObject(obj, route, blockIdx * 1000 + i));
      });
    }
  } else {
    issues.push(...validateObject(parsed, route, blockIdx));
  }

  return issues;
}

async function auditRoute(route, html) {
  const issues = [];
  const rawBlocks = extractJsonLdBlocks(html);
  const parsedTypes = [];

  if (rawBlocks.length === 0) {
    // Not every page has JSON-LD — pages with full chrome get it via BaseLayout,
    // pages rendered through other layouts (workbook index, etc.) may not. Only
    // a soft warning.
    return { route, blockCount: 0, issues, warning: 'no-jsonld' };
  }

  for (const [i, raw] of rawBlocks.entries()) {
    issues.push(...validateBlock(raw, route, i));
    // Track @type counts for duplicate detection (best-effort, re-parse cheap)
    try {
      const p = JSON.parse(raw);
      const t =
        p && typeof p === 'object' && '@type' in p
          ? p['@type']
          : Array.isArray(p) && p[0]?.['@type']
            ? p[0]['@type']
            : null;
      if (t) parsedTypes.push(t);
    } catch {
      /* already flagged */
    }
  }

  // Duplicate @type blocks per page
  const typeCounts = new Map();
  for (const t of parsedTypes) {
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
  }
  for (const [t, count] of typeCounts) {
    if (count > 1) {
      issues.push({
        rule: 'duplicate-type',
        msg: `${route} has ${count} JSON-LD blocks of @type "${t}" — Google rich-results will dedupe`,
      });
    }
  }

  return { route, blockCount: rawBlocks.length, issues };
}

async function main() {
  console.log('=== JSON-LD Integrity Audit (v7.7.17) — schema.org rich-results ===\n');

  const findings = [];
  for await (const f of walk('dist')) {
    if (!f.endsWith('index.html')) continue;
    if (f.includes('_astro') || f.includes('_pagefind')) continue;
    const html = await readFile(f, 'utf8');
    findings.push(await auditRoute(f, html));
  }

  const failing = findings.filter((f) => f.issues.length > 0);
  const totalIssues = failing.reduce((n, f) => n + f.issues.length, 0);
  const totalBlocks = findings.reduce((n, f) => n + f.blockCount, 0);
  const routesWithBlocks = findings.filter((f) => f.blockCount > 0).length;

  console.log(
    `Scanned ${findings.length} route(s) · ${totalBlocks} JSON-LD block(s) across ${routesWithBlocks} route(s) · ${totalIssues} issue(s) across ${failing.length} route(s)\n`,
  );

  if (totalIssues === 0) {
    console.log(
      `✓ All ${totalBlocks} JSON-LD blocks across ${routesWithBlocks} routes are valid + schema.org-compliant + https-canonical.`,
    );
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
    `\nFAIL — ${totalIssues} json-ld integrity issue(s) across ${failing.length} route(s).`,
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('json-ld integrity scan crashed:', e);
  process.exit(2);
});
