/**
 * functions/api/personality/track-visit.ts - First-touch visitor tracker.
 *
 * Architecture: 2026-08-08-live-data-apis.md (live data wiring).
 *
 * Behavior:
 *   - Reads `visitor_id` cookie. If absent, mints a UUID4 via
 *     `crypto.randomUUID()`.
 *   - Writes the visitor under `RATELIMIT` KV at `visitor:<id>` with
 *     a 90-day TTL (matches the cookie lifetime).
 *   - Sets `Set-Cookie: visitor_id=<id>; Max-Age=7776000; Path=/;
 *     SameSite=Lax; Secure`.
 *   - Returns `{ visitorId, ttl }` so the front-end knows the lifetime.
 *
 * Hard rules:
 *   - No PII is written. visitorId is a UUID; no email, no IP, no UA.
 *   - KV write is best-effort; a KV miss is NOT a 500 - we still set
 *     the cookie so the visitor gets a stable identifier client-side.
 *   - The endpoint is `Cache-Control: private, no-store` so the cookie
 *     never ends up in a shared cache.
 */
import type { PagesFunction } from '@cloudflare/workers-types';
import {
  allowedOrigin,
  errorResponse,
  json,
  requestId,
  type Env,
} from '../../lib/contracts';

const VISITOR_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days, matches cookie Max-Age.
const COOKIE_MAX_AGE = 90 * 24 * 60 * 60; // 7776000s - matches the spec.

const CORS_HEADERS: HeadersInit = {
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '300',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readVisitorCookie(request: Request): string | null {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(/;\s*/);
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name === 'visitor_id' && UUID_RE.test(decodeURIComponent(value))) {
      return decodeURIComponent(value);
    }
  }
  return null;
}

function buildCookie(visitorId: string): string {
  // SameSite=Lax is required so cross-site GETs from referers (the
  // recruiter-detection signal) still send the cookie. Secure ensures
  // the cookie never traverses plaintext HTTP.
  return `visitor_id=${encodeURIComponent(visitorId)}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax; Secure`;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const rid = requestId(request);
  const origin = allowedOrigin(request, env);
  const cors: HeadersInit = origin
    ? { 'Access-Control-Allow-Origin': origin, ...CORS_HEADERS }
    : CORS_HEADERS;

  let visitorId = readVisitorCookie(request);
  let isNew = false;
  if (!visitorId) {
    try {
      visitorId = crypto.randomUUID();
      isNew = true;
    } catch {
      return errorResponse(rid, 500, 'INTERNAL_ERROR', 'uuid_unavailable');
    }
  }

  // Best-effort KV write. The cookie is the source of truth; KV is for
  // server-side analytics (no PII, just visitorId + TTL).
  if (isNew) {
    try {
      await env.RATELIMIT.put(`visitor:${visitorId}`, '1', {
        expirationTtl: VISITOR_TTL_SECONDS,
      });
    } catch {
      // KV write failure is non-fatal; the cookie still gets set.
    }
  }

  const cookieHeader = buildCookie(visitorId);

  return json<{
    ok: true;
    request_id: string;
    visitorId: string;
    ttl: number;
    new: boolean;
  }>(
    {
      ok: true,
      request_id: rid,
      visitorId,
      ttl: COOKIE_MAX_AGE,
      new: isNew,
    },
    200,
    rid,
    {
      ...cors,
      'Cache-Control': 'private, no-store',
      'Set-Cookie': cookieHeader,
    },
  );
};

export const onRequestOptions: PagesFunction<Env> = async ({ request, env }) => {
  const origin = allowedOrigin(request, env);
  const cors: HeadersInit = origin
    ? { 'Access-Control-Allow-Origin': origin, ...CORS_HEADERS }
    : CORS_HEADERS;
  return new Response(null, { status: 204, headers: { ...cors, 'Set-Cookie': buildCookie(crypto.randomUUID()) } });
};