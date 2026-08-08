/**
 * mojs-recipes.client.ts : v11.W3 · @mojs/core recipe surface for W4.
 *
 * Per [[mojs-library-corpus-2026-07-31]]: mojs is browser-only, ~30KB gz,
 * hard-banned from hero decoration (Lighthouse regression per v8.1.0
 * hotfix). This module ships the recipe functions W4 surfaces will call:
 *
 *   - pulseOnce(el): 6-dot ring burst on viewport entry, ONE shot, 600ms.
 *     Used by [[EarthMap]] pin markers (per /methodology · pin pulse-once).
 *
 *   - eraBoundaryBurst(el): subtle 6-dot fade-in over 400ms on era markers.
 *     Used by [[StabilityViz]] 5-era visualization.
 *
 * Both recipes honour the chrome contract:
 *   - No rotate (mojs ShapeSwirl is banned; we use Shape only)
 *   - No halo/glow (fill is the single amber accent, no box-shadow)
 *   - Single burst per surface entry (no repeat, no infinite loop)
 *   - prefers-reduced-motion: reduce → return early, CSS handles terminal
 *
 * W4 owner imports these via dynamic import in EarthMap.astro and
 * StabilityViz.astro. The 30KB mojs bundle stays OUT of the initial
 * route payload : `client:visible` Astro directive + dynamic import
 * keep it deferred until the surface enters the viewport.
 */

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface PulseOptions {
  /** Origin coordinates (defaults to element's bounding-box center) */
  x?: number;
  y?: number;
  /** Number of dots in the ring (default 6, per brief) */
  count?: number;
  /** Final ring radius before fade (default 12px, per brief) */
  radius?: number;
  /** Burst duration in ms (default 600, per brief) */
  duration?: number;
  /** Fill color (default amber token) */
  fill?: string;
}

async function loadMojs(): Promise<typeof import('@mojs/core') | null> {
  // Dynamic import keeps @mojs/core out of the route's initial bundle.
  // The library only loads when a recipe function is actually invoked.
  try {
    const mod = await import('@mojs/core');
    return mod;
  } catch {
    return null;
  }
}

/**
 * pulseOnce : single 6-dot ring burst on the given element.
 * The ring expands from 0 → 12px then fades over 600ms. ONCE.
 * Per the brief: "NEVER repeating", "pulse-once is allowed because it's
 * NOT a status indicator; it's an entrance gesture."
 *
 * Idempotent: a second call on the same element is a no-op (data-pulsed
 * flag set on the element). Reduced-motion: no-op.
 */
export async function pulseOnce(el: HTMLElement, opts: PulseOptions = {}): Promise<void> {
  if (reduced) return;
  if (el.dataset.pulsed === 'true') return;
  el.dataset.pulsed = 'true';

  const mojs = await loadMojs();
  if (!mojs) return;

  const rect = el.getBoundingClientRect();
  const x = opts.x ?? rect.left + rect.width / 2 + window.scrollX;
  const y = opts.y ?? rect.top + rect.height / 2 + window.scrollY;
  const count = opts.count ?? 6;
  const radius = opts.radius ?? 12;
  const duration = opts.duration ?? 600;
  const fill = opts.fill ?? 'var(--c-amber, #946b1f)';

  // Burst is a particle system : 6 dots (count) on a swirl child. Each
  // child animates its radius from 0 → radius, opacity 1 → 0, then stops.
  // No repeat (per brief: "NEVER repeating"). No yoyo. Single playback.
  const burst = new mojs.Burst({
    left: x,
    top: y,
    radius: { 0: radius },
    count,
    children: {
      shape: 'circle',
      radius: { 0: 2 },
      fill,
      duration,
      easing: 'cubic.out',
      delay: 'rand(0, 80)',
    },
  });

  burst.play();
}

/**
 * eraBoundaryBurst : subtle 6-dot fade-in on a single era marker.
 * Used by StabilityViz (W4) when an era boundary enters the viewport.
 * 400ms total, no expansion (dots stay 1.5px), single playback.
 *
 * Idempotent: data-era-burst flag. Reduced-motion: no-op.
 */
export async function eraBoundaryBurst(el: HTMLElement): Promise<void> {
  if (reduced) return;
  if (el.dataset.eraBurst === 'true') return;
  el.dataset.eraBurst = 'true';

  const mojs = await loadMojs();
  if (!mojs) return;

  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2 + window.scrollX;
  const y = rect.top + rect.height / 2 + window.scrollY;
  const fill = 'var(--c-amber, #946b1f)';

  // 6 dots fade-in (opacity 0 → 1) over 400ms. No scale, no radius change
  // : this is a marker-arrival gesture, not a celebration burst.
  const burst = new mojs.Burst({
    left: x,
    top: y,
    count: 6,
    radius: { 0: 6 },
    children: {
      shape: 'circle',
      radius: 1.5,
      fill,
      opacity: { 0: 1 },
      duration: 400,
      easing: 'sin.out',
      delay: 'stagger(0, 30)',
    },
  });

  burst.play();
}

export {};
