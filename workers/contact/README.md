# workers/contact — `/api/contact` email backend

> Standalone Cloudflare Worker that relays visitor contact-form submissions
> from the static portfolio site to the Owner's inbox.

## Why a standalone Worker (not a CF Pages Function)

The CF Pages project `christianmacion-portfolio` was **deleted** per Owner
directive ("we just need the live site. and in GH"). The site is now
**static on GitHub Pages**. The `functions/` directory in the repo is
**local-dev only** per `wrangler.toml:1-4` — those routes don't run in
production.

A standalone Worker can be deployed independently to its own
`wrangler deploy` target, with its own route and KV binding, without
re-opening Pages. This also keeps the email surface on a separate
origin (e.g. `api.christianmacion.com`), so the static site's CSP
`connect-src 'self'` does not need to be relaxed.

## API contract

```
POST  /api/contact
Body  : Content-Type: application/json
        {
          "name":    "Jane Doe",          // 2..80 chars, unicode letters/digits
          "email":   "jane@example.com",  // RFC-light, lowercased
          "subject": "Hiring · senior QR", // 3..120 chars
          "message": "One paragraph…",    // 20..4000 chars
          "source":  "portfolio/contact", // optional, ≤64 chars (informational)
          "ts":      "2026-08-23T10:00:00Z", // optional, ISO-shaped (informational)
          "website": ""                   // HONEYPOT — must be empty
        }
```

| Outcome | Status | Body |
|---|---|---|
| Sent | `200` | `{ ok: true, status: "sent", request_id, provider_id }` |
| Duplicate (same body within 1h) | `200` | `{ ok: true, status: "queued", duplicate: true }` |
| Honeypot triggered | `200` | `{ ok: true, status: "queued", silent: true }` (NO email sent) |
| Bad input | `400` | `{ ok: false, code: "VALIDATION_ERROR", reason }` |
| Bad Content-Type | `415` | `{ ok: false, code: "VALIDATION_ERROR", reason: "content_type_must_be_json" }` |
| Oversize body | `413` | `{ ok: false, code: "VALIDATION_ERROR", reason: "body_too_large" }` |
| Wrong path | `404` | `{ ok: false, code: "NOT_FOUND" }` |
| Wrong method | `405` | `{ ok: false, code: "METHOD_NOT_ALLOWED" }` |
| Rate-limited (>5/min/IP) | `429` | `{ ok: false, code: "RATE_LIMIT", reset_minute }` |
| Backend missing (env) | `503` | `{ ok: false, code: "EMAIL_BACKEND_UNCONFIGURED", reason }` |
| Send failure | `502` | `{ ok: false, code: "UPSTREAM_UNAVAILABLE" }` |

## Privacy guarantees

1. **Owner's email** lives in `env.OWNER_EMAIL` only. It never appears
   in the request body, the response body, or any error envelope.
2. **Visitor IP** is HMAC-SHA256 keyed on `env.IP_HASH_PEPPER_PRIMARY`
   before being used for rate-limit keys or logged. The raw IP never
   leaves the request handler.
3. **Honeypot** (`website`) is never logged. Bots fill it; humans don't.
4. **Mail body** carries the IP *hash*, not the raw IP, in the email body
   so Owner can correlate cross-spam waves without seeing real IPs.
5. **CORS** is locked to the static site's origin via `ALLOWED_ORIGIN`.

## Deploy

```bash
# 1. One-time KV namespace (if the legacy one was wiped with Pages)
wrangler kv:namespace create RATELIMIT
# paste the returned `id` into wrangler.toml [[kv_namespaces]]

# 2. Set the three required secrets
wrangler secret put OWNER_EMAIL
# paste: christianmacion26@gmail.com
wrangler secret put RESEND_API_KEY
# paste: re_<your-resend-key>
wrangler secret put IP_HASH_PEPPER_PRIMARY
# paste: <random 32+ char string — generate with `openssl rand -hex 32`>

# 3. Deploy
wrangler deploy --config workers/contact/wrangler.toml
```

Output URL will be something like:
```
https://christianmacion-contact.<account-subdomain>.workers.dev
```

Wire that URL into the static site's contact form (replace
`/api/contact` with the absolute Worker URL in the form's fetch handler).

## Smoke test (against a deployed Worker)

```bash
URL=https://christianmacion-contact.<account>.workers.dev/api/contact

# 1. Valid submit
curl -sS -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d '{
    "name":"Jane Doe",
    "email":"jane@example.com",
    "subject":"Smoke test",
    "message":"This is a smoke test message, at least twenty characters long.",
    "source":"smoke-test",
    "ts":"2026-08-23T10:00:00Z",
    "website":""
  }'
# expect: {"ok":true,"status":"sent","request_id":"…",…}

# 2. Honeypot (filled)
curl -sS -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d '{
    "name":"Bot",
    "email":"bot@example.com",
    "subject":"spam",
    "message":"buy buy buy buy buy buy buy buy buy buy buy buy buy",
    "website":"http://spam.example"
  }'
# expect: {"ok":true,"status":"queued","request_id":"…","silent":true}

# 3. Validation failure
curl -sS -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d '{"name":"x","email":"bad","subject":"","message":"short"}'
# expect: 400 {"ok":false,"code":"VALIDATION_ERROR","reason":"name_invalid"}

# 4. Rate limit (after 5 valid submits in 60s)
for i in 1 2 3 4 5 6; do
  curl -sS -X POST "$URL" -H "Content-Type: application/json" \
    -d "{\"name\":\"User $i\",\"email\":\"u$i@example.com\",\"subject\":\"smoke $i\",\"message\":\"This is a smoke test message, at least twenty characters long.\",\"website\":\"\"}"
done
# expect: 5x 200, then 429 {"ok":false,"code":"RATE_LIMIT"}

# 5. Backend missing (secrets not set)
# expect: 503 {"ok":false,"code":"EMAIL_BACKEND_UNCONFIGURED","reason":"resend_api_key_missing"}
```

## Local dev

```bash
# Run with miniflare or wrangler dev — needs a KV namespace + .dev.vars
cd workers/contact
echo 'OWNER_EMAIL=christianmacion26@gmail.com' > .dev.vars
echo 'RESEND_API_KEY=re_test_dummy_key' >> .dev.vars
echo 'IP_HASH_PEPPER_PRIMARY=local-dev-pepper-32-chars-min-len' >> .dev.vars
wrangler dev --local
# Worker now reachable at http://localhost:8787/api/contact
```

## Cross-refs

- Mission: `2026-08-23-AFK-portfolio-v14`
- AAR: `~/.claude/cache/corporate/aars/portfolio-live-data-gdelt-email-backend-2026-08-23.md`
- Front-end spec: `~/Contingency/portfolio-improvement/SHARED-LEDGER.md §HO-REQ-FE-01`
- Lane-file: `~/Contingency/portfolio-improvement/DATA.md`
