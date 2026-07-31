/**
 * _feed-shared.ts — shared helpers for the three RSS 2.0 streams.
 *
 * Used by:
 *   - /feed.xml            (merged)
 *   - /feed-projects.xml   (project stream only)
 *   - /feed-solutions.xml  (solution stream only)
 *
 * All three render via the same renderFeed() with different filters.
 */
import { getCollection } from 'astro:content';
import { profile } from '@utils/profile';
import { buildYear } from '@utils/build-stamp';

export type FeedKind = 'project' | 'solution';
export type FeedStream = 'all' | 'project' | 'solution';

export interface FeedItem {
  id: string;
  title: string;
  url: string;
  updated: string; // ISO 8601
  summary: string;
  tags: string[];
  kind: FeedKind;
}

// tag: URI per RFC 4151 — stable, persistent, unique.
// Format: tag:<authority>,<date>:<specific>.
// Use the deployment host (PUBLIC_SITE_URL on mirror builds, GH Pages default
// otherwise) so feed <guid> values stay stable across builds. The year comes
// from buildYear() (BUILD_DATE env var, fixed fallback) per Standing Order §9.
const _host = (() => {
  try {
    return new URL(import.meta.env.PUBLIC_SITE_URL ?? 'https://christianmacion26.github.io').host;
  } catch {
    return 'christianmacion26.github.io';
  }
})();
export const PORTFOLIO_TAG_AUTHORITY = `${_host},${buildYear()}`;

function toIsoDate(d: Date | string | undefined, fallback: string): string {
  if (!d) return fallback;
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return fallback;
  return date.toISOString();
}

function toRssDate(isoDate: string): string {
  const date = new Date(isoDate);
  return isNaN(date.getTime()) ? new Date(0).toUTCString() : date.toUTCString();
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function buildItems(baseUrl: string, now: string): Promise<FeedItem[]> {
  const items: FeedItem[] = [];

  const projects = await getCollection('project');
  for (const p of projects) {
    items.push({
      id: `tag:${PORTFOLIO_TAG_AUTHORITY}:project:${p.id}`,
      title: p.data.title,
      url: `${baseUrl}/projects/${p.id}/`,
      updated: toIsoDate(p.data.date, now),
      summary: p.data.summary,
      tags: p.data.tags ?? [],
      kind: 'project',
    });
  }

  const solutions = await getCollection('solution');
  for (const s of solutions) {
    // Solutions schema has no date field; emit the deterministic build stamp.
    items.push({
      id: `tag:${PORTFOLIO_TAG_AUTHORITY}:solution:${s.data.slug}`,
      title: s.data.title,
      url: `${baseUrl}/solutions/#${s.data.slug}`,
      updated: now,
      summary: s.data.problem,
      tags: s.data.tags ?? [],
      kind: 'solution',
    });
  }

  // Order newest-first and cap each stream at 50 items.
  items.sort((a, b) => b.updated.localeCompare(a.updated));
  return items.slice(0, 50);
}

export interface RenderOpts {
  baseUrl: string;
  stream: FeedStream;
  selfHref: string;
  title: string;
  subtitle: string;
  items: FeedItem[];
  now: string;
}

export function renderFeed(opts: RenderOpts): string {
  const { baseUrl, stream, selfHref, title, subtitle, items, now } = opts;

  const entries = items
    .filter((it) => stream === 'all' || it.kind === stream)
    .map(
      (it) => `    <item>
      <title>${escapeXml(it.title)}</title>
      <link>${escapeXml(it.url)}</link>
      <guid isPermaLink="false">${escapeXml(it.id)}</guid>
      <pubDate>${toRssDate(it.updated)}</pubDate>
      <description>${escapeXml(it.summary)}</description>${
        it.tags.length
          ? `\n      ${it.tags.map((t) => `<category>${escapeXml(t)}</category>`).join('\n      ')}`
          : ''
      }
    </item>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(`${baseUrl}/`)}</link>
    <atom:link href="${escapeXml(selfHref)}" rel="self" type="application/rss+xml" />
    <description>${escapeXml(subtitle)}</description>
    <language>en</language>
    <lastBuildDate>${toRssDate(now)}</lastBuildDate>
    <managingEditor>${escapeXml(profile.contact.email)} (${escapeXml(profile.fullName)})</managingEditor>
${entries}
  </channel>
</rss>
`;
}
