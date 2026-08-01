import { z } from 'zod';

export const WebhookEventTypeSchema = z.enum([
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.complained',
  'email.failed',
  'email.suppressed',
]);

export const ResendEventSchema = z
  .object({
    type: WebhookEventTypeSchema,
    created_at: z.string().datetime(),
    svix_id: z.string().min(1).max(256),
    svix_timestamp: z.union([
      z.string().regex(/^\d{10,20}$/),
      z.number().int().min(1_000_000_000).max(99_999_999_999),
    ]),
    data: z.object({
      email_id: z.string().min(1).max(256),
      to: z.string().email().optional(),
      from: z.string().email().optional(),
      subject: z.string().max(998).optional(),
    }),
  })
  .passthrough();

export const WebhookAckSchema = z.object({
  ok: z.literal(true),
  request_id: z.string().min(8).max(128),
  received: z.literal(true),
  duplicate: z.boolean(),
});

export type ResendEventInput = z.infer<typeof ResendEventSchema>;
export type WebhookAck = z.infer<typeof WebhookAckSchema>;

export const RESEND_WEBHOOK_DURABLE_EFFECT =
  'delivery event + outbox/contact state update' as const;
export const RESEND_WEBHOOK_BUDGET = { minute: 120, hour: 600, scope: 'provider_route' } as const;
export const RESEND_WEBHOOK_AUTH_GATE =
  'Resend/Svix signature over raw bytes via svix-id / svix-timestamp / svix-signature (HMAC-SHA256 of `${id}.${ts}.${raw}`) + replay dedupe on provider_event_id' as const;
export const RESEND_WEBHOOK_BODY_CEILING = 262_144 as const;
