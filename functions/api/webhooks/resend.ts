import type { PagesFunction } from '@cloudflare/workers-types';
import { RESEND_WEBHOOK_AUTH_GATE, RESEND_WEBHOOK_BODY_CEILING, RESEND_WEBHOOK_BUDGET, RESEND_WEBHOOK_DURABLE_EFFECT } from '../../types/resend-webhook';
import { boundedBytes, errorResponse, json, parseResendEvent, requestId, sha256, verifyResendSignature, type Env, type WebhookAck } from '../../lib/contracts';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const rid = requestId(request);

  const hour = Math.floor(Date.now() / 3_600_000);
  const minute = Math.floor(Date.now() / 60_000);
  const minKey = `rl:v1:resend:webhook:${minute}`;
  const hourKey = `rl:v1:resend:webhook:${hour}`;
  const [minCount, hourCount] = await Promise.all([
    env.RATELIMIT.get(minKey),
    env.RATELIMIT.get(hourKey),
  ]);
  if (Number(minCount ?? '0') >= RESEND_WEBHOOK_BUDGET.minute) return errorResponse(rid, 429, 'RATE_LIMIT', 'rate_limit');
  if (Number(hourCount ?? '0') >= RESEND_WEBHOOK_BUDGET.hour) return errorResponse(rid, 429, 'RATE_LIMIT', 'rate_limit');

  const raw = await boundedBytes(request, RESEND_WEBHOOK_BODY_CEILING);
  if (!raw) return errorResponse(rid, 413, 'BODY_TOO_LARGE', 'body_too_large');

  const verify = await verifyResendSignature(request, raw, env);
  if (!verify.ok) {
    if (verify.reason === 'no_secret') return errorResponse(rid, 503, 'UPSTREAM_UNAVAILABLE', 'upstream_unavailable');
    return errorResponse(rid, 401, 'WEBHOOK_SIGNATURE_INVALID', 'webhook_signature_invalid');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return errorResponse(rid, 400, 'INVALID_JSON', 'invalid_json');
  }
  const event = parseResendEvent(parsed);
  if (!event) return errorResponse(rid, 422, 'VALIDATION_ERROR', 'validation_error');

  const payloadHash = await sha256(raw);
  const dedupeKey = `resend:${event.provider_event_id}`;

  const existing = await env.DB.prepare('SELECT id FROM email_delivery_events WHERE provider_event_id = ?').bind(event.provider_event_id).first<{ id: number }>();
  if (existing) {
    const body: WebhookAck = { ok: true, request_id: rid, received: true, duplicate: true };
    return json<WebhookAck>(body, 200, rid);
  }

  let contactId: number | null = null;
  if (event.contact_public_id) {
    const row = await env.DB.prepare('SELECT id FROM contact_submissions WHERE public_id = ?').bind(event.contact_public_id).first<{ id: number }>();
    contactId = row?.id ?? null;
  }
  if (!contactId && event.provider_message_id) {
    const row = await env.DB.prepare(
      `SELECT o.contact_id AS contact_id
         FROM notification_outbox o
         WHERE o.provider_message_id = ?
         ORDER BY o.id DESC
         LIMIT 1`,
    )
      .bind(event.provider_message_id)
      .first<{ contact_id: number }>();
    contactId = row?.contact_id ?? null;
  }

  const nextState = (() => {
    switch (event.event_type) {
      case 'email.sent': return 'sent';
      case 'email.delivered': return 'delivered';
      case 'email.delivery_delayed': return 'sent';
      case 'email.bounced': return 'bounced';
      case 'email.complained': return 'failed';
      case 'email.failed': return 'failed';
      case 'email.suppressed': return 'bounced';
    }
  })();

  const statements = [
    env.DB.prepare(
      'INSERT INTO email_delivery_events (provider, provider_event_id, provider_message_id, contact_id, event_type, payload_hash, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(event.provider, event.provider_event_id, event.provider_message_id, contactId, event.event_type, payloadHash, event.occurred_at),
  ];
  if (contactId && (nextState === 'sent' || nextState === 'delivered' || nextState === 'bounced' || nextState === 'failed')) {
    statements.push(
      env.DB.prepare(
        'UPDATE notification_outbox SET state = ?, updated_at = unixepoch(), sent_at = CASE WHEN ? = "sent" OR ? = "delivered" THEN unixepoch() ELSE sent_at END WHERE contact_id = ? AND state IN ("pending", "sending")',
      ).bind(nextState, nextState, nextState, contactId),
    );
    if (nextState === 'failed' || nextState === 'bounced') {
      statements.push(
        env.DB.prepare('UPDATE contact_submissions SET notification_status = ? WHERE id = ?').bind(nextState, contactId),
      );
    } else if (nextState === 'delivered' || nextState === 'sent') {
      statements.push(
        env.DB.prepare('UPDATE contact_submissions SET notification_status = ? WHERE id = ? AND notification_status = "pending"').bind(nextState, contactId),
      );
    }
  }
  void dedupeKey;
  await env.DB.batch(statements);

  await Promise.all([
    env.RATELIMIT.put(minKey, String(Number(minCount ?? '0') + 1), { expirationTtl: 90 }),
    env.RATELIMIT.put(hourKey, String(Number(hourCount ?? '0') + 1), { expirationTtl: 3_900 }),
  ]);

  const body: WebhookAck = { ok: true, request_id: rid, received: true, duplicate: false };
  return json<WebhookAck>(body, 200, rid);
};

export const _resendContractRef = { auth_gate: RESEND_WEBHOOK_AUTH_GATE, budget: RESEND_WEBHOOK_BUDGET, durable_effect: RESEND_WEBHOOK_DURABLE_EFFECT, body_ceiling: RESEND_WEBHOOK_BODY_CEILING } as const;
