import type { PagesFunction } from '@cloudflare/workers-types';
import {
  CONTACT_INBOX_AUTH_GATE,
  CONTACT_INBOX_BUDGET,
  CONTACT_INBOX_DURABLE_EFFECT,
} from '../../types/contact-inbox';
import {
  errorResponse,
  hmacSha256,
  json,
  parseAccessJwt,
  parseInboxQuery,
  requestId,
  sha256,
  type Env,
  type InboxItem,
  type InboxResponse,
} from '../../lib/contracts';

const ALLOWED_STATES = new Set(['unread', 'read', 'archived', 'all']);

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  void params;
  const rid = requestId(request);

  const auth = request.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return errorResponse(rid, 401, 'AUTH_REQUIRED', 'auth_required');
  const token = auth.slice('Bearer '.length).trim();
  if (!token) return errorResponse(rid, 401, 'AUTH_REQUIRED', 'auth_required');

  const claims = parseAccessJwt(token);
  if (!claims) return errorResponse(rid, 401, 'AUTH_INVALID', 'auth_invalid');
  if (claims.exp * 1000 < Date.now())
    return errorResponse(rid, 401, 'AUTH_INVALID', 'auth_invalid');
  if (env.CF_ACCESS_AUD) {
    const audOk =
      typeof claims.aud === 'string'
        ? claims.aud === env.CF_ACCESS_AUD
        : claims.aud.includes(env.CF_ACCESS_AUD);
    if (!audOk) return errorResponse(rid, 403, 'AUTH_INVALID', 'auth_invalid');
  }
  if (
    env.CF_ACCESS_TEAM_DOMAIN &&
    !claims.iss.endsWith(`.${env.CF_ACCESS_TEAM_DOMAIN}`) &&
    claims.iss !== env.CF_ACCESS_TEAM_DOMAIN
  ) {
    return errorResponse(rid, 403, 'AUTH_INVALID', 'auth_invalid');
  }

  const url = new URL(request.url);
  const query = parseInboxQuery(url.searchParams);
  if (!query) return errorResponse(rid, 422, 'VALIDATION_ERROR', 'validation_error');
  if (!ALLOWED_STATES.has(query.state))
    return errorResponse(rid, 422, 'VALIDATION_ERROR', 'validation_error');

  const subjectHash = await sha256(claims.sub);
  const hour = Math.floor(Date.now() / 3_600_000);
  const minute = Math.floor(Date.now() / 60_000);
  const readMinKey = `rl:v1:owner:${subjectHash}:inbox:${minute}`;
  const readHourKey = `rl:v1:owner:${subjectHash}:inbox:${hour}`;
  const [minCount, hourCount] = await Promise.all([
    env.RATELIMIT.get(readMinKey),
    env.RATELIMIT.get(readHourKey),
  ]);
  if (Number(minCount ?? '0') >= CONTACT_INBOX_BUDGET.minute)
    return errorResponse(rid, 429, 'RATE_LIMIT', 'rate_limit');
  if (Number(hourCount ?? '0') >= CONTACT_INBOX_BUDGET.hour)
    return errorResponse(rid, 429, 'RATE_LIMIT', 'rate_limit');

  const limit = query.limit;
  const offset = query.cursor ? Math.max(0, Math.min(Number(query.cursor) || 0, 1000)) : 0;

  let rows: Array<{
    public_id: string;
    name: string;
    email: string;
    subject: string;
    message: string;
    created_at: number;
    read_at: number | null;
    archived_at: number | null;
    notification_status: string;
  }> = [];
  if (query.state === 'unread') {
    const result = await env.DB.prepare(
      'SELECT public_id, name, email, subject, message, created_at, read_at, archived_at, notification_status FROM contact_submissions WHERE read_at IS NULL AND archived_at IS NULL ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
    )
      .bind(limit, offset)
      .all();
    rows = result.results as typeof rows;
  } else if (query.state === 'read') {
    const result = await env.DB.prepare(
      'SELECT public_id, name, email, subject, message, created_at, read_at, archived_at, notification_status FROM contact_submissions WHERE read_at IS NOT NULL AND archived_at IS NULL ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
    )
      .bind(limit, offset)
      .all();
    rows = result.results as typeof rows;
  } else if (query.state === 'archived') {
    const result = await env.DB.prepare(
      'SELECT public_id, name, email, subject, message, created_at, read_at, archived_at, notification_status FROM contact_submissions WHERE archived_at IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
    )
      .bind(limit, offset)
      .all();
    rows = result.results as typeof rows;
  } else {
    const result = await env.DB.prepare(
      'SELECT public_id, name, email, subject, message, created_at, read_at, archived_at, notification_status FROM contact_submissions ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
    )
      .bind(limit, offset)
      .all();
    rows = result.results as typeof rows;
  }

  const items: InboxItem[] = rows.map((row) => ({
    id: row.public_id,
    name: row.name,
    email: row.email,
    subject: row.subject,
    message: row.message,
    created_at: row.created_at,
    read_at: row.read_at,
    archived_at: row.archived_at,
    notification_status: (['pending', 'sent', 'delivered', 'failed', 'bounced'].includes(
      row.notification_status,
    )
      ? row.notification_status
      : 'pending') as InboxItem['notification_status'],
  }));
  const next_cursor = rows.length === limit ? String(offset + limit) : null;

  const ts = Math.floor(Date.now() / 1000);
  const csrfSecret = env.CSRF_SIGNING_KEY_PRIMARY;
  const csrf = csrfSecret
    ? `${await hmacSha256(csrfSecret, `${subjectHash}.${ts}.${rid}`)}.${ts}.${subjectHash.slice(0, 8)}`
    : `unsigned.${ts}.${subjectHash.slice(0, 8)}`;

  await Promise.all([
    env.RATELIMIT.put(readMinKey, String(Number(minCount ?? '0') + 1), { expirationTtl: 90 }),
    env.RATELIMIT.put(readHourKey, String(Number(hourCount ?? '0') + 1), { expirationTtl: 3_900 }),
  ]);

  const body: InboxResponse = { ok: true, request_id: rid, items, next_cursor, csrf_token: csrf };
  return json<InboxResponse>(body, 200, rid, {
    'Cache-Control': 'private, no-store',
    Vary: 'Authorization, Origin',
  });
};

export const onRequestOptions: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = (
    env.PUBLIC_ORIGINS ??
    'https://christianmacion-portfolio.pages.dev,https://christianmacion26.github.io'
  )
    .split(',')
    .map((item) => item.trim());
  if (!allowed.includes(origin)) {
    return new Response(null, { status: 204 });
  }
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '300',
      Vary: 'Origin, Access-Control-Request-Headers',
    },
  });
};

// auth_gate: see CONTACT_INBOX_AUTH_GATE (../../types/contact-inbox.ts)
// budget: see CONTACT_INBOX_BUDGET (60/min and 600/hour/Access subject)
// durable_effect: see CONTACT_INBOX_DURABLE_EFFECT (none)
export const _inboxContractRef = {
  auth_gate: CONTACT_INBOX_AUTH_GATE,
  budget: CONTACT_INBOX_BUDGET,
  durable_effect: CONTACT_INBOX_DURABLE_EFFECT,
} as const;
