import { z } from 'zod';

export const InboxStateSchema = z.enum(['unread', 'read', 'archived', 'all']);

export const InboxQuerySchema = z
  .object({
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(25).default(20),
    state: InboxStateSchema.default('unread'),
  })
  .strict();

export const InboxItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(2).max(100),
  email: z.string().email().max(254),
  subject: z.string().min(3).max(160),
  message: z.string().min(20).max(5000),
  created_at: z.number().int().nonnegative(),
  read_at: z.number().int().nonnegative().nullable(),
  archived_at: z.number().int().nonnegative().nullable(),
  notification_status: z.enum(['pending', 'sent', 'delivered', 'failed', 'bounced']),
});

export const InboxResponseSchema = z.object({
  ok: z.literal(true),
  request_id: z.string().min(8).max(128),
  items: z.array(InboxItemSchema).max(25),
  next_cursor: z.string().nullable(),
  csrf_token: z.string().min(16).max(256),
});

export type InboxQuery = z.infer<typeof InboxQuerySchema>;
export type InboxItem = z.infer<typeof InboxItemSchema>;
export type InboxResponse = z.infer<typeof InboxResponseSchema>;

export const CONTACT_INBOX_DURABLE_EFFECT = 'none' as const;
export const CONTACT_INBOX_BUDGET = { minute: 60, hour: 600, scope: 'access_subject' } as const;
export const CONTACT_INBOX_AUTH_GATE = 'verified Cloudflare Access JWT (Cf-Access-Jwt-Assertion) against org JWKS, issuer, audience, expiry' as const;
