/**
 * hero-name-color-regression.mjs — computed-style guard for the hero name.
 *
 * Why this exists
 * ---------------
 * The hero on `src/pages/index.astro:115-118` is a single `<h1 class="hero__name">`
 * with three spans:
 *   .hero__name-1 → "Christian"
 *   .hero__name-2 → "T."
 *   .hero__name-3 → "Macion"
 *
 * These three spans must render in the SAME computed color and SAME font-style.
 * The fix that prevents the bug is: parent `.hero__name` sets
 * `color: var(--c-ink)`; the children use `color: inherit` and `font-style: normal`
 * (the original bug wrapped the spans in `<em>` tags which forced italic and
 * pulled `--c-ink-2` from a cascade — a visible two-tone name).
 *
 * This regression has shipped 4+ times in git history:
 *   - 7c190f3
 *   - 673dc72
 *   - 9a41ec8
 *   - 474f57a  (the most recent re-fix)
 *
 * No CI guard previously read computed `color` / `font-style` on the three
 * spans, so the bug slipped past the existing Lighthouse + visual-regression
 * suite. This script closes that gap.
 *
 * 5-must-have (CLAUDE.md §1):
 *   - Terminal:   exits 0 on PASS, 1 on FAIL, 2 on error. No "running forever".
 *   - Idempotent: re-running against the same prod URL state yields identical
 *                 pass/fail (no Math.random, no Date.now in assertions).
 *   - Dedupe key: `portfolio-hero-name-color-v1`.
 *   - Coverage:   all 3 hero name spans read; all 3 color values asserted
 *                 identical; all 3 font-style values asserted `normal`.
 *   - AAR:        writes `.audit/incident/<date>-hero-name-color/failures.json`
 *                 on fail (mirrors the smoke-test-prod.mjs pattern).
 *
 * Usage:
 *   PROD_URL=https://christianmacion-portfolio.pages.dev node scripts/__tests__/hero-name-color-regression.mjs
 *   PROD_URL=http://localhost:4321                  node scripts/__tests__/hero-name-color-regression.mjs
 *   node scripts/__tests__/hero-name-color-regression.mjs    # uses default prod URL
 */

import { chromium } from 'playwright';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';

const PROD = process.env.PROD_URL || 'https://christianmacion-portfolio.pages.dev/';
const DEDUPE_KEY = 'portfolio-hero-name-color-v1';
const ROOT = resolve(import.meta.dirname, '..', '..');

const SPAN_KEYS = ['hero__name-1', 'hero__name-2', 'hero__name-3'];

function fmt(value) {
  if (value === null || value === undefined) return '∅';
  return String(value);
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'no-preference',
  });
  const page = await ctx.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('[browser-console-error]', msg.text());
  });
  page.on('pageerror', (e) => console.error('[browser-pageerror]', e.message));

  await page.goto(PROD, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 });

  // Read computed style for all three spans in one DOM round-trip.
  const samples = await page.evaluate((keys) => {
    const out = { parent: null, spans: [] };
    const h1 = document.querySelector('h1.hero__name');
    if (h1) {
      const cs = getComputedStyle(h1);
      out.parent = {
        tag: h1.tagName.toLowerCase(),
        className: h1.getAttribute('class'),
        color: cs.color,
        fontStyle: cs.fontStyle,
        fontWeight: cs.fontWeight,
      };
    }
    for (const cls of keys) {
      const el = document.querySelector(`h1.hero__name .${cls}`);
      if (!el) {
        out.spans.push({ className: cls, missing: true });
        continue;
      }
      const cs = getComputedStyle(el);
      out.spans.push({
        className: cls,
        text: el.textContent,
        color: cs.color,
        fontStyle: cs.fontStyle,
        fontWeight: cs.fontWeight,
        fontFamily: cs.fontFamily,
      });
    }
    return out;
  }, SPAN_KEYS);

  await browser.close();

  // === ASSERTIONS ===
  const errors = [];

  if (!samples.parent) {
    errors.push('h1.hero__name not found in DOM');
  }
  if (samples.spans.length !== SPAN_KEYS.length) {
    errors.push(`expected ${SPAN_KEYS.length} span samples, got ${samples.spans.length}`);
  }

  // Missing-span check
  for (const s of samples.spans) {
    if (s.missing) errors.push(`span .${s.className} not found inside h1.hero__name`);
  }

  // Color identity: all three spans must resolve to the same computed color.
  const colors = samples.spans
    .filter((s) => !s.missing)
    .map((s) => s.color);
  const allColorsIdentical = colors.length > 0 && colors.every((c) => c === colors[0]);
  if (!allColorsIdentical) {
    errors.push(
      `hero name spans have different computed colors: ` +
        samples.spans
          .filter((s) => !s.missing)
          .map((s) => `.${s.className}=${s.color}`)
          .join(', ')
    );
  }

  // Font-style identity: all three must be `normal` (catches the <em> italic-drift bug).
  for (const s of samples.spans) {
    if (s.missing) continue;
    if (s.fontStyle !== 'normal') {
      errors.push(
        `.${s.className} font-style is "${s.fontStyle}" (expected "normal") — italic-drift regression`
      );
    }
  }

  // === VERDICT ===
  console.log('=== hero-name-color-regression ===');
  console.log(`URL:               ${PROD}`);
  console.log(`Dedupe key:        ${DEDUPE_KEY}`);
  if (samples.parent) {
    console.log(
      `h1.hero__name:     color=${samples.parent.color}  font-style=${samples.parent.fontStyle}  font-weight=${samples.parent.fontWeight}`
    );
  }
  for (const s of samples.spans) {
    if (s.missing) {
      console.log(`  .${s.className.padEnd(14)}  MISSING`);
    } else {
      console.log(
        `  .${s.className.padEnd(14)}  text=${JSON.stringify(s.text).padEnd(12)}  color=${s.color}  font-style=${s.fontStyle}  font-weight=${s.fontWeight}`
      );
    }
  }
  console.log(
    `Identity check:    all 3 colors identical = ${allColorsIdentical ? 'YES' : 'NO (FAIL)'}`
  );

  if (errors.length > 0) {
    console.error('=== HERO-NAME-COLOR FAIL ===');
    for (const e of errors) console.error(' - ' + e);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dir = join(ROOT, '.audit', 'incident', `${stamp}-hero-name-color`);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      join(dir, 'failures.json'),
      JSON.stringify(
        {
          dedupe_key: DEDUPE_KEY,
          ts: new Date().toISOString(),
          prod_url: PROD,
          samples,
          errors,
        },
        null,
        2
      )
    );
    console.error(`hero-name-color: failure evidence written to ${dir}/failures.json`);
    process.exit(1);
  }

  console.log('=== HERO-NAME-COLOR PASS ===');
  console.log(`  All 3 hero name spans share computed color: ${colors[0]}`);
  console.log(`  All 3 hero name spans have font-style: normal`);
  console.log(`  Regressions guarded: 7c190f3, 673dc72, 9a41ec8, 474f57a`);
  process.exit(0);
}

main().catch(async (err) => {
  console.error(`hero-name-color: unexpected error: ${err.message}`);
  console.error(err.stack);
  process.exit(2);
});
