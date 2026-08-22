# workers/api-market-selected — `/api/market/selected` terminal tape

> Standalone Cloudflare Worker that aggregates Yahoo + CoinGecko + ECB
> into a single unified tape for the portfolio's live data chrome.

## Why a standalone Worker (not a CF Pages Function)

The CF Pages project `christianmacion-portfolio` was **deleted** per Owner
directive. The site is now **static on GitHub Pages**. The `functions/`
directory in the repo is **local-dev only**.

This Worker is the deployed production surface for `/api/market/selected`,
mirroring the contract from `functions/api/market/ticker.ts` (commit 88a0e59).

The endpoint is named `selected` (not `ticker`) because the public
surface calls it the "selected tape" — only a curated subset of 11
instruments are exposed (4 equities + 4 cryptos + 3 FX pairs).

## API contract (verbatim port)

```
GET /api/market/selected
```

Response (200):
```json
{
  "ok": true,
  "request_id": "…",
  "items": [
    { "sym": "SPY",   "px": 645.12, "deltaPct":  0.42, "source": "yahoo",     "currency": "USD", "label": "SPDR S&P 500 ETF" },
    { "sym": "BTC",   "px": 67234,  "deltaPct": -1.23, "source": "coingecko", "currency": "USD", "label": "bitcoin" },
    { "sym": "EUR/USD", "px": 1.1699, "deltaPct": 0,    "source": "ecb",       "currency": "USD", "label": "EUR to USD" }
  ],
  "lastSync": "2026-08-23T10:00:00.000Z",
  "sources":  { "yahoo": "2026-08-23T09:59:55Z", "coingecko": "2026-08-23T09:59:58Z", "ecb": "2026-08-22T16:00:00Z" },
  "status":   { "yahoo": "live", "coingecko": "live", "ecb": "cached" }
}
```

| Outcome | Status | Reason |
|---|---|---|
| Live / partial | `200` | tape ships with empty slots for failed sources |
| All 3 sources down | `502` | `all_sources_unavailable` |
| Sibling Worker URLs unset | `503` | `sibling_workers_not_configured` |
| Wrong path | `404` | `path_not_found` |
| Wrong method | `405` | `method_not_allowed` |

## Env contract

| Var | Required | Example |
|---|---|---|
| `FX_WORKER_URL` | yes | `https://christianmacion-market-fx.<acct>.workers.dev/api/market/fx` |
| `QUOTES_WORKER_URL` | yes | `https://christianmacion-market-quotes.<acct>.workers.dev/api/market/quotes` |
| `CRYPTO_WORKER_URL` | yes | `https://christianmacion-market-crypto.<acct>.workers.dev/api/market/crypto` |
| `ALLOWED_ORIGIN` | no | `https://christianmacion.github.io` |

The three sibling Workers must be deployed FIRST (since this aggregator
fans out to them). The `quotes` and `crypto` Workers are out of scope for
this mission; Owner to port them from `functions/api/market/quotes.ts` and
`functions/api/market/crypto.ts` using the same template.

## Caching

| Layer | TTL |
|---|---|
| `cf.cacheTtl` per sibling fetch | 60s |
| Response `Cache-Control: public, max-age=60` | 60s |

## Deploy

```bash
# 1. Deploy the three sibling Workers first (fx, quotes, crypto)
wrangler deploy --config workers/api-market-fx/wrangler.toml
# wrangler deploy --config workers/api-market-quotes/wrangler.toml   # TODO
# wrangler deploy --config workers/api-market-crypto/wrangler.toml    # TODO

# 2. Capture the deployed URLs and update [[vars]] in this wrangler.toml
# FX_WORKER_URL = "https://christianmacion-market-fx.<acct>.workers.dev/api/market/fx"
# QUOTES_WORKER_URL = "https://christianmacion-market-quotes.<acct>.workers.dev/api/market/quotes"
# CRYPTO_WORKER_URL = "https://christianmacion-market-crypto.<acct>.workers.dev/api/market/crypto"

# 3. Deploy this aggregator
wrangler deploy --config workers/api-market-selected/wrangler.toml
```

## Smoke test

```bash
URL=https://christianmacion-market-selected.<account>.workers.dev/api/market/selected

# 1. Live (all 3 sources healthy)
curl -sS "$URL" | jq '.items | length, [.status]'
# expect: 11, ["live","live","live"] or similar

# 2. CORS preflight
curl -sS -X OPTIONS "$URL" \
  -H "Origin: https://christianmacion.github.io" \
  -H "Access-Control-Request-Method: GET" -i
# expect: 204 + Access-Control-Allow-Origin: https://christianmacion.github.io

# 3. Wrong path
curl -sS "$URL/api/market/ticker" -i | head -1
# expect: 404
```

## Cross-refs

- Source-of-truth (legacy): `functions/api/market/ticker.ts`
- Sibling FX Worker: `workers/api-market-fx/`
- AAR: `~/.claude/cache/corporate/aars/portfolio-data-02-c-worker-refactor-2026-08-23.md`
- Mission: `2026-08-23-AFK-portfolio-v14`
