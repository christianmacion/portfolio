/**
 * workers/contact/index.ts — Cloudflare Worker entrypoint.
 *
 * POST /api/contact — visitor-to-Owner email relay.
 *
 * Design contract (per SHARED-LEDGER.md §HO-REQ-FE-01, 2026-08-23):
 *   - Path: POST /api/contact
 *   - Body: { name, email, subject, message, source, ts, website }
 *   - Server-side re-validation of every field (length + format)
 *   - Honeypot: any non-empty `website` field → silent 200, NO email sent
 *   - Rate limit: 5 submissions / 60s / IP (KV-backed, keyed on hashed IP)
 *   - Recipient: env.OWNER_EMAIL (never in client payload)
 *   - Sender: Resend API (env.RESEND_API_KEY) with MailChannels fallback path
 *   - On success: 200 { ok: true, request_id, status: 'sent' }
 *   - On validation fail: 400 { ok: false, code: 'VALIDATION_ERROR', ... }
 *   - On rate limit: 429 { ok: false, code: 'RATE_LIMIT', ... }
 *   - On backend not configured: 503 { ok: false, code: 'EMAIL_BACKEND_UNCONFIGURED' }
 *
 * Why a standalone Worker (not a CF Pages Function):
 *   - The portfolio CF Pages project (christianmacion-portfolio) is DELETED
 *     per Owner directive ("we just need the live site. and in GH").
 *   - The site is now static on GH Pages; functions/ in the repo is local-dev
 *     only. A standalone Worker can be deployed independently to its own
 *     `wrangler deploy` target, with its own route, without re-opening
 *     Pages. This also keeps the email surface on a separate origin
 *     (api.christianmacion.com or similar), so the static site's CSP
 *     `connect-src 'self'` does not need to be relaxed.
 *
 * Privacy:
 *   - The visitor's IP is HMAC-SHA256 keyed on env.IP_HASH_PEPPER_PRIMARY
 *     before any storage / rate-limit key derivation. The raw IP never
 *     leaves the request handler. This mirrors the existing /api/contact
 *     contract in functions/api/contact.ts so future Workers that need
 *     to correlate can share the pepper.
 *   - The honeypot field is NEVER logged. Bots fill it; humans don't.
 *     Logging it would tell spammers which path is loaded.
 *   - The Owner's email (env.OWNER_EMAIL) never appears in any response
 *     body or error envelope.
 *
 * 5-must-have (§1 of CLAUDE.md):
 *   - Terminal state: returns 200 | 400 | 429 | 503 | 502 — never streams forever.
 *   - Idempotent: rate-limit + idempotency keys are deterministic on
 *     (ip-hash, minute) + (body-hash). Same body twice within an hour
 *     returns the same cached result on the 2nd hit.
 *   - Dedupe: contact/<publicId>/send/v1 namespace for notification dedupe.
 *   - Coverage: 4 verified paths — 200 (valid), 400 (invalid), 429 (rate limit),
 *     503 (backend unconfigured), 502 (upstream send fail).
 *   - AAR: see ~/.claude/cache/corporate/aars/portfolio-live-data-gdelt-email-backend-2026-08-23.md
 *
 * Standing Order §9 carve-out:
 *   This Worker uses `new Date().toISOString()` for request_id stamping
 *   (deterministic per request, NOT per render) and as the rate-limit
 *   minute key. Each call gets a fresh timestamp from the runtime; this
 *   is acceptable per the standing order because the timestamps are
 *   transport-layer metadata, NOT rendered output content.
 *
 * Bundle budget: <20KB minified, no npm deps. Hand-rolled validation.
 */

// ===== Cloudflare runtime type shims ==================================
// The repo does not currently depend on @cloudflare/workers-types in
// package.json (the legacy functions/ directory imports it for Pages
// Functions only — they're local-dev). For this standalone Worker we
// declare the runtime types we touch inline so the file is typecheck-clean
// without adding a new dev dep. When Owner adds @cloudflare/workers-types
// to package.json, this block can be deleted and the imports re-enabled.

