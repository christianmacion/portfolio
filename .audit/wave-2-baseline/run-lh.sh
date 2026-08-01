#!/usr/bin/env bash
# .audit/wave-2-baseline/run-lh.sh — sequential LH capture (revised)
#
# Sequential not parallel: chrome headless runs are sensitive to shared
# /user-data-dir collisions — run one at a time with --user-data-dir unique.
set -uo pipefail

HOST="http://127.0.0.1:4178"
OUT="/Users/christianmacion/Contingency/christianmacion.github.io/.audit/lighthouse/wave-2-baseline"
SUMMARY="/Users/christianmacion/Contingency/christianmacion.github.io/.audit/wave-2-baseline/lighthouse-summary.md"
mkdir -p "$OUT"

ROUTES=(
  "/"
  "/for-recruiters/"
  "/about/"
  "/proof/"
  "/projects/quant/01-deflated-sharpe/"
  "/methodology/"
)

run_lh() {
  local route="$1" ff="$2" jsonpath="$3"
  local slug
  slug=$(echo "$route" | sed -E 's|^/+||; s|/+$||; s|/|_|g')
  [ -z "$slug" ] && slug="root"
  echo "[$ff] ${route} -> $slug.json"
  if [ "$ff" = "mobile" ]; then
    lighthouse "$HOST$route" \
      --form-factor=mobile --throttling-method=simulate \
      --screenEmulation.mobile=true --screenEmulation.width=412 --screenEmulation.height=823 --screenEmulation.deviceScaleFactor=1.75 \
      --emulatedUserAgent="Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse" \
      --chrome-flags="--headless=new --user-data-dir=/tmp/lh-iso-$slug-$ff-$RANDOM" \
      --quiet --output=json \
      --output-path="$jsonpath" >/dev/null 2>"$jsonpath.log"
  else
    lighthouse "$HOST$route" \
      --preset=desktop \
      --chrome-flags="--headless=new --user-data-dir=/tmp/lh-iso-$slug-$ff-$RANDOM" \
      --quiet --output=json \
      --output-path="$jsonpath" >/dev/null 2>"$jsonpath.log"
  fi
  if [ -s "$jsonpath" ]; then
    echo "  OK ($(stat -f%z "$jsonpath") bytes)"
  else
    echo "  FAIL"
    head -3 "$jsonpath.log" 2>/dev/null | sed 's/^/    /'
  fi
}

for route in "${ROUTES[@]}"; do
  slug=$(echo "$route" | sed -E 's|^/+||; s|/+$||; s|/|_|g')
  [ -z "$slug" ] && slug="root"
  for ff in mobile desktop; do
    run_lh "$route" "$ff" "$OUT/${ff}-${slug}.json"
  done
done

# Build summary
SUMMARY_TMP="${SUMMARY}.tmp"
cat > "$SUMMARY_TMP" <<EOF
# Wave 2 Lighthouse Baseline (pre-Wave-2-ship)

- Server: \`$HOST\`
- Build: \`BASE_PATH=/\` (CF Pages prod-equivalent)
- Mode: single run per (route,form-factor) — Wave 2 verify will run 3-run median
- Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)

| Route | Form | Perf | A11y | BP | SEO | LCP (s) | TBT (ms) | CLS |
|---|---|---|---|---|---|---|---|---|
EOF

for route in "${ROUTES[@]}"; do
  slug=$(echo "$route" | sed -E 's|^/+||; s|/+$||; s|/|_|g')
  [ -z "$slug" ] && slug="root"
  for ff in mobile desktop; do
    json="$OUT/${ff}-${slug}.json"
    if [ ! -s "$json" ]; then
      echo "| $route | $ff | ERR | ERR | ERR | ERR | n/a | n/a | n/a |" >> "$SUMMARY_TMP"
      continue
    fi
    python3 - "$json" "$route" "$ff" >> "$SUMMARY_TMP" <<'PY'
import json, sys
p, route, ff = sys.argv[1:4]
try:
    d = json.load(open(p))
    cats = d.get('categories', {})
    def s(k):
        v = cats.get(k, {}).get('score')
        return f"{round(v*100)}" if v is not None else "n/a"
    a = d.get('audits', {})
    def num(audit_id, ms=False):
        v = a.get(audit_id, {}).get('numericValue')
        if v is None: return "n/a"
        if ms and v < 1000: return f"{v:.0f}"
        if v < 10: return f"{v:.2f}"
        return f"{v:.0f}"
    lcp = num('largest-contentful-paint')
    tbt = num('total-blocking-time', ms=True)
    cls = num('cumulative-layout-shift')
    print(f"| {route} | {ff} | {s('performance')} | {s('accessibility')} | {s('best-practices')} | {s('seo')} | {lcp} | {tbt} | {cls} |")
except Exception as e:
    print(f"| {route} | {ff} | ERR | ERR | ERR | ERR | n/a | n/a | n/a |")
PY
  done
done

cat >> "$SUMMARY_TMP" <<EOF

## Hard-gate thresholds (binding per \`.github/workflows/lighthouse.yml\`)

| Form | Perf | A11y | BP | SEO |
|---|---|---|---|---|
| Mobile | ≥ 0.95 | = 1.00 | = 1.00 | = 1.00 |
| Desktop | ≥ 0.98 | = 1.00 | = 1.00 | = 1.00 |

## Notes

- 3-run median reserved for Part 2 (post-Wave-2-ship) verification.
EOF

mv "$SUMMARY_TMP" "$SUMMARY"
echo ""
echo "===== SUMMARY TABLE ====="
awk -F'|' '/^\|/{gsub(/^ *| *$/,""); print}' "$SUMMARY" | head -15
