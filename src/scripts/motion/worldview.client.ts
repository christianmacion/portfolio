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

// v13.1.4 polish-4 : realistic Earth palette. Scene-local colors chosen
// to read as a Blue Marble view from space without crossing into
// halo/glow territory. Each value is muted enough to keep the
// institutional register (Bloomberg terminal Earth, not NASA infographic).
const OCEAN_DEEP = '#1B4A6B';
const OCEAN_SHALLOW = '#2D6A8E';
const LAND_TAN = '#A89968';
const LAND_GREEN = '#6B7B4A';
const COASTLINE = '#2A3540';
const BORDER_COLOR = '#1F2937'; // country borders (slightly darker than coast)
const LIMB_RIM = '#5A7A98';
const STAR_DIM = '#9CA3A8';
const DEEP_SPACE = '#0A1825';
// v13.1.4 polish-6 : country biome palette. Inspired by NASA Blue Marble
// casein-paint reading (no gradient, no glow). Each biome has 4-5 muted
// tones derived from the LAND_TAN base. ISO 3166-1 numeric codes per
// countries-110m.json topology. Unmapped countries fall through to LAND_TAN.
const COUNTRY_BIOME: Record<string, string> = {
  // Desert / arid — sandy tan
  '012': '#C9A876', '024': '#C9A876', '148': '#C9A876', '364': '#C9A876',
  '368': '#C9A876', '376': '#C9A876', '398': '#C9A876', '400': '#C9A876',
  '417': '#C9A876', '422': '#C9A876', '434': '#C9A876', '466': '#C9A876',
  '478': '#C9A876', '496': '#C9A876', '504': '#C9A876', '512': '#C9A876',
  '562': '#C9A876', '682': '#C9A876', '728': '#C9A876', '729': '#C9A876',
  '732': '#C9A876', '748': '#C9A876', '762': '#C9A876', '784': '#C9A876',
  '792': '#C9A876', '795': '#C9A876', '860': '#C9A876', '887': '#C9A876',
  // Tropical / forest — deep green (Amazon, Congo, SE Asia, Central America)
  '050': '#4A6B3A', '064': '#4A6B3A', '068': '#4A6B3A', '084': '#4A6B3A',
  '090': '#4A6B3A', '104': '#4A6B3A', '116': '#4A6B3A', '144': '#4A6B3A',
  '170': '#4A6B3A', '174': '#4A6B3A', '178': '#4A6B3A', '180': '#4A6B3A',
  '188': '#4A6B3A', '192': '#4A6B3A', '214': '#4A6B3A', '218': '#4A6B3A',
  '222': '#4A6B3A', '320': '#4A6B3A', '324': '#4A6B3A', '332': '#4A6B3A',
  '340': '#4A6B3A', '360': '#4A6B3A', '384': '#4A6B3A', '388': '#4A6B3A',
  '450': '#4A6B3A', '454': '#4A6B3A', '458': '#4A6B3A', '508': '#4A6B3A',
  '524': '#4A6B3A', '548': '#4A6B3A', '566': '#4A6B3A', '586': '#4A6B3A',
  '591': '#4A6B3A', '598': '#4A6B3A', '604': '#4A6B3A', '608': '#4A6B3A',
  '630': '#4A6B3A', '646': '#4A6B3A', '704': '#4A6B3A', '764': '#4A6B3A',
  '800': '#4A6B3A', '834': '#4A6B3A', '862': '#4A6B3A',
  // Boreal / taiga — bluish-green
  '124': '#5A6B5A', '246': '#5A6B5A', '578': '#5A6B5A', '643': '#5A6B5A',
  '752': '#5A6B5A',
  // Tundra / polar — light grey
  '304': '#C8C8C0', '352': '#C8C8C0',
  // Agricultural / temperate — olive
  '032': '#6B7B4A', '040': '#6B7B4A', '056': '#6B7B4A', '072': '#6B7B4A',
  '100': '#6B7B4A', '112': '#6B7B4A', '152': '#6B7B4A', '156': '#6B7B4A',
  '158': '#6B7B4A', '191': '#6B7B4A', '203': '#6B7B4A', '208': '#6B7B4A',
  '233': '#6B7B4A', '250': '#6B7B4A', '276': '#6B7B4A', '300': '#6B7B4A',
  '348': '#6B7B4A', '372': '#6B7B4A', '380': '#6B7B4A', '392': '#6B7B4A',
  '408': '#6B7B4A', '410': '#6B7B4A', '428': '#6B7B4A', '440': '#6B7B4A',
  '554': '#6B7B4A', '616': '#6B7B4A', '620': '#6B7B4A', '642': '#6B7B4A',
  '703': '#6B7B4A', '705': '#6B7B4A', '710': '#6B7B4A', '724': '#6B7B4A',
  '756': '#6B7B4A', '804': '#6B7B4A', '826': '#6B7B4A',
};

