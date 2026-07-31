export type ApiErrorCode = 'BODY_TOO_LARGE' | 'INVALID_JSON' | 'VALIDATION_ERROR' | 'ORIGIN_DENIED' | 'AUTH_REQUIRED' | 'AUTH_INVALID' | 'CSRF_INVALID' | 'TURNSTILE_FAILED' | 'RATE_LIMIT' | 'IDEMPOTENCY_CONFLICT' | 'WEBHOOK_SIGNATURE_INVALID' | 'NOT_FOUND' | 'UPSTREAM_UNAVAILABLE' | 'INTERNAL_ERROR';

export type ApiError = { ok: false; error: string; code: ApiErrorCode; request_id: string; details?: ReadonlyArray<{ path: string; code: string }> };
export type ContactRequest = { name: string; email: string; subject: string; message: string; turnstile_token: string };
export type ContactAccepted = { ok: true; request_id: string; submission_ref: string; notification: 'queued'; duplicate: boolean };
export type VitalsRequest = { metric: 'LCP' | 'CLS' | 'INP' | 'FCP' | 'TTFB'; value: number; route: string; device: 'mobile' | 'tablet' | 'desktop' | 'unknown'; session_id: string };
export type VitalsAccepted = { ok: true; request_id: string; accepted: true };
export type HealthResponse = { ok: true; request_id: string; service: 'portfolio-api'; release: string; checks: { worker: 'ok'; d1?: 'ok'; kv?: 'ok' } };

export type InboxItem = {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  created_at: number;
  read_at: number | null;
  archived_at: number | null;
  notification_status: 'pending' | 'sent' | 'delivered' | 'failed' | 'bounced';
};
export type InboxResponse = { ok: true; request_id: string; items: ReadonlyArray<InboxItem>; next_cursor: string | null; csrf_token: string };
export type MarkReadRequest = { read: boolean };
export type MarkReadResponse = { ok: true; request_id: string; id: string; read_at: number | null };
export type WebhookEventType = 'email.sent' | 'email.delivered' | 'email.delivery_delayed' | 'email.bounced' | 'email.complained' | 'email.failed' | 'email.suppressed';
export type ResendEvent = {
  provider: 'resend';
  provider_event_id: string;
  provider_message_id: string;
  event_type: WebhookEventType;
  occurred_at: number;
  contact_public_id: string | null;
  payload_hash: string;
};
export type WebhookAck = { ok: true; request_id: string; received: true; duplicate: boolean };

