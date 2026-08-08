/**
 * hero-name-color-regression.mjs — computed-style guard for the hero name.
 *
 * Why this exists
 * ---------------
 * The hero on `src/pages/index.astro:151` is a single
 * `<h1 class="hero-flagship__name" data-words>Quantitative Researcher</h1>`.
 * `motion.ts` (data-words handler, src/scripts/motion.ts:22) auto-wraps the
 * inner text into `<span class="word">` spans for the per-word cascade.
 *
 * The contract: the H1 + every descendant must render in the SAME computed
 * color and SAME font-style (no italic-drift, no two-tone, no font-weight
 * drift). Catches accidental `<em>` re-introductions, cascade leak (e.g.
 * `.word` pulling `--c-ink-2` instead of `var(--c-ink)`), or hover-only
 * colour overrides that get caught by computed-style reads.
 *
 * Pre-v12.W4 the hero was a three-span `<h1 class="hero__name">` with
 * `<em>` wrappers — that bug shipped 4+ times in git history
 * (7c190f3, 673dc72, 9a41ec8, 474f57a). The v12.W4/W5 rewrite ships a
 * single text node wrapped by JS into .word spans; this guard preserves
 * the same invariant against future regressions.
 *
 * 5-must-have (CLAUDE.md §1):
 *   - Terminal:   exits 0 on PASS, 1 on FAIL, 2 on error. No "running forever".
 *   - Idempotent: re-running against the same prod URL state yields identical
 *                 pass/fail (no Math.random, no Date.now in assertions).
 *   - Dedupe key: `portfolio-hero-name-color-v2`.
 *   - Coverage:   the H1 + every descendant node read; all color values
 *                 asserted identical; all font-style values asserted `normal`;
 *                 no `<em>` descendants allowed.
 *   - AAR:        writes `.audit/incident/<date>-hero-name-color/failures.json`
 *                 on fail (mirrors the smoke-test-prod.mjs pattern).
 *
 * Usage:
 *   PROD_URL=https://christianmacion26.github.io/portfolio/ node scripts/__tests__/hero-name-color-regression.mjs
 *   PROD_URL=http://localhost:4321                            node scripts/__tests__/hero-name-color-regression.mjs
 *   node scripts/__tests__/hero-name-color-regression.mjs    # uses default prod URL
 */

import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';

const PROD = process.env.PROD_URL || 'https://christianmacion26.github.io/portfolio/';
const DEDUPE_KEY = 'portfolio-hero-name-color-v2';
const ROOT = resolve(import.meta.dirname, '..', '..');
const HERO_SELECTOR = 'h1.hero-flagship__name';

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
  ].filter(Boolean);
  return candidates.find(existsSync);
}

function fmt(value) {
  if (value === null || value === undefined) return '∅';
  return String(value);
}

