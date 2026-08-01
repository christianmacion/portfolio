import type { PagesFunction } from '@cloudflare/workers-types';
import {
  allowedOrigin,
  boundedJson,
  errorResponse,
  json,
  parseVitals,
  requestId,
  type Env,
  type VitalsAccepted,
} from '../lib/contracts';
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const rid = requestId(request);
  const origin = allowedOrigin(request, env);
  if (!origin) return errorResponse(rid, 403, 'ORIGIN_DENIED', 'origin_denied');
  const value = parseVitals(await boundedJson(request, 4096));
  if (!value) return errorResponse(rid, 422, 'VALIDATION_ERROR', 'validation_error');
  const key = `rl:v1:vitals:sid:${value.session_id}:${Math.floor(Date.now() / 3600000)}`;
  const count = Number((await env.RATELIMIT.get(key)) ?? '0');
  if (count >= 120) return errorResponse(rid, 429, 'RATE_LIMIT', 'rate_limit');
  await env.RATELIMIT.put(key, String(count + 1), { expirationTtl: 3900 });
  return json<VitalsAccepted>({ ok: true, request_id: rid, accepted: true }, 202, rid, {
    'Access-Control-Allow-Origin': origin,
  });
};
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const rid = requestId(request);
  const auth = request.headers.get('Authorization');
  if (!env.SMOKE_TEST_TOKEN || auth !== `Bearer ${env.SMOKE_TEST_TOKEN}`)
    return errorResponse(rid, 401, 'AUTH_REQUIRED', 'auth_required');
  const rows = await env.DB.prepare(
    'SELECT hour_start, metric, route, device, weighted_samples, p50, p75, p95 FROM vitals_hourly ORDER BY hour_start DESC LIMIT 25',
  ).all();
  return json({ ok: true, request_id: rid, items: rows.results }, 200, rid);
};
