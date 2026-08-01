#!/usr/bin/env node
/**
 * vibe-audit-broadside-trace.mjs — Layer 3 procurement-evidence drift guard.
 *
 * Closes the specific drift pattern from rounds 1-8 chrome polish AARs:
 * the AARs claimed `@keyframes broadside-rise` shipped, but the live HTML
 * (dist/) ships 0 instances.
 *
 * Algorithm
 * ---------
 *   1. Read `git log -1 --pretty=%B` (last commit message body).
 *   2. If the commit message mentions any tracked claim keyword
 *      (broadside-rise, by default), check whether that claim is verified
 *      in the built dist/ output (CSS @keyframes + class selectors + HTML
 *      usage sites). 0 hits => FAIL.
 *   3. Also scan the most recent AAR files (~/.claude/cache/corporate/aars/)
 *      that mention the claim keyword and verify each one's claim-vs-reality.
 *
 * Exits:
 *   1  -> drift detected (AAR/commit mentions claim but dist/ has 0 hits)
 *   0  -> all claims verified, OR no claim made
 *
 * 5-must-have (per CLAUDE.md §1)
 *   1. Terminal state     -> exit 0 / 1
 *   2. Idempotent write   -> reads only (no filesystem writes)
 *   3. Dedupe key         -> claim keyword acts as the dedupe key
 *   4. Coverage filter    -> scans dist/_astro/*.css, dist/*.html, *.js
 *   5. AAR                -> stdout report (caller appends to mission AAR)
 *
 * Usage:
 *   node scripts/vibe-audit-broadside-trace.mjs                # default keyword: broadside-rise
 *   node scripts/vibe-audit-broadside-trace.mjs --keyword "broadside-rise,hero-spiral"
 *   node scripts/vibe-audit-broadside-trace.mjs --dist ./dist   # override dist path
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";

const args = process.argv.slice(2);
function getArg(flag, def) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : def;
}

const KEYWORDS = (getArg("--keyword", "broadside-rise") || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const DIST = resolve(getArg("--dist", "./dist"));
const AAR_DIR = resolve(
  getArg("--aar-dir", `${process.env.HOME}/.claude/cache/corporate/aars`),
);
const SINCE = getArg("--since", "2026-07-30"); // chrome polish rounds 1-8 window
const AAR_LOOKBACK = Number.parseInt(getArg("--aar-lookback", "30"), 10);

function repoRoot() {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf-8",
  }).trim();
}

function lastCommitMessage(root) {
  return execFileSync("git", ["log", "-1", "--pretty=%B"], {
    encoding: "utf-8",
    cwd: root,
  }).trim();
}

function lastCommitSubject(root) {
  return execFileSync("git", ["log", "-1", "--pretty=%s"], {
    encoding: "utf-8",
    cwd: root,
  }).trim();
}

function* walkFiles(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    let s;
    try {
      s = statSync(p);
    } catch {
      continue;
    }
    if (s.isDirectory()) yield* walkFiles(p);
    else yield p;
  }
}

function fileHits(file, keywords) {
  let text;
  try {
    text = readFileSync(file, "utf-8");
  } catch {
    return {};
  }
  const out = {};
  for (const k of keywords) {
    // count occurrences of the keyword, require word-boundary-ish matches
    const re = new RegExp(escapeRe(k), "g");
    const matches = text.match(re);
    if (matches && matches.length > 0) {
      out[k] = matches.length;
    }
  }
  return out;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scanDist(dist, keywords) {
  const counts = Object.fromEntries(keywords.map((k) => [k, 0]));
  const files = [];
  if (!existsSync(dist)) return { counts, files };
  for (const f of walkFiles(dist)) {
    if (!/\.(css|html|js|mjs)$/i.test(f)) continue;
    const hits = fileHits(f, keywords);
    for (const k of keywords) {
      if (hits[k]) {
        counts[k] += hits[k];
        files.push({ file: f, keyword: k, count: hits[k] });
      }
    }
  }
  return { counts, files };
}

function scanAARs(aarDir, keywords, lookbackDays) {
  const findings = [];
  if (!existsSync(aarDir)) return findings;
  const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  for (const f of readdirSync(aarDir)) {
    if (!f.endsWith(".md")) continue;
    const p = join(aarDir, f);
    let s;
    try {
      s = statSync(p);
    } catch {
      continue;
    }
    if (s.mtimeMs < cutoff) continue;
    const text = readFileSync(p, "utf-8");
    for (const k of keywords) {
      if (text.includes(k)) {
        findings.push({ aar: f, keyword: k, mtime: s.mtime.toISOString() });
      }
    }
  }
  return findings;
}

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function main() {
  const root = repoRoot();
  const subject = lastCommitSubject(root);
  const body = lastCommitMessage(root);
  const fullMsg = `${subject}\n${body}`;

  console.log(`${BOLD}vibe-audit-broadside-trace${RESET}`);
  console.log(`keywords:    ${KEYWORDS.join(", ")}`);
  console.log(`dist:        ${DIST}`);
  console.log(`aar-dir:     ${AAR_DIR}`);
  console.log(`commit:      ${subject}`);
  console.log("");

  const distScan = scanDist(DIST, KEYWORDS);
  const aarHits = scanAARs(AAR_DIR, KEYWORDS, AAR_LOOKBACK);

  // Identify drift: any keyword mentioned in commit msg or recent AAR
  // but missing from dist/.
  const drift = [];
  for (const k of KEYWORDS) {
    const mentionedInCommit = fullMsg.toLowerCase().includes(k.toLowerCase());
    const mentionedInAAR = aarHits.some((h) => h.keyword === k);
    const inDist = distScan.counts[k] > 0;
    if ((mentionedInCommit || mentionedInAAR) && !inDist) {
      drift.push({
        keyword: k,
        inCommit: mentionedInCommit,
        inAAR: mentionedInAAR,
        inDist,
        aarFiles: aarHits.filter((h) => h.keyword === k).map((h) => h.aar),
      });
    }
  }

  if (drift.length > 0) {
    console.log(`${RED}${BOLD}DRIFT DETECTED${RESET}`);
    for (const d of drift) {
      console.log(
        `  ${RED}claim: "${d.keyword}" mentioned but dist/ has 0 instances${RESET}`,
      );
      if (d.inCommit) console.log(`    - commit msg: YES`);
      if (d.inAAR) console.log(`    - AAR files:   ${d.aarFiles.join(", ")}`);
    }
    console.log("");
    console.log(`${RED}This is procurement-evidence drift: the AAR claims the`);
    console.log(`feature shipped, but the built site has 0 instances. Either`);
    console.log(`revert the AAR claim or land the missing CSS/HTML.${RESET}`);
    process.exit(1);
  }

  // Verify-only path: no claim was made — emit a positive report.
  if (aarHits.length === 0 && !KEYWORDS.some((k) => fullMsg.toLowerCase().includes(k.toLowerCase()))) {
    console.log(`${GREEN}${BOLD}PASS${RESET} - no broadside-rise-style claim made in commit or recent AARs`);
    process.exit(0);
  }

  // Claim was made and dist/ has hits — verified.
  console.log(`${GREEN}${BOLD}PASS${RESET} - claim(s) verified against dist/`);
  for (const k of KEYWORDS) {
    console.log(`  ${GREEN}"${k}": ${distScan.counts[k]} hit(s) in dist/${RESET}`);
    for (const f of distScan.files.filter((x) => x.keyword === k).slice(0, 5)) {
      console.log(`    - ${relative(root, f.file)} (${f.count})`);
    }
  }
  process.exit(0);
}

main();
