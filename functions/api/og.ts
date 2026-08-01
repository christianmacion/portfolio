import type { PagesFunction } from '@cloudflare/workers-types';
import { requestId, type Env } from '../lib/contracts';
export const onRequestGet: PagesFunction<Env> = async ({ request }) => {
  const rid = requestId(request);
  const url = new URL(request.url);
  const title = url.searchParams.get('title')?.slice(0, 120) ?? 'Portfolio';
  const safeTitle = title.replace(/[&<>"']/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#171b20"/><path d="M80 500H1120" stroke="#c98a16" stroke-width="4"/><text x="80" y="300" fill="#f5f2e9" font-family="Arial,sans-serif" font-size="64" font-weight="700">${safeTitle}</text><text x="80" y="380" fill="#b7c9b0" font-family="monospace" font-size="24">CHRISTIAN MACION / PORTFOLIO</text></svg>`;
  return new Response(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'X-Request-Id': rid,
    },
  });
};
