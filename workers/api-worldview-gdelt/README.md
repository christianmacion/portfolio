# workers/api-worldview-gdelt — `/api/worldview/gdelt` GDELT 2.0 proxy

> Standalone Cloudflare Worker that proxies GDELT 2.0 geo-tagged news
> events for the portfolio's WorldView globe.

## Why a standalone Worker (not a CF Pages Function)

The CF Pages project `christianmacion-portfolio` was **deleted** per Owner
directive. The site is now **static on GitHub Pages**. The `functions/`
directory in the repo is **local-dev only**.

This Worker is the deployed production surface for `/api/worldview/gdelt`,
mirroring the contract from `functions/api/worldview/gdelt.ts` (commit 88a0e59).

## API contract (verbatim port)

```
GET /api/worldview/gdelt
GET /api/worldview/gdelt?url=<encoded-gdelt-export-url>
```

Response (200):
```json
{
  "ok": true,
  "request_id": "…",
  "events": [
    {
      "id": "LIVE-abc12345",
      "title": "GDELT 2.0 · live pull · 10:00:00Z",
      "category": "data-pull",
      "severity": "mild",
      "lat": 0, "lon": 0,
      "city": "edge",
      "source": "data-source-pull",
      "timestamp": "2026-08-23T10:00:00.000Z"
    },
    {
      "id": "GDELT-12345678",
      "title": "Actor A ↔ Actor B · Frankfurt",
      "category": "central-bank",
      "severity": "moderate",
      "lat": 50.11, "lon": 8.68,
      "city": "Frankfurt",
      "source": "GDELT 2.0",
      "timestamp": "2026-08-22T16:00:00.000Z",
      "goldstein": 2.5
    }
  ],
  "lastSync": "2026-08-23T10:00:00.000Z"
}
```

| Outcome | Status | Reason |
|---|---|---|
| Live | `200` | normal |
| Manifest unavailable | `502` | `gdelt_manifest_unavailable` |
| URL not GDELT domain | `422` | `url_not_gdelt` |
| Invalid URL syntax | `422` | `invalid_url` |
| Wrong path | `404` | `path_not_found` |
| Wrong method | `405` | `method_not_allowed` |

## How it works

1. Fetch `https://data.gdeltproject.org/gdeltv2/lastupdate.txt` (no edge
   cache; GDELT updates every 15 min).
2. Parse line 2 for the latest `.export.CSV.zip` URL.
3. Validate URL is on `data.gdeltproject.org` (SSRF guard).
4. Download the ZIP (60s edge cache).
5. Inflate the embedded CSV using `DecompressionStream('deflate')`
   (zlib-wrapped; Workers supports it natively).
6. Sample 6 events with valid lat/lon (stride = rows/1200).
7. Prepend a `LIVE-<rid>` seed event so the chrome always shows activity.

## Caching

| Layer | TTL | Why |
|---|---|---|
| Manifest pull (`cf.cacheTtl`) | 0s | GDELT updates every 15 min |
| Export ZIP pull (`cf.cacheTtl`) | 60s | Same export URL is stable for 15 min |
| Response `Cache-Control` | 60s | Browser revalidation cadence |

## SSRF guard

The `?url=` parameter is **whitelisted to `data.gdeltproject.org`**. Any
other host returns 422 `url_not_gdelt`. This prevents an attacker from
pointing the Worker at internal Cloudflare metadata (`169.254.0.0/16`)
or other private IPs.

## Deploy

```bash
# 1. Optional: KV namespace (only if you wire CACHE for debug)
# wrangler kv:namespace create CACHE
# paste the returned `id` into wrangler.toml [[kv_namespaces]]

# 2. Deploy (no secrets required)
wrangler deploy --config workers/api-worldview-gdelt/wrangler.toml
```

## Smoke test

```bash
URL=https://christianmacion-worldview-gdelt.<account>.workers.dev/api/worldview/gdelt

# 1. Live
curl -sS "$URL" | jq '.events | length'
# expect: 1..7 (1 seed + up to 6 real)

# 2. SSRF guard — should reject non-GDELT URL
curl -sS "$URL?url=https://evil.example.com/x" | jq '.reason'
# expect: "url_not_gdelt"

# 3. CORS preflight
curl -sS -X OPTIONS "$URL" \
  -H "Origin: https://christianmacion.github.io" \
  -H "Access-Control-Request-Method: GET" -i
# expect: 204 + Access-Control-Allow-Origin: https://christianmacion.github.io
```

## Cross-refs

- Source-of-truth (legacy): `functions/api/worldview/gdelt.ts`
- AAR: `~/.claude/cache/corporate/aars/portfolio-data-02-c-worker-refactor-2026-08-23.md`
- Mission: `2026-08-23-AFK-portfolio-v14`
