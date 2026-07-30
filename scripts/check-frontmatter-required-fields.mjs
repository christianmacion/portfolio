// check-frontmatter-required-fields.mjs — v7.7.30 FRONTMATTER-REQUIRED-FIELDS CI GATE
//
// Catches content-collection entries missing canonical frontmatter fields
// before ship. The `content:freshness:integrity` gate (v7.7.29) reads git
// commit timestamps — but authors can re-read-and-republish a post without
// touching the file. Without explicit frontmatter dates, an evergreen entry
// ages silently. This gate requires at least one publish-date field per
// content entry.
//
// Companion gates:
//   - scripts/check-content-freshness-integrity.mjs (v7.7.29) — git timestamp
//   - scripts/check-structured-data-coverage.mjs (v7.7.24) — JSON-LD presence
//
// Rules enforced:
//   1. Every src/content/** entry MUST start with YAML frontmatter (---)
//   2. Entry MUST include at least one publish-date field:
//        date | pubDate | lastUpdated | startDate
//   3. The publish-date MUST be a valid YYYY-MM-DD (or YYYY-MM) string
//   4. The publish-date MUST NOT be in the future
//   5. The publish-date MUST be within the last FRONT_STALE_MONTHS (24) months
//
// Exits 1 on any fail. Exits 0 otherwise.
// Used in: npm run ci (after content:freshness:integrity, before audit).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CONTENT_ROOT = 'src/content';
const FRONT_STALE_MONTHS = 24;
const DATE_FIELDS = ['date', 'pubDate', 'lastUpdated', 'startDate'];
const FRONT_STALE_SECONDS = FRONT_STALE_MONTHS * 30 * 24 * 60 * 60;
const CUTOFF_EPOCH = Math.floor(Date.now() / 1000) - FRONT_STALE_SECONDS;

function* walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.endsWith('.md') || e.name.endsWith('.mdx')) yield full;
  }
}

function parseFrontmatter(content) {
  if (!content.startsWith('---')) return null;
  const endIdx = content.indexOf('\n---', 3);
  if (endIdx === -1) return null;
  const block = content.slice(3, endIdx);
  const fields = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.+?)\s*$/);
    if (m) fields[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return fields;
}

function parseDate(s) {
  if (!s) return null;
  // Accept YYYY-MM-DD or YYYY-MM
  const m = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10) - 1;
  const day = m[3] ? parseInt(m[3], 10) : 1;
  const d = new Date(Date.UTC(year, month, day));
  if (isNaN(d.getTime())) return null;
  return Math.floor(d.getTime() / 1000);
}

function audit() {
  const issues = [];
  const entries = [];
  const now = Math.floor(Date.now() / 1000);

  for (const f of walk(CONTENT_ROOT)) {
    const content = readFileSync(f, 'utf8');
    const fm = parseFrontmatter(content);

    if (fm === null) {
      issues.push({
        rule: 'missing-frontmatter',
        msg: `${f} — no YAML frontmatter (must start with --- and close with ---)`,
      });
      continue;
    }

    // Find first present date field
    let dateField = null;
    let dateValue = null;
    for (const field of DATE_FIELDS) {
      if (fm[field]) {
        dateField = field;
        dateValue = fm[field];
        break;
      }
    }

    if (dateField === null) {
      issues.push({
        rule: 'missing-published-date',
        msg: `${f} — none of [${DATE_FIELDS.join(', ')}] present in frontmatter`,
      });
      continue;
    }

    const epoch = parseDate(dateValue);
    if (epoch === null) {
      issues.push({
        rule: 'invalid-date-format',
        msg: `${f} — ${dateField}: "${dateValue}" is not YYYY-MM-DD or YYYY-MM`,
      });
      continue;
    }

    if (epoch > now) {
      issues.push({
        rule: 'future-date',
        msg: `${f} — ${dateField}: "${dateValue}" is in the future`,
      });
      continue;
    }

    const isFresh = epoch >= CUTOFF_EPOCH;
    if (!isFresh) {
      const monthsAgo = Math.floor((now - epoch) / (30 * 24 * 60 * 60));
      issues.push({
        rule: 'stale-frontmatter-date',
        msg: `${f} — ${dateField}: "${dateValue}" is ${monthsAgo} months old (cutoff: ${FRONT_STALE_MONTHS}mo)`,
      });
    }

    entries.push({ path: f, dateField, dateValue, epoch, isFresh });
  }

  entries.sort((a, b) => a.epoch - b.epoch);
  return { issues, entries };
}

function main() {
  console.log('=== Frontmatter-Required-Fields Audit (v7.7.30) — content collection frontmatter date ===\n');

  const { issues, entries } = audit();

  console.log(`Scanned ${entries.length + (issues.length - entries.length === 0 ? 0 : issues.filter((i) => !entries.some((e) => e.path === i.msg.split(' — ')[0])).length)} entries · ${entries.length} with date field · ${issues.length} issue(s)\n`);

  // Field usage breakdown
  const byField = new Map();
  for (const e of entries) {
    byField.set(e.dateField, (byField.get(e.dateField) || 0) + 1);
  }
  console.log('Date-field usage:');
  for (const [f, n] of [...byField.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${f.padEnd(14)} ${n}`);
  }
  console.log('');

  // Top-5 oldest
  const oldest = entries.slice(0, 5);
  if (oldest.length > 0) {
    console.log('Oldest 5 entries (by frontmatter date):');
    for (const e of oldest) {
      console.log(`  ${e.dateValue}  [${e.dateField}]  ${e.path}`);
    }
    console.log('');
  }

  if (issues.length === 0) {
    console.log(`✓ All ${entries.length} entries have a valid publish-date (within ${FRONT_STALE_MONTHS}mo, not in future).`);
    return;
  }

  const byRule = new Map();
  for (const i of issues) {
    if (!byRule.has(i.rule)) byRule.set(i.rule, []);
    byRule.get(i.rule).push(i.msg);
  }
  for (const [rule, msgs] of byRule) {
    console.log(`\n[${rule}] — ${msgs.length} site(s):`);
    for (const m of msgs.slice(0, 5)) console.log(`  ${m}`);
    if (msgs.length > 5) console.log(`  ... and ${msgs.length - 5} more`);
  }

  console.error(`\nFAIL — ${issues.length} frontmatter-required-fields issue(s).`);
  process.exit(1);
}

try {
  main();
} catch (e) {
  console.error('frontmatter-required-fields scan crashed:', e);
  process.exit(2);
}