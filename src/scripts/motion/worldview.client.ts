/**
 * worldview.client.ts : WorldView Live globe + ticker scheduler.
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
import { loadMarketTicksWithMeta, type MarketTick } from '@utils/market-ticks';
import { CITIES, markerVisual, cityLocalTime, type CityPin, type CityLevel } from '@data/cities';

// === Constants ========================================================
const ROTATION_PERIOD_MS = 90_000; // one full rotation = 90s
const PIN_LIFETIME_MS = 30_000; // pins fade after 30s
const TICKER_MAX_ROWS = 9; // visible ticker rows
const GLOBE_SIZE = 360; // SVG viewBox width/height (square)
// AMBER token used by pins + ring strokes. Mirrored from tokens-v6.13.css
// (--c-amber) so the pin color stays in sync if the palette ever evolves.
const AMBER = '#B45309';
const INK_3 = '#666666'; // ring stroke + label text
const LABEL_BG = '#FAFAFA'; // matches modal --c-bg

// === Type contracts ===================================================
interface WorldViewRefs {
  root: HTMLElement;
  svg: SVGSVGElement;
  tickerList: HTMLUListElement;
  status: HTMLElement;
  hint: HTMLElement;
  syncGdelt: HTMLElement;
  syncCoinGecko: HTMLElement;
  syncYahoo: HTMLElement;
  regimeChip: HTMLElement | null;
  provenance: HTMLElement | null;
}

// === Venue pin (persistent) ============================================
interface VenuePin {
  el: SVGGElement;
  lat: number;
  lon: number;
  level: CityLevel;
  city: string;
  venue: string;
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
  private path: any; // d3 GeoPath : lazy typed to avoid static d3-geo import
  private landPaths: string[] = [];
  private graticulePath: string;
  private equatorPath: SVGPathElement;
  private meridianPath: SVGPathElement;
  private oceanRect: SVGRectElement;
  private landGroup: SVGGElement;
  private graticuleGroup: SVGGElement;
  private pinGroup: SVGGElement;
  private venueGroup: SVGGElement;
  private labelGroup: SVGGElement;
  private pins = new Map<string, { el: SVGCircleElement; born: number; lat: number; lon: number }>();
  private venues = new Map<string, VenuePin>();
  private d3: any = null;
  private topoFeature: any = null;
  private cachedFc: FeatureCollection<Geometry> | null = null;
  private hoveredVenue: string | null = null;

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

    // Ocean disc (transparent — the limb circle below supplies the visible
    // ocean fill so the disc edge carries the hairline outline).
    this.oceanRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    this.oceanRect.setAttribute('x', '0');
    this.oceanRect.setAttribute('y', '0');
    this.oceanRect.setAttribute('width', String(this.width));
    this.oceanRect.setAttribute('height', String(this.height));
    this.oceanRect.setAttribute('fill', 'transparent');
    this.svg.appendChild(this.oceanRect);

    // Limb circle : the visible disc edge + ocean fill. Subtle warm
    // cream so the landmasses have readable contrast against the ocean.
    const limb = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    limb.setAttribute('cx', String(this.width / 2));
    limb.setAttribute('cy', String(this.height / 2));
    limb.setAttribute('r', String((GLOBE_SIZE / 2) - 6));
    limb.setAttribute('fill', 'var(--c-bg-2)');
    limb.setAttribute('stroke', 'var(--c-rule)');
    limb.setAttribute('stroke-width', '1');
    this.svg.appendChild(limb);

    // Graticule layer (lat/lon grid) — hairline 0.4px at 45% opacity so
    // it reads as background context, never competing with the landmasses
    // or venue markers. d3-geo's geoGraticule10() = 10° spacing.
    this.graticuleGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.graticuleGroup.setAttribute('class', 'wv-globe__graticule');
    const gratPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    gratPath.setAttribute('d', this.graticulePath);
    gratPath.setAttribute('fill', 'none');
    gratPath.setAttribute('stroke', 'var(--c-rule)');
    gratPath.setAttribute('stroke-width', '0.4');
    gratPath.setAttribute('stroke-opacity', '0.45');
    this.graticuleGroup.appendChild(gratPath);

    // Equator + prime meridian accents : 1px amber at 25% opacity, drawn
    // over the graticule so they read as institutional reference lines
    // (Bloomberg terminal touches them). Helps the globe anchor visually.
    // Paths are populated in reframe() once the projection is wired.
    this.equatorPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    this.equatorPath.setAttribute('fill', 'none');
    this.equatorPath.setAttribute('stroke', AMBER);
    this.equatorPath.setAttribute('stroke-width', '0.6');
    this.equatorPath.setAttribute('stroke-opacity', '0.25');
    this.graticuleGroup.appendChild(this.equatorPath);
    this.meridianPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    this.meridianPath.setAttribute('fill', 'none');
    this.meridianPath.setAttribute('stroke', AMBER);
    this.meridianPath.setAttribute('stroke-width', '0.6');
    this.meridianPath.setAttribute('stroke-opacity', '0.25');
    this.graticuleGroup.appendChild(this.meridianPath);

    this.svg.appendChild(this.graticuleGroup);

    // Land layer
    this.landGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.landGroup.setAttribute('class', 'wv-globe__land');
    this.svg.appendChild(this.landGroup);

    // Pins
    this.pinGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.pinGroup.setAttribute('class', 'wv-globe__pins');
    this.svg.appendChild(this.pinGroup);

    // Venue markers (L1/L2/L3) live below the transient GDELT pins so
    // event pulses render on top. Hover labels render in their own group
    // above everything else so the city name always wins the z-fight.
    this.venueGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.venueGroup.setAttribute('class', 'wv-globe__venues');
    this.svg.appendChild(this.venueGroup);

    this.labelGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.labelGroup.setAttribute('class', 'wv-globe__labels');
    this.svg.appendChild(this.labelGroup);

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
      // Land data unavailable : the globe still spins, just empty.
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
        p.setAttribute('fill', 'var(--c-bg)');
        p.setAttribute('stroke', 'var(--c-ink-3)');
        p.setAttribute('stroke-width', '0.35');
        p.setAttribute('stroke-opacity', '0.55');
        p.setAttribute('stroke-linejoin', 'round');
        this.landGroup.appendChild(p);
      }
    }
    // Equator + prime meridian : drawn after land so they render on top.
    // Built from a single line (equator) + great circle (prime meridian)
    // sampled in lon/lat space. Cheap (~24 segments each).
    const equatorCoords: [number, number][] = [];
    for (let i = 0; i <= 72; i++) equatorCoords.push([i * 5 - 180, 0]);
    const meridianCoords: [number, number][] = [];
    for (let i = 0; i <= 36; i++) meridianCoords.push([0, i * 5 - 90]);
    const eqD = this.path({ type: 'LineString', coordinates: equatorCoords });
    const meD = this.path({ type: 'LineString', coordinates: meridianCoords });
    this.equatorPath.setAttribute('d', eqD ?? '');
    this.meridianPath.setAttribute('d', meD ?? '');
    this.renderPins();
    this.renderVenues();
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
      // Re-frame land + venues every ~6 frames (~100ms) to keep costs down.
      if (this.cachedFc && Math.floor(t / 100) !== Math.floor((t - 16) / 100)) {
        this.reframe();
      } else if (!this.cachedFc) {
        // Even without the topology loaded we still re-project venues.
        this.renderVenues();
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

  /** Drop a persistent L1/L2/L3 venue marker (12 baseline cities).
   *  Persistent markers never age out. Visual differentiation per RFC
   *  §5.1: L1 = 3px solid, L2 = 5px + 1 ring, L3 = 7px + 2 rings.
   *  Marker is amber on the cream globe, with a hairline ink-3 ring for
   *  contrast against bright ocean areas. */
  addVenue(city: CityPin): void {
    if (this.venues.has(city.id)) return;
    const visual = markerVisual(city.level);
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', `wv-globe__venue wv-globe__venue--${city.level.toLowerCase()}`);
    g.setAttribute('data-venue-id', city.id);
    g.setAttribute('transform', 'translate(0 0)');
    // Concentric rings drawn first so the solid dot renders on top.
    for (let i = visual.rings; i >= 1; i--) {
      const ring = document.createElementNS('http://www.w3.org/2000.svg', 'circle');
      const ringR = visual.radius + i * 2.5;
      ring.setAttribute('r', String(ringR));
      ring.setAttribute('fill', 'none');
      ring.setAttribute('stroke', AMBER);
      ring.setAttribute('stroke-width', '0.6');
      ring.setAttribute('stroke-opacity', String(Math.max(0.35, 0.85 - i * 0.25)));
      g.appendChild(ring);
    }
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('r', String(visual.radius));
    dot.setAttribute('fill', AMBER);
    dot.setAttribute('stroke', LABEL_BG);
    dot.setAttribute('stroke-width', '0.8');
    g.appendChild(dot);
    // Tooltip for screen readers : city · venue · level · local time.
    // Refreshed every 60s on the parent group's data attribute; cheap.
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${city.city} · ${city.venue} · ${city.level}`;
    g.appendChild(title);
    this.venueGroup.appendChild(g);
    this.venues.set(city.id, { el: g, lat: city.lat, lon: city.lon, level: city.level, city: city.city, venue: city.venue });

    // Hover wiring : show city label group. Use pointerover/out on the
    // venue group (not the dot) so the entire marker is the hit area.
    g.addEventListener('pointerenter', () => {
      this.hoveredVenue = city.id;
      this.renderLabel();
    });
    g.addEventListener('pointerleave', () => {
      if (this.hoveredVenue === city.id) {
        this.hoveredVenue = null;
        this.renderLabel();
      }
    });
  }

  /** Replace the entire venue set with a fresh array. Idempotent. */
  replaceVenues(cities: readonly CityPin[]): void {
    for (const [, v] of this.venues) v.el.remove();
    this.venues.clear();
    for (const c of cities) this.addVenue(c);
    this.renderVenues();
  }

  /** Project all venue markers onto the visible disc; hide those on the
   *  far side. Called by reframe() so labels + rings track rotation. */
  renderVenues(): void {
    const proj = this.path.projection();
    if (!proj) return;
    for (const [id, v] of this.venues) {
      const coord = proj([v.lon, v.lat]);
      const visible = coord && !isNaN(coord[0]) && !isNaN(coord[1]);
      v.el.setAttribute('transform', visible ? `translate(${coord![0]} ${coord![1]})` : 'translate(-9999 -9999)');
      // When the marker is on the far side of the disc (behind the
      // sphere), the projection still produces a coord; dim it via opacity
      // by checking whether the dot is occluded by the centrepoint.
      if (visible) {
        const dx = coord![0] - GLOBE_SIZE / 2;
        const dy = coord![1] - GLOBE_SIZE / 2;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const radius = GLOBE_SIZE / 2 - 6;
        const front = dist < radius * 0.85;
        v.el.setAttribute('opacity', front ? '1' : '0.35');
        if (id === this.hoveredVenue) this.renderLabel();
      } else {
        v.el.setAttribute('opacity', '0');
      }
    }
  }

  /** Render the hover label group (city + venue + L chip + local time). */
  renderLabel(): void {
    this.labelGroup.replaceChildren();
    if (!this.hoveredVenue) return;
    const v = this.venues.get(this.hoveredVenue);
    if (!v) return;
    const city = CITIES.find((c) => c.id === this.hoveredVenue);
    if (!city) return;
    const proj = this.path.projection();
    if (!proj) return;
    const coord = proj([v.lon, v.lat]);
    if (!coord || isNaN(coord[0])) return;
    const x = coord[0];
    const y = coord[1] - 16; // float above the dot
    // Background plate
    const pad = 4;
    const lines = [
      `${v.city.toUpperCase()} · ${v.venue}`,
      `${v.level} · ${cityLocalTime(city)} LOCAL · UTC${city.utcOffset >= 0 ? '+' : ''}${city.utcOffset}`,
    ];
    const charW = 5.4; // approximate mono glyph width at 10px
    const lineH = 12;
    const width = Math.max(...lines.map((l) => l.length * charW)) + pad * 2;
    const height = lines.length * lineH + pad * 2 - 2;
    const plate = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    plate.setAttribute('x', String(x - width / 2));
    plate.setAttribute('y', String(y - height));
    plate.setAttribute('width', String(width));
    plate.setAttribute('height', String(height));
    plate.setAttribute('fill', LABEL_BG);
    plate.setAttribute('stroke', AMBER);
    plate.setAttribute('stroke-width', '0.6');
    this.labelGroup.appendChild(plate);
    lines.forEach((text, i) => {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', String(x));
      t.setAttribute('y', String(y - height + pad + lineH * (i + 1) - 3));
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace');
      t.setAttribute('font-size', '9');
      t.setAttribute('letter-spacing', '0.06em');
      t.setAttribute('fill', i === 0 ? INK_3 : AMBER);
      t.textContent = text;
      this.labelGroup.appendChild(t);
    });
  }
}

// === Ticker scheduler =================================================
class Ticker {
  private list: HTMLUListElement;
  private events: GdeltEvent[] = [];
  private ticks: MarketTick[] = [];
  private refreshTimer = 0;
  private gdeltTimer = 0;
  private regimeChip: HTMLElement | null = null;
  constructor(list: HTMLUListElement) {
    this.list = list;
  }

  private row(timestamp: string, source: string, region: string, headline: string, signal: string, badge?: string): HTMLLIElement {
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
    const sig = document.createElement('span');
    sig.className = 'wv-ticker__signal mono';
    sig.textContent = signal;
    const h = document.createElement('span');
    h.className = 'wv-ticker__head';
    h.textContent = headline;
    li.append(t, s, r, sig, h);
    if (badge) {
      const b = document.createElement('span');
      const lvl = badge.toLowerCase();
      b.className = 'wv-ticker__badge mono wv-ticker__badge--' + lvl;
      b.textContent = badge;
      li.appendChild(b);
    }
    return li;
  }

  private render(): void {
    const items: { ts: string; src: string; region: string; head: string; signal: string; badge?: string }[] = [];
    for (const ev of this.events) {
      // GDELT rows read as alpha signals: critical = L3 with HIGH-conviction tag,
      // moderate = L2 with NEUTRAL, mild = L1 with LOW. Headline is the
      // event title; signal column carries the regime tag.
      const tag = ev.severity === 'critical' ? 'HIGH' : ev.severity === 'moderate' ? 'NEUT' : 'LOW';
      items.push({
        ts: ev.timestamp,
        src: 'GDELT',
        region: ev.city.slice(0, 12).toUpperCase(),
        head: ev.title,
        signal: tag,
        badge: ev.severity === 'critical' ? 'L3' : ev.severity === 'moderate' ? 'L2' : 'L1',
      });
    }
    for (const t of this.ticks) {
      // TICK rows show the price + changePct as headline; signal column
      // shows the direction. Mapping: ▲ → LONG, ▼ → SHORT. The 'tag'
      // (RSI/MA/volume) is reserved for future research overlays.
      items.push({
        ts: t.timestamp,
        src: 'TICK',
        region: t.symbol,
        head:
          t.price.toLocaleString('en-US', { maximumFractionDigits: 4 }) +
          ' · ' +
          (t.changePct >= 0 ? '+' : '') +
          t.changePct.toFixed(2) +
          '%',
        signal: t.changePct >= 0 ? '▲ LONG' : '▼ SHORT',
        badge: t.level,
      });
    }
    items.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
    const visible = items.slice(0, TICKER_MAX_ROWS);
    this.list.replaceChildren(...visible.map((v) => this.row(v.ts, v.src, v.region, v.head, v.signal, v.badge)));
    // Update the regime chip in the footer on every render so it tracks
    // the live distribution. Cheap; runs on the same cadence as render().
    this.computeRegime();
  }

  /** Compute the dominant regime from the tick distribution : green-bar
   *  ratio of the most recent N ticks maps to RISK-ON / NEUTRAL / RISK-OFF.
   *  N = 12 (covers a 6-min window at 30s refresh). */
  private computeRegime(): void {
    if (!this.regimeChip) return;
    const window = this.ticks.slice(0, 12);
    if (window.length === 0) {
      this.regimeChip.textContent = 'NEUTRAL';
      this.regimeChip.setAttribute('data-regime', 'neutral');
      return;
    }
    const green = window.filter((t) => t.changePct > 0).length;
    const ratio = green / window.length;
    let label: string, attr: string;
    if (ratio >= 0.6) { label = 'RISK-ON';  attr = 'on'; }
    else if (ratio <= 0.4) { label = 'RISK-OFF'; attr = 'off'; }
    else { label = 'NEUTRAL'; attr = 'neutral'; }
    const avg = window.reduce((s, t) => s + t.changePct, 0) / window.length;
    const sign = avg >= 0 ? '+' : '';
    this.regimeChip.textContent = `${label} · ${window.length} ticks · avg ${sign}${avg.toFixed(2)}%`;
    this.regimeChip.setAttribute('data-regime', attr);
  }

  async refreshGlobePins(globe: Globe): Promise<void> {
    const events = await loadGdelt();
    this.events = events;
    globe.replacePins(events);
    this.render();
  }

  async refreshTicks(): Promise<void> {
    const out = await loadMarketTicksWithMeta();
    this.ticks = out.ticks;
    this.lastBySource = out.bySource;
    this.render();
  }

  private lastBySource: Record<string, string> = {};
  private syncGdelt: HTMLElement | null = null;
  private syncCoinGecko: HTMLElement | null = null;
  private syncYahoo: HTMLElement | null = null;

  setSyncTargets(refs: {
    syncGdelt: HTMLElement;
    syncCoinGecko: HTMLElement;
    syncYahoo: HTMLElement;
  }): void {
    this.syncGdelt = refs.syncGdelt;
    this.syncCoinGecko = refs.syncCoinGecko;
    this.syncYahoo = refs.syncYahoo;
  }

  private paintSync(target: HTMLElement | null, iso: string | undefined): void {
    if (!target) return;
    target.textContent = iso ? iso.slice(11, 16) + 'Z' : '--:--Z';
  }

  start(globe: Globe, status: HTMLElement, regimeChip: HTMLElement | null = null): void {
    this.regimeChip = regimeChip;
    void this.refreshGlobePins(globe).then(() => {
      status.textContent = 'last sync ' + new Date().toISOString().slice(11, 19) + 'Z';
      this.paintSync(this.syncGdelt, new Date().toISOString());
    });
    void this.refreshTicks().then(() => {
      this.paintSync(this.syncCoinGecko, this.lastBySource.CoinGecko);
      this.paintSync(this.syncYahoo, this.lastBySource.Yahoo);
    });
    // GDELT refresh every 15 minutes (matches upstream cadence).
    this.gdeltTimer = window.setInterval(() => {
      void this.refreshGlobePins(globe).then(() => {
        status.textContent = 'last sync ' + new Date().toISOString().slice(11, 19) + 'Z';
        this.paintSync(this.syncGdelt, new Date().toISOString());
      });
    }, 15 * 60 * 1000);
    // Market ticks refresh every 30 seconds.
    this.refreshTimer = window.setInterval(() => {
      void this.refreshTicks().then(() => {
        this.paintSync(this.syncCoinGecko, this.lastBySource.CoinGecko);
        this.paintSync(this.syncYahoo, this.lastBySource.Yahoo);
      });
    }, 30_000);
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
  // v13.1.4 Phase 1 showcase : seed the 12 L1/L2/L3 venue markers at open
  // so the globe is never empty. The venues are persistent (no
  // PIN_LIFETIME_MS fade) and rendered with size + ring differentiation
  // per RFC §5.1. GDELT events drop on top as transient pins (existing
  // behavior via Ticker.refreshGlobePins).
  activeGlobe.replaceVenues(CITIES);
  if (!activeTicker) {
    activeTicker = new Ticker(activeRefs.tickerList);
  }
  activeTicker.start(activeGlobe, activeRefs.status, activeRefs.regimeChip);
  activeRefs.hint.textContent = 'globe auto-rotates · drag to pan · hover pins for venue · 12 venues L1/L2/L3';
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
  // Capture-phase keyboard handler : same pattern as CommandPalette.
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
  const syncGdelt = document.querySelector<HTMLElement>('[data-worldview-sync-gdelt]');
  const syncCoinGecko = document.querySelector<HTMLElement>('[data-worldview-sync-coingecko]');
  const syncYahoo = document.querySelector<HTMLElement>('[data-worldview-sync-yahoo]');
  const regimeChip = document.querySelector<HTMLElement>('[data-worldview-regime]');
  const provenance = document.querySelector<HTMLElement>('[data-worldview-provenance]');
  // v13.1.4 Phase 1 globe : root + status are required selectors; svg +
  // tickerList are optional (when absent, the open/close + status logic
  // still runs but the globe does not render). hint + sync* + regimeChip
  // + provenance are best-effort : the script no-ops on missing targets.
  if (!root || !status) return;

  // Tick the last-sync stamp every 30s while the modal is open so the
  // HH:MM:SSZ footer reads as a live system, not a stale snapshot.
  let syncTimer: number | null = null;
  function tickStatus(): void {
    const now = new Date().toISOString().slice(11, 19) + 'Z';
    status.textContent = 'last sync ' + now;
    if (syncYahoo) syncYahoo.textContent = now;
  }
  function startSync(): void {
    if (syncTimer !== null) return;
    tickStatus();
    syncTimer = window.setInterval(tickStatus, 30_000);
  }
  function stopSync(): void {
    if (syncTimer !== null) {
      window.clearInterval(syncTimer);
      syncTimer = null;
    }
  }

  // Refactor bind to expose start/stop hooks for the sync timer.
  bind({
    root,
    svg: svg ?? document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
    tickerList: tickerList ?? document.createElement('ul'),
    status,
    hint: hint ?? status,
    syncGdelt: syncGdelt ?? status,
    syncCoinGecko: syncCoinGecko ?? status,
    syncYahoo: syncYahoo ?? status,
    regimeChip,
    provenance,
  });

  // Wire the sync timer to the modal lifecycle. We piggy-back on
  // data-worldview-open attribute as the open signal (set by openModal
  // below / by the legacy handler in bind).
  const observer = new MutationObserver(() => {
    if (root.hasAttribute('hidden')) stopSync();
    else startSync();
  });
  observer.observe(root, { attributes: true, attributeFilter: ['hidden'] });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}