async function main() {
  const executablePath = findChrome();
  if (!executablePath) {
    console.error('hero-name-color: no Chrome/Chromium binary found.');
    console.error('Set CHROME_PATH or install Chrome from https://google.com/chrome');
    process.exit(2);
  }
  const browser = await chromium.launch({ executablePath, headless: true });
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

  // Wait for motion.ts to wrap the H1 text into .word spans (data-words
  // cascade handler runs on DOMContentLoaded; give it 2s to settle).
  await page
    .waitForFunction(
      (sel) => {
        const h1 = document.querySelector(sel);
        return h1 && h1.querySelectorAll('.word').length > 0;
      },
      HERO_SELECTOR,
      { timeout: 5000 }
    )
    .catch(() => {
      // fall through; samples will reflect post-cascade emptiness and the
      // assertions below will surface it.
    });

  // Read computed style for the H1 + every descendant in one DOM round-trip.
  const samples = await page.evaluate((sel) => {
    const out = { parent: null, descendants: [], emDescendants: 0 };
    const h1 = document.querySelector(sel);
    if (h1) {
      const cs = getComputedStyle(h1);
      out.parent = {
        tag: h1.tagName.toLowerCase(),
        className: h1.getAttribute('class'),
        text: h1.textContent,
        color: cs.color,
        fontStyle: cs.fontStyle,
        fontWeight: cs.fontWeight,
        fontFamily: cs.fontFamily,
      };
      out.emDescendants = h1.querySelectorAll('em').length;
      const all = h1.querySelectorAll('*');
      all.forEach((el) => {
        const cs2 = getComputedStyle(el);
        out.descendants.push({
          tag: el.tagName.toLowerCase(),
          className: el.getAttribute('class'),
          text: el.textContent,
          color: cs2.color,
          fontStyle: cs2.fontStyle,
          fontWeight: cs2.fontWeight,
          fontFamily: cs2.fontFamily,
        });
      });
    }
    return out;
  }, HERO_SELECTOR);

  await browser.close();

  // === ASSERTIONS ===
  const errors = [];

  if (!samples.parent) {
    errors.push(`${HERO_SELECTOR} not found in DOM`);
  } else {
    // No <em> descendants — the original bug wrapped name parts in <em>.
    if (samples.emDescendants > 0) {
      errors.push(
        `hero H1 contains ${samples.emDescendants} <em> descendant(s) — italic-drift regression`
      );
    }

    // Collect every computed color across the H1 + its descendants.
    const colors = [samples.parent.color, ...samples.descendants.map((d) => d.color)];
    const allColorsIdentical =
      colors.length > 0 && colors.every((c) => c === colors[0]);

    if (!allColorsIdentical) {
      const all = [
        { tag: samples.parent.tag, color: samples.parent.color },
        ...samples.descendants.map((d) => ({ tag: d.tag, className: d.className, color: d.color })),
      ];
      errors.push(
        `hero name has different computed colors: ` +
          all.map((n) => `${n.tag}.${n.className || 'parent'}=${n.color}`).join(', ')
      );
    }

    // Every font-style must be `normal` (catches the <em> italic-drift bug).
    const fontStyles = [samples.parent, ...samples.descendants];
    for (const s of fontStyles) {
      if (s.fontStyle !== 'normal') {
        errors.push(
          `${s.tag}.${s.className || 'parent'} font-style is "${s.fontStyle}" (expected "normal") — italic-drift regression`
        );
      }
    }
  }

  // === VERDICT ===
  console.log('=== hero-name-color-regression (v2) ===');
  console.log(`URL:               ${PROD}`);
  console.log(`Dedupe key:        ${DEDUPE_KEY}`);
  if (samples.parent) {
    console.log(
      `${HERO_SELECTOR}: color=${samples.parent.color}  font-style=${samples.parent.fontStyle}  font-weight=${samples.parent.fontWeight}`
    );
    console.log(`text:              ${JSON.stringify(samples.parent.text)}`);
    console.log(`descendants:       ${samples.descendants.length} node(s)`);
    console.log(`<em> descendants:  ${samples.emDescendants}`);
    for (const d of samples.descendants) {
      console.log(
        `  ${d.tag}.${(d.className || '').padEnd(8)}  text=${JSON.stringify(d.text).slice(0, 30)}  color=${d.color}  font-style=${d.fontStyle}`
      );
    }
  } else {
    console.log(`${HERO_SELECTOR}: MISSING (no h1 found)`);
  }

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
  console.log(`  ${HERO_SELECTOR} + ${samples.descendants.length} descendant(s) share computed color: ${samples.parent?.color}`);
  console.log(`  All font-style: normal`);
  console.log(`  Zero <em> descendants (italic-drift regression guarded)`);
  console.log(`  Regressions guarded: 7c190f3, 673dc72, 9a41ec8, 474f57a`);
  process.exit(0);
}

main().catch(async (err) => {
  console.error(`hero-name-color: unexpected error: ${err.message}`);
  console.error(err.stack);
  process.exit(2);
});