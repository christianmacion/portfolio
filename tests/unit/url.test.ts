/**
 * url.test.ts — base-path-aware URL helpers.
 *
 * Critical contract: `path('/x')` resolves to `<BASE><x>/`, never a raw
 * `/x`. Absolute URLs (https, mailto, tel, protocol-relative) must pass
 * through unchanged — this was the v9.2 regression that broke 3 cert
 * issuer URLs on /certifications.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// We need import.meta.env.BASE_URL for the url.ts module.
// Vitest's import.meta.env polyfill is set via vi.stubEnv.
vi.stubEnv('BASE_URL', '/portfolio/');
vi.stubEnv('PUBLIC_SITE_URL', 'https://christianmacion26.github.io');

// Import AFTER env stubbing so the module picks up the value.
import { path, BASE } from '@utils/url';

describe('url.path — base path handling', () => {
  it('prepends the configured BASE to an internal route', () => {
    expect(path('/projects')).toBe('/portfolio/projects/');
  });

  it('prepends BASE when the input has no leading slash', () => {
    expect(path('about')).toBe('/portfolio/about/');
  });

  it('preserves trailing slash if already present', () => {
    expect(path('/projects/')).toBe('/portfolio/projects/');
  });

  it('appends a trailing slash for page routes', () => {
    // /projects without trailing slash becomes /portfolio/projects/
    expect(path('/projects')).toMatch(/\/$/);
  });

  it('does NOT append trailing slash to assets (have a dot in last segment)', () => {
    expect(path('/resume.pdf')).toBe('/portfolio/resume.pdf');
    expect(path('/og-image.jpg')).toBe('/portfolio/og-image.jpg');
  });

  it('does NOT modify hash fragments', () => {
    expect(path('/#hero')).toBe('/portfolio/#hero');
  });

  it('returns absolute https URLs unchanged', () => {
    expect(path('https://example.com/')).toBe('https://example.com/');
    expect(path('https://example.com/cert')).toBe('https://example.com/cert');
  });

  it('returns mailto: URLs unchanged', () => {
    expect(path('mailto:hello@example.com')).toBe('mailto:hello@example.com');
  });

  it('returns tel: URLs unchanged', () => {
    expect(path('tel:+639916162630')).toBe('tel:+639916162630');
  });

  it('returns protocol-relative URLs unchanged', () => {
    expect(path('//cdn.example.com/asset.js')).toBe('//cdn.example.com/asset.js');
  });
});

describe('url.BASE — exported constant', () => {
  it('is the BASE_URL with trailing slash stripped', () => {
    expect(BASE).toBe('/portfolio');
    expect(BASE.endsWith('/')).toBe(false);
  });
});