// check-og-integrity.mjs — v7.7.18 OPEN-GRAPH-INTEGRITY CI GATE
//
// Catches malformed Open Graph + Twitter Card meta tags before ship.
// dist/**/index.html embeds <meta property="og:..."> and <meta name="twitter:...">
// tags for LinkedIn / Slack / Twitter previews. If the OG set is incomplete,
// the preview card falls back to a generic title — losing brand authority.
// The meta-integrity gate (v7.7.14) validates <meta name="description"> and
// <title>; this gate validates the OG + Twitter Card parallel surface.
//
// Rules enforced (per dist/**/index.html):
//   - If any og:* tag is present, the canonical set {og:title, og:description,
//     og:image, og:url} must all be present (LinkedIn / Slack / Twitter
//     fall back to a generic title without all four).
//   - og:type (if present) must be a canonical Open Graph type
//   - og:image + og:url must be https URLs
//   - og:url must be on a canonical host
//   - og:title length 5-95 chars; og:description length 10-200 chars
//   - twitter:card (if present) must be summary|summary_large_image|app|player
//   - If twitter:title or twitter:image is present, twitter:card must also
//     be present (otherwise Twitter ignores the lot)
//   - twitter:image must be https
//
// Exits 1 on any fail. Exits 0 otherwise.
// Used in: npm run ci (after jsonld:integrity, before audit).

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const CANONICAL_HOSTS = new Set([
  'christianmacion-portfolio.pages.dev',
  'christianmacion26.github.io',
]);

// Canonical Open Graph object types (per ogp.me / Facebook OG docs)
const VALID_OG_TYPES = new Set([
  'website',
  'article',
  'profile',
  'book',
  'books.author',
  'books.book',
  'books.genre',
  'business.business',
  'fitness.course',
  'game.achievement',
  'music.album',
  'music.playlist',
  'music.radio_station',
  'music.song',
  'product',
  'product.group',
  'product.item',
  'restaurant.menu',
  'restaurant.menu_item',
  'restaurant.menu_section',
  'restaurant.restaurant',
  'video.episode',
  'video.movie',
  'video.other',
  'video.tv_show',
]);

const VALID_TWITTER_CARDS = new Set(['summary', 'summary_large_image', 'app', 'player']);

// Required OG set — if ANY og:* is present, all four must be present
const REQUIRED_OG_IF_ANY = ['og:title', 'og:description', 'og:image', 'og:url'];

const OG_TITLE_MIN = 5;
const OG_TITLE_MAX = 95;
const OG_DESC_MIN = 10;
const OG_DESC_MAX = 200;

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else yield full;
  }
}

// Extract all <meta property="og:..."> and <meta name="twitter:..."> tags.
// v7.7.18 — backref-aware regex (same fix as v7.7.14 meta-integrity) —
// `[^"']*` cannot match content containing apostrophes (e.g. "researcher's
// failures") because `'` terminates the negated character class. Using
// `\1` / \3` to match the SAME quote that opened the attribute lets the
// content include the other quote character.
function extractMeta(html) {
  const og = {};
  const tw = {};
  const re =
    /<meta\s+(?:property|name)\s*=\s*(["'])([^"']+)\1[^>]*content\s*=\s*(["'])([\s\S]*?)\3[^>]*\/?>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const key = m[2];
    const val = m[4];
    if (key.startsWith('og:')) og[key] = val;
    else if (key.startsWith('twitter:')) tw[key] = val;
  }
  return { og, tw };
}

