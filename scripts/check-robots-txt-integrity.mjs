// check-robots-txt-integrity.mjs — v7.7.25 ROBOTS-TXT-INTEGRITY CI GATE
//
// Catches malformed / missing robots.txt files before ship. Google and
// other crawlers use robots.txt as the source-of-truth for crawl-rules:
// which paths they may index, where the sitemap lives, and (with the rise
// of AI search bots like GPTBot / ClaudeBot / PerplexityBot) whether
// AI-powered engines can ingest the content.
//
// Companion gates:
//   - scripts/check-canonical-url-integrity.mjs (v7.7.20) — canonical URL
//   - scripts/check-sitemap-integrity.mjs      (v7.7.16) — sitemap validity
//   - scripts/check-structured-data-coverage.mjs (v7.7.24) — JSON-LD
//
// Rules enforced:
//   1. public/robots.txt MUST exist (presence)
//   2. File MUST be non-empty
//   3. MUST contain at least one User-agent directive
//   4. At least one Allow: or Disallow: directive MUST be present (per UA)
//   5. If Sitemap: directive present, URL MUST be valid https + canonical host
//   6. Disallow: /  MUST NOT be the only directive (would block entire site)
//   7. Empty lines / hash-comments only files fail (no actual directives)
//   8. AI-bot UAs (GPTBot / ClaudeBot / anthropic-ai / PerplexityBot /
//      Google-Extended / CCBot / Applebot-Extended) MUST NOT be disallowed
//      for an open-portfolio site (we ship an explicit AI-bot policy per
//      llmstxt.org conventions — a missing UA declaration is a coverage gap)
//
// Exits 1 on any fail. Exits 0 otherwise.
// Used in: npm run ci (after structured:data:coverage, before audit).

import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const ROBOTS_PATH = 'public/robots.txt';
const CANONICAL_HOSTS = new Set([
  'christianmacion-portfolio.pages.dev',
  'christianmacion26.github.io',
]);

// AI-bot user-agents a public-facing portfolio should explicitly address.
// (llmstxt.org + the v6.0 AI-bot policy in public/robots.txt.)
const AI_USER_AGENTS = [
  'GPTBot',
  'ClaudeBot',
  'anthropic-ai',
  'PerplexityBot',
  'Google-Extended',
  'CCBot',
  'Applebot-Extended',
];

