import type { PagesFunction } from '@cloudflare/workers-types';
import { CONTACT_MARK_READ_AUTH_GATE, CONTACT_MARK_READ_BUDGET, CONTACT_MARK_READ_DURABLE_EFFECT } from '../../../types/contact-mark-read';
import { allowedOrigin, boundedJson, constantTimeEqual, errorResponse, hmacSha256, json, parseAccessJwt, parseMarkRead, parsePublicId, requestId, sha256, type Env, type MarkReadResponse } from '../../../lib/contracts';

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const rid = requestId(request);

  const origin = allowedOrigin(request, env);
  if (!origin) return errorResponse(rid, 403, 'ORIGIN_DENIED', 'origin_denied');
  if (request.headers.get('Sec-Fetch-Site') !== 'same-origin') return errorResponse(rid, 403, 'AUTH_INVALID', 'auth_invalid');
  if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') return errorResponse(rid, 415, 'VALIDATION_ERROR', 'validation_error');

  const idemKey = request.headers.get('Idempotency-Key');
  if (!idemKey || idemKey.length > 128) return errorResponse(rid, 422, 'VALIDATION_ERROR', 'validation_error');

  const csrfHeader = request.headers.get('X-CSRF-Token') ?? '';
  if (!csrfHeader || csrfHeader.length > 256) return errorResponse(rid, 403, 'CSRF_INVALID', 'csrf_invalid');

  const auth = request.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return errorResponse(rid, 401, 'AUTH_REQUIRED', 'auth_required');
  const token = auth.slice('Bearer '.length).trim();
  const claims = parseAccessJwt(token);
  if (!claims) return errorResponse(rid, 401, 'AUTH_INVALID', 'auth_invalid');
  if (claims.exp * 1000 < Date.now()) return errorResponse(rid, 401, 'AUTH_INVALID', 'auth_invalid');
  if (env.CF_ACCESS_AUD) {
    const audOk = typeof claims.aud === 'string' ? claims.aud === env.CF_ACCESS_AUD : claims.aud.includes(env.CF_ACCESS_AUD);
    if (!audOk) return errorResponse(rid, 403, 'AUTH_INVALID', 'auth_invalid');
  }

  const csrfSecret = env.CSRF_SIGNING_KEY_PRIMARY;
  if (!csrfSecret) return errorResponse(rid, 503, 'UPSTREAM_UNAVAILABLE', 'upstream_unavailable');
  const csrfParts = csrfHeader.split('.');
  if (csrfParts.length !== 3) return errorResponse(rid, 403, 'CSRF_INVALID', 'csrf_invalid');
  const [mac, tsRaw, subjectTail] = csrfParts;
  const ts = Number(tsRaw);
  if (!Number.isInteger(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 600) return errorResponse(rid, 403, 'CSRF_INVALID', 'csrf_invalid');
  const subjectHash = await sha256(claims.sub);
  if (subjectHash.slice(0, 8) !== subjectTail) return errorResponse(rid, 403, 'CSRF_INVALID', 'csrf_invalid');
  const expectedMac = await hmacSha256(csrfSecret, `${subjectHash}.${ts}.${rid}`);
  if (!constantTimeEqual(mac, expectedMac)) return errorResponse(rid, 403, 'CSRF_INVALID', 'csrf_invalid');
  if (env.CSRF_SIGNING_KEY_PREVIOUS) {
    const expectedMacPrev = await hmacSha256(env.CSRF_SIGNING_KEY_PREVIOUS, `${subjectHash}.${ts}.${rid}`);
    if (!constantTimeEqual(mac, expectedMacPrev)) return errorResponse(rid, 403, 'CSRF_INVALID', 'csrf_invalid');
  }

  const publicId = parsePublicId(typeof params.id === 'string' ? params.id : Array.isArray(params.id) ? params.id[0] : null);
  if (!publicId) return errorResponse(rid, 404, 'NOT_FOUND', 'not_found');

  const body = parseMarkRead(await boundedJson(request, 1024));
  if (!body) return errorResponse(rid, 422, 'VALIDATION_ERROR', 'validation_error');

  const subjectHashForBudget = await sha256(claims.sub);
  const hour = Math.floor(Date.now() / 3_600_000);
  const minute = Math.floor(Date.now() / 60_000);
  const mrMinKey = `rl:v1:owner:${subjectHashForBudget}:mark-read:${minute}`;
  const mrHourKey = `rl:v1:owner:${subjectHashForBudget}:mark-read:${hour}`;
  const [minCount, hourCount] = await Promise.all([
    env.RATELIMIT.get(mrMinKey),
    env.RATELIMIT.get(mrHourKey),
  ]);
  if (Number(minCount ?? '0') >= CONTACT_MARK_READ_BUDGET.minute) return errorResponse(rid, 429, 'RATE_LIMIT', 'rate_limit');
  if (Number(hourCount ?? '0') >= CONTACT_MARK_READ_BUDGET.hour) return errorResponse(rid, 429, 'RATE_LIMIT', 'rate_limit');

  const action = body.read ? 'contact.mark_read' : 'contact.mark_unread';
  const newReadAt = body.read ? Math.floor(Date.now() / 1000) : null;
  const dedupeKey = `${idemKey}.${publicId}.${action}`;

  const existing = await env.DB.prepare('SELECT read_at FROM contact_submissions WHERE public_id = ?').bind(publicId).first<{ read_at: number | null }>();
  if (!existing) return errorResponse(rid, 404, 'NOT_FOUND', 'not_found');

  const updateResult = await env.DB.batch([
    env.DB.prepare('UPDATE contact_submissions SET read_at = ? WHERE public_id = ?').bind(newReadAt, publicId),
    env.DB.prepare(
      'INSERT INTO owner_audit_log (dedupe_key, actor_subject_hash, action, target_public_id, request_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(dedupe_key) DO NOTHING',
    ).bind(dedupeKey, subjectHashForBudget, action, publicId, rid, JSON.stringify({ source: 'pages_function', idem: idemKey })),
  ]);

  await Promise.all([
    env.RATELIMIT.put(mrMinKey, String(Number(minCount ?? '0') + 1), { expirationTtl: 90 }),
    env.RATELIMIT.put(mrHourKey, String(Number(hourCount ?? '0') + 1), { expirationTtl: 3_900 }),
  ]);

  const responseBody: MarkReadResponse = { ok: true, request_id: rid, id: publicId, read_at: newReadAt };
  void updateResult;
  return json<MarkReadResponse>(responseBody, 200, rid, { 'Access-Control-Allow-Origin': origin });
};

export const onRequestOptions: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = (env.PUBLIC_ORIGINS ?? 'https://christianmacion-portfolio.pages.dev,https://christianmacion26.github.io')
    .split(',')
    .map((item) => item.trim());
  if (!allowed.includes(origin)) {
    return new Response(null, { status: 204 });
  }
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key, X-CSRF-Token, Sec-Fetch-Site',
      'Access-Control-Max-Age': '300',
      'Vary': 'Origin, Access-Control-Request-Headers',
    },
  });
};

export const _markReadContractRef = { auth_gate: CONTACT_MARK_READ_AUTH_GATE, budget: CONTACT_MARK_READ_BUDGET, durable_effect: CONTACT_MARK_READ_DURABLE_EFFECT } as const;