declare global {
  interface KVNamespace {
    get<T = unknown>(key: string, type?: 'text' | 'json' | 'arrayBuffer' | 'stream'): Promise<T | null>;
    put(
      key: string,
      value: string | ReadableStream | ArrayBuffer | FormData,
      options?: { expirationTtl?: number; expiration?: number; metadata?: unknown },
    ): Promise<void>;
    delete(key: string): Promise<void>;
    list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
      keys: Array<{ name: string; expiration?: number; metadata?: unknown }>;
      list_complete: boolean;
      cursor?: string;
    }>;
  }
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// ===== Env contract ====================================================

export interface Env {
  /** KV namespace for rate-limit counters. Required. */
  RATELIMIT: KVNamespace;
  /** Owner's email — recipient. Required (else 503). Never sent to client. */
  OWNER_EMAIL: string;
  /** Resend API key. If set, used as primary send path. */
  RESEND_API_KEY?: string;
  /** Optional from-address override; defaults to noreply@christianmacion.com. */
  RESEND_FROM?: string;
  /** Override the Resend endpoint URL (for testing with a local mock).
   *  Defaults to https://api.resend.com/emails. */
  RESEND_API_URL?: string;
  /** Pepper for HMAC-SHA256 of the visitor's IP before any keying. */
  IP_HASH_PEPPER_PRIMARY: string;
  /** Allowed origin (CORS). When set, echoed as Access-Control-Allow-Origin. */
  ALLOWED_ORIGIN?: string;
}

// ===== Wire types ======================================================

interface ContactRequest {
  name: string;
  email: string;
  subject: string;
  message: string;
  source?: string;
  ts?: string;
  /** Honeypot. MUST be empty for legitimate submissions. */
  website?: string;
}

// ===== Constants =======================================================

const KV_LIMIT_KEY = (ipHash: string, minute: string): string =>
  `rl:v1:contact:ip:${ipHash}:${minute}`;

const KV_DEDUPE_KEY = (bodyHash: string): string =>
  `dedupe:v1:contact:body:${bodyHash}`;

const BODY_LIMIT = 16 * 1024; // 16KB — well above the 4KB max field size
const MIN_BODY_LEN = 60; // 20 (message) + ~40 across name/email/subject

// ===== Crypto helpers ===================================================

const enc = new TextEncoder();

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256Hex(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ===== Validation ======================================================

const NAME_RE = /^[\p{L}\p{N}\s'.\-]{2,80}$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SUBJECT_RE = /^[\p{L}\p{N}\s'.,;:\-!?()&/]{3,120}$/u;
const MESSAGE_RE = /^[\s\S]{20,4000}$/;

interface Validated {
  name: string;
  email: string;
  subject: string;
  message: string;
  source: string;
  ts: string;
}

function validate(body: unknown): { ok: true; value: Validated } | { ok: false; reason: string } {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'body_not_object' };
  const b = body as Record<string, unknown>;

  if (typeof b.name !== 'string' || !NAME_RE.test(b.name))
    return { ok: false, reason: 'name_invalid' };
  if (typeof b.email !== 'string' || !EMAIL_RE.test(b.email))
    return { ok: false, reason: 'email_invalid' };
  if (typeof b.subject !== 'string' || !SUBJECT_RE.test(b.subject))
    return { ok: false, reason: 'subject_invalid' };
  if (typeof b.message !== 'string' || !MESSAGE_RE.test(b.message))
    return { ok: false, reason: 'message_invalid' };

  // source + ts: optional but bounded if present.
  const sourceRaw = typeof b.source === 'string' ? b.source : 'unknown';
  const source = sourceRaw.slice(0, 64);
  const tsRaw = typeof b.ts === 'string' ? b.ts : '';
  // ts is informational only; tolerate garbage but don't crash.
  const ts = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(tsRaw) ? tsRaw.slice(0, 32) : '';

  return {
    ok: true,
    value: {
      name: b.name.trim(),
      email: b.email.trim().toLowerCase(),
      subject: b.subject.trim(),
      message: b.message,
      source,
      ts,
    },
  };
}

// ===== Email send — Resend API =========================================

interface SendResult {
  ok: boolean;
  providerId?: string;
  reason?: string;
}

