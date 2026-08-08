/**
 * functions/api/personality/who-am-i.ts - Personalization context resolver.
 *
 * Architecture: 2026-08-08-live-data-apis.md (live data wiring).
 *
 * Returns:
 *   - visitorId : from cookie (set by /api/personality/track-visit) or
 *                 a freshly minted UUID for first-touch.
 *   - isRecruiter : true if the referer matches a known recruiter domain.
 *   - geo : 2-letter country code from `request.cf.country` (Cloudflare edge).
 *   - variant : A or B - deterministic hash of visitorId, used for A/B tests.
 *
 * Hard rules:
 *   - Geo lookup is opt-in: `request.cf.country` is only populated by
 *     Cloudflare in production traffic (Pages dev emits undefined).
 *   - Recruiter domains are allowlist-based; this is NOT a fingerprinting
 *     system. We identify the *session's referer context*, not the visitor.
 *   - No PII is logged. visitorId is a UUID4 minted client-side or here.
 *   - Variant is deterministic from visitorId so refreshes are stable.
 */
import type { PagesFunction } from '@cloudflare/workers-types';
import {
  allowedOrigin,
  errorResponse,
  json,
  requestId,
  type Env,
} from '../../lib/contracts';

export interface WhoAmIResponse {
  ok: true;
  request_id: string;
  visitorId: string;
  isRecruiter: boolean;
  geo: string;
  variant: 'A' | 'B';
  referer: string | null;
}

const CORS_HEADERS: HeadersInit = {
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '300',
};

const RECRUITER_HOSTS = new Set<string>([
  'linkedin.com',
  'www.linkedin.com',
  'indeed.com',
  'www.indeed.com',
  'glassdoor.com',
  'www.glassdoor.com',
  'hireloft.com',
  'www.hireloft.com',
]);

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

function isRecruiterReferer(referer: string | null): boolean {
  if (!referer) return false;
  let host = '';
  try {
    host = new URL(referer).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (RECRUITER_HOSTS.has(host)) return true;
  // Match subdomains of allowlisted hosts (e.g. "de.linkedin.com").
  for (const known of RECRUITER_HOSTS) {
    if (host.endsWith(`.${known}`)) return true;
  }
  return false;
}

/** Variant = hash(visitorId) % 2 === 0 ? 'A' : 'B'.
 *  Stable for the same visitorId across sessions / deploys. */
function variantOf(visitorId: string): 'A' | 'B' {
  let hash = 0;
  for (let i = 0; i < visitorId.length; i += 1) {
    hash = (hash * 31 + visitorId.charCodeAt(i)) >>> 0;
  }
  return hash % 2 === 0 ? 'A' : 'B';
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const rid = requestId(request);
  const origin = allowedOrigin(request, env);
  const cors: HeadersInit = origin
    ? { 'Access-Control-Allow-Origin': origin, ...CORS_HEADERS }
    : CORS_HEADERS;

  let visitorId = readVisitorCookie(request);
  if (!visitorId) {
    try {
      visitorId = crypto.randomUUID();
    } catch {
      return errorResponse(rid, 500, 'INTERNAL_ERROR', 'uuid_unavailable');
    }
  }

  const referer = request.headers.get('Referer');
  const isRecruiter = isRecruiterReferer(referer);
  // `request.cf` is only populated by Cloudflare in production; in dev
  // it's undefined. Default to 'XX' so the type stays string.
  const cf = (request as Request & { cf?: { country?: string } }).cf;
  const geo = typeof cf?.country === 'string' && cf.country.length === 2 ? cf.country : 'XX';

  const variant = variantOf(visitorId);

  return json<WhoAmIResponse>(
    {
      ok: true,
      request_id: rid,
      visitorId,
      isRecruiter,
      geo,
      variant,
      referer: referer ? referer.slice(0, 512) : null,
    },
    200,
    rid,
    { ...cors, 'Cache-Control': 'private, no-store' },
  );
};

export const onRequestOptions: PagesFunction<Env> = async ({ request, env }) => {
  const origin = allowedOrigin(request, env);
  const cors: HeadersInit = origin
    ? { 'Access-Control-Allow-Origin': origin, ...CORS_HEADERS }
    : CORS_HEADERS;
  return new Response(null, { status: 204, headers: cors });
};