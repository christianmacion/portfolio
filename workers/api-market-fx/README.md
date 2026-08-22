# workers/api-market-fx — `/api/market/fx` ECB FX proxy

> Standalone Cloudflare Worker that proxies the ECB SDMX reference rates
> (EUR-anchored) for the portfolio's converter UI and live tape.

## Why a standalone Worker (not a CF Pages Function)

The CF Pages project `christianmacion-portfolio` was **deleted** per Owner
directive. The site is now **static on GitHub Pages**. The `functions/`
directory in the repo is **local-dev only**.

This Worker is the deployed production surface for `/api/market/fx`,
mirroring the contract from `functions/api/market/fx.ts` (commit 88a0e59).

## API contract (verbatim port)

```
GET /api/market/fx
```

Response (200):
```json
{
  "ok": true,
  "request_id": "…",
  "source": "ecb",
  "items": [
    { "pair": "EUR/USD", "px": 1.1699, "base": "EUR", "quote": "USD" },
    { "pair": "GBP/USD", "px": 1.3656, "base": "GBP", "quote": "USD" },
    { "pair": "USD/JPY", "px": 158.70, "base": "USD", "quote": "JPY" }
  ],
  "lastSync": "2026-08-23T10:00:00.000Z"
}
```

| Outcome | Status | Reason |
|---|---|---|
| Live | `200` | normal |
| Upstream unreachable | `502` | `ecb_unreachable` |
| Upstream 4xx/5xx | `502` | `ecb_<status>` |
| CSV parse fail | `502` | `ecb_invalid_csv` |
| No valid rows | `502` | `ecb_no_valid_rows` |
| Wrong path | `404` | `path_not_found` |
| Wrong method | `405` | `method_not_allowed` |

## ECB URL (live-verified 2026-08-23)

```
https://data-api.ecb.europa.eu/service/data/EXR/D.USD+GBP+JPY.EUR.SP00.A?format=csvdata&lastNObservations=1
```

Notes:
- `service/data/EXR/D.` is the canonical path. The legacy `/data/exr/<symbols>`
  shortcut returns 404 — DO NOT revert.
- `lastNObservations=1` caps payload to the latest row per series (~4KB).
- Returns one row per (base, EUR) pair; alphabetical by base code.

## Caching

| Layer | TTL | Why |
|---|---|---|
| `cf.cacheTtl` on upstream fetch | 3600s | ECB publishes once per biz day |
| Response `Cache-Control: public, max-age=60` | 60s | Browser revalidation cadence |

## Deploy

```bash
# 1. Optional: KV namespace (only if you wire CACHE for debug)
# wrangler kv:namespace create CACHE
# paste the returned `id` into wrangler.toml [[kv_namespaces]]

# 2. Deploy (no secrets required for this endpoint)
wrangler deploy --config workers/api-market-fx/wrangler.toml
```

Output URL will be something like:
```
https://christianmacion-market-fx.<account-subdomain>.workers.dev/api/market/fx
```

## Smoke test

```bash
URL=https://christianmacion-market-fx.<account>.workers.dev/api/market/fx

# 1. Live
curl -sS "$URL" | jq '.items'
# expect: 3 rows (EUR/USD, GBP/USD, USD/JPY) within ±0.15% of spot

# 2. CORS preflight
curl -sS -X OPTIONS "$URL" \
  -H "Origin: https://christianmacion.github.io" \
  -H "Access-Control-Request-Method: GET" -i
# expect: 204 + Access-Control-Allow-Origin: https://christianmacion.github.io

# 3. Wrong path
curl -sS "$URL/api/market/wrong" -i | head -1
# expect: 404

# 4. Wrong method
curl -sS -X POST "$URL" -i | head -1
# expect: 405
```

## Cross-refs

- Source-of-truth (legacy): `functions/api/market/fx.ts`
- ECB URL fix pattern: `~/.claude/projects/-Users-christianmacion/memory/2026-08-23-ecb-sdmx-url-direction-fix-pattern.md`
- AAR: `~/.claude/cache/corporate/aars/portfolio-data-02-c-worker-refactor-2026-08-23.md`
- Mission: `2026-08-23-AFK-portfolio-v14`
