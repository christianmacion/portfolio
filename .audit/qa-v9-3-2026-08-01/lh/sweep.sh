#!/usr/bin/env bash
# v9.3 QA — Lighthouse sweep on every primary route
set -uo pipefail
LHDIR="/Users/christianmacion/Contingency/christianmacion.github.io/.audit/qa-v9-3-2026-08-01/lh"
mkdir -p "$LHDIR"
ROUTES=(
  "/" "/about/" "/ai/" "/for-recruiters/" "/proof/" "/workbooks/"
  "/methodology/" "/contact/" "/resume/" "/experience/" "/skills/"
  "/now/" "/colophon/" "/desk/" "/projects/" "/publications/"
)

for ROUTE in "${ROUTES[@]}"; do
  SAFE=$(echo "$ROUTE" | sed 's|/|_|g; s| |_|g')
  [ "$SAFE" = "_" ] && SAFE=_root
  URL="http://localhost:4399${ROUTE}"
  for RUN in 1 2 3; do
    lighthouse "$URL" \
      --quiet \
      --chrome-flags="--headless --no-sandbox --disable-dev-shm-usage" \
      --output=json \
      --output-path="${LHDIR}/m-${SAFE}-r${RUN}.json" \
      --form-factor=mobile \
      --throttling-method=simulate \
      --only-categories=performance,accessibility,best-practices,seo \
      --screenEmulation.mobile=true \
      --screenEmulation.width=412 \
      --screenEmulation.height=823 \
      --screenEmulation.deviceScaleFactor=1.75 \
      --screenEmulation.disabled=false \
      --emulatedUserAgent="Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse" \
      2>&1 | tail -1 || true
    echo "MOBILE ${ROUTE} run${RUN} done" >&2
  done
  lighthouse "$URL" \
    --quiet \
    --chrome-flags="--headless --no-sandbox --disable-dev-shm-usage" \
    --output=json \
    --output-path="${LHDIR}/d-${SAFE}.json" \
    --preset=desktop \
    --only-categories=performance,accessibility,best-practices,seo \
    2>&1 | tail -1 || true
  echo "DESKTOP ${ROUTE} done" >&2
done
echo "DONE"
