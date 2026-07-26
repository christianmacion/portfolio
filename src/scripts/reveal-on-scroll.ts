/**
 * reveal-on-scroll.ts — Phase D-7.
 *
 * One-shot fade-in for any element with [data-reveal].
 * Triggers when any pixel of the element enters the viewport.
 * Honors prefers-reduced-motion (CSS side) and unobserves after firing.
 *
 * v6.18 — also drives [data-spark] paths (MiniSpark draw-in via
 * stroke-dashoffset). And honors [data-reveal-delay] (ms) on any
 * data-reveal element so hero staggers (0/80/160/240/320ms) work
 * without per-target JS.
 *
 * Total bundle: ~700 bytes minified.
 */

// Mark JS-enabled BEFORE attaching the observer so CSS can layer the
// hidden-start state on top of `<html class="js">`. Without this, sections
// remain invisible if the observer never fires (pre-hydration, headless
// full-page screenshots, etc.).
document.documentElement.classList.add('js');

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function fire(el: HTMLElement): void {
  const delay = Number.parseFloat(el.dataset.revealDelay ?? '');
  const ms = Number.isFinite(delay) && delay > 0 ? delay : 0;
  if (ms > 0) {
    window.setTimeout(() => el.classList.add('is-revealed'), ms);
  } else {
    el.classList.add('is-revealed');
  }
}

function init(): void {
  const revealTargets = document.querySelectorAll<HTMLElement>('[data-reveal]');
  const sparkTargets = document.querySelectorAll<SVGPathElement>('[data-spark]');
  if (revealTargets.length === 0 && sparkTargets.length === 0) return;

  if (reduced || !('IntersectionObserver' in window)) {
    // Reduced-motion or no IO support — show everything immediately.
    revealTargets.forEach((el) => el.classList.add('is-revealed'));
    sparkTargets.forEach((el) => el.classList.add('is-revealed'));
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        // Reveal as soon as ANY pixel of the target enters the viewport.
        if (entry.isIntersecting) {
          fire(entry.target as HTMLElement);
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0, rootMargin: '0px' },
  );

  revealTargets.forEach((el) => io.observe(el));
  sparkTargets.forEach((el) => io.observe(el));

  // Safety net: after 1.2s, reveal anything still hidden (slow loaders,
  // headless browsers with virtual time, JS-disabled users that gained
  // a `js` class late, etc.). Better to show late than never.
  window.setTimeout(() => {
    revealTargets.forEach((el) => el.classList.add('is-revealed'));
    sparkTargets.forEach((el) => el.classList.add('is-revealed'));
  }, 1200);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export {};
