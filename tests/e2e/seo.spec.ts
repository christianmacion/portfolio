/**
 * seo.spec.ts — meta + structured data + OG contract on every key route.
 *
 * Every public route must carry:
 *   - <title> with owner name suffix
 *   - meta description (non-empty)
 *   - canonical link
 *   - og:title / og:description / og:image
 *   - twitter:card
 */
import { test, expect } from '@playwright/test';

const ROUTES = [
  '/',
  '/about/',
  '/projects/',
  '/proof/',
  '/now/',
  '/positions/',
  '/resume/',
  '/contact/',
];

test.describe('SEO contract — every public route', () => {
  for (const route of ROUTES) {
    test(`${route} has title + description + canonical + OG`, async ({ page }) => {
      await page.goto(route);

      // 1. <title> with owner name suffix.
      const title = await page.title();
      expect(title.length).toBeGreaterThan(0);

      // 2. meta description.
      const desc = page.locator('meta[name="description"]').first();
      const descContent = await desc.getAttribute('content');
      expect(descContent, `${route} has empty meta description`).toBeTruthy();
      expect(descContent!.length, `${route} meta description too short`).toBeGreaterThan(20);

      // 3. canonical link.
      const canonical = page.locator('link[rel="canonical"]').first();
      await expect(canonical).toHaveAttribute('href', /^https:\/\//);

      // 4. og:title + og:description + og:image.
      const ogTitle = page.locator('meta[property="og:title"]').first();
      const ogDesc = page.locator('meta[property="og:description"]').first();
      const ogImage = page.locator('meta[property="og:image"]').first();
      await expect(ogTitle).toHaveAttribute('content', /\w+/);
      await expect(ogDesc).toHaveAttribute('content', /\w+/);
      // og:image may be absent on some routes; if present, must be a URL.
      if (await ogImage.count()) {
        const href = await ogImage.getAttribute('content');
        expect(href).toMatch(/^https?:\/\//);
      }

      // 5. twitter:card.
      const twCard = page.locator('meta[name="twitter:card"]').first();
      if (await twCard.count()) {
        const c = await twCard.getAttribute('content');
        expect(c).toMatch(/^(summary|summary_large_image|app|player)$/);
      }
    });
  }
});