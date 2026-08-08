/**
 * odometer.ts : Phase D-1.
 *
 * Animates [data-counter="N"] once when scrolled into view. Counter goes
 * from 0 → N over 0.6s with an ease-out cubic-bezier curve. Monospace
 * tabular-nums prevents layout shift. One-shot per element.
 *
 * v6.18 : fix 0-flash. SSR renders the formatted final value (not 0),
 * so we DON'T reset to '0' on init. Only when the IO fires AND the
 * element is in viewport do we start the count-up. Threshold also
 * dropped from 0.3 → 0 so a cell that's partially visible animates
 * immediately (the hero stats live near the top of the page).
 *
 * v2026-08-02 : default duration shortened to 0.6s (was 1.2s). The
 * value is SSR'd to the final figure, so the user only sees "0" for
 * the duration of the count-up. 0.6s reads as institutional snappy
 * (≤ the 0.6s audit threshold) while remaining legible for ≥ 2-digit
 * targets. Per-element override via `data-duration="<ms>"` is still
 * honored when the caller passes > 0.
 *
 * Honors prefers-reduced-motion (instant snap to final value).
 */

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function init(): void {
  const targets = document.querySelectorAll<HTMLElement>('[data-counter]');
  if (targets.length === 0) return;

  targets.forEach((el) => {
    const finalStr = el.dataset.counter ?? '0';
    const final = Number.parseFloat(finalStr);
    if (!Number.isFinite(final)) return;

    if (reduced || !('IntersectionObserver' in window)) {
      // Already SSR'd to the final value : leave it.
      return;
    }

    // Allow per-element duration override via `data-duration` (ms).
    // v2026-08-02 : default shortened from 1200 → 600.
    const overrideDur = Number.parseFloat(el.dataset.duration ?? '');
    const duration = Number.isFinite(overrideDur) && overrideDur > 0 ? overrideDur : 600;
    const start = performance.now();
    let fired = false;

    const animate = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // ease-out cubic-bezier(0.16, 1, 0.3, 1)
      const eased = 1 - Math.pow(1 - t, 3);
      const current = Math.round(final * eased);
      el.textContent = String(current);
      if (t < 1) requestAnimationFrame(animate);
      else el.textContent = finalStr; // ensure exact final value
    };

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && !fired) {
            fired = true;
            // Reset to 0 RIGHT BEFORE the animation starts (not on
            // init). Eliminates the "0 flash" that came from setting
            // it at module-load before IO fires.
            el.textContent = '0';
            requestAnimationFrame(animate);
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0 },
    );
    io.observe(el);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export {};
