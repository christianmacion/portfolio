/**
 * Vitest setup — runs before every unit test file.
 *
 * Stubs import.meta.env so modules that read `import.meta.env.BASE_URL`
 * or `import.meta.env.PUBLIC_SITE_URL` at module-load time (url.ts, seo.ts)
 * can resolve without throwing.
 */
import { vi, beforeAll, afterEach } from 'vitest';

// Default test environment: BASE_URL=/portfolio (GH Pages default).
// Tests can override per-file with vi.stubEnv or by re-importing.
const baseEnv = {
  BASE_URL: '/portfolio/',
  PUBLIC_SITE_URL: 'https://christianmacion26.github.io',
  BUILD_DATE: '2026-07-10T00:00:00Z',
};

beforeAll(() => {
  // Attach a minimal `import.meta.env` polyfill to the test globals.
  // Vitest's jsdom env doesn't expose Astro's `import.meta.env`.
  (globalThis as Record<string, unknown>).__BASE_ENV__ = baseEnv;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});