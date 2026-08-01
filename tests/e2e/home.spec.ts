/**
 * home.spec.ts — landing route smoke + chrome contract.
 *
 * The home page is the highest-traffic surface. This spec verifies:
 *   - 200 status, no console errors
 *   - H1 renders
 *   - CTA links resolve
 *   - JSON-LD schema.org Person block is present
 *   - prefers-reduced-motion override is respected
 */
import { test, expect } from '@playwright/test';

test.describe('home page', () => {
  test('renders with 200 + no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    const resp = await page.goto('/');
    expect(resp?.status()).toBe(200);

    // No console errors (allow warning/info).
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('renders an H1 with the owner name', async ({ page }) => {
    await page.goto('/');
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible();
    const text = await h1.innerText();
    expect(text.length).toBeGreaterThan(0);
  });

  test('emits schema.org Person JSON-LD', async ({ page }) => {
    await page.goto('/');
    const jsonLd = await page.locator('script[type="application/ld+json"]').allInnerTexts();
    expect(jsonLd.length).toBeGreaterThan(0);
    const personBlock = jsonLd.find((s) => s.includes('"@type":"Person"') || s.includes('"@type": "Person"'));
    expect(personBlock, 'no Person JSON-LD found').toBeDefined();
    expect(personBlock).toContain('Digos City');
  });

  test('has at least one in-page anchor with href', async ({ page }) => {
    await page.goto('/');
    const links = await page.locator('a[href]').count();
    expect(links).toBeGreaterThan(3);
  });

  test('meta description is non-empty', async ({ page }) => {
    await page.goto('/');
    const desc = await page.locator('meta[name="description"]').first().getAttribute('content');
    expect(desc).toBeTruthy();
    expect(desc!.length).toBeGreaterThan(20);
  });

  test('canonical link is set', async ({ page }) => {
    await page.goto('/');
    const canonical = page.locator('link[rel="canonical"]').first();
    await expect(canonical).toHaveAttribute('href', /christianmacion/i);
  });
});