// v13.1.4 polish-6 : always-visible major cities. Pop-scaled dot size +
// label with backdrop. Digos + Dagupan are Owner's hometown accents.
// 38 cities cover the major continents; population drives visual hierarchy.
interface DisplayCity {
  name: string;
  lat: number;
  lon: number;
  pop: number; // millions
}
const DISPLAY_CITIES: readonly DisplayCity[] = [
  { name: 'NEW YORK', lat: 40.71, lon: -74.0, pop: 8.3 },
  { name: 'LOS ANGELES', lat: 34.05, lon: -118.24, pop: 4.0 },
  { name: 'CHICAGO', lat: 41.88, lon: -87.63, pop: 2.7 },
  { name: 'MEXICO CITY', lat: 19.43, lon: -99.13, pop: 9.2 },
  { name: 'TORONTO', lat: 43.65, lon: -79.38, pop: 2.9 },
  { name: 'LIMA', lat: -12.05, lon: -77.04, pop: 11.0 },
  { name: 'BOGOTA', lat: 4.71, lon: -74.07, pop: 11.0 },
  { name: 'SAO PAULO', lat: -23.55, lon: -46.63, pop: 22.4 },
  { name: 'BUENOS AIRES', lat: -34.6, lon: -58.38, pop: 15.4 },
  { name: 'SANTIAGO', lat: -33.45, lon: -70.67, pop: 6.8 },
  { name: 'CARACAS', lat: 10.48, lon: -66.9, pop: 3.2 },
  { name: 'LONDON', lat: 51.51, lon: -0.13, pop: 9.0 },
  { name: 'PARIS', lat: 48.86, lon: 2.35, pop: 2.2 },
  { name: 'BERLIN', lat: 52.52, lon: 13.4, pop: 3.7 },
  { name: 'MADRID', lat: 40.42, lon: -3.7, pop: 3.3 },
  { name: 'ROME', lat: 41.9, lon: 12.5, pop: 2.9 },
  { name: 'MOSCOW', lat: 55.76, lon: 37.62, pop: 12.5 },
  { name: 'ISTANBUL', lat: 41.01, lon: 28.98, pop: 15.5 },
  { name: 'CAIRO', lat: 30.04, lon: 31.24, pop: 20.9 },
  { name: 'LAGOS', lat: 6.52, lon: 3.38, pop: 14.4 },
  { name: 'NAIROBI', lat: -1.29, lon: 36.82, pop: 4.4 },
  { name: 'JOHANNESBURG', lat: -26.2, lon: 28.05, pop: 5.6 },
  { name: 'DUBAI', lat: 25.2, lon: 55.27, pop: 3.4 },
  { name: 'MUMBAI', lat: 19.08, lon: 72.88, pop: 20.4 },
  { name: 'DELHI', lat: 28.61, lon: 77.21, pop: 31.2 },
  { name: 'BANGKOK', lat: 13.76, lon: 100.5, pop: 10.5 },
  { name: 'SINGAPORE', lat: 1.35, lon: 103.82, pop: 5.7 },
  { name: 'HONG KONG', lat: 22.32, lon: 114.17, pop: 7.5 },
  { name: 'BEIJING', lat: 39.9, lon: 116.41, pop: 21.5 },
  { name: 'SHANGHAI', lat: 31.23, lon: 121.47, pop: 28.5 },
  { name: 'TOKYO', lat: 35.68, lon: 139.69, pop: 37.4 },
  { name: 'SEOUL', lat: 37.57, lon: 126.98, pop: 9.9 },
  { name: 'MANILA', lat: 14.6, lon: 120.98, pop: 1.8 },
  { name: 'DIGOS', lat: 6.74, lon: 125.36, pop: 0.2 },
  { name: 'DAGUPAN', lat: 16.04, lon: 120.34, pop: 0.2 },
  { name: 'SYDNEY', lat: -33.87, lon: 151.21, pop: 5.3 },
  { name: 'MELBOURNE', lat: -37.81, lon: 144.96, pop: 5.1 },
  { name: 'AUCKLAND', lat: -36.85, lon: 174.76, pop: 1.6 },
];

// v13.1.4 polish-6 : major country labels (text only, no dot). Centroid
// coordinates chosen so the label falls inside the country even at globe
// rotation extremes. 14 labels — enough to anchor continents without
// crowding the institutional register.
const COUNTRY_LABELS: ReadonlyArray<{ name: string; lat: number; lon: number }> = [
  { name: 'USA', lat: 39.5, lon: -98.5 },
  { name: 'CANADA', lat: 56.0, lon: -106.0 },
  { name: 'BRAZIL', lat: -14.2, lon: -51.9 },
  { name: 'RUSSIA', lat: 61.5, lon: 105.0 },
  { name: 'CHINA', lat: 35.0, lon: 104.0 },
  { name: 'INDIA', lat: 22.0, lon: 79.0 },
  { name: 'AUSTRALIA', lat: -25.0, lon: 133.0 },
  { name: 'EUROPE', lat: 50.0, lon: 9.0 },
  { name: 'AFRICA', lat: 0.0, lon: 20.0 },
  { name: 'SAUDI ARABIA', lat: 24.0, lon: 45.0 },
  { name: 'ARGENTINA', lat: -38.0, lon: -64.0 },
  { name: 'MEXICO', lat: 23.0, lon: -102.0 },
  { name: 'INDONESIA', lat: -2.0, lon: 118.0 },
  { name: 'GREENLAND', lat: 72.0, lon: -42.0 },
];

