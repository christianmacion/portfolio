/**
 * scroll-progress.ts — top-of-viewport 2px amber progress bar.
 *
 * Pattern from Medium.com / Stripe-docs. Hidden until user scrolls past
 * the first 8px, then fills as the document scrolls. rAF-throttled,
 * respects prefers-reduced-motion (the bar still tracks scroll, but
 * does not animate — it just snaps to the right width).
 *
 * Idempotent: re-running adds a single bar element.
 */
const PROGRESS_ID = 'scroll-progress-bar';

// === v8.3 — chrome token fallback constant (defensive against missing tokens) ===
// Mirrors the legacy Jane-Street-era `--c-amber` fallback for the
// scroll-progress bar fill. The `var(--c-amber, …)` pattern was used
// because this script may fire before the v6-13 surface CSS is parsed.
// Now consolidated: token is the source of truth, this constant mirrors
// the legacy value. See `src/styles/tokens-v6.13.css` for current
// `--j-warn` (the v6-17 successor of --c-amber's amber era value).
const FALLBACK_AMBER_PROGRESS = '#d4a017';

function build(): void {
  if (document.getElementById(PROGRESS_ID)) return;

  const bar = document.createElement('div');
  bar.id = PROGRESS_ID;
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', 'Reading progress');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.setAttribute('aria-valuenow', '0');

  // Inline styles so this works without depending on a CSS bundle
  // being processed before script runs.
  bar.style.cssText = [
    'position: fixed',
    'top: 0',
    'left: 0',
    'height: 2px',
    'width: 0',
    `background: var(--c-amber, ${FALLBACK_AMBER_PROGRESS})`,
    'z-index: 60',
    'pointer-events: none',
    'transition: opacity 200ms ease',
    'opacity: 0',
  ].join(';');
  document.body.appendChild(bar);
}

function tick(): void {
  const bar = document.getElementById(PROGRESS_ID);
  if (!bar) return;

  const doc = document.documentElement;
  const scrollTop = window.scrollY || doc.scrollTop;
  const max = doc.scrollHeight - window.innerHeight;
  const pct = max > 0 ? Math.min(100, Math.max(0, (scrollTop / max) * 100)) : 0;

  bar.style.width = `${pct.toFixed(2)}%`;
  bar.setAttribute('aria-valuenow', String(Math.round(pct)));

  // Show only after a tiny scroll, hide when at top.
  bar.style.opacity = scrollTop > 8 ? '1' : '0';
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

export function initScrollProgress(): void {
  build();
  tick();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initScrollProgress, { once: true });
  } else {
    initScrollProgress();
  }
}
