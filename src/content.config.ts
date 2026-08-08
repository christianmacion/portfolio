/**
 * content.config.ts : Astro 5 content collection schemas (Zod).
 * All collections are loaded by the Slug routing in src/pages/projects/[slug].astro.
 */
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const headlineMetric = z.object({
  label: z.string(),
  value: z.string(),
  sub: z.string().optional(),
});

const project = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/projects' }),
  schema: z.object({
    title: z.string(),
    role: z.enum(['ai', 'quant']),
    order: z.number(),
    summary: z.string(),
    summary_long: z.string().optional(),
    stack: z.array(z.string()).default([]),
    metrics: z.array(headlineMetric).default([]),
    repo: z.string().optional(),
    demo: z.string().optional(),
    sourceLink: z.string().optional(),
    status: z.enum(['production', 'open-source', 'internal', 'archived']).default('open-source'),
    tags: z.array(z.string()).default([]),
    date: z.coerce.date().optional(),
    // Optional pin flag. When true, the project is sorted to the top of
    // /projects and /proof with a "Pinned" mono pill. Pattern from
    // Neel Nanda (pinned posts) and Hugo PaperMod (sticky-until-read).
    pinned: z.boolean().default(false),
    readMinutes: z.number().optional(),
    topic: z.enum(['quant', 'ai', 'oss', 'teaching']).optional(),
    assetType: z.enum(['code', 'writeup', 'talk', 'live-demo']).optional(),
    // Optional hero image rendered at the top of the detail page.
    // Used to anchor visuals for backtests / eval dashboards / etc.
    hero: z
      .object({
        src: z.string(), // path under /public, e.g. "/proof/dashboard-2026-01.png"
        alt: z.string(),
        fit: z.enum(['cover', 'contain']).default('cover'),
        aspect: z.enum(['16/9', '4/3', '3/2', '16/10', 'auto']).default('16/9'),
      })
      .optional(),
  }),
});

const experience = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/experience' }),
  schema: z.object({
    title: z.string(), // job title
    company: z.string(), // employer
    role: z.string().default('experience'),
    order: z.number(),
    location: z.string(),
    startDate: z.string(), // YYYY-MM
    endDate: z.string(), // YYYY-MM or "present"
    isCurrent: z.boolean().default(false),
    summary: z.string().optional(),
    tags: z.array(z.string()).default([]),
    contributions: z
      .array(
        z.object({
          label: z.string(),
          evidence: z.string(),
          proof: z.string().optional(),
        }),
      )
      .default([]),
    proofs: z.array(z.string()).default([]),
  }),
});

const skillItem = z.object({
  label: z.string(),
  sub: z.string().optional(),
  level: z.number().min(1).max(5).optional(), // self-rated proficiency 1-5
  years: z.number().optional(), // years of practice
});

const skillGroup = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/skills' }),
  schema: z.object({
    title: z.string(),
    group: z.string(),
    blurb: z.string(),
    items: z.array(skillItem),
    order: z.number(),
  }),
});

const certItem = z.object({
  name: z.string(),
  issuer: z.string(),
  year: z.number().optional(),
  tier: z.number().optional(),
  flagship: z.boolean().optional(),
});

const certGroup = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/certifications' }),
  schema: z.object({
    title: z.string(),
    group: z.string(),
    blurb: z.string(),
    items: z.array(certItem),
    order: z.number(),
    // Optional flagship: a single signature image that anchors the group.
    // Rendered as a ProofCard above the cert list when set.
    featuredImg: z.string().optional(),
    featuredCaption: z.string().optional(),
    featuredAlt: z.string().optional(),
    featuredHref: z.string().optional(),
  }),
});

const solution = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/solutions' }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    category: z.string(),
    order: z.number(),
    client: z.string(),
    problem: z.string(),
    approach: z.string(),
    evidence: z.array(z.string()),
    outcome: z.string(),
    proof: z.array(z.string()),
    tags: z.array(z.string()).default([]),
    lane: z.enum(['ai', 'quant', 'education', 'systems']),
  }),
});

// v6.1 : `predictionEvent` collection. Eight binary event contracts,
// each with: market-implied probability (in [0,1] units), an edge over
// the market (in probability units : positive means our model-implied
// is higher than the implied price), a 1-line evidence string, and a
// methodology pointer. NDA-positive by construction: no platform names
// appear in any field. See `notes/v61-patterns.md` for the determinism
// contract (the decay curves are PRNG-derived from `BUILD_DATE`).
const predictionEvent = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/prediction' }),
  schema: z.object({
    title: z.string(),
    category: z.enum(['macro', 'crypto', 'rates', 'political', 'equity', 'volatility']),
    tenor: z.string(),
    impliedPx: z.number().min(0).max(1),
    edge: z.number().min(-1).max(1),
    evidence: z.string(),
    methodology: z.string(),
    order: z.number(),
    source: z.string(),
  }),
});

// v6.2 : `worldEvent` collection. Fixture pins rendered on the
// WorldEventMap iron-desk widget. Each entry has (lat, lon, category,
// severity) so the map can render the pin and the legend can label it.
// Generic language only : no platform or employer names (NDA-positive).
const worldEvent = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/world-events' }),
  schema: z.object({
    title: z.string(),
    category: z.enum(['central-bank', 'earnings', 'geopolitical', 'data-release', 'fx']),
    severity: z.enum(['mild', 'moderate', 'critical']),
    lat: z.number(),
    lon: z.number(),
    city: z.string(),
    source: z.string(),
    order: z.number(),
  }),
});

export const collections = {
  project,
  experience,
  skillGroup,
  certGroup,
  solution,
  predictionEvent,
  worldEvent,
};
