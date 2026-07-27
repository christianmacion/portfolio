// check-cross-reference-integrity.mjs — v7.7.31 CROSS-REFERENCE-INTEGRITY CI GATE
//
// Catches content-collection entries referencing missing or stale assets
// before ship. Walks src/content/** for /proof/*.jpg references and
// https?:// external URLs. Verifies each /proof/ ref against the public/
// filesystem. HEAD-checks each external URL with a short timeout.
//
// Companion gates:
//   - scripts/check-content-freshness-integrity.mjs (v7.7.29) — git timestamp
//   - scripts/check-frontmatter-required-fields.mjs (v7.7.30) — frontmatter date
//   - scripts/check-link-rot.mjs (v7.7.13) — production live-link HEAD check
//
// Rules enforced:
//   1. Every /proof/<file>.jpg ref MUST exist in public/proof/<file>.jpg
//   2. Every /proof/<file>.{mp4,svg,png,webp,jpeg} ref MUST exist
//   3. Every https?:// external URL MUST return 2xx (HEAD with 4s timeout)
//   4. (Informational) list all unreferenced public/proof/* files
//
// Skips:
//   - localhost / 127.0.0.1 / christianmacion-portfolio.pages.dev /
//     christianmacion26.github.io (own-site self-refs are verified by
//     other gates; HEAD against CF Pages from CI is unreliable)
//   - URLs ending in mailto:, tel:, #anchor
//
// Exits 1 on any fail. Exits 0 otherwise.
// Used in: npm run ci (after frontmatter:required:fields, before audit).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CONTENT_ROOT = 'src/content';
const PROOF_DIR = 'public/proof';
const HEAD_TIMEOUT_MS = 4000;
const MAX_CONCURRENT = 8;

const SKIP_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  'christianmacion-portfolio.pages.dev',
  'christianmacion26.github.io',
]);

const ALLOWED_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'svg', 'mp4', 'gif'];

function* walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.endsWith('.md') || e.name.endsWith('.mdx')) yield full;
  }
}

function extractProofRefs(content) {
  const refs = new Set();
  // Match /proof/<path>.<ext> with reasonable filename chars
  const re = /\/proof\/[a-zA-Z0-9._/-]+\.(jpg|jpeg|png|webp|svg|mp4|gif)/g;
  let m;
  while ((m = re.exec(content)) !== null) refs.add(m[0]);
  return refs;
}

function extractExternalUrls(content) {
  const urls = new Set();
  const re = /https?:\/\/[^\s)"'<>]+/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const url = m[0].replace(/[.,;:!?]+$/, ''); // strip trailing punctuation
    if (url.startsWith('mailto:') || url.startsWith('tel:')) continue;
    try {
      const u = new URL(url);
      if (SKIP_HOSTS.has(u.hostname)) continue;
      urls.add(url);
    } catch {
      // invalid URL — flag below
    }
  }
  return urls;
}

async function headCheck(url) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), HEAD_TIMEOUT_MS);
    // Use GET with Range: bytes=0-0 (HEAD-equivalent, less likely to be blocked)
    const r = await fetch(url, {
      method: 'GET',
      signal: ctl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PortfolioLinkBot/1.0; +https://christianmacion.com)',
        'Range': 'bytes=0-0',
      },
    });
    clearTimeout(t);
    // Consume body to free connection
    await r.text().catch(() => {});
    return { status: r.status, ok: r.ok };
  } catch (e) {
    return { status: 0, ok: false, error: e.message };
  }
}

async function checkUrls(urls) {
  const results = new Map();
  const urlArr = [...urls];
  let cursor = 0;
  async function worker() {
    while (cursor < urlArr.length) {
      const idx = cursor++;
      const url = urlArr[idx];
      results.set(url, await headCheck(url));
    }
  }
  const workers = Array.from({ length: Math.min(MAX_CONCURRENT, urlArr.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function audit() {
  const issues = [];
  const referencedProofs = new Set();
  const referencedUrls = new Set();
  const fileCount = { total: 0, withRefs: 0 };

  for (const f of walk(CONTENT_ROOT)) {
    fileCount.total++;
    const content = readFileSync(f, 'utf8');
    const proofRefs = extractProofRefs(content);
    const extUrls = extractExternalUrls(content);
    if (proofRefs.size === 0 && extUrls.size === 0) continue;
    fileCount.withRefs++;

    for (const ref of proofRefs) referencedProofs.add(ref);
    for (const u of extUrls) referencedUrls.add(u);
  }

  // Rule 1 + 2 — every referenced proof file MUST exist in public/proof/
  for (const ref of referencedProofs) {
    // /proof/foo.jpg → public/proof/foo.jpg
    const localPath = join('public', ref);
    let exists = false;
    try {
      exists = statSync(localPath).isFile();
    } catch {
      exists = false;
    }
    if (!exists) {
      issues.push({
        rule: 'missing-proof-file',
        msg: `${ref} is referenced but not found at ${localPath}`,
      });
    }
  }

  // Informational — unreferenced proof files (not a fail)
  const unreferenced = [];
  try {
    const onDisk = readdirSync(PROOF_DIR);
    for (const f of onDisk) {
      const ref = `/proof/${f}`;
      if (!referencedProofs.has(ref) && ALLOWED_EXTS.some((ext) => f.endsWith(`.${ext}`))) {
        unreferenced.push(f);
      }
    }
  } catch {
    // public/proof/ missing — not a fail; flag as warning
  }

  // Rule 3 — every external URL MUST return 2xx (HEAD)
  console.log(`\n  Checking ${referencedUrls.size} external URL(s) (HEAD, ${HEAD_TIMEOUT_MS}ms timeout, max ${MAX_CONCURRENT} concurrent)...`);
  const urlResults = await checkUrls(referencedUrls);
  for (const [url, r] of urlResults) {
    if (!r.ok) {
      issues.push({
        rule: 'dead-external-url',
        msg: `${url} → status ${r.status}${r.error ? ` (${r.error})` : ''}`,
      });
    }
  }

  return { issues, referencedProofs, fileCount, unreferenced, urlResults };
}

async function main() {
  console.log('=== Cross-Reference-Integrity Audit (v7.7.31) — proof files + external URLs ===\n');

  const { issues, referencedProofs, fileCount, unreferenced } = await audit();

  console.log(`Scanned ${fileCount.total} content entries · ${fileCount.withRefs} reference proofs/URLs · ${referencedProofs.size} unique proof refs · ${issues.length} issue(s)\n`);

  if (unreferenced.length > 0) {
    console.log(`Unreferenced public/proof/* files (informational, ${unreferenced.length}):`);
    for (const f of unreferenced) console.log(`  /proof/${f}`);
    console.log('');
  }

  if (issues.length === 0) {
    console.log(`✓ All ${referencedProofs.size} proof refs resolve · all external URLs 2xx.`);
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

  console.error(`\nFAIL — ${issues.length} cross-reference-integrity issue(s).`);
  process.exit(1);
}

main().catch((e) => {
  console.error('cross-reference-integrity scan crashed:', e);
  process.exit(2);
});