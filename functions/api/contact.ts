import type { PagesFunction } from '@cloudflare/workers-types';
import { allowedOrigin, boundedJson, errorResponse, json, parseContact, requestId, sha256, type ContactAccepted, type Env } from '../lib/contracts';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const rid = requestId(request);
  const origin = allowedOrigin(request, env);
  if (!origin) return errorResponse(rid, 403, 'ORIGIN_DENIED', 'origin_denied');
  if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') return errorResponse(rid, 415, 'VALIDATION_ERROR', 'validation_error');
  const key = request.headers.get('Idempotency-Key');
  if (!key || !(await sha256(key)).length) return errorResponse(rid, 422, 'VALIDATION_ERROR', 'validation_error');
  const payload = parseContact(await boundedJson(request, 16 * 1024));
  if (!payload) return errorResponse(rid, 422, 'VALIDATION_ERROR', 'validation_error');
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  const ipHash = `v1:${await sha256(ip)}`;
  const hour = Math.floor(Date.now() / 3600000);
  const limitKey = `rl:v1:contact:ip:${ipHash}:${hour}`;
  const cached = await env.RATELIMIT.get<{ count: number }>(limitKey, 'json');
  if ((cached?.count ?? 0) >= 5) return errorResponse(rid, 429, 'RATE_LIMIT', 'rate_limit');
  const bodyHash = await sha256(JSON.stringify(payload));
  const idempotencyHash = await sha256(key);
  const existing = await env.DB.prepare('SELECT public_id, body_hash FROM contact_submissions WHERE idempotency_key_hash = ?').bind(idempotencyHash).first<{ public_id: string; body_hash: string }>();
  if (existing) {
    if (existing.body_hash !== bodyHash) return errorResponse(rid, 409, 'IDEMPOTENCY_CONFLICT', 'idempotency_conflict');
    return json<ContactAccepted>({ ok: true, request_id: rid, submission_ref: existing.public_id, notification: 'queued', duplicate: true }, 200, rid, { 'Access-Control-Allow-Origin': origin });
  }
  if (env.TURNSTILE_SECRET_PRIMARY) {
    const verify = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_PRIMARY, response: payload.turnstile_token, remoteip: ip }) });
    const result = await verify.json() as { success?: boolean };
    if (!result.success) return errorResponse(rid, 403, 'TURNSTILE_FAILED', 'turnstile_failed');
  }
  const publicId = crypto.randomUUID();
  const dedupe = `contact/${publicId}/owner-notification/v1`;
  const insert = await env.DB.batch([
    env.DB.prepare(`INSERT INTO contact_submissions (public_id, request_id, idempotency_key_hash, body_hash, name, email, subject, message, ip_hash, user_agent, turnstile_verified) SELECT ?,?,?,?,?,?,?,?,?,?,1 WHERE (SELECT COUNT(*) FROM contact_submissions WHERE ip_hash=? AND created_at >= ((unixepoch()/3600)*3600)) < 5 ON CONFLICT(idempotency_key_hash) DO NOTHING`).bind(publicId, rid, idempotencyHash, bodyHash, payload.name, payload.email, payload.subject, payload.message, ipHash, request.headers.get('User-Agent'), ipHash),
    env.DB.prepare('INSERT INTO notification_outbox (contact_id, dedupe_key) SELECT id, ? FROM contact_submissions WHERE public_id = ? ON CONFLICT(dedupe_key) DO NOTHING').bind(dedupe, publicId),
  ]);
  if (!insert[0].meta.changes) return errorResponse(rid, 429, 'RATE_LIMIT', 'rate_limit');
  await env.RATELIMIT.put(limitKey, JSON.stringify({ count: (cached?.count ?? 0) + 1, reset_at: (hour + 1) * 3600 }), { expirationTtl: 3900 });
  return json<ContactAccepted>({ ok: true, request_id: rid, submission_ref: publicId, notification: 'queued', duplicate: false }, 201, rid, { 'Access-Control-Allow-Origin': origin });
};
