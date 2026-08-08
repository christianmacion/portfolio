/**
 * active-nav.ts : Phase D-2 + v6.0 · section-toc integration.
 *
 * Tracks visible <section> ids and applies `.is-active` to:
 *   1. The matching nav link (.nav__link)
 *   2. The matching in-page TOC link (.toc__link, data-toc-href)
 *
 * Uses "leading section" logic : only the section whose top is
 * closest to a 25%-of-viewport reference line gets the active class.
 * No scroll-jacking; pure read.
 *
 * Total bundle: ~900 bytes minified.
 */

function init(): void {
  // 1) Top-nav active link (existing behaviour)
  const navLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('.nav__link'));

  // 2) In-page section-TOC active link (new in v6.0)
  const tocLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('[data-toc-href]'));

  if (navLinks.length === 0 && tocLinks.length === 0) return;

  // Gather all sections that any of the link sets point to, keyed by id
  const ids = new Set<string>();
  navLinks.forEach((a) => {
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('#')) ids.add(href.slice(1));
  });
  tocLinks.forEach((a) => {
    const href = a.getAttribute('data-toc-href') ?? '';
    if (href.startsWith('#')) ids.add(href.slice(1));
  });
  if (ids.size === 0) return;

  const sections = Array.from(ids)
    .map((id) => document.getElementById(id))
    .filter((el): el is HTMLElement => !!el);
  if (sections.length === 0) return;

  function update(): void {
    const referenceY = window.innerHeight * 0.25;
    let bestId: string | null = null;
    let bestDist = Infinity;
    for (const s of sections) {
      const rect = s.getBoundingClientRect();
      const dist = Math.abs(rect.top - referenceY);
      if (rect.top < window.innerHeight && dist < bestDist) {
        bestDist = dist;
        bestId = s.id;
      }
    }
    // Update nav links
    navLinks.forEach((a) => {
      const href = a.getAttribute('href') ?? '';
      a.classList.toggle('is-active', href === `#${bestId}`);
    });
    // Update TOC links
    tocLinks.forEach((a) => {
      const href = a.getAttribute('data-toc-href') ?? '';
      a.classList.toggle('toc__link--active', href === `#${bestId}`);
    });
  }

  update();
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export {};
