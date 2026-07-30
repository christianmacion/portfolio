#!/usr/bin/env bash
# check-no-halo.sh — v7.7.91 GATE-HONESTY
# Pre-commit guard against the halo/glow `box-shadow: 0 0 N px` pattern.
#
# Anti-pattern: any CSS rule that puts a glow `box-shadow: 0 0 Npx` around a
# shape. This is the AI-vibe halo Owner flagged in the chrome contract
# (no halo / no glow / no gradient / 0/2px radii only / hairline borders).
#
# Institutional reference (Man Group, Renaissance, AQR, Bridgewater,
# Jane Street, D.E. Shaw, Two Sigma): zero glow halo chrome anywhere.
#
# v7.7.91 — REPLACED the broken inline `grep -rn 'box-shadow:\\s*0\\s*0\\s*[1-9][0-9]'`
# command in package.json:109. The inline version used literal `\s` without
# `-E` (POSIX BRE), so it never matched anything and always PASSED — a lying
# gate. This script uses POSIX ERE with `-E` to actually match the pattern.
#
# Usage:
#   ./scripts/check-no-halo.sh
#
# Exit codes:
#   0  = clean
#   1  = found halo patterns (will print offenders)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/src"

# Pattern matches any of:
#   - box-shadow: 0 0 4px ...        (literal two-zero glow halo)
#   - box-shadow: 0 0 24px ...       (larger glow halo)
#   - drop-shadow(0 0 Npx ...)      (SVG drop-shadow filter halo)
# The regex is wrapped with POSIX ERE (`grep -E`) so `\s` is interpreted as
# whitespace and the script cannot silently no-op like the old inline did.
HALO_PATTERN='box-shadow:[[:space:]]*0[[:space:]]*0[[:space:]]*[1-9][0-9]|drop-shadow\(0[[:space:]]+0[[:space:]]+[1-9]'

OFFENDERS=$(grep -rEn \
  --include="*.astro" --include="*.css" --include="*.ts" --include="*.tsx" --include="*.html" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.astro --exclude-dir=_astro \
  "$SRC" \
  -e "$HALO_PATTERN" \
  2>/dev/null | grep -vE '/\*|\*/|//' | head -100 || true)

if [ -n "$OFFENDERS" ]; then
  echo ""
  echo "FAIL: halo/glow patterns detected:"
  echo ""
  echo "$OFFENDERS"
  echo ""
  echo "These patterns violate the chrome contract. Replace with hairline"
  echo "borders (border: 1px solid var(--c-rule)) or remove the box-shadow."
  exit 1
fi

echo "PASS: no halo/glow box-shadows or drop-shadow filters"
exit 0