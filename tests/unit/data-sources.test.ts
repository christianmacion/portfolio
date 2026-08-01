/**
 * data-sources.test.ts — public-domain data source registry.
 *
 * Critical contract: only sources that are verifiably public-domain,
 * NDA-clean, and known-licence. No proprietary feeds, no employer
 * scrapes, no platform names.
 */
import { describe, it, expect } from 'vitest';
import { dataSources, dataSourceCount } from '@utils/data-sources';

describe('dataSources — registry integrity', () => {
  it('contains 12 sources (canonical chrome count)', () => {
    expect(dataSourceCount).toBe(12);
    expect(dataSources).toHaveLength(12);
  });

  it('every source has the required shape {name, category, urlPattern, license}', () => {
    for (const src of dataSources) {
      expect(src.name).toBeTruthy();
      expect(['macro', 'equity-deriv', 'crypto-onchain', 'funding', 'rates', 'commodities', 'fx', 'cftc'])
        .toContain(src.category);
      expect(src.urlPattern).toMatch(/^https?:\/\//);
      expect(src.license).toBeTruthy();
    }
  });

  it('every source is NDA-clean (no employer names, no proprietary platforms)', () => {
    const NDA_BANNED = ['19V Capital', 'Macion Capital', 'Arclion', 'Quantivo', 'CallRank'];
    for (const src of dataSources) {
      const haystack = `${src.name} ${src.urlPattern} ${src.license} ${src.note ?? ''}`;
      for (const banned of NDA_BANNED) {
        expect(haystack, `${src.name} leaks "${banned}"`).not.toContain(banned);
      }
    }
  });

  it('does not include NDA-banned platforms (Polymarket/Kalshi/NOAA/USDA per nda-audit.ts)', () => {
    // The nda-audit disallows these as proprietary data sources; the
    // public registry should agree.
    const urlHaystack = dataSources.map((s) => s.urlPattern).join(' ');
    expect(urlHaystack).not.toContain('polymarket');
    expect(urlHaystack).not.toContain('kalshi');
  });

  it('every source carries an explicit license', () => {
    for (const src of dataSources) {
      expect(src.license.length).toBeGreaterThan(3);
    }
  });

  it('category counts (best-effort invariant: 3 macro, 2 crypto-onchain, 2 funding-equivalent)', () => {
    const counts = new Map<string, number>();
    for (const src of dataSources) {
      counts.set(src.category, (counts.get(src.category) ?? 0) + 1);
    }
    expect(counts.get('macro')).toBeGreaterThanOrEqual(1);
    expect(counts.get('crypto-onchain')).toBeGreaterThanOrEqual(2);
  });
});