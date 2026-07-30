// check-content-freshness-integrity.mjs — v7.7.29 CONTENT-FRESHNESS-INTEGRITY CI GATE
//
// Catches stale content-collection entries before ship. Each entry's "last
// touched" date is read from `git log -1 --format=%ct` (commit timestamp
// at the file path). Files untouched for > STALE_MONTHS months flag as
// stale. Stale entries ship alongside fresh ones without distinction,
// weakening recruiter trust + Google freshness signals.
//
// Companion gates:
//   - scripts/check-build-output-integrity.mjs (v7.7.27) — dist/ shape
//   - scripts/check-internal-link-graph-integrity.mjs (v7.7.28) — nav/footer
//
// Rules enforced:
//   1. Every content-collection entry under src/content/ MUST be in git
//      (git log returns ≥ 1 commit for the path)
//   2. Entry MUST have been touched within the last STALE_MONTHS months
//   3. At least MIN_FRESH_PCT of entries MUST be fresh (catches bulk-stale)
//   4. (Informational) sort entries by last-touched timestamp
//
// Exits 1 on any fail. Exits 0 otherwise.
// Used in: npm run ci (after internal:link:graph:integrity, before audit).

import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const CONTENT_ROOT = 'src/content';
const STALE_MONTHS = 12;
const MIN_FRESH_PCT = 60;

// Compute the cutoff (epoch seconds, 12 months ago)
const STALE_SECONDS = STALE_MONTHS * 30 * 24 * 60 * 60;
const CUTOFF_EPOCH = Math.floor(Date.now() / 1000) - STALE_SECONDS;

function* walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.endsWith('.md') || e.name.endsWith('.mdx')) yield full;
  }
}

function lastCommitEpoch(filePath) {
  try {
    const out = execSync(`git log -1 --format=%ct -- "${filePath}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const ts = parseInt(out.trim(), 10);
    return Number.isFinite(ts) ? ts : null;
  } catch {
    return null;
  }
}

function audit() {
  const issues = [];
  const entries = [];
  let staleCount = 0;
  let freshCount = 0;

  // Walk content collections
  for (const f of walk(CONTENT_ROOT)) {
    const lastTouched = lastCommitEpoch(f);

    // Rule 1 — file MUST be tracked in git
    if (lastTouched === null) {
      issues.push({
        rule: 'untracked-content',
        msg: `${f} is not tracked by git (no commit history)`,
      });
      continue;
    }

    const isFresh = lastTouched >= CUTOFF_EPOCH;
    if (!isFresh) staleCount++;
    else freshCount++;

    entries.push({ path: f, lastTouched, isFresh });
  }

  // Sort by freshness (oldest first)
  entries.sort((a, b) => a.lastTouched - b.lastTouched);

  // Rule 2 — every entry MUST be fresh
  const stale = entries.filter((e) => !e.isFresh);
  if (stale.length > 0) {
    // Format the oldest stale entry's age in months for context
    const oldestStale = stale[0];
    const ageMonths = Math.floor((Date.now() / 1000 - oldestStale.lastTouched) / (30 * 24 * 60 * 60));
    for (const e of stale) {
      const months = Math.floor((Date.now() / 1000 - e.lastTouched) / (30 * 24 * 60 * 60));
      issues.push({
        rule: 'stale-content',
        msg: `${e.path} last touched ${months} months ago (cutoff: ${STALE_MONTHS} months; oldest in batch: ${ageMonths}mo)`,
      });
    }
  }

  // Rule 3 — fresh-pct check (catches bulk-stale that overwhelms individual flags)
  const total = entries.length;
  const freshPct = total > 0 ? Math.round((freshCount / total) * 100) : 100;
  if (total > 0 && freshPct < MIN_FRESH_PCT) {
    issues.push({
      rule: 'low-fresh-pct',
      msg: `Only ${freshPct}% of content entries are fresh (${freshCount}/${total} — expected ≥ ${MIN_FRESH_PCT}%)`,
    });
  }

  return { issues, entries, freshCount, staleCount, total, freshPct };
}

function main() {
  console.log('=== Content-Freshness-Integrity Audit (v7.7.29) — content collection last-touched ===\n');

  const { issues, entries, freshCount, staleCount, total, freshPct } = audit();

  console.log(
    `Scanned ${total} content entries · ${freshCount} fresh · ${staleCount} stale (cutoff: ${STALE_MONTHS}mo) · ${freshPct}% fresh · ${issues.length} issue(s)\n`,
  );

  // Always show the top-5 oldest entries as a status line
  const oldest = entries.slice(0, 5);
  if (oldest.length > 0) {
    console.log('Oldest 5 entries:');
    for (const e of oldest) {
      const date = new Date(e.lastTouched * 1000).toISOString().slice(0, 10);
      console.log(`  ${date}  ${e.path}`);
    }
    console.log('');
  }

  if (issues.length === 0) {
    console.log(`✓ All ${total} content entries are fresh (touched within last ${STALE_MONTHS} months).`);
    return;
  }

  const byRule = new Map();
  for (const i of issues) {
    if (!byRule.has(i.rule)) byRule.set(i.rule, []);
    byRule.get(i.rule).push(i.msg);
  }
  for (const [rule, msgs] of byRule) {
    console.log(`\n[${rule}] — ${msgs.length} site(s):`);
    for (const m of msgs.slice(0, 5)) {
      console.log(`  ${m}`);
    }
    if (msgs.length > 5) console.log(`  ... and ${msgs.length - 5} more`);
  }

  console.error(`\nFAIL — ${issues.length} content-freshness-integrity issue(s).`);
  process.exit(1);
}

try {
  main();
} catch (e) {
  console.error('content-freshness-integrity scan crashed:', e);
  process.exit(2);
}