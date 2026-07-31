import type { PagesFunction } from '@cloudflare/workers-types';
import { errorResponse, requestId, type Env } from '../lib/contracts';

const onAny: PagesFunction<Env> = async ({ request }) => {
  const rid = requestId(request);
  return errorResponse(rid, 404, 'NOT_FOUND', 'not_found');
};

export const onRequestGet = onAny;
export const onRequestPost = onAny;
export const onRequestPut = onAny;
export const onRequestPatch = onAny;
export const onRequestDelete = onAny;
export const onRequestHead = onAny;
export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { status: 204 });
