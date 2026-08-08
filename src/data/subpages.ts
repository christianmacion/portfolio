/**
 * subpages.ts :  v9.8 Wave B subpage registry.
 *
 * Single source of truth for the 4 light-content subpages added in
 * v9.8. Each entry binds a URL slug to its section index (used by
 * <SectionMark index="NN" />), title (lowercased on render), H1
 * title, eyebrow chip text, and a 1-line description used as the
 * page <meta description>.
 *
 * Used by:
 *   - src/pages/{notes,stack,repos,engagement}.astro
 *   - src/components/SideRail.astro (nav items)
 *   - src/utils/seo.ts (breadcrumb JSON-LD fallback)
 *
 * v9.8 Wave B :  front_end_engineer per commander dispatch.
 * Pattern-only: matches the institutional chrome contract
 * (mono + 1 amber accent, no halo/glow/gradient).
 */

export interface SubpageEntry {
  /** URL slug (no leading slash). Must match `src/pages/<slug>.astro`. */
  slug: string;
  /** SideRail nav label (sentence-case). */
  label: string;
  /** SectionMark 2-digit index (e.g. "01", "02"). */
  index: string;
  /** SectionMark title :  auto-lowercased on render. */
  title: string;
  /** Page <title>. */
  pageTitle: string;
  /** Page <meta description>. */
  description: string;
  /** Eyebrow chip text above the H1. */
  chip: string;
  /** SVG icon key for SideRail (1px stroke, 16×16). */
  icon: 'note' | 'stack' | 'repo' | 'engage' | 'timeline';
}

export const subpages: ReadonlyArray<SubpageEntry> = [
  {
    slug: 'notes',
    label: 'Notes',
    index: '01',
    title: 'research log',
    pageTitle: 'Notes',
    description:
      'Research log: a working notebook of quant + AI thinking, postmortems, and what survived review.',
    chip: 'NOTES · RESEARCH LOG · WORKING NOTEBOOK',
    icon: 'note',
  },
  {
    slug: 'stack',
    label: 'Stack',
    index: '02',
    title: 'tools and stack',
    pageTitle: 'Stack',
    description:
      'Tools, libraries, and infrastructure: what runs in production, what runs in dev, and what is on the bench.',
    chip: 'STACK · TOOLS · WHAT IS INSTALLED',
    icon: 'stack',
  },
  {
    slug: 'repos',
    label: 'Repos',
    index: '03',
    title: 'github portfolio',
    pageTitle: 'Repos',
    description:
      'GitHub portfolio: runnable code, reproducible scorecards, and the public record of shipped work.',
    chip: 'REPOS · GITHUB PORTFOLIO · RUNNABLE',
    icon: 'repo',
  },
  {
    slug: 'engagement',
    label: 'Engagement',
    index: '04',
    title: 'engagement model',
    pageTitle: 'Engagement',
    description:
      'Engagement model: how to work together :  scope, cadence, deliverables, and the parts of the loop that are non-negotiable.',
    chip: 'ENGAGEMENT · HOW WE WORK · NON-NEGOTIABLES',
    icon: 'engage',
  },
  {
    slug: 'timeline',
    label: 'AI Timeline',
    index: '05',
    title: 'ai history timeline',
    pageTitle: 'AI History Timeline',
    description:
      'Six architectural jumps in three years: PROMPTS to SKILLS to AGENTS to HARNESS to LOOPS to GRAPHS. Always up to trend, two months ahead of mainstream.',
    chip: 'AI · HISTORY · 2022 TO 2025 · 10 MONTHS AHEAD',
    icon: 'timeline',
  },
];

/** Lookup by URL slug. */
export function getSubpageBySlug(slug: string): SubpageEntry | undefined {
  const normalized = slug.replace(/^\/+|\/+$/g, '');
  return subpages.find((s) => s.slug === normalized);
}