export type Env = {
  DB: D1Database;
  RATELIMIT: KVNamespace;
  TURNSTILE_SECRET_PRIMARY?: string;
  TURNSTILE_SECRET_PREVIOUS?: string;
  IP_HASH_PEPPER_PRIMARY?: string;
  IP_HASH_PEPPER_PREVIOUS?: string;
  CSRF_SIGNING_KEY_PRIMARY?: string;
  CSRF_SIGNING_KEY_PREVIOUS?: string;
  SESSION_SIGNING_KEY_PRIMARY?: string;
  SESSION_SIGNING_KEY_PREVIOUS?: string;
  RESEND_WEBHOOK_SECRET_PRIMARY?: string;
  RESEND_WEBHOOK_SECRET_PREVIOUS?: string;
  RESEND_API_KEY?: string;
  OWNER_NOTIFY_EMAIL?: string;
  CONTACT_FROM_EMAIL?: string;
  CF_ANALYTICS_READ_TOKEN?: string;
  INTERNAL_SERVICE_TOKEN?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  CF_ACCESS_JWKS_URL?: string;
  SMOKE_TEST_TOKEN?: string;
  RELEASE_SHA?: string;
  PUBLIC_ORIGINS?: string;
  AE_DATASET?: string;
  AE?: AnalyticsEngineDataset;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const control = /[ -]/;
export function parseContact(value: unknown): ContactRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const fields = ['name', 'email', 'subject', 'message', 'turnstile_token'];
  if (Object.keys(input).some((key) => !fields.includes(key))) return null;
  if (fields.some((key) => typeof input[key] !== 'string')) return null;
  const result = { name: String(input.name).trim(), email: String(input.email).trim().toLowerCase(), subject: String(input.subject).trim(), message: String(input.message).trim(), turnstile_token: String(input.turnstile_token) };
  if (result.name.length < 2 || result.name.length > 100 || control.test(result.name)) return null;
  if (result.email.length < 3 || result.email.length > 254 || !/^\S+@\S+\.\S+$/.test(result.email)) return null;
  if (result.subject.length < 3 || result.subject.length > 160 || control.test(result.subject)) return null;
  if (result.message.length < 20 || result.message.length > 5000 || /[ ]/.test(result.message)) return null;
  if (result.turnstile_token.length < 1 || result.turnstile_token.length > 2048) return null;
  return result;
}
export function parseVitals(value: unknown): VitalsRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const metrics = ['LCP', 'CLS', 'INP', 'FCP', 'TTFB'];
  const devices = ['mobile', 'tablet', 'desktop', 'unknown'];
  if (typeof input.metric !== 'string' || !metrics.includes(input.metric) || typeof input.value !== 'number' || !Number.isFinite(input.value) || input.value < 0 || input.value > 120000 || typeof input.route !== 'string' || !/^\/[A-Za-z0-9/_-]*\/$|^\/$/.test(input.route) || typeof input.device !== 'string' || !devices.includes(input.device) || typeof input.session_id !== 'string' || !uuid.test(input.session_id)) return null;
  if (input.metric === 'CLS' && input.value > 10) return null;
  return input as VitalsRequest;
}
export function parseInboxQuery(value: Record<string, string> | URLSearchParams | null): { cursor: string | null; limit: number; state: 'unread' | 'read' | 'archived' | 'all' } | null {
  const params = value instanceof URLSearchParams ? value : value ? new URLSearchParams(value) : new URLSearchParams();
  const cursorRaw = params.get('cursor');
  if (cursorRaw !== null && (typeof cursorRaw !== 'string' || cursorRaw.length === 0 || cursorRaw.length > 512)) return null;
  const limitRaw = params.get('limit') ?? '20';
  const limit = Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) return null;
  const stateRaw = params.get('state') ?? 'unread';
  if (stateRaw !== 'unread' && stateRaw !== 'read' && stateRaw !== 'archived' && stateRaw !== 'all') return null;
  return { cursor: cursorRaw, limit, state: stateRaw };
}
export function parseMarkRead(value: unknown): MarkReadRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== 'read')) return null;
  if (typeof input.read !== 'boolean') return null;
  return { read: input.read };
}
export function parsePublicId(value: string | undefined | null): string | null {
  if (typeof value !== 'string' || value.length !== 36 || !uuid.test(value)) return null;
  return value;
}
export function parseResendEvent(value: unknown): ResendEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (input.type !== 'email.sent' && input.type !== 'email.delivered' && input.type !== 'email.delivery_delayed' && input.type !== 'email.bounced' && input.type !== 'email.complained' && input.type !== 'email.failed' && input.type !== 'email.suppressed') return null;
  const data = (input.data && typeof input.data === 'object' && !Array.isArray(input.data)) ? input.data as Record<string, unknown> : null;
  if (!data || typeof data.email_id !== 'string' || data.email_id.length < 1 || data.email_id.length > 256) return null;
  const occurred = typeof input.created_at === 'string' ? Math.floor(new Date(input.created_at).getTime() / 1000) : NaN;
  if (!Number.isFinite(occurred) || occurred < 0 || occurred > 4_102_444_800) return null;
  if (typeof input.svix_id !== 'string' || input.svix_id.length < 1 || input.svix_id.length > 256) return null;
  if (typeof input.svix_timestamp !== 'string' && typeof input.svix_timestamp !== 'number') return null;
  const contactHint = typeof data.to === 'string' ? data.to : null;
  return {
    provider: 'resend',
    provider_event_id: input.svix_id,
    provider_message_id: data.email_id,
    event_type: input.type,
    occurred_at: occurred,
    contact_public_id: contactHint && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(contactHint) ? contactHint : null,
    payload_hash: '',
  };
}
export function requestId(request: Request): string { return request.headers.get('CF-Ray') ?? crypto.randomUUID(); }
export function json<T>(body: T, status = 200, requestIdValue?: string, extra: HeadersInit = {}): Response { const headers = new Headers(extra); headers.set('Content-Type', 'application/json; charset=utf-8'); headers.set('Cache-Control', 'no-store'); if (requestIdValue) headers.set('X-Request-Id', requestIdValue); return new Response(JSON.stringify(body), { status, headers }); }
export function errorResponse(requestIdValue: string, status: number, code: ApiErrorCode, error: string): Response { return json<ApiError>({ ok: false, error, code, request_id: requestIdValue }, status); }
export function allowedOrigin(request: Request, env: Env): string | null { const origin = request.headers.get('Origin'); const configured = (env.PUBLIC_ORIGINS ?? 'https://christianmacion-portfolio.pages.dev,https://christianmacion26.github.io').split(',').map((item) => item.trim()); return origin && configured.includes(origin) ? origin : null; }
export async function boundedJson(request: Request, maxBytes: number): Promise<unknown | null> { const length = Number(request.headers.get('Content-Length') ?? '0'); if (length > maxBytes) return null; const reader = request.body?.getReader(); if (!reader) return null; const chunks: Uint8Array[] = []; let total = 0; for (;;) { const part = await reader.read(); if (part.done) break; total += part.value.byteLength; if (total > maxBytes) { await reader.cancel(); return null; } chunks.push(part.value); } const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; } catch { return null; } }
export async function boundedBytes(request: Request, maxBytes: number): Promise<Uint8Array | null> { const length = Number(request.headers.get('Content-Length') ?? '0'); if (length > maxBytes) return null; const reader = request.body?.getReader(); if (!reader) return null; const chunks: Uint8Array[] = []; let total = 0; for (;;) { const part = await reader.read(); if (part.done) break; total += part.value.byteLength; if (total > maxBytes) { await reader.cancel(); return null; } chunks.push(part.value); } const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes; }
export async function sha256(value: string | Uint8Array): Promise<string> { const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value; const digest = await crypto.subtle.digest('SHA-256', bytes); return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
export async function hmacSha256(secret: string, payload: string | Uint8Array): Promise<string> { const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); const bytes = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload; const sig = await crypto.subtle.sign('HMAC', key, bytes); return Array.from(new Uint8Array(sig)).map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
export function constantTimeEqual(a: string, b: string): boolean { if (a.length !== b.length) return false; let mismatch = 0; for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i); return mismatch === 0; }
export function base64UrlEncode(value: string | Uint8Array): string { const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value; let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
export function base64UrlDecode(value: string): Uint8Array { const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4); const binary = atob(padded); const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i); return bytes; }
export type AccessClaims = { sub: string; aud: string | string[]; iss: string; exp: number; iat: number; email?: string };
export function parseAccessJwt(token: string): AccessClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const headerBytes = base64UrlDecode(parts[0]);
    const headerText = new TextDecoder().decode(headerBytes);
    const header = JSON.parse(headerText) as { alg?: string; kid?: string };
    if (header.alg !== 'RS256' && header.alg !== 'ES256') return null;
    const payloadBytes = base64UrlDecode(parts[1]);
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as AccessClaims;
    if (typeof payload.sub !== 'string' || payload.sub.length < 1) return null;
    if (typeof payload.iss !== 'string') return null;
    if (typeof payload.exp !== 'number' || typeof payload.iat !== 'number') return null;
    if (typeof payload.aud !== 'string' && !Array.isArray(payload.aud)) return null;
    return payload;
  } catch {
    return null;
  }
}
export type ResendVerifyOk = { ok: true; event_id: string };
export type ResendVerifyErr = { ok: false; reason: 'missing_header' | 'bad_timestamp' | 'bad_signature' | 'no_secret' };
export async function verifyResendSignature(request: Request, raw: Uint8Array, env: Env): Promise<ResendVerifyOk | ResendVerifyErr> {
  const id = request.headers.get('svix-id');
  const ts = request.headers.get('svix-timestamp');
  const sig = request.headers.get('svix-signature');
  if (!id || !ts || !sig) return { ok: false, reason: 'missing_header' };
  if (!/^\d{10,20}$/.test(ts)) return { ok: false, reason: 'bad_timestamp' };
  const secret = env.RESEND_WEBHOOK_SECRET_PRIMARY;
  if (!secret) return { ok: false, reason: 'no_secret' };
  const candidate = sig.replace(/^v1,/, '').trim();
  const expected = await hmacSha256(secret, `${id}.${ts}.${new TextDecoder().decode(raw)}`);
  if (constantTimeEqual(candidate, expected)) return { ok: true, event_id: id };
  if (env.RESEND_WEBHOOK_SECRET_PREVIOUS) {
    const previous = await hmacSha256(env.RESEND_WEBHOOK_SECRET_PREVIOUS, `${id}.${ts}.${new TextDecoder().decode(raw)}`);
    if (constantTimeEqual(candidate, previous)) return { ok: true, event_id: id };
  }
  return { ok: false, reason: 'bad_signature' };
}
