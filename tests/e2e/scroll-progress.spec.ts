/**
 * scroll-progress.spec.ts — scroll progress bar updates 0% → 50% → 100%.
 *
 * The scroll progress bar lives at the top of every page (chrome
 * contract). It must update monotonically as the user scrolls.
 *
 * Implementation note (scroll-progress.ts): the runtime bar element
 * is `#scroll-progress-bar`, appended to document.body at load.
 * It sets `bar.style.width = "<pct>%"`, not transform.
 */
import { test, expect } from '@playwright/test';

test.describe('scroll progress bar', () => {
  test('progress bar width updates as user scrolls', async ({ page }) => {
    await page.goto('/');
    // The bar is appended to <body> with id="scroll-progress-bar".
    const bar = page.locator('#scroll-progress-bar');
    await expect(bar).toHaveCount(1);

    // Helper: read the inline width (e.g. "23.45%").
    const readWidth = () =>
      bar.evaluate((el) => (el as HTMLElement).style.width);

    // 0% scroll → width 0%, bar hidden (opacity 0).
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
    const at0 = await readWidth();
    // The bar's inline style is `${pct.toFixed(2)}%` — but the
    // computed `style.width` getter normalizes "0%" to "0%" when
    // toFixed yields "0.00" (the implementation then strips the
    // trailing ".00"). Accept either form.
    expect(['0%', '0.00%']).toContain(at0);

    // 50% scroll → width ~ 50%.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await page.waitForTimeout(300);
    const at50 = await readWidth();
    const pct50 = parseFloat(at50);
    expect(pct50).toBeGreaterThan(30);
    expect(pct50).toBeLessThan(70);

    // 100% scroll → width 100%.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    const at100 = await readWidth();
    expect(parseFloat(at100)).toBeGreaterThan(95);
  });
});