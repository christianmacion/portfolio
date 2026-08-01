import type { PagesFunction } from '@cloudflare/workers-types';
import { json, requestId, type Env } from '../lib/contracts';
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const rid = requestId(request);
  try {
    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS submissions FROM contact_submissions',
    ).first<{ submissions: number }>();
    return json(
      {
        ok: true,
        request_id: rid,
        sitemap: [
          { loc: new URL('/', request.url).toString(), lastmod: new Date(0).toISOString() },
        ],
        submissions: row?.submissions ?? 0,
      },
      200,
      rid,
    );
  } catch {
    return json(
      { ok: true, request_id: rid, sitemap: [{ loc: new URL('/', request.url).toString() }] },
      200,
      rid,
    );
  }
};
