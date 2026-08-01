import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/unit/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'tests/e2e/**', 'tests/visual/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html', 'lcov'],
      reportsDirectory: './.audit/coverage',
      include: ['src/utils/**/*.{ts,tsx}', 'src/lib/**/*.{ts,tsx}'],
      exclude: [
        '**/__tests__/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/*.test.tsx',
        '**/*.spec.tsx',
        'src/utils/nda-audit.ts',
        'src/utils/project-helpers.ts',
        '**/types.ts',
        'src/pages/**',
        'src/layouts/**',
      ],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
      },
    },
    setupFiles: ['./tests/unit/setup.ts'],
    // Inject Astro-style env values into BOTH process.env and
    // import.meta.env (vitest polyfills import.meta.env from process.env).
    env: {
      BASE_URL: '/portfolio/',
      PUBLIC_SITE_URL: 'https://christianmacion26.github.io',
      BUILD_DATE: '2026-08-01T00:00:00Z',
    },
  },
  resolve: {
    alias: {
      '~': path.resolve(__dirname, 'src'),
      '@utils': path.resolve(__dirname, 'src/utils'),
      '@components': path.resolve(__dirname, 'src/components'),
      '@layouts': path.resolve(__dirname, 'src/layouts'),
      '@styles': path.resolve(__dirname, 'src/styles'),
      '@scripts': path.resolve(__dirname, 'src/scripts'),
      '@data': path.resolve(__dirname, 'src/data'),
    },
  },
  // Astro exposes config via `import.meta.env` (compile-time literal).
  // vi.stubEnv only handles process.env; for `import.meta.env.*` we
  // use Vite's `define` to substitute at transform time.
  define: {
    'import.meta.env.BASE_URL': JSON.stringify('/portfolio/'),
    'import.meta.env.PUBLIC_SITE_URL': JSON.stringify('https://christianmacion26.github.io'),
    'import.meta.env.BUILD_DATE': JSON.stringify('2026-08-01T00:00:00Z'),
  },
});