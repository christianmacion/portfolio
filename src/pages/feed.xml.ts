/**
 * feed.xml.ts — RSS 2.0 feed of all portfolio content (projects + solutions merged).
 *
 * Three streams:
 *   /feed.xml            — merged (all kinds), canonical homepage link
 *   /feed-projects.xml   — project stream only
 *   /feed-solutions.xml  — solution stream only
 *
 * Surfaced via <link rel="alternate" type="application/rss+xml"> in BaseLayout.
 * Items are ordered newest-first; capped at 50 per stream. Each entry links to
 * the canonical public URL and carries the frontmatter summary as the content body.
 */
import type { APIRoute } from 'astro';
import { profile } from '@utils/profile';
import { buildStampUtc8Iso } from '@utils/build-stamp';
import { buildItems, renderFeed } from './_feed-shared';

export const prerender = true;

export const GET: APIRoute = async ({ site }) => {
  // Combine Astro `site` (origin) with `import.meta.env.BASE_URL` (configured base, "/portfolio")
  // so feed entry URLs match the canonical sitemap URLs which include the base path.
  // Fallback matches the live Cloudflare Pages domain — the GH Pages domain is no
  // longer the canonical deploy target (see package.json `build` script).
  const siteStr =
    site?.toString().replace(/\/$/, '') ?? 'https://christianmacion-portfolio.pages.dev';
  const basePath = (import.meta.env.BASE_URL || '').replace(/\/$/, '');
  const baseUrl = `${siteStr}${basePath}`;
  // §9: deterministic feed `<updated>` from BUILD_DATE (env), not `new Date()`.
  const now = buildStampUtc8Iso();
  const items = await buildItems(baseUrl, now);

  const body = renderFeed({
    baseUrl,
    stream: 'all',
    selfHref: `${baseUrl}/feed.xml`,
    title: `${profile.fullName} — Portfolio Updates`,
    subtitle: 'Newest projects, research artifacts, and client solutions. Quant, AI, OSS.',
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
