/**
 * carousel.ts : driver for the StatementCarousel component.
 *
 * The component lives at `src/components/StatementCarousel.astro` and renders
 * the static HTML (slides + dots). This module wires the live behavior:
 *
 *   - Auto-advances slides on a timer (default 5s; configured per-instance
 *     via `data-interval` on the root `[data-stmt-carousel]` element).
 *   - Pauses on `mouseenter` / `focusin`, resumes on `mouseleave` / `focusout`.
 *   - Manual nav via the dot buttons (`[data-stmt-dot]`).
 *   - Respects `prefers-reduced-motion` (no auto-advance when reduced).
 *
 * Why this lives in @scripts/ instead of an inline `<script>` in the component:
 * Astro 7 sometimes drops per-component `<script>` blocks during the build
 * (the chunk never materialises in dist/_astro/, and no `<script src>` is
 * emitted on the page). Wiring it through the BaseLayout bundle : like
 * reveal-on-scroll, odometer, active-nav, copy-button, scroll-progress :
 * guarantees the driver ships on every page that includes the carousel.
 *
 * v6.0.13 hardening:
 *   - Generation token (`gen`) invalidates any tick callback that was
 *     already queued when `stop()` was called. Solves the "stale
 *     `setInterval` callback fires after manual nav" race.
 *   - `Number(raw)` is guarded: if `data-stmt-dot` is missing or
 *     non-integer, the click is a no-op (instead of `show(NaN)` which
 *     silently kills the carousel : every slide gets `aria-hidden` and
 *     opacity 0).
 *   - `show(i)` skips when `next === active` (no flicker on duplicate
 *     clicks).
 */

function initCarousel(root: HTMLElement): void {
  const slides = Array.from(root.querySelectorAll<HTMLElement>('[data-stmt-index]'));
  const dots = Array.from(root.querySelectorAll<HTMLElement>('[data-stmt-dot]'));
  if (slides.length === 0) return;

  const intervalMs = Number(root.dataset.interval ?? '5000');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let active = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  // Generation token. Each `start()` increments and captures a fresh `myGen`;
  // callbacks whose `myGen !== gen` are leaked from a previous start() and
  // must drop without firing.
  let gen = 0;

  function show(i: number): void {
    const next = ((i % slides.length) + slides.length) % slides.length;
    if (next === active) return;
    active = next;
    slides.forEach((s, idx) => {
      const on = idx === active;
      s.classList.toggle('is-active', on);
      s.setAttribute('aria-hidden', on ? 'false' : 'true');
    });
    dots.forEach((d, idx) => {
      const on = idx === active;
      d.classList.toggle('is-active', on);
      // v6.11.6 : dots now use role=tab + aria-selected (parent is
      // role=tablist). The previous aria-pressed toggle pattern was an
      // ARIA mismatch since tablist requires tab children.
      d.setAttribute('aria-selected', on ? 'true' : 'false');
      d.setAttribute('tabindex', on ? '0' : '-1');
    });
  }

  function start(): void {
    if (reduced) return;
    stop();
    const myGen = ++gen;
    timer = setInterval(() => {
      if (myGen !== gen) return; // stale callback from a cancelled interval
      show(active + 1);
    }, intervalMs);
  }
  function stop(): void {
    gen++; // invalidate any in-flight interval callback
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  dots.forEach((d) => {
    d.addEventListener('click', () => {
      const raw = d.dataset.stmtDot;
      const idx = raw == null ? active : Number(raw);
      // v6.0.13 : `Number(undefined) === NaN`. Without this guard, a dot
      // click with a missing attribute silently kills the entire carousel
      // (every slide gets aria-hidden=true and opacity 0).
      if (!Number.isInteger(idx)) return;
      show(idx);
      start(); // restart timer after manual nav
    });
  });

  root.addEventListener('mouseenter', stop);
  root.addEventListener('mouseleave', start);
  root.addEventListener('focusin', stop);
  root.addEventListener('focusout', start);

  start();
}

function init(): void {
  const roots = document.querySelectorAll<HTMLElement>('[data-stmt-carousel]');
  if (roots.length === 0) return;
  roots.forEach(initCarousel);
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
}

export {};
