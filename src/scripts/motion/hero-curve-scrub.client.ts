/**
 * hero-curve-scrub.client.ts — v11.W3 · scroll-triggered curve draw-on.
 *
 * Replaces the paint-time 2.4s stroke-dashoffset draw with a viewport-entry
 * 240ms ease-in-out scrub. The line draws once, fast, when the curve enters
 * the viewport. The terminal caret + amber tag fade in immediately after.
 *
 * Why native JS instead of GSAP (per bundle budget):
 *   - GSAP would add ~25KB gz (per [[theatre-library-corpus-2026-07-31]]
 *     table). The 240ms ease-in-out is a single property transition that
 *     CSS handles in 4 lines. No new library needed.
 *   - Chrome contract: single entrance gesture, no infinite scrub.
 *
 * Reduced-motion: snap to terminal state (dashoffset 0, all visible).
 * Idempotent: data-hero-curve-scrub flag prevents re-binding.
 */

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function init(): void {
  if (reduced) return;
  const curve = document.querySelector<HTMLElement>('.hero-curve__line');
  if (!curve) return;
  if (curve.dataset.heroCurveScrub === 'true') return;
  curve.dataset.heroCurveScrub = 'true';

  // Override the paint-time CSS keyframe by zeroing the delay so the
  // scrub can be triggered from JS. The CSS already sets
  // stroke-dashoffset: 720 (line invisible). We drive it to 0 over 240ms.
  curve.style.animation = 'none';
  curve.style.strokeDashoffset = '720';

  const section = curve.closest('.hero-curve');
  if (!section) return;

  // 240ms ease-in-out from 720 → 0. Single playback. No repeat. No yoyo.
  const animate = (): void => {
    const start = performance.now();
    const from = 720;
    const to = 0;
    const dur = 240;
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / dur);
      // ease-in-out cubic
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      curve.style.strokeDashoffset = String(from + (to - from) * eased);
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        curve.style.strokeDashoffset = '0';
      }
    };
    requestAnimationFrame(tick);
  };

  // Single IO on the curve's parent section. Fires once when 12% enters.
  if (!('IntersectionObserver' in window)) {
    animate();
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          animate();
          io.disconnect();
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
  );
  io.observe(section);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export {};
