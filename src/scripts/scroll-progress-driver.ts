/**
 * scroll-progress-driver.ts : v9.3.1 fix
 *
 * The static bar element in BaseLayout.astro
 * (`<div class="scroll-progress"><i></i></div>`) reads its inner-bar width
 * from the CSS custom property `--scroll-progress` (see motion.css §8).
 * This driver is the SOLE writer of that property. The legacy
 * `scroll-progress.ts` script created a separate `scroll-progress-bar`
 * element via direct inline-style mutation; that element overlapped the
 * static bar and made the bug invisible. The fix drops the dynamic element
 * and drives the static one via the documented CSS custom property.
 *
 * Reduced-motion: the bar still tracks scroll position. A runtime guard
 * here neutralizes the inner-bar transition (belt-and-suspenders for
 * slim-chrome pages where motion.css isn't loaded, and to ensure the
 * contract holds even if a downstream CSS rule scopes out the global
 * override). The bar snaps to the right width without animating.
 *
 * Idempotent: re-running just updates the same property; no DOM mutations.
 */
const PROGRESS_VAR = '--scroll-progress';

function tick(): void {
  const doc = document.documentElement;
  const scrollTop = window.scrollY || doc.scrollTop;
  const max = doc.scrollHeight - window.innerHeight;
  const pct = max > 0 ? Math.min(100, Math.max(0, (scrollTop / max) * 100)) : 0;
  doc.style.setProperty(PROGRESS_VAR, `${pct.toFixed(2)}%`);
  const bar = document.querySelector<HTMLElement>('.scroll-progress');
  if (bar) bar.setAttribute('aria-valuenow', String(Math.round(pct)));
}

let rafQueued = false;
function onScroll(): void {
  if (rafQueued) return;
  rafQueued = true;
  requestAnimationFrame(() => {
    rafQueued = false;
    tick();
  });
}

function applyReducedMotionGuard(): void {
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const inner = document.querySelector<HTMLElement>('.scroll-progress > i');
  if (inner) inner.style.transition = 'none';
}

export function initScrollProgressDriver(): void {
  applyReducedMotionGuard();
  tick();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  window
    .matchMedia('(prefers-reduced-motion: reduce)')
    .addEventListener('change', applyReducedMotionGuard);
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initScrollProgressDriver, { once: true });
  } else {
    initScrollProgressDriver();
  }
}
