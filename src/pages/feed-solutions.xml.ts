/**
 * feed-solutions.xml.ts : RSS 2.0 stream of solution entries only.
 *
 * See _feed-shared.ts for the rendering helpers.
 */
import type { APIRoute } from 'astro';
import { profile } from '@utils/profile';
import { buildStampUtc8Iso } from '@utils/build-stamp';
import { buildItems, renderFeed } from './_feed-shared';

export const prerender = true;

export const GET: APIRoute = async ({ site }) => {
  const siteStr = site?.toString().replace(/\/$/, '') ?? 'https://christianmacion26.github.io';
  const basePath = (import.meta.env.BASE_URL || '').replace(/\/$/, '');
  const baseUrl = `${siteStr}${basePath}`;
  // §9: deterministic feed `<updated>` from BUILD_DATE (env), not `new Date()`.
  const now = buildStampUtc8Iso();
  const items = await buildItems(baseUrl, now);

  const body = renderFeed({
    baseUrl,
    stream: 'solution',
    selfHref: `${baseUrl}/feed-solutions.xml`,
    title: `${profile.fullName} to Solutions`,
    subtitle: 'Client engagements and shipped deliverables. Newest first.',
    items,
    now,
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=600',
    },
  });
};
