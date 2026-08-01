import type { PagesFunction } from '@cloudflare/workers-types';
import { errorResponse, json, requestId, type Env, type HealthResponse } from '../lib/contracts';
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const rid = requestId(request);
  const auth = request.headers.get('Authorization');
  if (!env.SMOKE_TEST_TOKEN || !auth || auth !== `Bearer ${env.SMOKE_TEST_TOKEN}`)
    return errorResponse(rid, 401, 'AUTH_REQUIRED', 'auth_required');
  const url = new URL(request.url);
  const deep = url.searchParams.get('deep') ?? '0';
  if (deep !== '0' && deep !== '1')
    return errorResponse(rid, 422, 'VALIDATION_ERROR', 'validation_error');
  const checks: HealthResponse['checks'] = { worker: 'ok' };
  if (deep === '1') {
    try {
      await env.DB.prepare('SELECT 1').first();
      const key = `health:v1:${env.RELEASE_SHA ?? 'local'}`;
      await env.RATELIMIT.put(key, 'ok', { expirationTtl: 60 });
      if ((await env.RATELIMIT.get(key)) !== 'ok') throw new Error('kv');
      checks.d1 = 'ok';
      checks.kv = 'ok';
    } catch {
      return errorResponse(rid, 503, 'UPSTREAM_UNAVAILABLE', 'upstream_unavailable');
    }
  }
  return json<HealthResponse>(
    {
      ok: true,
      request_id: rid,
      service: 'portfolio-api',
      release: env.RELEASE_SHA ?? 'local',
      checks,
    },
    200,
    rid,
  );
};
