/**
 * a11y.spec.ts — axe-core gate on every key route.
 *
 * Tracks 0 NEW violations. The known violations (per the v9.3 wave-2
 * a11y baseline — see `2026-08-01-portfolio-v9-3-wave-2-a11y-baseline.md`)
 * are intentionally tolerated so this gate closes the "tests pass =
 * green-on-paper" gap surfaced by the 2026-08-01 audit without also
 * failing the build on pre-existing a11y debt.
 *
 * Closing the remaining wave-2 findings is a separate workstream
 * (the 3 CRITICAL contrast findings + 2 reduced-motion gaps documented
 * in the AAR). When that workstream lands, remove the KNOWN_VIOLATIONS
 * set and this test becomes a hard 0-violation gate.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const A11Y_ROUTES = [
  '/',
  '/about/',
  '/projects/',
  '/proof/',
  '/now/',
  '/positions/',
  '/resume/',
  '/contact/',
];

/**
 * Pre-existing axe violations from the v9.3 wave-2 audit. Each entry
 * matches an axe rule id that we tolerate until the underlying fix
 * lands. This is a "known-fail" registry, not a suppression — every
 * entry must trace back to a documented audit row + remediation PR.
 */
const KNOWN_VIOLATIONS = new Set<string>([
  'region', // content outside a landmark — chrome/BaseLayout concern, tracked under wave-2
  'landmark-one-main', // intentional multi-main layout for chrome sections
  'landmark-unique', // unique-landmark check — same root cause as landmark-one-main
  'landmark-main-is-top-level', // nested <main> in chrome — tracked under wave-2
  'landmark-no-duplicate-main', // multiple <main> in chrome — tracked under wave-2
  'color-contrast', // 3 CRITICAL contrast findings — see AAR 2026-08-01-portfolio-v9-3-wave-2-a11y-baseline
  'heading-order', // H1 → H3 skip on /resume/ — known heading structure
]);

test.describe('a11y — axe-core gate (0 NEW violations)', () => {
  for (const route of A11Y_ROUTES) {
    test(`${route} has 0 new axe violations`, async ({ page }) => {
      await page.goto(route);
      const results = await new AxeBuilder({ page }).analyze();

      const newViolations = results.violations.filter((v) => !KNOWN_VIOLATIONS.has(v.id));
      const knownViolations = results.violations.filter((v) => KNOWN_VIOLATIONS.has(v.id));

      // Surface known violations in the test output so they remain
      // visible during the PR review (so reviewers know the debt
      // exists and is being tracked).
      if (knownViolations.length > 0) {
        test.info().annotations.push({
          type: 'known-violations',
          description: knownViolations.map((v) => `${v.id}: ${v.nodes.length} node(s)`).join('; '),
        });
      }

      expect(
        newViolations,
        `${route} introduced ${newViolations.length} new violations: ${newViolations.map((v) => v.id).join(', ')}`,
      ).toEqual([]);
    });
  }
});