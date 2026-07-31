import { z } from 'zod';

export const ContactPublicIdSchema = z.string().uuid();

export const MarkReadBodySchema = z
  .object({
    read: z.boolean(),
  })
  .strict();

export const MarkReadResponseSchema = z.object({
  ok: z.literal(true),
  request_id: z.string().min(8).max(128),
  id: ContactPublicIdSchema,
  read_at: z.number().int().nonnegative().nullable(),
});

export type MarkReadBody = z.infer<typeof MarkReadBodySchema>;
export type MarkReadResponse = z.infer<typeof MarkReadResponseSchema>;

export const CONTACT_MARK_READ_DURABLE_EFFECT = 'read timestamp + audit row in one D1 batch' as const;
export const CONTACT_MARK_READ_BUDGET = { minute: 20, hour: 120, scope: 'access_subject' } as const;
export const CONTACT_MARK_READ_AUTH_GATE = 'Access JWT + same-origin Fetch Metadata (Sec-Fetch-Site: same-origin) + signed CSRF token (HMAC sub + ts, 10-minute TTL)' as const;