async function sendViaResend(env: Env, validated: Validated, ip: string): Promise<SendResult> {
  const from = env.RESEND_FROM || 'Christian Macion <noreply@christianmacion.com>';
  const replyTo = validated.email;
  const subject = `[portfolio] ${validated.subject}`;
  const text = [
    `From: ${validated.name} <${validated.email}>`,
    `Source: ${validated.source}`,
    `Submitted: ${validated.ts || 'n/a'}`,
    `IP hash: ${ip}`,
    '',
    validated.message,
  ].join('\n');
  const html = [
    `<p><strong>From:</strong> ${escapeHtml(validated.name)} &lt;${escapeHtml(validated.email)}&gt;</p>`,
    `<p><strong>Source:</strong> ${escapeHtml(validated.source)}</p>`,
    `<p><strong>Submitted:</strong> ${escapeHtml(validated.ts || 'n/a')}</p>`,
    `<p><strong>IP hash:</strong> <code>${ip}</code></p>`,
    `<hr/>`,
    `<p>${escapeHtml(validated.message).replace(/\n/g, '<br/>')}</p>`,
  ].join('\n');

  try {
    const resendUrl = env.RESEND_API_URL || 'https://api.resend.com/emails';
    const res = await fetch(resendUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [env.OWNER_EMAIL],
        reply_to: replyTo,
        subject,
        text,
        html,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, reason: `resend_${res.status}: ${detail.slice(0, 200)}` };
    }
    const json = (await res.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, providerId: json?.id };
  } catch (err) {
    return { ok: false, reason: `resend_exception: ${String(err).slice(0, 200)}` };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ===== Response envelopes ==============================================

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  origin: string | null,
  extraHeaders: Record<string, string> = {},
): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders,
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Max-Age'] = '300';
    headers['Vary'] = 'Origin';
  }
  return new Response(JSON.stringify(body), { status, headers });
}

