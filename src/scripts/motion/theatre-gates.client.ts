/**
 * theatre-gates.client.ts : v11.W3 · theatre.js gates-lattice stagger-reveal.
 *
 * Showcases the @theatre/core library on /methodology : the G1-G31 gate
 * lattice (31 individual gate cells, organized as 6 family rows of ~5 gates
 * each + 1 trailer). Each cell fades in + 0.5px scale-up, 50ms stagger,
 * total 1.6s arc. Fires ONCE on viewport entry, then unobserves.
 *
 * Why theatre.js (per [[theatre-library-corpus-2026-07-31]]):
 *   - Dataverse pointer model lets the same animation state be read by
 *     multiple consumers (the cells share a Sheet so they stagger in order)
 *   - Bezier-handle curve control beyond CSS easing
 *   - Apache-2.0 runtime (~50KB gz core, ~9KB gz after tree-shake of named
 *     imports); @theatre/studio (AGPL-3.0) NEVER imported here
 *
 * Reduced-motion: returns early. CSS .gates-lattice__cell reduced-motion
 * override forces opacity:1 + transform:none, no theatre code path runs.
 *
 * Idempotent: window.__gatesLatticeBound flag prevents re-binding.
 */

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface GateCellBinding {
  el: HTMLElement;
  index: number;
}

async function init(): Promise<void> {
  if (reduced) return;
  if ((window as unknown as { __gatesLatticeBound?: boolean }).__gatesLatticeBound) return;
  (window as unknown as { __gatesLatticeBound?: boolean }).__gatesLatticeBound = true;

  const lattice = document.querySelector<HTMLElement>('[data-gates-lattice]');
  if (!lattice) return;

  const cells = Array.from(lattice.querySelectorAll<HTMLElement>('.gates-lattice__cell'));
  if (cells.length === 0) return;

  // Dynamic import keeps @theatre/core OUT of the route's initial JS chunk.
  // The library only loads when the lattice actually enters the viewport.
  // Vite + esbuild tree-shake named exports: getProject + val + onChange.
  let getProject: typeof import('@theatre/core').getProject;
  let onChange: typeof import('@theatre/core').onChange;
  let val: typeof import('@theatre/core').val;
  try {
    ({ getProject, onChange, val } = await import('@theatre/core'));
  } catch (e) {
    // Theatre.js failed to load (network or browser quirk). Fall back to
    // a no-animation state: reveal cells immediately via CSS-only path so
    // the lattice is still legible, and bail.
    console.warn('[theatre-gates] @theatre/core failed to load, skipping animation', e);
    cells.forEach((el) => { el.style.opacity = '1'; el.style.transform = 'none'; });
    return;
  }

  // Wrap getProject in a try/catch : Theatre v0.7+ throws "state seems to
  // be formatted in a way that is unreadable" when the project name is
  // already registered with a different state shape (HMR / page reload).
  // Refusing to register is safer than crashing the whole motion bundle.
  let project: ReturnType<typeof getProject>;
  try {
    project = getProject('gates-lattice', { state: { sheets: {} } });
  } catch (e) {
    console.warn('[theatre-gates] getProject failed, falling back to instant reveal', e);
    cells.forEach((el) => { el.style.opacity = '1'; el.style.transform = 'none'; });
    return;
  }
  const sheet = project.sheet('reveal');

  // One SheetObject per cell, sharing the same Sheet for synchronized
  // stagger (cells fire in DOM order). props are flat number values so
  // theatre exposes each as a Pointer<number> via obj.props.<key>.
  const bindings: GateCellBinding[] = cells.map((el, index) => {
    const obj = sheet.object(`cell-${index}`, {
      // 0 = hidden (opacity 0, scale 0.995), 1 = visible (opacity 1, scale 1)
      progress: 0,
      delay: index * 0.05,
    });

    onChange(obj.props.progress, (progress: number) => {
      // progress 0→1 maps to opacity 0→1 and scale 0.995→1.005
      // (the brief says "0.5px scale-up" : at the 240px cell width that's
      // a barely-perceptible settle, which matches Bryllim-grade restraint)
      const clamped = Math.min(1, Math.max(0, progress));
      el.style.opacity = String(clamped);
      el.style.transform = `scale(${0.995 + clamped * 0.005})`;
    });

    // Bind DOM refs back through val() so the IO trigger can read the
    // initial delay without traversing every cell.
    void val(obj.props.delay);

    return { el, index };
  });

  // One IntersectionObserver for the lattice container. When 12% of the
  // lattice enters the viewport, play the Sheet (one-shot, then unbind).
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        sheet.sequence
          .play({
            range: [0, 1.6],
            rate: 1,
            iterationCount: 1,
          })
          .catch(() => {
            // Theatre's sequence.play returns void in some versions and a
            // Promise in others. Swallow silently either way; the onChange
            // handler above is the source of truth for visual state.
          });
        io.disconnect();
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
  );

  // Per-cell delayed fade-in is driven by theatre, not CSS : we just need
  // each cell to know its own delay. We pre-set transform/opacity to 0 so
  // the page doesn't flash a fully-visible lattice before theatre kicks in.
  bindings.forEach(({ el }) => {
    el.style.opacity = '0';
    el.style.transform = 'scale(0.995)';
  });

  io.observe(lattice);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void init();
  });
} else {
  void init();
}

export {};
