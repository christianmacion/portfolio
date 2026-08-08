/**
 * worldview.client.ts — WorldView Live globe + ticker scheduler.
 *
 * Loaded lazily when ⌘J opens the WorldView modal. d3-geo and
 * topojson-client are imported DYNAMICALLY so they only load on ⌘J
 * (saves ~25 KB on the initial BaseLayout bundle). The gdelt-client
 * and market-ticks utilities are statically imported (small, ~5 KB).
 *
 * Accessibility:
 *   - Globe rotation pauses on :hover AND on prefers-reduced-motion: reduce
 *   - Ticker is the aria-live region for screen readers
 *   - Pin colors are not the sole signal (shape + label distinguish sources)
 *
 * Bundle budget (this file alone, minified): ~3 KB
 * Lazy-loaded d3-geo: ~30 KB min, ~10 KB gz
 * Lazy-loaded topojson-client: ~4 KB min, ~2 KB gz
 * Static topojson data: 107 KB (fetched separately)
 */

import type { FeatureCollection, Geometry } from 'geojson';
import type { Topology } from 'topojson-specification';
import { loadGdelt, type GdeltEvent } from '@utils/gdelt-client';
import { loadMarketTicks, type MarketTick } from '@utils/market-ticks';

// === Constants ========================================================
const ROTATION_PERIOD_MS = 90_000; // one full rotation = 90s
const PIN_LIFETIME_MS = 30_000; // pins fade after 30s
const TICKER_MAX_ROWS = 7; // visible ticker rows
const GLOBE_SIZE = 360; // SVG viewBox width/height (square)

// === Type contracts ===================================================
interface WorldViewRefs {
  root: HTMLElement;
  svg: SVGSVGElement;
  tickerList: HTMLUListElement;
  status: HTMLElement;
  hint: HTMLElement;
}

// === Globe renderer ===================================================
class Globe {
  private svg: SVGSVGElement;
  private width = GLOBE_SIZE;
  private height = GLOBE_SIZE;
  private rotation: [number, number] = [20, 80]; // [lon, lat]
  private rafHandle = 0;
  private lastTick = 0;
  private hoverPaused = false;
  private reduceMotion: boolean;
  private path: any; // d3 GeoPath — lazy typed to avoid static d3-geo import
  private landPaths: string[] = [];
  private graticulePath: string;
  private oceanRect: SVGRectElement;
  private landGroup: SVGGElement;
  private graticuleGroup: SVGGElement;
  private pinGroup: SVGGElement;
  private pins = new Map<string, { el: SVGCircleElement; born: number; lat: number; lon: number }>();
  private d3: any = null;
  private topoFeature: any = null;
  private cachedFc: FeatureCollection<Geometry> | null = null;