// === Type contracts ===================================================
interface WorldViewRefs {
  root: HTMLElement;
  svg: SVGSVGElement;
  canvas: HTMLCanvasElement;
  tickerList: HTMLUListElement;
  status: HTMLElement;
  hint: HTMLElement;
  syncGdelt: HTMLElement;
  syncCoinGecko: HTMLElement;
  syncBinance: HTMLElement;
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

// === Utilities =========================================================
/** Minimal HTML escape for the detail panel payload. Trusts the row's
 *  visible-text inputs (event titles from the GDELT cache, tick symbols
 *  from the market-ticks cache) and emits a safe string for innerHTML.
 *  Keeps the row interactive (innerHTML is much cheaper than building
 *  6 nested elements per render tick) without opening an XSS surface
 *  on the institutional register. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// === Globe renderer ===================================================
class Globe {
  private svg: SVGSVGElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private earthImage: HTMLImageElement | null = null;
  private earthImageData: ImageData | null = null;
  private textureLoaded = false;
  private textureRenderPending = true;
  private width = GLOBE_SIZE;
  private height = GLOBE_SIZE;
  private rotation: [number, number] = [20, 80]; // [lon, lat]
  private rafHandle = 0;
  private lastTick = 0;
  private hoverPaused = false;
  private reduceMotion: boolean;
  private path: any; // d3 GeoPath : lazy typed to avoid static d3-geo import
  private landPaths: string[] = [];
  private oceanRect: SVGRectElement;
  private landGroup: SVGGElement;
  private pinGroup: SVGGElement;
  private venueGroup: SVGGElement;
  private labelGroup: SVGGElement;
  private displayCityGroup: SVGGElement;
  private displayCityLabels: SVGGElement;
  private countryLabelGroup: SVGGElement;
  private pins = new Map<string, { el: SVGCircleElement; born: number; lat: number; lon: number }>();
  private venues = new Map<string, VenuePin>();
  private d3: any = null;
  private topoFeature: any = null;
  private cachedFc: FeatureCollection<Geometry> | null = null;
  private hoveredVenue: string | null = null;

  constructor(svg: SVGSVGElement, canvas: HTMLCanvasElement, d3: any, topoFeature: any) {
    this.svg = svg;
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
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
    this.svg.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`);
    this.svg.setAttribute('role', 'img');
    this.svg.setAttribute('aria-label', 'Spinning earth with global event pins (institutional data terminal)');

    // v13.1.4 polish-7 : NASA Blue Marble texture. Loaded async; once
    // available the renderer re-projects it onto the visible hemisphere
    // via d3.geoOrthographic.invert per frame. ImageData is cached so
    // pixel sampling is a flat array read (no canvas re-fetch per frame).
    this.earthImage = new Image();
    this.earthImage.crossOrigin = 'anonymous';
    this.earthImage.decoding = 'async';
    this.earthImage.onload = () => {
      if (!this.earthImage) return;
      const tmp = document.createElement('canvas');
      tmp.width = this.earthImage.naturalWidth;
      tmp.height = this.earthImage.naturalHeight;
      const tmpCtx = tmp.getContext('2d');
      if (!tmpCtx) return;
      tmpCtx.drawImage(this.earthImage, 0, 0);
      this.earthImageData = tmpCtx.getImageData(0, 0, tmp.width, tmp.height);
      this.textureLoaded = true;
      this.textureRenderPending = true;
    };
    this.earthImage.onerror = () => {
      // Texture unavailable — globe falls back to flat-fill lands.
      this.textureLoaded = false;
    };
    // v13.1.4 polish-7c : prefix the texture URL with Astro's base path.
    // The site lives at https://christianmacion.github.io/portfolio/ so
    // the absolute path must include /portfolio/ — a bare `/textures/...`
    // resolves to the org pages root and 404s. import.meta.env.BASE_URL
    // is set by astro.config.mjs (`base: '/portfolio'` by default) and
    // ships to the client at build time.
    this.earthImage.src = `${import.meta.env.BASE_URL}textures/earth-blue-marble.jpg`;

    // v13.1.4 polish-7 : ocean disc is REMOVED. The canvas behind the
    // SVG (data-worldview-canvas) renders the projected NASA Blue
    // Marble satellite texture per frame, so the SVG must NOT have an
    // opaque backdrop or the texture is hidden. Starfield + limb rim
    // + graticule + borders + pins + cities + labels still render in
    // the SVG above the canvas.
    this.oceanRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    this.oceanRect.setAttribute('x', '0');
    this.oceanRect.setAttribute('y', '0');
    this.oceanRect.setAttribute('width', String(this.width));
    this.oceanRect.setAttribute('height', String(this.height));
    this.oceanRect.setAttribute('fill', '#0A1825'); // fallback only (texture load failed)
    this.oceanRect.setAttribute('fill-opacity', '0'); // invisible by default; canvas shows through
    this.svg.appendChild(this.oceanRect);

    // Starfield : tiny dots outside the limb circle. Deterministic seed
    // (no Math.random per CLAUDE.md §8) — a 16-step rejection-sampled
    // grid in viewport coordinates, skipping any dot that lands within
    // 0.85 × radius of the sphere center. Sub-pixel size, no glow.
    const starfieldGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    starfieldGroup.setAttribute('class', 'wv-globe__stars');
    const cx = this.width / 2;
    const cy = this.height / 2;
    const starR = (GLOBE_SIZE / 2) - 6;
    let sIdx = 0;
    // Step in 18px grid increments across the viewport; deterministic seed.
    for (let sy = 9; sy < this.height; sy += 18) {
      for (let sx = 9; sx < this.width; sx += 18) {
        // Per-cell deterministic offset (no Math.random).
        const o = ((sx * 31 + sy * 17) % 12) - 6;
        const px = sx + o;
        const py = sy + ((sx * 7 + sy * 13) % 10) - 5;
        const dx = px - cx;
        const dy = py - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // Skip dots inside the limb (leave the sphere itself clean).
        if (dist < starR * 1.02) continue;
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', String(px));
        dot.setAttribute('cy', String(py));
        // Vary star size deterministically (small 0.5-1.2 px).
        const r = 0.5 + (((sx * 11 + sy * 23) % 8) / 10);
        dot.setAttribute('r', String(r));
        dot.setAttribute('fill', STAR_DIM);
        dot.setAttribute('opacity', String(0.35 + (((sx + sy) % 5) / 10)));
        starfieldGroup.appendChild(dot);
        sIdx++;
        if (sIdx > 320) break; // hard cap; deterministic coverage
      }
      if (sIdx > 320) break;
    }
    this.svg.appendChild(starfieldGroup);

    // Limb circle : subtle steel-blue rim (stroke only, no fill) so the
    // edge of the disc reads against the canvas texture. The texture
    // itself provides the ocean/land fill; the SVG only adds the edge
    // definition.
    const limb = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    limb.setAttribute('cx', String(this.width / 2));
    limb.setAttribute('cy', String(this.height / 2));
    limb.setAttribute('r', String((GLOBE_SIZE / 2) - 6));
    limb.setAttribute('fill', 'none');
    limb.setAttribute('stroke', LIMB_RIM);
    limb.setAttribute('stroke-width', '0.8');
    limb.setAttribute('stroke-opacity', '0.7');
    this.svg.appendChild(limb);

    // v13.1.4 polish-7e : graticule removed (Owner directive). Earth reads
    // as institutional satellite imagery + venue markers + country borders,
    // not as globe-decor with lat/lon grid lines.

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

    // v13.1.4 polish-6 : always-visible major cities + country labels.
    // Three nested groups so the z-order is clean: country labels render
    // above land but below city dots, city labels render above dots.
    // Hover label group (labelGroup) stays on top of everything.
    this.countryLabelGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.countryLabelGroup.setAttribute('class', 'wv-globe__country-labels');
    this.svg.appendChild(this.countryLabelGroup);

    this.displayCityGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.displayCityGroup.setAttribute('class', 'wv-globe__display-cities');
    this.svg.appendChild(this.displayCityGroup);

    this.displayCityLabels = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.displayCityLabels.setAttribute('class', 'wv-globe__display-city-labels');
    this.svg.appendChild(this.displayCityLabels);

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
      const res = await fetch(`${import.meta.env.BASE_URL}countries-110m.json`, { cache: 'force-cache' });
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
    // v13.1.4 polish-7e Beat 1 : pin pop — fresh GDELT event lands with a
    // single overshoot (Reuters wire-tick set-piece). 240ms, transform-
    // composited. Reduced-motion: pin appears at rest immediately.
    if (!this.reduceMotion && typeof circle.animate === 'function') {
      circle.animate(
        [
          { transform: 'scale(0)' },
          { transform: 'scale(1.08)', offset: 0.7 },
          { transform: 'scale(1)' },
        ],
        { duration: 240, easing: 'cubic-bezier(0.34, 1.30, 0.50, 1)', fill: 'forwards' },
      );
    }
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
    const proj = this.path.projection();
    if (!proj) return;
    // v13.1.4 polish-7 : real NASA Blue Marble satellite texture.
    // Render the projected equirectangular texture onto the canvas
    // (behind the SVG) via d3.geoOrthographic.invert per pixel. The
    // SVG layer above carries stroke-only country borders + cities +
    // labels + pins + venues, so the satellite imagery shows through
    // transparent fills.
    if (this.textureLoaded) {
      this.renderEarthTexture();
      this.textureRenderPending = false;
    }
    // Land layer : stroke-only paths. The satellite imagery on the
    // canvas behind provides the visual fill; the SVG carries the
    // borders (and a fallback fill for the no-texture path below).
    this.landGroup.replaceChildren();
    if (this.cachedFc) {
      for (const f of this.cachedFc.features) {
        const d = this.path(f);
        if (!d) continue;
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', d);
        p.setAttribute('class', 'wv-globe__land-shape');
        if (this.textureLoaded) {
          // Texture mode : transparent fill, border stroke only.
          p.setAttribute('fill', 'none');
          p.setAttribute('stroke', BORDER_COLOR);
          p.setAttribute('stroke-width', '0.7');
          p.setAttribute('stroke-opacity', '0.85');
        } else {
          // Fallback : flat-fill biome coloring while texture loads.
          const id = f.id !== undefined ? String(f.id) : '';
          const biome = COUNTRY_BIOME[id] ?? LAND_TAN;
          p.setAttribute('fill', biome);
          p.setAttribute('stroke', BORDER_COLOR);
          p.setAttribute('stroke-width', '0.6');
          p.setAttribute('stroke-opacity', '0.9');
        }
        p.setAttribute('stroke-linejoin', 'round');
        this.landGroup.appendChild(p);
      }
    }
    // v13.1.4 polish-7e : graticule removed (Owner directive). No equator
    // or prime-meridian reference lines; the globe reads as institutional
    // satellite imagery + venue markers + country borders, no lat/lon decor.
    this.renderPins();
    this.renderVenues();
    this.renderDisplayCities();
    this.renderCountryLabels();
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

  /**
   * v13.1.4 polish-7 : project the equirectangular NASA Blue Marble
   * texture onto the orthographic sphere. For each canvas pixel inside
   * the visible disc, invert the projection to get (lon, lat), then
   * sample the source image at the corresponding equirectangular pixel.
   *
   * Performance : 360 × 360 = 129 600 pixels per re-project. At the
   * ~100ms re-frame cadence this is ~1.3M pixels/sec — well within
   * modern JS engine budgets. The source ImageData is cached as a
   * flat Uint8ClampedArray so per-pixel sampling is a single indexed
   * read (no canvas re-fetch).
   */
  private renderEarthTexture(): void {
    if (!this.textureLoaded || !this.earthImageData) return;
    const proj = this.path.projection();
    if (!proj) return;

    const w = this.canvas.width;
    const h = this.canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const sphereR = GLOBE_SIZE / 2 - 6;
    const sphereR2 = sphereR * sphereR;

    const srcData = this.earthImageData.data;
    const srcW = this.earthImageData.width;
    const srcH = this.earthImageData.height;
    const srcMaxX = srcW - 1;
    const srcMaxY = srcH - 1;

    const out = this.ctx.createImageData(w, h);
    const outArr = out.data;

    for (let y = 0; y < h; y++) {
      const dy = y - cy;
      const dy2 = dy * dy;
      for (let x = 0; x < w; x++) {
        const dx = x - cx;
        const r2 = dx * dx + dy2;
        const outIdx = (y * w + x) * 4;

        if (r2 > sphereR2) {
          outArr[outIdx + 3] = 0; // outside sphere : transparent
          continue;
        }

        // Invert projection to get (lon, lat) for this disc pixel.
        // proj.invert expects SCREEN coordinates (the projection's
        // translate is applied internally), so we pass [x, y] directly
        // (not the offsets [dx, dy]).
        const coords = proj.invert([x, y]);
        if (!coords) {
          outArr[outIdx + 3] = 0;
          continue;
        }

        // Equirectangular mapping : lon ∈ [-180,180] → x ∈ [0,srcW],
        // lat ∈ [-90,90] → y ∈ [0,srcH] (flipped : north = top).
        let imgX = ((coords[0] + 180) / 360) * srcW;
        let imgY = ((90 - coords[1]) / 180) * srcH;

        // Wrap longitude (rotation can shift pixels past the seam).
        imgX = ((imgX % srcW) + srcW) % srcW;
        if (imgY < 0) imgY = 0;
        else if (imgY > srcMaxY) imgY = srcMaxY;

        // Nearest-neighbor sample (fast; bilinear is overkill for a
        // 2048×1024 texture on a 360px disc — at most ~3 texels/pixel).
        const ix = imgX | 0;
        const iy = imgY | 0;
        const srcIdx = (iy * srcW + ix) * 4;
        outArr[outIdx] = srcData[srcIdx];
        outArr[outIdx + 1] = srcData[srcIdx + 1];
        outArr[outIdx + 2] = srcData[srcIdx + 2];
        outArr[outIdx + 3] = 255;
      }
    }

    this.ctx.putImageData(out, 0, 0);
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

  /** Render always-visible major cities (pop-scaled dot + dark backdrop
   *  label). 38 cities cover the major continents; population drives the
   *  visual hierarchy. Digos + Dagupan are the Owner's hometown accents.
   *  Uses geoDistance (not just coord) to detect back-side positions,
   *  since d3-projection always returns a coordinate for any point on
   *  the sphere even when the point is on the far side. */
  renderDisplayCities(): void {
    this.displayCityGroup.replaceChildren();
    this.displayCityLabels.replaceChildren();
    const proj = this.path.projection();
    if (!proj) return;
    const rot = proj.rotate();
    const cx = GLOBE_SIZE / 2;
    const cy = GLOBE_SIZE / 2;
    const r = GLOBE_SIZE / 2 - 6;
    for (const c of DISPLAY_CITIES) {
      // Back-side detection via angular distance from view center.
      const angDist = this.d3.geoDistance(rot, [c.lon, c.lat]);
      if (angDist > Math.PI / 2 + 0.05) continue; // hide back-side cities
      const coord = proj([c.lon, c.lat]);
      if (!coord || isNaN(coord[0])) continue;
      const dx = coord[0] - cx;
      const dy = coord[1] - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > r * 0.92) continue; // hide near limb edge
      // Pop-scaled dot radius (5 tiers).
      const dotR = c.pop > 20 ? 2.4 : c.pop > 10 ? 2.0 : c.pop > 5 ? 1.6 : c.pop > 1 ? 1.2 : 0.9;
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', String(coord[0]));
      dot.setAttribute('cy', String(coord[1]));
      dot.setAttribute('r', String(dotR));
      dot.setAttribute('fill', '#E8E6E1'); // cream paper
      dot.setAttribute('stroke', '#1A1A1A');
      dot.setAttribute('stroke-width', '0.4');
      this.displayCityGroup.appendChild(dot);
      // Label with dark backdrop. Placed to the right of the dot by
      // default; flips left if the city is on the right half of the
      // globe so the label doesn't overflow the viewport.
      const flipLeft = coord[0] > cx;
      const charW = 4.6;
      const w = c.name.length * charW + 6;
      const labelX = flipLeft ? coord[0] - dotR - 3 - w : coord[0] + dotR + 3;
      const labelY = coord[1] + 2.6;
      const plate = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      plate.setAttribute('x', String(labelX));
      plate.setAttribute('y', String(labelY - 8));
      plate.setAttribute('width', String(w));
      plate.setAttribute('height', String(11));
      plate.setAttribute('fill', '#0A1825');
      plate.setAttribute('fill-opacity', '0.74');
      plate.setAttribute('rx', '1.2');
      this.displayCityLabels.appendChild(plate);
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', String(labelX + 3));
      t.setAttribute('y', String(labelY));
      t.setAttribute('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace');
      t.setAttribute('font-size', '7.5');
      t.setAttribute('letter-spacing', '0.05em');
      t.setAttribute('fill', '#E8E6E1');
      t.textContent = c.name;
      this.displayCityLabels.appendChild(t);
    }
  }

