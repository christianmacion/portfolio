#!/usr/bin/env node
/**
 * vibe-audit-staged.mjs — Layer 1 pre-commit gate.
 *
 * Runs `apply_vibe_audit.py` against each staged file (in coverage filter),
 * aggregates tells by severity, and exits:
 *   1  if any SEV-5 or SEV-4 tell is introduced  (BLOCK commit)
 *   0  otherwise  (clean) — emits SEV-3 warnings to stderr but does NOT block
 *
 * Why this exists
 * ---------------
 * Rounds 1-8 of chrome polish AARs claimed `broadside-rise` shipped, but the
 * live HTML ships 0 instances.  This is procurement-evidence drift:
 * a tell was claimed in an AAR but never actually landed in the working tree.
 * Layer 1 (this script) closes the local-feedback loop so a vibe tell cannot
 * silently enter a commit.
 *
 * Layer 2 (CI: .github/workflows/vibe-audit.yml) is the sibling for PR + push.
 * Layer 3 (scripts/vibe-audit-broadside-trace.mjs) catches the specific drift
 * pattern: AAR claims a keyframe shipped, but dist/ has 0 instances.
 *
 * 5-must-have (per CLAUDE.md §1)
 *   1. Terminal state     -> exit 0 (clean / SEV-3 warn) or 1 (SEV-4/5)
 *   2. Idempotent write   -> reads only; writes only to stdout/stderr
 *   3. Dedupe key         -> per-file audit cache (delegated to apply_vibe_audit)
 *   4. Coverage filter    -> filters staged files to vibe-audit extensions
 *   5. AAR                -> apply_vibe_audit writes its own AAR
 *
 * Usage:
 *   node scripts/vibe-audit-staged.mjs                # all staged files
 *   node scripts/vibe-audit-staged.mjs --quiet        # suppress SEV-3 noise
 *   VIBE_AUDIT_TOOL=path/to/apply_vibe_audit.py node scripts/vibe-audit-staged.mjs
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, relative } from "node:path";

const COVERAGE_EXTS = new Set([
  ".html", ".htm", ".css", ".scss",
  ".md", ".mdx",
  ".astro", ".tsx", ".jsx", ".vue", ".svelte",
  ".liquid", ".pug", ".haml", ".erb",
  ".ts",
]);

const DEFAULT_TOOL = `${process.env.HOME}/.claude/skills/webcraft-no-vibe/apply_vibe_audit.py`;

const args = process.argv.slice(2);
const QUIET = args.includes("--quiet") || args.includes("-q");

function repoRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
    }).trim();
  } catch {
    return process.cwd();
  }
}

function stagedFiles(root) {
  const out = execFileSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
    { encoding: "utf-8", cwd: root },
  );
  return out
    .split("\0")
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) => resolve(root, f));
}

function inCoverage(p) {
  const dot = p.lastIndexOf(".");
  if (dot < 0) return false;
  return COVERAGE_EXTS.has(p.slice(dot).toLowerCase());
}

function runAudit(tool, file) {
  const r = spawnSync("python3", [tool, "audit", file], {
    encoding: "utf-8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    status: r.status,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
  };
}

function parseTells(auditOut) {
  const lines = auditOut.split("\n");
  const tells = [];
  let inTells = false;
  for (const line of lines) {
    if (line.startsWith("## Top tells")) {
      inTells = true;
      continue;
    }
    if (inTells && line.startsWith("|----------")) continue;
    if (inTells && line.startsWith("| Severity")) continue;
    if (inTells && line.startsWith("| ") && line.includes("|")) {
      const cells = line
        .replace(/^\| /, "")
        .replace(/ \|$/, "")
        .split(" | ")
        .map((s) => s.trim());
      const sev = Number.parseInt(cells[0], 10);
      if (Number.isInteger(sev) && sev >= 1) {
        tells.push({
          severity: sev,
          id: cells[1],
          category: cells[2],
          file: cells[3].replace(/`/g, ""),
          label: cells[4],
        });
      }
    } else if (inTells && !line.startsWith("|") && line.trim() !== "") {
      break;
    }
  }
  return tells;
}

function colorize(s, code) {
  if (process.env.NO_COLOR || !process.stdout.isTTY) return s;
  return `\x1b[${code}m${s}\x1b[0m`;
}

const RED = (s) => colorize(s, "31");
const YELLOW = (s) => colorize(s, "33");
const GREEN = (s) => colorize(s, "32");
const BOLD = (s) => colorize(s, "1");

function main() {
  const root = repoRoot();
  const tool = process.env.VIBE_AUDIT_TOOL || DEFAULT_TOOL;

  if (!existsSync(tool)) {
    console.error(`vibe-audit-staged: tool not found: ${tool}`);
    console.error(`Set VIBE_AUDIT_TOOL=<path-to-apply_vibe_audit.py>`);
    process.exit(2);
  }

  const files = stagedFiles(root).filter(inCoverage);
  if (files.length === 0) {
    if (!QUIET) {
      console.log(
        GREEN("vibe-audit-staged: no staged files in coverage filter - PASS"),
      );
    }
    process.exit(0);
  }

  if (!QUIET) {
    console.log(
      BOLD(`vibe-audit-staged: auditing ${files.length} staged file(s)`),
    );
  }

  let allTells = [];

  for (const file of files) {
    const rel = relative(root, file);
    const { status, stdout, stderr } = runAudit(tool, file);
    if (status === 2) {
      console.error(`vibe-audit-staged: SKIP ${rel} (no coverage match)`);
      continue;
    }
    if (status !== 0 && status !== 1) {
      console.error(`vibe-audit-staged: tool error on ${rel} (exit ${status})`);
      console.error(stderr);
      continue;
    }
    const tells = parseTells(stdout);
    if (tells.length > 0) {
      allTells = allTells.concat(tells.map((t) => ({ ...t, file: rel })));
    }
  }

  allTells.sort((a, b) => b.severity - a.severity);

  const sev5 = allTells.filter((t) => t.severity === 5);
  const sev4 = allTells.filter((t) => t.severity === 4);
  const sev3 = allTells.filter((t) => t.severity === 3);

  if (!QUIET) {
    console.log("");
    console.log(
      BOLD("vibe-audit-staged summary:") +
        ` sev5=${sev5.length} sev4=${sev4.length} sev3=${sev3.length} files_audited=${files.length}`,
    );
  }

  if (sev5.length > 0 || sev4.length > 0) {
    console.error("");
    console.error(
      RED(BOLD(`BLOCK: SEV-5/4 tell(s) introduced - commit refused`)),
    );
    console.error(
      RED(
        `Auto-fail category signal (SEV-5) or major tells (SEV-4) detected in staged files.`,
      ),
    );
    console.error("");
    for (const t of allTells.filter((t) => t.severity >= 4)) {
      console.error(
        RED(`  [SEV-${t.severity}] ${t.id} ${t.file} - ${t.label}`),
      );
    }
    console.error("");
    console.error(
      RED(`Reference: ~/.claude/skills/webcraft-no-vibe/VIBE-DOCTRINE.md`),
    );
    console.error(
      RED(`Bypass:    git commit --no-verify  (NOT recommended; CI will still fail)`),
    );
    process.exit(1);
  }

  if (sev3.length > 0) {
    console.error("");
    console.error(
      YELLOW(BOLD(`WARN: SEV-3 tell(s) present (not blocking):`)),
    );
    for (const t of sev3) {
      console.error(
        YELLOW(`  [SEV-${t.severity}] ${t.id} ${t.file} - ${t.label}`),
      );
    }
    console.error(
      YELLOW(
        `These do not block the commit but should be reviewed before merge.`,
      ),
    );
    process.exit(0);
  }

  if (!QUIET) {
    console.log("");
    console.log(
      GREEN(
        BOLD(`vibe-audit-staged: PASS - ${files.length} staged file(s) clean`),
      ),
    );
  }
  process.exit(0);
}

main();