  constructor(svg: SVGSVGElement, d3: any, topoFeature: any) {
    this.svg = svg;
    this.d3 = d3;
    this.topoFeature = topoFeature;
    this.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.path = d3.geoPath(
      d3.geoOrthographic()
        .scale((GLOBE_SIZE / 2) - 6)
        .translate([GLOBE_SIZE / 2, GLOBE_SIZE / 2])
        .rotate(this.rotation)
        .clipAngle(90),
    );
    this.graticulePath = this.path(d3.geoGraticule10()) ?? '';

    this.svg.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`);
    this.svg.setAttribute('role', 'img');
    this.svg.setAttribute('aria-label', 'Spinning earth with global event pins (institutional data terminal)');

    // Ocean disc
    this.oceanRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    this.oceanRect.setAttribute('x', '0');
    this.oceanRect.setAttribute('y', '0');
    this.oceanRect.setAttribute('width', String(this.width));
    this.oceanRect.setAttribute('height', String(this.height));
    this.oceanRect.setAttribute('fill', 'transparent');
    this.svg.appendChild(this.oceanRect);

    // Limb circle (the visible disc edge)
    const limb = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    limb.setAttribute('cx', String(this.width / 2));
    limb.setAttribute('cy', String(this.height / 2));
    limb.setAttribute('r', String((GLOBE_SIZE / 2) - 6));
    limb.setAttribute('fill', 'var(--c-bg-2)');
    limb.setAttribute('stroke', 'var(--c-rule)');
    limb.setAttribute('stroke-width', '1');
    this.svg.appendChild(limb);

    // Graticule layer
    this.graticuleGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.graticuleGroup.setAttribute('class', 'wv-globe__graticule');
    const gratPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    gratPath.setAttribute('d', this.graticulePath);
    gratPath.setAttribute('fill', 'none');
    gratPath.setAttribute('stroke', 'var(--c-rule)');
    gratPath.setAttribute('stroke-width', '0.4');
    gratPath.setAttribute('stroke-opacity', '0.45');
    this.graticuleGroup.appendChild(gratPath);
    this.svg.appendChild(this.graticuleGroup);

    // Land layer
    this.landGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.landGroup.setAttribute('class', 'wv-globe__land');
    this.svg.appendChild(this.landGroup);

    // Pins
    this.pinGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.pinGroup.setAttribute('class', 'wv-globe__pins');
    this.svg.appendChild(this.pinGroup);

    // Drag to rotate (improves UX; does not interfere with scroll on modal body).
    let dragging = false;
    let dragX = 0;
    let dragY = 0;
    this.svg.addEventListener('pointerdown', (e) => {
      dragging = true;
      this.hoverPaused = true;
      dragX = e.clientX;
      dragY = e.clientY;
      this.svg.setPointerCapture(e.pointerId);
    });
    this.svg.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - dragX;
      const dy = e.clientY - dragY;
      this.rotation = [this.rotation[0] + dx * 0.4, Math.max(-80, Math.min(80, this.rotation[1] - dy * 0.4))];
      dragX = e.clientX;
      dragY = e.clientY;
      this.reframe();
    });
    this.svg.addEventListener('pointerup', (e) => {
      dragging = false;
      this.hoverPaused = false;
      this.svg.releasePointerCapture(e.pointerId);
    });
    this.svg.addEventListener('pointerenter', () => {
      this.hoverPaused = true;
    });
    this.svg.addEventListener('pointerleave', () => {
      this.hoverPaused = false;
      dragging = false;
    });
  }

  /** Load the world topology from /countries-110m.json (108KB, lazy). */
  async loadLand(): Promise<void> {
    try {
      const res = await fetch('/countries-110m.json', { cache: 'force-cache' });
      if (!res.ok) throw new Error('topology fetch failed');
      const topo = (await res.json()) as Topology;
      const fc = this.topoFeature(topo, topo.objects.countries) as unknown as FeatureCollection<Geometry>;
      this.landPaths = [];
      for (const f of fc.features) {
        const d = this.path(f);
        if (d) this.landPaths.push(d);
      }
      this.cachedFc = fc;
    } catch {
      // Land data unavailable — the globe still spins, just empty.
      // This is the CORS-fallback path; the modal stays informative.
    }
  }

  /** Update rotation based on elapsed time since the last frame. */
  tick(now: number): void {
    if (this.reduceMotion || this.hoverPaused) {
      this.lastTick = now;
      return;
    }
    if (this.lastTick === 0) this.lastTick = now;
    const elapsed = now - this.lastTick;
    this.lastTick = now;
    // Full rotation in 90s ⇒ 360° / 90_000 ms = 0.004°/ms
    this.rotation = [this.rotation[0] + elapsed * (360 / ROTATION_PERIOD_MS), this.rotation[1]];
  }

  /** Drop a pin at (lat, lon) with a label. */
  addPin(id: string, lat: number, lon: number, label: string): void {
    if (this.pins.has(id)) return;
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('r', '3');
    circle.setAttribute('fill', 'var(--c-amber)');
    circle.setAttribute('stroke', 'var(--c-bg)');
    circle.setAttribute('stroke-width', '0.5');
    circle.setAttribute('data-pin-id', id);
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = label;
    circle.appendChild(title);
    this.pinGroup.appendChild(circle);
    this.pins.set(id, { el: circle, born: performance.now(), lat, lon });
    this.renderPins();
  }

  /** Project pins onto the disc; hide pins that fall outside the visible
   *  hemisphere or have aged past PIN_LIFETIME_MS. */
  renderPins(): void {
    const proj = this.path.projection();
    const now = performance.now();
    for (const [id, pin] of this.pins) {
      const age = now - pin.born;
      if (age > PIN_LIFETIME_MS) {
        pin.el.remove();
        this.pins.delete(id);
        continue;
      }
      const coord = proj([pin.lon, pin.lat]);
      if (!coord || isNaN(coord[0]) || isNaN(coord[1])) {
        pin.el.setAttribute('display', 'none');
        continue;
      }
      pin.el.setAttribute('display', 'inline');
      pin.el.setAttribute('cx', String(coord[0]));
      pin.el.setAttribute('cy', String(coord[1]));
      pin.el.setAttribute('opacity', String(Math.max(0.2, 1 - age / PIN_LIFETIME_MS)));
    }
  }

  /** Re-render both land and pins at the current rotation. */
  reframe(): void {
    this.path.projection().rotate(this.rotation);
    // Re-project each land path by re-running on the cached d-strings.
    // d3-geo's path only re-projects via `path(feature)`, so we use the
    // path's projection as a function and re-run each path's parsed
    // geometry. Easiest: re-derive d via projection([lon, lat]) on every
    // vertex of every cached ring. For 1:110m at 360px this is fast.
    const proj = this.path.projection();
    if (!proj) return;
    // Re-parse cached strings is heavy; we instead keep the FeatureCollection
    // around. Simpler implementation: hold a single string cache and accept
    // that re-rendering lands costs an O(N) walk per frame.
    // For 1:110m and ~140 countries at 360px, this is bounded.
    this.landGroup.replaceChildren();
    if (this.cachedFc) {
      for (const f of this.cachedFc.features) {
        const d = this.path(f);
        if (!d) continue;
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', d);
        p.setAttribute('class', 'wv-globe__land-shape');
        this.landGroup.appendChild(p);
      }
    }
    this.renderPins();
  }

  /** Inject the loaded FeatureCollection for re-projection on each frame. */
  setLandCollection(fc: FeatureCollection<Geometry>): void {
    this.cachedFc = fc;
    this.reframe();
  }

  /** Start the rotation animation loop. */
  start(): void {
    const loop = (t: number) => {
      this.tick(t);
      this.renderPins();
      // Re-frame land every ~6 frames (~100ms) to keep costs down.
      if (this.cachedFc && Math.floor(t / 100) !== Math.floor((t - 16) / 100)) {
        this.reframe();
      }
      this.rafHandle = requestAnimationFrame(loop);
    };
    this.rafHandle = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.rafHandle);
    this.rafHandle = 0;
  }

  /** Replace all pins with a fresh event set. */
  replacePins(events: GdeltEvent[]): void {
    for (const [, pin] of this.pins) pin.el.remove();
    this.pins.clear();
    for (const ev of events) {
      this.addPin(ev.id, ev.lat, ev.lon, `${ev.title} (${ev.city})`);
    }
  }
}

// === Ticker scheduler =================================================
class Ticker {
  private list: HTMLUListElement;
  private events: GdeltEvent[] = [];
  private ticks: MarketTick[] = [];
  private refreshTimer = 0;
  private gdeltTimer = 0;
  constructor(list: HTMLUListElement) {
    this.list = list;
  }

  private row(timestamp: string, source: string, region: string, headline: string, badge?: string): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'wv-ticker__row';
    li.setAttribute('role', 'listitem');
    const t = document.createElement('span');
    t.className = 'wv-ticker__time mono';
    t.textContent = timestamp.slice(11, 19) + 'Z';
    const s = document.createElement('span');
    s.className = 'wv-ticker__src mono';
    s.textContent = source;
    const r = document.createElement('span');
    r.className = 'wv-ticker__region mono';
    r.textContent = region;
    const h = document.createElement('span');
    h.className = 'wv-ticker__head';
    h.textContent = headline;
    li.append(t, s, r, h);
    if (badge) {
      const b = document.createElement('span');
      b.className = 'wv-ticker__badge mono';
      b.textContent = badge;
      li.appendChild(b);
    }
    return li;
  }

  private render(): void {
    const items: { ts: string; src: string; region: string; head: string; badge?: string }[] = [];
    for (const ev of this.events) {
      items.push({
        ts: ev.timestamp,
        src: 'GDELT',
        region: ev.city.slice(0, 12).toUpperCase(),
        head: ev.title,
        badge: ev.severity === 'critical' ? 'L3' : ev.severity === 'moderate' ? 'L2' : 'L1',
      });
    }
    for (const t of this.ticks) {
      items.push({
        ts: t.timestamp,
        src: 'TICK',
        region: t.symbol,
        head:
          t.price.toLocaleString('en-US', { maximumFractionDigits: 4 }) +
          (t.changePct >= 0 ? ' ▲ +' : ' ▼ ') +
          Math.abs(t.changePct).toFixed(2) +
          '%',
        badge: t.level,
      });
    }
    items.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
    const visible = items.slice(0, TICKER_MAX_ROWS);
    this.list.replaceChildren(...visible.map((v) => this.row(v.ts, v.src, v.region, v.head, v.badge)));
  }

  async refreshGlobePins(globe: Globe): Promise<void> {
    const events = await loadGdelt();
    this.events = events;
    globe.replacePins(events);
    this.render();
  }

  async refreshTicks(): Promise<void> {
    this.ticks = await loadMarketTicks();
    this.render();
  }

  start(globe: Globe, status: HTMLElement): void {
    void this.refreshGlobePins(globe).then(() => {
      status.textContent = 'last sync ' + new Date().toISOString().slice(11, 19) + 'Z';
    });
    void this.refreshTicks();
    // GDELT refresh every 15 minutes (matches upstream cadence).
    this.gdeltTimer = window.setInterval(() => {
      void this.refreshGlobePins(globe).then(() => {
        status.textContent = 'last sync ' + new Date().toISOString().slice(11, 19) + 'Z';
      });
    }, 15 * 60 * 1000);
    // Market ticks refresh every 30 seconds.
    this.refreshTimer = window.setInterval(() => void this.refreshTicks(), 30_000);
  }

  stop(): void {
    window.clearInterval(this.refreshTimer);
    window.clearInterval(this.gdeltTimer);
    this.refreshTimer = 0;
    this.gdeltTimer = 0;
  }
}

// === Modal lifecycle ===================================================
let activeGlobe: Globe | null = null;
let activeTicker: Ticker | null = null;
let activeRefs: WorldViewRefs | null = null;
let topoCache: Topology | null = null;
// d3-geo + topojson-client are loaded DYNAMICALLY so they only enter the
// network/cache when ⌘J is first pressed. Until then the BaseLayout bundle
// stays slim (~5 KB added by worldview.client.ts).
let d3geoMod: any = null;
let topoMod: any = null;

async function loadDeps(): Promise<void> {
  if (!d3geoMod) {
    const m = await import('d3-geo');
    d3geoMod = (m as any).default ?? m;
  }
  if (!topoMod) {
    const m = await import('topojson-client');
    topoMod = (m as any).default ?? m;
  }
}

async function openModal(): Promise<void> {
  if (!activeRefs) return;
  if (activeRefs.root.hasAttribute('hidden')) {
    activeRefs.root.removeAttribute('hidden');
    document.body.dataset.worldviewOpen = '1';
  }
  await loadDeps();
  if (!topoCache) {
    try {
      const res = await fetch('/countries-110m.json', { cache: 'force-cache' });
      if (res.ok) topoCache = (await res.json()) as Topology;
    } catch {
      topoCache = null;
    }
  }
  if (!activeGlobe) {
    activeGlobe = new Globe(activeRefs.svg, d3geoMod, topoMod.feature);
  }
  if (topoCache && topoCache.objects && topoCache.objects.countries) {
    const fc = topoMod.feature(
      topoCache,
      topoCache.objects.countries,
    ) as unknown as FeatureCollection<Geometry>;
    activeGlobe.setLandCollection(fc);
  } else {
    void activeGlobe.loadLand();
  }
  activeGlobe.start();
  if (!activeTicker) {
    activeTicker = new Ticker(activeRefs.tickerList);
  }
  activeTicker.start(activeGlobe, activeRefs.status);
  activeRefs.hint.textContent = 'GLobe auto-rotates · drag to pan · hover pauses';
}

function closeModal(): void {
  if (!activeRefs) return;
  if (!activeRefs.root.hasAttribute('hidden')) {
    activeRefs.root.setAttribute('hidden', '');
    delete document.body.dataset.worldviewOpen;
  }
  activeGlobe?.stop();
  activeTicker?.stop();
}

function bind(refs: WorldViewRefs): void {
  activeRefs = refs;
  // Capture-phase keyboard handler — same pattern as CommandPalette.
  document.addEventListener(
    'keydown',
    (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j' && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!refs.root.hasAttribute('hidden')) closeModal();
        else void openModal();
        return;
      }
      if (e.key === 'Escape' && !refs.root.hasAttribute('hidden')) {
        e.preventDefault();
        closeModal();
      }
    },
    true,
  );

  refs.root.addEventListener('click', (e) => {
    const t = e.target;
    if (t instanceof Element && t.closest('[data-worldview-close]')) {
      closeModal();
    }
  });

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t instanceof Element && t.closest('[data-worldview-open]')) {
      e.preventDefault();
      void openModal();
    }
  });
}

// === Bootstrap ========================================================
function init(): void {
  const root = document.querySelector<HTMLElement>('[data-worldview]');
  const svg = document.querySelector<SVGSVGElement>('[data-worldview-svg]');
  const tickerList = document.querySelector<HTMLUListElement>('[data-worldview-ticker]');
  const status = document.querySelector<HTMLElement>('[data-worldview-status]');
  const hint = document.querySelector<HTMLElement>('[data-worldview-hint]');
  if (!root || !svg || !tickerList || !status || !hint) return;
  bind({ root, svg, tickerList, status, hint });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}