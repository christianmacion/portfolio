/**
 * countup.ts — animated count-up for the home page stats strip.
 *
 * Counts from 0 → data-countup target using requestAnimationFrame and a
 * cubic-out ease. Honors prefers-reduced-motion: reduce (snaps to target).
 *
 * Preserves the original numeric format (commas, decimals, suffixes like
 * "k") by parsing the leading numeric run and re-applying the suffix on
 * each tick. Non-numeric strings render unchanged at the end.
 *
 * Vanilla TS, no deps. ~30 lines.
 */

const REDUCED_MOTION =
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

/** Parse leading numeric run. Returns {n, suffix} or null if not numeric. */
function parseNumeric(text: string): { n: number; suffix: string } | null {
  // Match: optional sign, digits with optional commas/decimal, then any non-digit suffix.
  const match = text.trim().match(/^(-?[\d,]*(?:\.\d+)?)(.*)$/);
  if (!match || !match[1] || match[1].replace(/[,]/g, '') === '') return null;
  const n = parseFloat(match[1].replace(/,/g, ''));
  if (Number.isNaN(n)) return null;
  return { n, suffix: match[2] ?? '' };
}

/** Format a number with the same precision/separators as the target. */
function formatLike(template: string, value: number): string {
  const { suffix } = parseNumeric(template) ?? { suffix: '' };
  const templateStr = template.trim();
  const hasComma = templateStr.includes(',');
  const decimalsMatch = templateStr.match(/\.(\d+)/);
  const decimals = decimalsMatch ? decimalsMatch[1].length : 0;
  const intPart = Math.floor(Math.abs(value));
  const sign = value < 0 ? '-' : '';
  const intStr = hasComma
    ? intPart.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    : intPart.toString();
  const decPart = decimals > 0
    ? '.' + (Math.abs(value) - intPart).toFixed(decimals).slice(2)
    : '';
  return `${sign}${intStr}${decPart}${suffix}`;
}

export interface CountUpOptions {
  /** Animation duration in ms. Default 1400. */
  duration?: number;
}

export function animateCountUp(el: HTMLElement, opts: CountUpOptions = {}): void {
  const target = el.dataset.countup ?? el.textContent ?? '';
  const parsed = parseNumeric(target);
  if (!parsed) return; // not numeric. leave alone

  const { duration = 1400 } = opts;

  // v6.18 W2 lock (2026-08-08): aria-live="polite" on count-up targets
  // so screen readers announce the final numeric value when the
  // animation completes (per WCAG 4.1.3 live-region requirement).
  // Idempotent — only sets if not already present.
  if (!el.hasAttribute('aria-live')) {
    el.setAttribute('aria-live', 'polite');
  }
  if (!el.hasAttribute('aria-atomic')) {
    el.setAttribute('aria-atomic', 'true');
  }

  if (REDUCED_MOTION) {
    el.textContent = target;
    return;
  }

  const start = performance.now();
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    const v = easeOutCubic(t) * parsed.n;
    el.textContent = formatLike(target, v);
    if (t < 1) requestAnimationFrame(tick);
    else el.textContent = target; // ensure exact final value
  };
  el.textContent = formatLike(target, 0);
  requestAnimationFrame(tick);
}

/**
 * Wire up all `[data-countup]` elements in a container. Uses an
 * IntersectionObserver so the animation only fires when the strip
 * enters the viewport.
 */
export function initCountUps(container: ParentNode = document): void {
  const els = container.querySelectorAll<HTMLElement>('[data-countup]');
  if (!els.length) return;

  if (REDUCED_MOTION) {
    els.forEach((el) => animateCountUp(el));
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          animateCountUp(entry.target as HTMLElement);
          io.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.4 },
  );
  els.forEach((el) => io.observe(el));
}