  /** Render major country labels (text only, with dark backdrop). 14
   *  labels — enough to anchor continents without crowding the
   *  institutional register. Renders below city labels so cities win
   *  the z-fight at the same latitude. */
  renderCountryLabels(): void {
    this.countryLabelGroup.replaceChildren();
    const proj = this.path.projection();
    if (!proj) return;
    const rot = proj.rotate();
    const cx = GLOBE_SIZE / 2;
    const cy = GLOBE_SIZE / 2;
    const r = GLOBE_SIZE / 2 - 6;
    for (const c of COUNTRY_LABELS) {
      const angDist = this.d3.geoDistance(rot, [c.lon, c.lat]);
      if (angDist > Math.PI / 2 + 0.05) continue;
      const coord = proj([c.lon, c.lat]);
      if (!coord || isNaN(coord[0])) continue;
      const dx = coord[0] - cx;
      const dy = coord[1] - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > r * 0.85) continue; // hide near limb edge
      const charW = 5.4;
      const w = c.name.length * charW + 8;
      const plate = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      plate.setAttribute('x', String(coord[0] - w / 2));
      plate.setAttribute('y', String(coord[1] - 7));
      plate.setAttribute('width', String(w));
      plate.setAttribute('height', String(13));
      plate.setAttribute('fill', '#0A1825');
      plate.setAttribute('fill-opacity', '0.82');
      plate.setAttribute('rx', '1.5');
      this.countryLabelGroup.appendChild(plate);
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', String(coord[0]));
      t.setAttribute('y', String(coord[1] + 3));
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace');
      t.setAttribute('font-size', '9');
      t.setAttribute('font-weight', '600');
      t.setAttribute('letter-spacing', '0.1em');
      t.setAttribute('fill', '#E8E6E1');
      t.textContent = c.name;
      this.countryLabelGroup.appendChild(t);
    }
  }
}

