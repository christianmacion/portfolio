import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config — E2E + visual + a11y gate.
 *
 * Runs against the local Astro dev server (or the mirror build, via
 * PLAYWRIGHT_BASE_URL). Two projects: desktop Chrome and Pixel 5.
 * CI tightens: 2 retries, single worker, github reporter.
 *
 * webServer reuses an existing dev server if one is already running
 * (handy for local development); CI always starts fresh.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4321',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:4321',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});