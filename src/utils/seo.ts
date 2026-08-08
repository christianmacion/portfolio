/**
 * seo.ts : meta / JSON-LD helpers
 *
 * Canonical URLs use Astro.url which already includes the configured `base`,
 * so we never manually prepend it. SITE_URL is the deployment root (without
 * base) so combining it with Astro.url.pathname produces the full public URL.
 * Image URLs combine SITE_URL with `path()` from `url.ts` so they pick up
 * the configured `base` (`/portfolio` on GH Pages).
 */
import { BASE } from './url';
import { profile } from './profile';

export interface SEO {
  title: string;
  description: string;
  image?: string;
  type?: 'website' | 'article' | 'profile';
  pathname?: string;
}

const SITE_NAME = profile.fullName;
// `SITE_URL` is the deployment root (no base path). Default is the canonical
// GH Pages site; override at build time with PUBLIC_SITE_URL when building the
// Cloudflare Pages mirror. Astro strips this from client bundles when prefixed
// with `import.meta.env.`, so we read it via `import.meta.env.PUBLIC_SITE_URL`
// at build time and fall back to the default.
export const SITE_URL =
  (import.meta.env.PUBLIC_SITE_URL as string | undefined) ?? 'https://christianmacion.github.io';

/**
 * Absolute URL with the configured base path appended.
 *
 * v6.0 fix (was BROKEN pre-v6): The previous implementation used
 * `new URL(path, SITE_URL+'/')` which strips the leading slash from `path`
 * and resolves relative to the host root, losing the configured `/portfolio`
 * base. Correct: SITE_URL already includes the base path when BASE is set
 * (e.g. `/portfolio`), so just concatenate.
 *
 * On the Cloudflare Pages mirror (--base=/), BASE is empty and this returns
 * `https://christianmacion-portfolio.pages.dev/og-image.jpg`.
 * On GH Pages (default base), BASE='/portfolio' and this returns
 * `https://christianmacion.github.io/portfolio/og-image.jpg`.
 */
function absUrl(p: string): string {
  return `${SITE_URL}${BASE}${p}`;
}

export function buildMeta({ title, description, image, type = 'website', pathname = '/' }: SEO) {
  // v11.W1 (2026-08-08): a page may pass a fully-composed title that already
  // leads with the site name (the home page does, so the SERP row reads
  // "Christian T. Macion · Quantitative Researcher ..." rather than burying
  // the name at the end). Suffixing SITE_NAME in that case would print the
  // name twice. `startsWith` covers it and is idempotent: composing an
  // already-composed title is a NOOP, so re-runs cannot double-suffix.
  const fullTitle =
    title === SITE_NAME || title.startsWith(SITE_NAME) ? title : `${title} · ${SITE_NAME}`;
  const canonical = new URL(pathname, SITE_URL).toString();
  const imageUrl = image ? new URL(image, SITE_URL).toString() : undefined;
  return {
    title: fullTitle,
    description,
    canonical,
    openGraph: {
      type,
      title: fullTitle,
      description,
      url: canonical,
      site_name: SITE_NAME,
      images: imageUrl ? [{ url: imageUrl }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: imageUrl ? [imageUrl] : undefined,
    },
  };
}

export interface PersonInfo {
  fullName: string;
  titles: { primary: string; secondary: string };
  location: { city: string; province: string; country: string };
  contact: {
    email: string;
    linkedin: string;
    github: string;
    medium?: string;
  };
  knowsAbout?: readonly string[];
  alumniOf?: readonly string[];
  awards?: readonly string[];
}

export function personJsonLd(p: PersonInfo) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: p.fullName,
    jobTitle: p.titles.primary,
    description: p.titles.secondary,
    url: SITE_URL,
    image: absUrl('/og-image.jpg'),
    address: {
      '@type': 'PostalAddress',
      addressLocality: p.location.city,
      addressRegion: p.location.province,
      addressCountry: p.location.country,
    },
    email: p.contact.email,
    sameAs: [p.contact.linkedin, p.contact.github, p.contact.medium].filter(Boolean),
    knowsAbout: p.knowsAbout ?? [],
    alumniOf: (p.alumniOf ?? []).map((name) => ({
      '@type': 'EducationalOrganization',
      name,
    })),
    award: p.awards ?? [],
  };
}

/**
 * WebSite JSON-LD with SearchAction. Allows Google's site-links search box.
 */
export function websiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
    description: `Portfolio of ${profile.fullName} to ${profile.titles.primary}.`,
    inLanguage: 'en',
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}${BASE}/search/?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

/**
 * BreadcrumbList JSON-LD for a hierarchical navigation chain. Helps Google
 * render breadcrumb SERPs (improves CTR) and gives AI agents a strict tree
 * of where each URL sits in the IA.
 *
 * Pass an array of {name, href} from root to leaf; hrefs are stored as the
 * `path()`-aware absolute URL so the audit sees them live at the same place
 * other JSON-LD fields do.
 */
export interface Crumb {
  name: string;
  href: string;
}
export function breadcrumbJsonLd(crumbs: Crumb[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: `${SITE_URL}${c.href.startsWith('/') ? c.href : `/${c.href}`}`,
    })),
  };
}

/**
 * ItemList JSON-LD for a list of CreativeWork (projects). Helps Google render
 * rich project carousels if the page qualifies for one.
 *
 * @alias imported via `@utils/seo` alias from projects/index.astro:26
 * : knip's tsconfig-path resolver doesn't follow the alias reliably.
 */
export function projectListJsonLd(
  projects: Array<{
    slug: string;
    title: string;
    summary: string;
    role: 'ai' | 'quant';
    sourceLink?: string;
    date?: Date | string;
  }>,
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: projects.map((p, idx) => {
      const url = `${SITE_URL}/projects/${p.slug}/`;
      return {
        '@type': 'ListItem',
        position: idx + 1,
        item: {
          '@type': 'CreativeWork',
          name: p.title,
          description: p.summary,
          url,
          codeRepository: p.sourceLink,
          dateCreated: p.date ? new Date(p.date).toISOString().slice(0, 10) : undefined,
          author: {
            '@type': 'Person',
            name: SITE_NAME,
            url: SITE_URL,
          },
          genre: p.role === 'ai' ? 'Artificial Intelligence' : 'Quantitative Finance',
        },
      };
    }),
  };
}
