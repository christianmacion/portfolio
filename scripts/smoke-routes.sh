#!/usr/bin/env bash
# smoke-routes.sh — v9.2 fix-wave canonical smoke probe.
#
# Why this exists: the devops fix-wave AAR
# (2026-07-31-portfolio-v9-2-devops-fix-wave §4.4) recorded inline curl
# probes against the isolated mirror preview. Two of those probes were
# wrong-shaped and created false 404s:
#   1. `/graph` (and `/graph/`) — there is NO `/graph` route. The
#      dynamic features plan (RFC-2026-07-31-portfolio-v9-2-dynamic-
#      features.md) does not scope a `/graph` page; the only `graph`
#      artifact on the site is `public/graph-stream.json` (a static
#      JSON data file consumed by GraphStream.astro). The smoke probe
#      was a hallucinated route. Removed from the canonical list.
#   2. `/proof` (no trailing slash) — `astro.config.mjs` declares
#      `trailingSlash: 'always'`, so the canonical URL is `/proof/`
#      and `/proof` 404s by design. This is correct behavior, not a
#      bug. The smoke probe was wrong.
#
# This script is the canonical source-of-truth for which routes must
# return 200 on a fresh preview. It runs against a `BASE_URL` (default
# `http://localhost:4321`) and exits non-zero on any unexpected status.
#
# Usage:
#   BASE_URL=http://localhost:4321 ./scripts/smoke-routes.sh
#   BASE_URL=https://christianmacion26.github.io/portfolio ./scripts/smoke-routes.sh
#
# Coverage filter (binding per CLAUDE.md §1):
#   - INCLUDES: every route in src/pages/*.astro + the canonical
#     "home" + the 6 critical routes that the devops AAR §4.4
#     smoke-table enumerated.
#   - EXCLUDES: /graph (not a route), /500 (Astro emits 500.html
#     only on actual server errors; not a smoke target), and any
#     worktree-local `node_modules`/`.astro` paths.

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:4321}"

# All routes use trailing slashes (astro.config.mjs: trailingSlash: 'always').
# Format: "<path>|<expected_status>". Use 404 to assert the route is
# intentionally missing (none currently; the devops AAR's `/graph` was
# removed because it was a hallucinated expectation).
ROUTES=(
  "/|200"
  "/about/|200"
  "/proof/|200"
  "/projects/|200"
  "/markets/|200"
  "/research/|200"
  "/ai/|200"
  "/methodology/|200"
  "/certifications/|200"
  "/for-recruiters/|200"
  "/workbooks/|200"
  "/contact/|200"
  "/now/|200"
  "/sitemap-index.xml|200"
)

FAIL=0
PASS=0
TOTAL=${#ROUTES[@]}

for entry in "${ROUTES[@]}"; do
  path="${entry%%|*}"
  expected="${entry##*|}"
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${BASE_URL}${path}" || echo "000")
  if [ "$code" = "$expected" ]; then
    printf "  PASS  %s  (%s)\n" "$path" "$code"
    PASS=$((PASS + 1))
  else
    printf "  FAIL  %s  (expected %s, got %s)\n" "$path" "$expected" "$code"
    FAIL=$((FAIL + 1))
  fi
done

echo ""
echo "smoke-routes: ${PASS}/${TOTAL} pass, ${FAIL} fail (base=${BASE_URL})"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
