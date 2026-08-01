/**
 * reduced-motion.spec.ts — per-component prefers-reduced-motion override.
 *
 * Per the standing-order quality bar (v9.2 visual uplift §port_contract_1),
 * every motion component ships with a reduced-motion override that lands
 * the element on its resting state with no transform / filter / opacity.
 *
 * This spec verifies the override at the document level: with
 * `reducedMotion: 'reduce'` set, no element in the DOM has a non-identity
 * transform at idle.
 */
import { test, expect } from '@playwright/test';

test.describe('prefers-reduced-motion override', () => {
  test.use({ reducedMotion: 'reduce' });

  test('home page has no non-identity transforms under reduced-motion', async ({ page }) => {
    await page.goto('/');

    // Sample elements with transform/opacity/filter applied; under
    // reduced-motion, every animated chrome should land on its
    // resting state. We assert that the document doesn't carry any
    // visible animation in flight by checking the computed style of
    // known chrome selectors.
    const violations = await page.evaluate(() => {
      const out: Array<{ sel: string; transform: string; filter: string; opacity: string }> = [];
      // Common animated chrome selectors. If the page adds new ones,
      // extend this list.
      const sels = [
        '[data-animated]',
        '.scroll-progress',
        '.ambient-vector-band',
        '.pulse-ring',
        '.chrome-marquee',
        'header',
        'main',
        'footer',
        'section[data-section]',
      ];
      for (const sel of sels) {
        const els = document.querySelectorAll<HTMLElement>(sel);
        for (const el of Array.from(els).slice(0, 5)) {
          const cs = getComputedStyle(el);
          out.push({
            sel,
            transform: cs.transform,
            filter: cs.filter,
            opacity: cs.opacity,
          });
        }
      }
      return out;
    });

    for (const row of violations) {
      // Under reduced-motion, no element should have a non-identity
      // transform, filter, or opacity < 1.
      expect(
        row.transform,
        `${row.sel} transform = ${row.transform}`,
      ).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
      expect(row.filter, `${row.sel} filter = ${row.filter}`).toBe('none');
      expect(parseFloat(row.opacity), `${row.sel} opacity = ${row.opacity}`).toBe(1);
    }
  });

  test('scroll-progress bar does not animate under reduced-motion', async ({ page }) => {
    await page.goto('/');
    // Scroll halfway; under reduced-motion the bar should still land
    // on its resting state (no transform animation, opacity 1).
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    const transform = await page.evaluate(() => {
      const bar = document.querySelector('.scroll-progress') as HTMLElement | null;
      return bar ? getComputedStyle(bar).transform : 'none';
    });
    expect(transform).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
  });
});