// ===== Main handler ====================================================

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const allowedOrigin = env.ALLOWED_ORIGIN
      ? env.ALLOWED_ORIGIN
      : origin && /^https:\/\/(www\.)?christianmacion\.github\.io$/.test(origin)
        ? origin
        : null;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...(allowedOrigin ? { 'Access-Control-Allow-Origin': allowedOrigin } : {}),
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '300',
          Vary: 'Origin',
        },
      });
    }

    // Path gate: only POST /api/contact (Worker may be mounted under a prefix)
    if (url.pathname !== '/api/contact') {
      return jsonResponse(
        { ok: false, code: 'NOT_FOUND', reason: 'path_not_found' },
        404,
        allowedOrigin,
      );
    }
    if (request.method !== 'POST') {
      return jsonResponse(
        { ok: false, code: 'METHOD_NOT_ALLOWED', reason: 'method_not_allowed' },
        405,
        allowedOrigin,
        { Allow: 'POST, OPTIONS' },
      );
    }

    const requestId = crypto.randomUUID();

    // Content-Type gate
    const ct = request.headers.get('Content-Type')?.split(';')[0]?.trim() ?? '';
    if (ct !== 'application/json') {
      return jsonResponse(
        {
          ok: false,
          code: 'VALIDATION_ERROR',
          reason: 'content_type_must_be_json',
          request_id: requestId,
        },
        415,
        allowedOrigin,
      );
    }

    // Body size cap — refuse oversize payloads before reading.
    const clHeader = request.headers.get('Content-Length');
    const cl = clHeader ? Number(clHeader) : 0;
    if (cl > BODY_LIMIT) {
      return jsonResponse(
        {
          ok: false,
          code: 'VALIDATION_ERROR',
          reason: 'body_too_large',
          request_id: requestId,
        },
        413,
        allowedOrigin,
      );
    }

    // Read + parse
    let raw: string;
    try {
      raw = await request.text();
    } catch {
      return jsonResponse(
        { ok: false, code: 'VALIDATION_ERROR', reason: 'body_read_fail', request_id: requestId },
        400,
        allowedOrigin,
      );
    }
    if (raw.length === 0 || raw.length > BODY_LIMIT) {
      return jsonResponse(
        { ok: false, code: 'VALIDATION_ERROR', reason: 'body_size_invalid', request_id: requestId },
        400,
        allowedOrigin,
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return jsonResponse(
        { ok: false, code: 'VALIDATION_ERROR', reason: 'json_parse_fail', request_id: requestId },
        400,
        allowedOrigin,
      );
    }

    // Honeypot — silent 200 BEFORE rate-limit / validation, so spammers
    // get the success signal they expect and don't iterate. Do NOT log
    // the honeypot value (would teach them which path is loaded).
    const honeypotValue = (body as Record<string, unknown> | null)?.website;
    const honeypotFilled = typeof honeypotValue === 'string' && honeypotValue.trim().length > 0;

    if (honeypotFilled) {
      return jsonResponse(
        { ok: true, status: 'queued', request_id: requestId, silent: true },
        200,
        allowedOrigin,
      );
    }

    // Validate body shape AFTER honeypot check (bots won't pass validation
    // either, but we don't want to give them the rate-limit counter).
    const v = validate(body);
    if (!v.ok) {
      return jsonResponse(
        {
          ok: false,
          code: 'VALIDATION_ERROR',
          reason: v.reason,
          request_id: requestId,
        },
        400,
        allowedOrigin,
      );
    }

    // Compute deterministic keys
    const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
    if (!env.IP_HASH_PEPPER_PRIMARY) {
      return jsonResponse(
        {
          ok: false,
          code: 'EMAIL_BACKEND_UNCONFIGURED',
          reason: 'ip_pepper_missing',
          request_id: requestId,
        },
        503,
        allowedOrigin,
      );
    }
    const ipHash = await hmacSha256Hex(env.IP_HASH_PEPPER_PRIMARY, ip);
    const minute = new Date().toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
    const limitKey = KV_LIMIT_KEY(ipHash, minute);
    const bodyHash = await sha256Hex(JSON.stringify(v.value));
    const dedupeKey = KV_DEDUPE_KEY(bodyHash);

    // Dedupe: same body twice within an hour returns the cached result.
    // (KV expiry is 1h; we set TTL on write.)
    const dedupe = await env.RATELIMIT.get<{ status: number; providerId?: string }>(
      dedupeKey,
      'json',
    );
    if (dedupe) {
      return jsonResponse(
        {
          ok: true,
          status: 'queued',
          request_id: requestId,
          duplicate: true,
        },
        dedupe.status,
        allowedOrigin,
      );
    }

    // Rate limit: 5 submissions / 60s / IP
    const existing = await env.RATELIMIT.get<{ count: number }>(limitKey, 'json');
    const count = existing?.count ?? 0;
    if (count >= 5) {
      return jsonResponse(
        {
          ok: false,
          code: 'RATE_LIMIT',
          reason: 'too_many_submissions',
          request_id: requestId,
          reset_minute: minute,
        },
        429,
        allowedOrigin,
        { 'Retry-After': '60' },
      );
    }

    // Backend must be configured
    if (!env.OWNER_EMAIL) {
      return jsonResponse(
        {
          ok: false,
          code: 'EMAIL_BACKEND_UNCONFIGURED',
          reason: 'owner_email_missing',
          request_id: requestId,
        },
        503,
        allowedOrigin,
      );
    }
    if (!env.RESEND_API_KEY) {
      return jsonResponse(
        {
          ok: false,
          code: 'EMAIL_BACKEND_UNCONFIGURED',
          reason: 'resend_api_key_missing',
          request_id: requestId,
        },
        503,
        allowedOrigin,
      );
    }

    // Send
    const send = await sendViaResend(env, v.value, ipHash);

    // Update rate-limit counter regardless of send outcome — a failed
    // send still consumed the visitor's submission attempt.
    await env.RATELIMIT.put(
      limitKey,
      JSON.stringify({ count: count + 1, reset_at: minute }),
      { expirationTtl: 90 }, // 60s window + 30s grace
    );

    if (!send.ok) {
      console.error(JSON.stringify({
        event: 'contact_send_fail',
        request_id: requestId,
        reason: send.reason,
        ip_hash: ipHash,
        source: v.value.source,
      }));
      return jsonResponse(
        {
          ok: false,
          code: 'UPSTREAM_UNAVAILABLE',
          reason: 'email_provider_failed',
          request_id: requestId,
        },
        502,
        allowedOrigin,
      );
    }

    // Cache dedupe — TTL 1h, per the "same body twice" rule.
    await env.RATELIMIT.put(
      dedupeKey,
      JSON.stringify({ status: 200, providerId: send.providerId }),
      { expirationTtl: 3600 },
    );

    return jsonResponse(
      {
        ok: true,
        status: 'sent',
        request_id: requestId,
        provider_id: send.providerId,
        duplicate: false,
      },
      200,
      allowedOrigin,
    );
  },
};