function auditRoute(route, html) {
  const issues = [];
  const { og, tw } = extractMeta(html);
  const hasAnyOg = Object.keys(og).length > 0;
  const hasAnyTw = Object.keys(tw).length > 0;

  // === OG rules ===

  // (1) If any og:* is present, the canonical set must all be present
  if (hasAnyOg) {
    for (const required of REQUIRED_OG_IF_ANY) {
      if (!(required in og)) {
        issues.push({
          rule: 'missing-required-og',
          msg: `${route} has OG tags but is missing required <meta property="${required}">`,
        });
      }
    }
  }

  // (2) og:type (if present) must be a canonical Open Graph type
  if (og['og:type'] !== undefined && !VALID_OG_TYPES.has(og['og:type'])) {
    issues.push({
      rule: 'bad-og-type',
      msg: `${route} og:type="${og['og:type']}" is not a canonical Open Graph type`,
    });
  }

  // (3) og:image + og:url must be https URLs
  for (const urlField of ['og:image', 'og:url']) {
    const v = og[urlField];
    if (v === undefined) continue;
    try {
      const u = new URL(v);
      if (u.protocol !== 'https:') {
        issues.push({
          rule: `non-https-${urlField.replace(':', '-')}`,
          msg: `${route} ${urlField}="${v}" is not https://`,
        });
      } else if (urlField === 'og:url') {
        // og:url must be on a canonical host
        if (!CANONICAL_HOSTS.has(u.host)) {
          issues.push({
            rule: 'og-url-non-canonical',
            msg: `${route} og:url host="${u.host}" is not canonical (expected one of: ${[...CANONICAL_HOSTS].join(', ')})`,
          });
        }
      }
    } catch {
      issues.push({
        rule: `malformed-${urlField.replace(':', '-')}`,
        msg: `${route} ${urlField}="${v}" is not a valid URL`,
      });
    }
  }

  // (4) og:title length 5-95; og:description length 10-200
  if (og['og:title'] !== undefined) {
    const len = og['og:title'].length;
    if (len < OG_TITLE_MIN || len > OG_TITLE_MAX) {
      issues.push({
        rule: 'og-title-length',
        msg: `${route} og:title is ${len} chars (must be ${OG_TITLE_MIN}-${OG_TITLE_MAX})`,
      });
    }
  }
  if (og['og:description'] !== undefined) {
    const len = og['og:description'].length;
    if (len < OG_DESC_MIN || len > OG_DESC_MAX) {
      issues.push({
        rule: 'og-description-length',
        msg: `${route} og:description is ${len} chars (must be ${OG_DESC_MIN}-${OG_DESC_MAX})`,
      });
    }
  }

  // === Twitter Card rules ===

  // (5) twitter:card (if present) must be one of 4 canonical values
  if (tw['twitter:card'] !== undefined && !VALID_TWITTER_CARDS.has(tw['twitter:card'])) {
    issues.push({
      rule: 'bad-twitter-card',
      msg: `${route} twitter:card="${tw['twitter:card']}" must be one of: ${[...VALID_TWITTER_CARDS].join('|')}`,
    });
  }

  // (6) If twitter:title or twitter:image is present, twitter:card must also be present
  if (!('twitter:card' in tw) && ('twitter:title' in tw || 'twitter:image' in tw)) {
    issues.push({
      rule: 'twitter-card-missing',
      msg: `${route} has twitter:title or twitter:image but is missing twitter:card`,
    });
  }

  // (7) twitter:image must be https (if present)
  if (tw['twitter:image'] !== undefined) {
    try {
      const u = new URL(tw['twitter:image']);
      if (u.protocol !== 'https:') {
        issues.push({
          rule: 'non-https-twitter-image',
          msg: `${route} twitter:image="${tw['twitter:image']}" is not https://`,
        });
      }
    } catch {
      issues.push({
        rule: 'malformed-twitter-image',
        msg: `${route} twitter:image="${tw['twitter:image']}" is not a valid URL`,
      });
    }
  }

  return {
    route,
    ogCount: Object.keys(og).length,
    twCount: Object.keys(tw).length,
    hasAnyOg,
    hasAnyTw,
    issues,
  };
}

async function main() {
  console.log(
    '=== Open-Graph + Twitter Card Integrity Audit (v7.7.18) — preview-card surface ===\n',
  );

  const findings = [];
  for await (const f of walk('dist')) {
    if (!f.endsWith('index.html')) continue;
    if (f.includes('_astro') || f.includes('_pagefind')) continue;
    const html = await readFile(f, 'utf8');
    findings.push(auditRoute(f, html));
  }

  const failing = findings.filter((f) => f.issues.length > 0);
  const totalIssues = failing.reduce((n, f) => n + f.issues.length, 0);
  const routesWithOg = findings.filter((f) => f.hasAnyOg).length;
  const routesWithTw = findings.filter((f) => f.hasAnyTw).length;

  console.log(
    `Scanned ${findings.length} route(s) · ${routesWithOg} with OG · ${routesWithTw} with Twitter Card · ${totalIssues} issue(s) across ${failing.length} route(s)\n`,
  );

  if (totalIssues === 0) {
    console.log(`✓ All OG + Twitter Card tags are complete, valid, and on canonical hosts.`);
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
    `\nFAIL — ${totalIssues} open-graph integrity issue(s) across ${failing.length} route(s).`,
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('open-graph integrity scan crashed:', e);
  process.exit(2);
});