// Parse a robots.txt file into a list of "groups" — each group starts with
// User-agent: lines and contains Allow/Disallow/Crawl-delay/Sitemap lines.
function parseRobots(text) {
  const groups = [];
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    // Strip comments + trim
    const line = rawLine.replace(/#.*$/, '').trim();
    if (line === '') continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue; // malformed line — skip silently (some bots include junk)
    const [, field, value] = m;
    const fieldLower = field.toLowerCase();
    if (fieldLower === 'user-agent') {
      // A new UA declaration starts a new group (or adds to a multi-UA group,
      // which most parsers treat as the SAME group with multiple UAs).
      if (current && current.uas.length > 0) {
        groups.push(current);
      }
      current = { uas: [value.trim()], directives: [], hasSitemap: false };
    } else if (current) {
      if (fieldLower === 'sitemap') {
        current.directives.push({ field: 'Sitemap', value: value.trim() });
        current.hasSitemap = true;
      } else if (
        fieldLower === 'allow' ||
        fieldLower === 'disallow' ||
        fieldLower === 'crawl-delay'
      ) {
        current.directives.push({ field: capitalize(field), value: value.trim() });
      }
    } else {
      // Directive before any User-agent — invalid per RFC 9309
      groups.push({
        uas: [],
        directives: [{ field: capitalize(field), value: value.trim() }],
        hasSitemap: fieldLower === 'sitemap',
      });
    }
  }
  if (current && current.uas.length > 0) groups.push(current);
  return groups;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function audit() {
  const issues = [];

  // Rule 1 — presence
  if (!existsSync(ROBOTS_PATH)) {
    issues.push({ rule: 'missing-robots', msg: `${ROBOTS_PATH} does not exist` });
    return { issues };
  }

  // Rule 2 — non-empty
  const st = await stat(ROBOTS_PATH);
  if (st.size === 0) {
    issues.push({ rule: 'empty-robots', msg: `${ROBOTS_PATH} is empty (0 bytes)` });
    return { issues };
  }

  const text = await readFile(ROBOTS_PATH, 'utf8');

  // Quick pre-check: at least one non-comment, non-blank line
  const hasContent = text.split(/\r?\n/).some((l) => l.replace(/#.*$/, '').trim() !== '');
  if (!hasContent) {
    issues.push({
      rule: 'no-directives',
      msg: `${ROBOTS_PATH} contains only comments / blank lines (no actual directives)`,
    });
    return { issues };
  }

  const groups = parseRobots(text);

  // Rule 3 — at least one User-agent group
  if (groups.length === 0) {
    issues.push({ rule: 'no-user-agent', msg: `${ROBOTS_PATH} has no User-agent directives` });
    return { issues };
  }

  // Rule 4 — every group MUST have at least one Allow or Disallow directive
  const groupsWithoutRules = groups.filter(
    (g) => !g.directives.some((d) => d.field === 'Allow' || d.field === 'Disallow'),
  );
  if (groupsWithoutRules.length > 0) {
    for (const g of groupsWithoutRules) {
      issues.push({
        rule: 'group-without-allow-disallow',
        msg: `User-agent "${g.uas.join(', ')}" has no Allow: or Disallow: directives (must declare at least one)`,
      });
    }
  }

  // Rule 5 — Sitemap URLs MUST be valid https + canonical host
  const sitemapDirs = groups.flatMap((g) => g.directives.filter((d) => d.field === 'Sitemap'));
  for (const s of sitemapDirs) {
    let url;
    try {
      url = new URL(s.value);
    } catch {
      issues.push({
        rule: 'sitemap-malformed',
        msg: `Sitemap: "${s.value}" is not a valid URL`,
      });
      continue;
    }
    if (url.protocol !== 'https:') {
      issues.push({
        rule: 'sitemap-not-https',
        msg: `Sitemap: "${s.value}" is not https://`,
      });
    }
    if (!CANONICAL_HOSTS.has(url.host)) {
      issues.push({
        rule: 'sitemap-non-canonical-host',
        msg: `Sitemap: host="${url.host}" is not canonical (expected one of: ${[...CANONICAL_HOSTS].join(', ')})`,
      });
    }
    if (!url.pathname.endsWith('.xml')) {
      issues.push({
        rule: 'sitemap-not-xml',
        msg: `Sitemap: "${s.value}" does not end in .xml (got "${url.pathname}")`,
      });
    }
  }

  // Rule 6 — Disallow: / MUST NOT be the only directive (would block entire site)
  for (const g of groups) {
    const rules = g.directives.filter((d) => d.field === 'Allow' || d.field === 'Disallow');
    const onlyDisallowRoot =
      rules.length === 1 && rules[0].field === 'Disallow' && rules[0].value === '/';
    if (onlyDisallowRoot) {
      issues.push({
        rule: 'site-wide-disallow',
        msg: `User-agent "${g.uas.join(', ')}" is blocked site-wide (Disallow: / with no Allow) — would prevent indexing`,
      });
    }
  }

  // Rule 7 — AI-bot UAs MUST be present in the file (open-portfolio policy)
  const declaredUAs = new Set(groups.flatMap((g) => g.uas));
  const missingAIs = AI_USER_AGENTS.filter((ua) => !declaredUAs.has(ua));
  if (missingAIs.length > 0) {
    issues.push({
      rule: 'missing-ai-user-agent',
      msg: `AI-bot User-agents not declared: ${missingAIs.join(', ')} (open-portfolio policy per llmstxt.org)`,
    });
  }

  // Rule 8 — AI-bot UAs MUST NOT be Disallowed
  for (const g of groups) {
    const hasAIUA = g.uas.some((ua) => AI_USER_AGENTS.includes(ua));
    if (!hasAIUA) continue;
    const disallowAll = g.directives.some((d) => d.field === 'Disallow' && d.value === '/');
    if (disallowAll) {
      issues.push({
        rule: 'ai-bot-disallowed',
        msg: `AI-bot "${g.uas.join(', ')}" is Disallowed site-wide (Disallow: /) — breaks open-portfolio policy`,
      });
    }
  }

  return { issues };
}

async function main() {
  console.log('=== Robots.txt Integrity Audit (v7.7.25) — crawl rules + AI-bot policy ===\n');

  const { issues } = await audit();

  console.log(`Scanned 1 file (public/robots.txt) · ${issues.length} issue(s)\n`);

  if (issues.length === 0) {
    console.log('✓ robots.txt is present, valid, and AI-bot-friendly.');
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

  console.error(`\nFAIL — ${issues.length} robots-txt-integrity issue(s).`);
  process.exit(1);
}

main().catch((e) => {
  console.error('robots-txt-integrity scan crashed:', e);
  process.exit(2);
});
