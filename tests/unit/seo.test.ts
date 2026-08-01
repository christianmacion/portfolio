/**
 * seo.test.ts — meta + JSON-LD helpers.
 *
 * Pin the contract: title gets suffixed with the site name (unless
 * already equal), canonical uses the public SITE_URL, JSON-LD always
 * carries @context, BreadcrumbList position is 1-indexed, ItemList
 * roles split AI vs Quant.
 */
import { describe, it, expect, vi } from 'vitest';

// Stub Astro's import.meta.env so seo.ts can resolve.
vi.stubEnv('PUBLIC_SITE_URL', 'https://christianmacion26.github.io');
vi.stubEnv('BASE_URL', '/portfolio/');

import { buildMeta, personJsonLd, websiteJsonLd, breadcrumbJsonLd, projectListJsonLd } from '@utils/seo';
import { profile } from '@utils/profile';

describe('buildMeta', () => {
  it('suffixes the title with the site name when not equal', () => {
    const m = buildMeta({ title: 'About', description: 'Bio.' });
    expect(m.title).toBe(`About · ${profile.fullName}`);
  });

  it('does NOT double-suffix when title already equals site name', () => {
    const m = buildMeta({ title: profile.fullName, description: 'Bio.' });
    expect(m.title).toBe(profile.fullName);
    expect(m.title.split(` · ${profile.fullName}`)).toHaveLength(1);
  });

  it('builds a canonical URL from pathname + SITE_URL', () => {
    const m = buildMeta({
      title: 'About',
      description: 'Bio.',
      pathname: '/about/',
    });
    expect(m.canonical).toBe('https://christianmacion26.github.io/about/');
  });

  it('populates openGraph + twitter', () => {
    const m = buildMeta({
      title: 'X',
      description: 'Y',
      image: '/og.jpg',
    });
    expect(m.openGraph.title).toContain('X');
    expect(m.openGraph.images).toBeDefined();
    // Image URL is resolved against SITE_URL (no base path duplication).
    // The base path lives in BASE_URL, applied at render time, not here.
    expect(m.openGraph.images?.[0].url).toContain('https://christianmacion26.github.io/og.jpg');
    expect(m.twitter.card).toBe('summary_large_image');
  });

  it('default type is "website"', () => {
    const m = buildMeta({ title: 'X', description: 'Y' });
    expect(m.openGraph.type).toBe('website');
  });

  it('honors type="profile"', () => {
    const m = buildMeta({ title: 'X', description: 'Y', type: 'profile' });
    expect(m.openGraph.type).toBe('profile');
  });
});

describe('personJsonLd', () => {
  it('produces a schema.org Person object', () => {
    const ld = personJsonLd(profile) as Record<string, unknown>;
    expect(ld['@context']).toBe('https://schema.org');
    expect(ld['@type']).toBe('Person');
    expect(ld.name).toBe(profile.fullName);
  });

  it('includes address, sameAs, knowsAbout', () => {
    const ld = personJsonLd(profile) as Record<string, unknown>;
    expect(ld.address).toBeDefined();
    const sameAs = ld.sameAs as string[];
    expect(sameAs.length).toBeGreaterThan(0);
    expect((ld.knowsAbout as string[]).length).toBeGreaterThan(0);
  });
});

describe('websiteJsonLd', () => {
  it('produces a schema.org WebSite with SearchAction', () => {
    const ld = websiteJsonLd() as Record<string, unknown>;
    expect(ld['@context']).toBe('https://schema.org');
    expect(ld['@type']).toBe('WebSite');
    expect(ld.potentialAction).toBeDefined();
  });
});

describe('breadcrumbJsonLd', () => {
  it('produces a BreadcrumbList with 1-indexed positions', () => {
    const ld = breadcrumbJsonLd([
      { name: 'Home', href: '/' },
      { name: 'Projects', href: '/projects/' },
    ]) as Record<string, unknown>;
    const items = ld.itemListElement as Array<Record<string, unknown>>;
    expect(ld['@type']).toBe('BreadcrumbList');
    expect(items).toHaveLength(2);
    expect(items[0].position).toBe(1);
    expect(items[1].position).toBe(2);
  });

  it('builds absolute item URLs from hrefs', () => {
    const ld = breadcrumbJsonLd([
      { name: 'Home', href: '/' },
    ]) as Record<string, unknown>;
    const item = (ld.itemListElement as Array<Record<string, unknown>>)[0].item;
    expect(String(item)).toMatch(/^https:\/\//);
  });
});

describe('projectListJsonLd', () => {
  it('produces an ItemList of CreativeWork with genre split', () => {
    const ld = projectListJsonLd([
      { slug: 'a', title: 'A', summary: '...', role: 'ai' },
      { slug: 'b', title: 'B', summary: '...', role: 'quant' },
    ]) as Record<string, unknown>;
    expect(ld['@type']).toBe('ItemList');
    const items = ld.itemListElement as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    expect(items[0].position).toBe(1);
    const aiWork = items[0].item as Record<string, unknown>;
    const quantWork = items[1].item as Record<string, unknown>;
    expect(aiWork.genre).toBe('Artificial Intelligence');
    expect(quantWork.genre).toBe('Quantitative Finance');
  });

  it('normalizes date to YYYY-MM-DD when provided', () => {
    const ld = projectListJsonLd([
      { slug: 'a', title: 'A', summary: '...', role: 'ai', date: new Date('2026-07-10T00:00:00Z') },
    ]) as Record<string, unknown>;
    const work = ((ld.itemListElement as Array<Record<string, unknown>>)[0].item) as Record<string, unknown>;
    expect(work.dateCreated).toBe('2026-07-10');
  });
});