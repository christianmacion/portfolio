// vitest.config.ts — vitest config for the Cloudflare Pages Functions tests.
// Scope is narrow: `functions/__tests__/**/*.test.ts` only. The Astro
// `src/**` tree is linted + typechecked via `npm run lint` and `npm run
// typecheck`; do not add Astro component tests here without explicit
// setup of jsdom + Astro's runtime.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['functions/__tests__/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    testTimeout: 15000,
    coverage: {
      enabled: false,
    },
  },
});
