/**
 * motion.ts : v7.4 INSTITUTIONAL MOTION DRIVER (SITE-WIDE)
 *
 * v7.4-WIDE : applies to every page (not just /):
 *   - .hero [data-stagger] paint-time reveal (no observer needed)
 *   - .word TextReveal (per-word cascade) : auto-wrap ANY [data-words]
 *     heading OR direct .hero__title / .r-hero__title / h1.hero__title
 *   - .hero.has-cursor (after entrance settles, append the cursor)
 *   - .nav is-scrolled toggling (after 80px scroll)
 *   - .scroll-progress is-active (after 1 viewport)
 *   - Portrait parallax (max 8px translate, capped at top + bottom)
 *   - SectionRail (left-rail scroll-driven ticks, single IO)
 *   - Site-wide auto-init: any [data-section-trace] in view fires
 *     its scaleX transition once (paired with [data-reveal] or auto)
 *
 * Reduced-motion: every active driver returns early. Static layout wins.
 */

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Auto-wrap any heading text into per-word <span class="word"> spans.
 * Targets: [data-words] (explicit), .hero__title, .r-hero__title,
 *          h1.hero__title, h1.r-hero__title, .hero__name.
 * Idempotent : re-runs are no-ops.
 */
function autoWrapWords(): void {
  const selector = [
    '[data-words]',
    '.hero__title',
    '.r-hero__title',
    '.work__title',
    '.fit__title',
    '.h1',
    // v12.W4 (2026-08-08) : add .hero-flagship__name so the home page H1
    // (Quantitative Researcher) gets the per-word cascade. The H1 now
    // carries data-words explicitly, so [data-words] matches it too,
    // but the explicit class entry keeps the wiring intent obvious to
    // any future maintainer.
    '.hero-flagship__name',
    '.r-card__title',
    '.section__title',
    '.r-disclose__title',
    '.r-grid__title',
    '.contact__eyebrow',
  ].join(', ');
  const headings = document.querySelectorAll<HTMLElement>(selector);
  headings.forEach((h) => {
    if (h.dataset.wordsDone === 'true') return;
    // Skip if already wrapped (e.g., on the home h1 with explicit spans)
    if (h.querySelector('.word')) return;
    // Collect text from leaf nodes : preserve icon/sup separately if any
    const walker = document.createTreeWalker(h, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        // Don't wrap inside iconography / child spans already
        if (parent.tagName === 'SPAN' && parent.classList.contains('word')) {
          return NodeFilter.FILTER_REJECT;
        }
        if (parent.tagName === 'SUP' || parent.tagName === 'SUB') {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const textNodes: Text[] = [];
    let n: Node | null = walker.nextNode();
    while (n) {
      textNodes.push(n as Text);
      n = walker.nextNode();
    }
    if (textNodes.length === 0) return;
    textNodes.forEach((tn) => {
      const text = tn.textContent ?? '';
      if (!text.trim()) return;
      const frag = document.createDocumentFragment();
      const parts = text.split(/(\s+)/);
      parts.forEach((p) => {
        if (p.match(/^\s+$/)) {
          frag.appendChild(document.createTextNode(p));
        } else if (p.length > 0) {
          const span = document.createElement('span');
          span.className = 'word';
          span.textContent = p;
          frag.appendChild(span);
        }
      });
      tn.parentNode?.replaceChild(frag, tn);
    });
    h.dataset.wordsDone = 'true';
  });
}

function initHeroStagger(): void {
  // v12.W4 (2026-08-08) : also match `.hero-flagship [data-stagger]` so
  // the home page's flagship hero (which uses .hero-flagship, not .hero)
  // gets the same paint-time cascade. The CSS layer in motion.css §2
  // ships the matching transition rule; this JS just adds .is-revealed
  // to fire it.
  const heroStagger = document.querySelectorAll<HTMLElement>(
    '.hero [data-stagger], .hero-flagship [data-stagger]',
  );
  heroStagger.forEach((el) => el.classList.add('is-revealed'));

  // Auto-wrap any heading text into word spans (site-wide).
  autoWrapWords();
  const words = document.querySelectorAll<HTMLElement>('.word');
  words.forEach((el) => el.classList.add('is-revealed'));

  // Add the cursor class after the 6-step stagger completes (~720ms).
  // The class triggers the CSS keyframe (motion.css #16).
  // v12.W4 (2026-08-08) : also fire on .hero-flagship so the home page
  // H1 gets the terminal-caret blink after the word cascade settles.
  if (words.length > 0 || heroStagger.length > 0) {
    window.setTimeout(() => {
      document.querySelectorAll<HTMLElement>('.hero, .hero-flagship').forEach((el) => {
        el.classList.add('has-cursor');
      });
    }, 760);
  }
}

/**
 * Site-wide reveal driver for [data-reveal] sections.
 * Fires once on intersect. SectionTrace ([data-section-trace]) is a
 * child pattern that resolves when its parent is in view.
 */
function initSiteReveal(): void {
  if (reduced) return;
  const targets = document.querySelectorAll<HTMLElement>('[data-reveal]');
  if (targets.length === 0) return;
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-revealed');
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
  );
  targets.forEach((t) => io.observe(t));
}

function initNavAndScroll(): void {
  const nav = document.querySelector<HTMLElement>('.nav');
  const bar = document.querySelector<HTMLElement>('.scroll-progress');
  const portrait = document.querySelector<HTMLElement>('.hero__portrait img');

  function onScroll(): void {
    const y = window.scrollY;
    if (nav) {
      nav.classList.toggle('is-scrolled', y > 80);
      // v2026-07-31 : second-tier elevation when the hero is fully
      // scrolled past (50vh). Adds a 1px offset hairline that reads
      // as "the nav is floating over scrolled content". The CSS
      // uses `box-shadow: 0 1px 0 0 ...` (no 0-spread blur) so it
      // stays inside the no-halo gate.
      nav.classList.toggle('is-elevated', y > window.innerHeight * 0.5);
    }
    if (bar) bar.classList.toggle('is-active', y > window.innerHeight * 0.6);
    if (portrait && !reduced) {
      const hero = portrait.closest('.hero');
      if (!hero) return;
      const rect = (hero as HTMLElement).getBoundingClientRect();
      const heroH = rect.height;
      const progress = Math.min(1, Math.max(0, -rect.top / heroH));
      const translate = (1 - Math.abs(progress - 0.5) * 2) * 8;
      portrait.style.transform = `translateY(${translate.toFixed(2)}px)`;
    }
  }

  if (reduced) {
    nav?.classList.add('is-scrolled');
    nav?.classList.add('is-elevated');
    return;
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  onScroll();
}

/**
 * v2026-07-31 : data-reveal-stagger helper.
 * Reads [data-reveal-stagger="N"] (ms) on a parent and applies the
 * matching `--reveal-stagger` CSS custom property. The CSS in
 * motion.css §21 uses that var + nth-child() to compute per-child
 * delays. Idempotent : re-runs are no-ops.
 */
function initRevealStagger(): void {
  const groups = document.querySelectorAll<HTMLElement>('[data-reveal-stagger]');
  groups.forEach((g) => {
    if (g.dataset.revealStaggerBound === 'true') return;
    const n = Number.parseFloat(g.dataset.revealStagger ?? '80');
    const ms = Number.isFinite(n) && n > 0 ? n : 80;
    g.style.setProperty('--reveal-stagger', `${ms}ms`);
    g.dataset.revealStaggerBound = 'true';
  });
}

/* === SectionRail : left-rail scroll-driven ticks.
 * Single IO across all [data-section-num]. Each item fills its --section-progress
 * (0→1) as the section enters the viewport. Active = --section-progress > 0.5.
 *
 * Auto-build: if a page has .section-rail but no .section-rail__item children,
 * build the rail from any <section id="..."> in the page. Idempotent.
 */
function initSectionRail(): void {
  if (reduced) return;
  const rail = document.querySelector<HTMLElement>('.section-rail');
  if (!rail) return;

  let items = Array.from(rail.querySelectorAll<HTMLElement>('.section-rail__item'));
  if (items.length === 0) {
    // Auto-build from section IDs in the page.
    const sections = document.querySelectorAll<HTMLElement>('main section[id]');
    if (sections.length === 0) return;
    sections.forEach((s, i) => {
      const id = s.id;
      const label = id.replace(/-/g, ' ').toUpperCase();
      const item = document.createElement('span');
      item.className = 'section-rail__item';
      item.dataset.sectionId = id;
      item.textContent = `${String(i + 1).padStart(2, '0')}`;
      item.title = label;
      item.setAttribute('aria-label', label);
      rail.appendChild(item);
    });
    items = Array.from(rail.querySelectorAll<HTMLElement>('.section-rail__item'));
    // Tag each section with data-section-num so the rail can map.
    sections.forEach((s, i) => {
      s.dataset.sectionNum = String(i + 1).padStart(2, '0');
    });
  }

  const targets = document.querySelectorAll<HTMLElement>('[data-section-num]');
  if (items.length === 0 || targets.length === 0) return;

  const targetById = new Map<string, HTMLElement>();
  targets.forEach((t) => {
    if (t.id) targetById.set(t.id, t);
  });

  const itemMap = new Map<string, HTMLElement>();
  items.forEach((it) => {
    const sid = it.dataset.sectionId;
    if (sid) itemMap.set(sid, it);
  });

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const id = (entry.target as HTMLElement).id;
        const item = itemMap.get(id);
        if (!item) return;
        const ratio = entry.intersectionRatio;
        item.style.setProperty('--section-progress', ratio.toFixed(3));
        item.classList.toggle('is-active', ratio > 0.5);
      });
    },
    { threshold: Array.from({ length: 21 }, (_, i) => i / 20) },
  );

  targetById.forEach((t) => io.observe(t));
}