// === Ticker scheduler =================================================
/** v13.1.4 polish-7g : shape of a single ticker row. Extends the
 *  visible-row fields with the raw fields the detail panel renders
 *  (price, changePct, severity, etc.). Local to this file so the
 *  public Ticker surface stays unchanged. */
interface TickerItem {
  ts: string;
  src: string;
  region: string;
  head: string;
  signal: string;
  badge?: string;
  type: 'gdelt' | 'tick';
  severity?: string;
  priceLabel?: string;
  changeLabel?: string;
}

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

  private row(
    timestamp: string,
    source: string,
    region: string,
    headline: string,
    signal: string,
    badge: string | undefined,
    detailHtml: string,
  ): HTMLLIElement {
    // v13.1.4 polish-7g : ticker row is now interactive. <li> wraps a
    // <button class="wv-ticker__row"> (the visible grid) + a hidden
    // <div class="wv-ticker__detail"> that expands on tap. aria-expanded
    // + aria-controls wire the button to the detail panel for screen
    // readers. The detail holds the untruncated headline + the full
    // timestamp + the source/signal/level grid. WCAG 2.5.5 SC 2.5.8:
    // 44×44 minimum touch target is set via the .wv-ticker__row
    // min-height on mobile (CSS in WorldView.astro).
    const li = document.createElement('li');
    li.className = 'wv-ticker__item';
    li.setAttribute('role', 'listitem');

    const detailId = `wv-ticker-detail-${Math.random().toString(36).slice(2, 10)}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wv-ticker__row';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', detailId);
    btn.setAttribute(
      'aria-label',
      `${region} · ${headline} · ${signal}${badge ? ' · ' + badge : ''}. Tap to expand details.`,
    );

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
    btn.append(t, s, r, sig, h);
    if (badge) {
      const b = document.createElement('span');
      const lvl = badge.toLowerCase();
      b.className = 'wv-ticker__badge mono wv-ticker__badge--' + lvl;
      b.textContent = badge;
      btn.appendChild(b);
    }

    // Inline detail panel : hidden until the row is tapped.
    const detail = document.createElement('div');
    detail.className = 'wv-ticker__detail';
    detail.id = detailId;
    detail.hidden = true;
    detail.setAttribute('role', 'region');
    detail.setAttribute('aria-label', `${region} details`);
    detail.innerHTML = detailHtml;

    // Toggle handler : single source of truth for the open/close state.
    // aria-expanded + hidden + .wv-ticker__row--open class are all kept
    // in sync so the CSS, the screen-reader announcement, and the DOM
    // truth stay aligned.
    const toggle = (open?: boolean): void => {
      const next =
        open === undefined
          ? btn.getAttribute('aria-expanded') !== 'true'
          : open;
      btn.setAttribute('aria-expanded', next ? 'true' : 'false');
      btn.classList.toggle('wv-ticker__row--open', next);
      detail.hidden = !next;
    };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggle();
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
        return;
      }
      if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') {
        e.preventDefault();
        toggle(false);
        btn.focus();
      }
    });

    li.append(btn, detail);
    return li;
  }

  /** Build the detail panel HTML for a single row. Pure string return;
   *  uses innerHTML at the call site (event/tick payloads come from the
   *  same trusted JSON caches the visible row already consumes). */
  private detailHtml(item: TickerItem): string {
    const rows: Array<[string, string]> = [
      ['Time', item.ts + 'Z'],
      ['Source', item.src],
      ['Region', item.region],
      ['Signal', item.signal],
    ];
    if (item.badge) rows.push(['Level', item.badge]);
    if (item.type === 'gdelt' && item.severity) rows.push(['Severity', item.severity]);
    if (item.type === 'tick') {
      rows.push(['Symbol', item.region]);
      rows.push(['Price', item.priceLabel ?? '—']);
      rows.push(['Change', item.changeLabel ?? '—']);
    }
    const dl = rows
      .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`)
      .join('');
    return `<p class="wv-ticker__detail-head">${escapeHtml(item.head)}</p>`
      + `<dl class="wv-ticker__detail-grid">${dl}</dl>`;
  }

  private render(): void {
    // v13.1.4 polish-7e Beat 4 : diff previous ticks vs incoming. Symbols
    // whose price or changePct moved get a one-shot tint sweep on render.
    const prevBySymbol = new Map<string, { price: number; changePct: number }>();
    for (const t of this.ticks) prevBySymbol.set(t.symbol, { price: t.price, changePct: t.changePct });

    const items: TickerItem[] = [];
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
        type: 'gdelt',
        severity: ev.severity,
      });
    }
    for (const t of this.ticks) {
      // TICK rows show the price + changePct as headline; signal column
      // shows the direction. Mapping: ▲ → LONG, ▼ → SHORT. The 'tag'
      // (RSI/MA/volume) is reserved for future research overlays.
      const priceLabel = t.price.toLocaleString('en-US', { maximumFractionDigits: 4 });
      const changeLabel =
        (t.changePct >= 0 ? '+' : '') + t.changePct.toFixed(2) + '%';
      items.push({
        ts: t.timestamp,
        src: 'TICK',
        region: t.symbol,
        head: priceLabel + ' · ' + changeLabel,
        signal: t.changePct >= 0 ? '▲ LONG' : '▼ SHORT',
        badge: t.level,
        type: 'tick',
        priceLabel,
        changeLabel,
      });
    }
    items.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
    const visible = items.slice(0, TICKER_MAX_ROWS);
    // Build the row nodes first, then tag them with motion classes.
    const freshestRegion = visible[0]?.region;
    const tickedRegions = new Set<string>();
    for (const t of this.ticks) {
      const prev = prevBySymbol.get(t.symbol);
      if (!prev) continue;
      if (prev.price !== t.price || prev.changePct !== t.changePct) {
        tickedRegions.add(t.symbol);
      }
    }
    this.list.replaceChildren(
      ...visible.map((v) => {
        const row = this.row(
          v.ts,
          v.src,
          v.region,
          v.head,
          v.signal,
          v.badge,
          this.detailHtml(v),
        );
        // Beat 2 : newest row lands with slide + fade.
        if (v.region === freshestRegion) {
          const btn = row.querySelector<HTMLButtonElement>('.wv-ticker__row');
          if (btn) btn.classList.add('wv-ticker__row--fresh');
        }
        // Beat 4 : ticks whose price/% changed get a one-shot tint sweep.
        if (v.src === 'TICK' && tickedRegions.has(v.region)) {
          const btn = row.querySelector<HTMLButtonElement>('.wv-ticker__row');
          if (btn) btn.classList.add('wv-ticker__row--ticked');
        }
        return row;
      }),
    );
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
  private syncBinance: HTMLElement | null = null;
  private syncYahoo: HTMLElement | null = null;

  setSyncTargets(refs: {
    syncGdelt: HTMLElement;
    syncCoinGecko: HTMLElement;
    syncBinance: HTMLElement;
    syncYahoo: HTMLElement;
  }): void {
    this.syncGdelt = refs.syncGdelt;
    this.syncCoinGecko = refs.syncCoinGecko;
    this.syncBinance = refs.syncBinance;
    this.syncYahoo = refs.syncYahoo;
  }

  private paintSync(target: HTMLElement | null, iso: string | undefined): void {
    if (!target) return;
    target.textContent = iso ? iso.slice(11, 16) + 'Z' : '--:--Z';
    // v13.1.4 polish-7e Beat 3 : one-shot acknowledgment dip when a
    // sync stamp refreshes. No loop, no color — just a quiet opacity dip.
    target.classList.add('wv__legend--flash');
    window.setTimeout(() => target.classList.remove('wv__legend--flash'), 240);
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
        this.paintSync(this.syncBinance, this.lastBySource.Binance);
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
      const res = await fetch(`${import.meta.env.BASE_URL}countries-110m.json`, { cache: 'force-cache' });
      if (res.ok) topoCache = (await res.json()) as Topology;
    } catch {
      topoCache = null;
    }
  }
  if (!activeGlobe) {
    activeGlobe = new Globe(activeRefs.svg, activeRefs.canvas, d3geoMod, topoMod.feature);
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
  const canvas = document.querySelector<HTMLCanvasElement>('[data-worldview-canvas]');
  const tickerList = document.querySelector<HTMLUListElement>('[data-worldview-ticker]');
  const status = document.querySelector<HTMLElement>('[data-worldview-status]');
  const hint = document.querySelector<HTMLElement>('[data-worldview-hint]');
  const syncGdelt = document.querySelector<HTMLElement>('[data-worldview-sync-gdelt]');
  const syncCoinGecko = document.querySelector<HTMLElement>('[data-worldview-sync-coingecko]');
  const syncBinance = document.querySelector<HTMLElement>('[data-worldview-sync-binance]');
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
    canvas: canvas ?? document.createElement('canvas'),
    tickerList: tickerList ?? document.createElement('ul'),
    status,
    hint: hint ?? status,
    syncGdelt: syncGdelt ?? status,
    syncCoinGecko: syncCoinGecko ?? status,
    syncBinance: syncBinance ?? status,
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