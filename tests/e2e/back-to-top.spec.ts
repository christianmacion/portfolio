/**
 * back-to-top.spec.ts — back-to-top button contract.
 *
 * The button is hidden at scroll = 0 and revealed on scroll. Clicking
 * it returns the user to the top of the page.
 *
 * Implementation note: the back-to-top button has id="back-to-top" and
 * uses the `[hidden]` HTML attribute to toggle visibility. If the
 * button isn't present on the page, this test is skipped.
 */
import { test, expect } from '@playwright/test';

test.describe('back-to-top button', () => {
  test('hidden at scroll=0, revealed on scroll, returns to top', async ({ page }) => {
    await page.goto('/');
    const btn = page.locator('#back-to-top');

    // Button may not exist on every page; bail gracefully.
    const exists = await btn.count();
    if (!exists) {
      test.skip(true, 'no back-to-top button on this page (opt-in chrome)');
      return;
    }

    // At scroll=0 the button is hidden via the `hidden` attribute.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(150);
    const hiddenAt0 = await btn.evaluate((el) => (el as HTMLElement).hasAttribute('hidden'));
    expect(hiddenAt0, 'back-to-top not hidden at scroll=0').toBe(true);

    // Scroll down; button becomes visible (hidden attribute removed).
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    const hiddenAt100 = await btn.evaluate((el) => (el as HTMLElement).hasAttribute('hidden'));
    expect(hiddenAt100, 'back-to-top still hidden at scroll=full').toBe(false);

    // Click the button → returns to scroll=0.
    await btn.click();
    await page.waitForTimeout(800);
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY, `scrollY after click = ${scrollY}`).toBeLessThan(50);
  });
});