function init(): void {
  initHeroStagger();
  initSiteReveal();
  initRevealStagger();
  initNavAndScroll();
  initSectionRail();
  initHomeSectionReveal();
}

/* === v11.W3 : single site-wide IntersectionObserver for home-section
 * reveal stagger. CSS in motion.css §29f owns the transition (240ms
 * ease-out, 12px translateY, --reveal-stagger-i * 80ms delay). This
 * function:
 *   1. collects every .home-section in document order
 *   2. assigns --reveal-stagger-i = <index> as a CSS custom property
 *   3. observes them via a single IO (one observer, all targets)
 *   4. fires .is-revealed once when 12% of the element enters view
 *   5. unobserves after firing (one-shot per section)
 *
 * Reduced-motion: returns early; CSS keeps .home-section opacity:0 +
 * transform off the page, but the global reduced-motion media query
 * in motion.css §29g forces opacity:1 + transform:none so the page
 * reads correctly without a JS special-case.
 *
 * Idempotent: re-running init() is a no-op because the IO flag on
 * documentElement prevents double-bind. */
function initHomeSectionReveal(): void {
  if (document.documentElement.dataset.homeSectionRevealBound === 'true') return;
  document.documentElement.dataset.homeSectionRevealBound = 'true';
  // Selector covers both the explicit .home-section class AND the
  // home page's existing top-level section classes (.broadside,
  // .hero-flagship, .lede, .artifacts, .help, .footprint). This
  // means a single site-wide IO drives the entire home page reveal
  // stagger without touching index.astro beyond the two .home-section
  // tags already added.
  const sections = document.querySelectorAll<HTMLElement>(
    '.home-section, main > section.broadside, main > section.hero-flagship, main > section.lede, main > section.artifacts, main > section.help, main > section.footprint',
  );
  if (sections.length === 0) return;

  // De-dupe (in case both .home-section and a positional class match)
  // and assign stagger index in DOM order.
  const seen = new Set<HTMLElement>();
  const list: HTMLElement[] = [];
  sections.forEach((s) => {
    if (!seen.has(s)) {
      seen.add(s);
      list.push(s);
    }
  });
  list.forEach((s, i) => {
    s.style.setProperty('--reveal-stagger-i', String(i));
  });

  if (reduced || !('IntersectionObserver' in window)) {
    list.forEach((s) => s.classList.add('is-revealed'));
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-revealed');
          io.unobserve(entry.target);
        }
      });
    },
    // Threshold lowered from 0.12 → 0.001: the .broadside container is
    // 8209px tall (whole page wrapped in one section on home), so 12% of
    // it (985px) exceeds the 900px viewport height. The previous threshold
    // never fired for full-page screenshots or for the home broadside in
    // any viewport < 985px. 0.001 ≈ "any pixel visible" matches the
    // intent ("section enters view") without spamming the callback.
    // rootMargin '0px 0px -8% 0px' keeps the trigger inside the fold.
    { threshold: 0.001, rootMargin: '0px 0px -8% 0px' },
  );
  list.forEach((s) => io.observe(s));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export {};
