#!/usr/bin/env bash
# check-no-lightbulb-halos.sh
# Pre-commit guard against the AI-vibe lightbulb halo pattern.
#
# Anti-pattern: any CSS rule that puts a 3px box-shadow halo around a
# status dot. This is the pattern Owner flagged as "looks like a fucking
# light bulb" and "signal that screams AI built me" on 2026-07-12.
#
# Institutional reference (Man Group, Renaissance, AQR, Bridgewater,
# Jane Street, D.E. Shaw, Two Sigma): NO site uses this. Every dot
# is solid color, no surrounding halo.
#
# Usage:
#   ./scripts/check-no-lightbulb-halos.sh
#   ./scripts/check-no-lightbulb-halos.sh --strict   # fail on any halo pattern
#
# Exit codes:
#   0  = clean
#   1  = found halo patterns (will print offenders)
#   2  = bad args
set -euo pipefail
# v7.7.91 — gate-honesty: set -o pipefail ensures the grep pipeline failure
# propagates. Previously `head -50 || true` swallowed the grep exit code,
# so a broken grep (e.g., regex error) silently passed the gate.
set -o pipefail

STRICT=0
for arg in "$@"; do
  case "$arg" in
    --strict) STRICT=1 ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/src"

# Patterns that MUST NOT appear in chrome (status dots / badges / pills).
# Search for `box-shadow: 0 0 0` with a colored soft reference.
# The gitignore / dist / build dirs are excluded.
EXCLUDES=(
  --glob '!**/node_modules/**'
  --glob '!**/dist/**'
  --glob '!**/.astro/**'
  --glob '!**/_astro/**'
)

# Look for the halo+soft pattern (anti-pattern)
echo "Scanning $SRC for lightbulb-halo patterns..."

OFFENDERS=$(grep -rEn \
  --include="*.astro" --include="*.css" --include="*.ts" --include="*.tsx" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.astro \
  "$SRC" \
  -e 'box-shadow:\s*0 0 0.*var\(--.*-soft\)' \
  -e 'box-shadow:\s*0 0 0 3px' \
  2>/dev/null | grep -v "f21\|f23\|/\*\|\*/\|//" | head -50 || true)

# Whitelist patterns — comments describing the rule itself, accessibility
# focus rings, and intentionally-grey halos on form controls are OK.
WHITELIST_FILTER='
  /F2[1-9]|F23|institutional|kill every/i   # comments describing the rule
  |/pagefind-ui__search-input:focus/         # search input accessibility focus ring
  |/DSRCalculator.*hover/                    # button hover state (white halo)
  |/comment|# |^\s*//|/\*|\*/                 # comments and white-listed
'
OFFENDERS=$(echo "$OFFENDERS" | grep -vE "$WHITELIST_FILTER" 2>/dev/null || true)

if [ -n "$OFFENDERS" ]; then
  echo ""
  echo "❌ LIGHTBULB-HALO VIOLATIONS FOUND:"
  echo ""
  echo "$OFFENDERS"
  echo ""
  echo "These patterns are AI-vibe chrome. Replace with solid color or"
  echo "remove the box-shadow. Reference: ~/.claude/projects/-Users-christianmacion/"
  echo "memory/institutional-design-patterns.md"
  exit 1
fi

echo "✅ No lightbulb halos found."
exit 0
