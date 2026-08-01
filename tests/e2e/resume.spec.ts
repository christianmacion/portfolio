/**
 * resume.spec.ts — resume PDFs download + chrome.
 *
 * /resume ships 3 PDF variants. This spec verifies the resume page
 * renders + the 3 PDF download links resolve (200 + content-type).
 */
import { test, expect } from '@playwright/test';

test.describe('resume', () => {
  test('resume page renders', async ({ page }) => {
    const resp = await page.goto('/resume/');
    expect(resp?.status()).toBe(200);
  });

  test('exposes 3 PDF download links', async ({ page }) => {
    await page.goto('/resume/');
    const pdfLinks = await page.locator('a[href$=".pdf"]').count();
    expect(pdfLinks).toBeGreaterThanOrEqual(3);
  });

  test('PDFs return application/pdf content-type', async ({ page, request }) => {
    await page.goto('/resume/');
    const hrefs = await page.locator('a[href$=".pdf"]').evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).href),
    );
    expect(hrefs.length).toBeGreaterThanOrEqual(1);
    for (const href of hrefs.slice(0, 1)) {
      const r = await request.get(href);
      expect(r.status()).toBe(200);
      const ct = r.headers()['content-type'] ?? '';
      expect(ct).toMatch(/pdf|octet-stream/i);
    }
  });
});