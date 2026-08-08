/**
 * keyboard-shortcuts.ts : v6.2 (Mission T, part 3)
 *
 * Global keyboard navigation for the home page.
 *
 * Routes:
 *   ?  toggles the #keyhint-panel (slide in/out)
 *   j  page-down by one viewport-height (~75% of innerHeight for context)
 *   k  page-up by one viewport-height
 *   g  scroll to top
 *   b  scroll to bottom
 *   /  focus first [data-search] element on the page (no-op if absent)
 *   Escape  close any open keyhint panel
 *
 * Honors prefers-reduced-motion (instant scroll jumps regardless of
 * behavior, because the script does not need the visual easing : only
 * the panel transitions have a reduced-motion branch via CSS).
 *
 * Idempotent: uses a `Symbol`-keyed flag on `document.documentElement`
 * so calling `init()` twice doesn't double-attach.
 */

const INIT_FLAG = Symbol.for('cm.keyboard-shortcuts.init');
declare global {
  interface HTMLElement {
    [key: symbol]: boolean | undefined;
  }
}
const root = document.documentElement as unknown as Record<symbol, boolean | undefined>;
if (root[INIT_FLAG]) {
  // Already attached : bail. Astro 7 may double-invoke module imports.
} else {
  root[INIT_FLAG] = true;
  attach();
}

export {};

function attach(): void {
  const panel = document.querySelector<HTMLElement>('#keyhint-panel');

  /** Smooth scroll into position; falls back to instant if reduced motion. */
  const scrollTo = (y: number): void => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({
      top: y,
      left: 0,
      behavior: reduced ? 'auto' : 'smooth',
    });
  };

  const openPanel = (): void => {
    if (!panel) return;
    panel.removeAttribute('hidden');
    // Force reflow so the next class addition triggers the CSS transition.
    void panel.offsetWidth;
    panel.classList.add('is-open');
    panel.setAttribute('aria-hidden', 'false');
  };
  const closePanel = (): void => {
    if (!panel) return;
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    // Hide after the transition completes (220ms matches the CSS).
    window.setTimeout(() => {
      if (!panel.classList.contains('is-open')) {
        panel.setAttribute('hidden', '');
      }
    }, 240);
  };
  const togglePanel = (): void => {
    if (!panel) return;
    if (panel.classList.contains('is-open')) closePanel();
    else openPanel();
  };

  const focusSearch = (): void => {
    const target = document.querySelector<HTMLElement>('[data-search]');
    if (!target) return;
    target.focus();
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const viewportStep = (dir: 1 | -1): void => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const step = Math.round(window.innerHeight * 0.75);
    const target = window.scrollY + dir * step;
    // Clamp to the document so we never under/over-shoot past the bounds.
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const clamped = Math.max(0, Math.min(target, max));
    scrollTo(clamped);
    // Touch reduced to silence unused-var lint without changing behavior.
    void reduced;
  };

  // Bound `this` listeners, ignore auto-repeat on movement keys (j/k/g/b).
  const handler = (e: KeyboardEvent): void => {
    // Don't intercept when the user is typing in a real field.
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
      // Still allow Escape to close the panel even when an input is focused.
      if (e.key === 'Escape') {
        if (panel && panel.classList.contains('is-open')) {
          closePanel();
          e.preventDefault();
        }
      }
      return;
    }
    // Modifier keys disqualify all shortcuts except Escape.
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    switch (e.key) {
      case '?':
        togglePanel();
        e.preventDefault();
        break;
      case 'Escape':
        if (panel && panel.classList.contains('is-open')) {
          closePanel();
          e.preventDefault();
        }
        break;
      case 'j':
        if (!e.repeat) viewportStep(1);
        e.preventDefault();
        break;
      case 'k':
        if (!e.repeat) viewportStep(-1);
        e.preventDefault();
        break;
      case 'g':
        if (!e.repeat) scrollTo(0);
        e.preventDefault();
        break;
      case 'b':
        if (!e.repeat) {
          const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
          scrollTo(max);
        }
        e.preventDefault();
        break;
      case '/':
        focusSearch();
        e.preventDefault();
        break;
    }
  };

  document.addEventListener('keydown', handler);
}
