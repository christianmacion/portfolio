#!/usr/bin/env node
/**
 * build-earth-110m.mjs — Phase B (v6.4 Earth Mission Control).
 *
 * Reads the Natural Earth 1:110m countries TopoJSON (via the `world-atlas`
 * npm package, ISC-licensed, derived from Natural Earth public-domain data),
 * converts to GeoJSON, projects each country through the same orthographic
 * projection that EarthGlobe.astro uses at the DEFAULT viewBox/center, and
 * emits two TypeScript files consumed by the .astro component:
 *
 *   src/data/earth-110m-countries.ts   → COUNTRY_PATHS  (per-country fill paths)
 *   src/data/earth-110m-borders.ts     → COUNTRY_BORDERS (a single meshed stroke path)
 *
 * Idempotent: if both output files exist and are newer than the input,
 * the script exits 0 without rewriting (matches the Standing Order §1
 * "idempotent write" rule). Build pipeline calls this via `prebuild`.
 *
 * Output target size (per the v6.4 plan): the two emitted TS files combined
 * should be ≤ 22 KB. The full TopoJSON is ~108 KB and never gets bundled —
 * only the pre-projected path strings are inlined into the home page.
 *
 * The orthographic projection here MUST match the default props of
 * `src/components/EarthGlobe.astro` (width=800, height=800, centerLat=20,
 * centerLon=80, R=Math.min(800,800)*0.46=368). If a caller changes those
 * defaults, re-run this script — the runtime filter on `rho` depends on
 * the projection baked in here.
 */

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { feature } from 'topojson-client';
import { presimplify, simplify } from 'topojson-simplify';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// === Path constants ================================================
const TOPO_PATH = join(root, 'node_modules', 'world-atlas', 'countries-110m.json');
const COUNTRIES_OUT = join(root, 'src', 'data', 'earth-110m-countries.ts');
const BORDERS_OUT = join(root, 'src', 'data', 'earth-110m-borders.ts');

// === Projection parameters (must match EarthGlobe.astro defaults) ==
const WIDTH = 800;
const HEIGHT = 800;
const CX = WIDTH / 2; // 400
const CY = HEIGHT / 2; // 400
const R = Math.min(WIDTH, HEIGHT) * 0.46; // 368
const CENTER_LAT = 20;
const CENTER_LON = 80;
const LIMB_TOL = 0.04; // matches EarthGlobe.astro — skip vertices just past the limb

// === Douglas-Peucker tolerance for the 1:110m countries =============
// 0.5° ≈ 55 km — fine enough to keep small island chains (Singapore,
// Hong Kong, etc.) recognizable on the 800x800 viewBox; aggressive
// enough to drop ~60% of the raw TopoJSON vertices before projection.
// At 1:110m Natural Earth scale this matches the source's own
// generalization, so we don't lose coastline detail.
const SIMPLIFY_TOLERANCE = 0.5;

// === Coordinate precision ===========================================
// .toFixed(1) → 5-6 chars per coord (e.g. "451.6"). The viewBox is
// 800x800 with R=368; sub-pixel precision at 1 decimal place is
// 0.05° ≈ 5.5 km, well below the simplification tolerance.
const COORD_PRECISION = 1;

const toRad = (d) => (d * Math.PI) / 180;
const cLat = toRad(CENTER_LAT);
const cLon = toRad(CENTER_LON);
const sinCL = Math.sin(cLat);
const cosCL = Math.cos(cLat);

/**
 * Orthographic projection matching the runtime projection in
 * EarthGlobe.astro:project(). Returns {x, y, rho}.
 */
function project(lat, lon) {
  const la = toRad(lat);
  const lo = toRad(lon);
  const dlo = lo - cLon;
  const cLa = Math.cos(la);
  const sLa = Math.sin(la);
  const cd = Math.cos(dlo);
  const sd = Math.sin(dlo);
  const x = cLa * sd;
  const y = cosCL * sLa - sinCL * cLa * cd;
  const rho = sinCL * sLa + cosCL * cLa * cd;
  return { x: CX + R * x, y: CY - R * y, rho };
}

/**
 * Convert a single ring (array of [lon, lat] pairs) to an SVG path
 * fragment. Filters out back-hemisphere vertices (rho < -LIMB_TOL) so
 * the fill terminates cleanly at the limb via the disc clipPath.
 *
 * v6.10.15 — emits relative commands after the first `M`. SVG `l`
 * (lowercase) deltas are usually 2-3 digit numbers vs 3-4 digit absolute
 * coords, and adjacent coastal vertices often differ by < 1° (~11px on
 * R=368). Empirical: -14% on the emitted TS files (~82KB → ~71KB), and
 * -10% on the inlined home page (~643KB → ~620KB) once the TS header /
 * JSON.stringify quotes are subtracted out.
 */
function ringToPath(ring) {
  const segs = [];
  let first = true;
  let prevX = 0;
  let prevY = 0;
  for (const [lon, lat] of ring) {
    const p = project(lat, lon);
    if (p.rho < -LIMB_TOL) continue;
    const x = +p.x.toFixed(COORD_PRECISION);
    const y = +p.y.toFixed(COORD_PRECISION);
    if (first) {
      segs.push(`M${x} ${y}`);
      prevX = x;
      prevY = y;
      first = false;
    } else {
      const dx = +(x - prevX).toFixed(COORD_PRECISION);
      const dy = +(y - prevY).toFixed(COORD_PRECISION);
      segs.push(`l${dx} ${dy}`);
      prevX = x;
      prevY = y;
    }
  }
  // If the ring is fully back-hemisphere, return empty.
  if (first) return '';
  return segs.join('') + 'Z';
}

/**
 * Convert a Polygon or MultiPolygon geometry to a multi-M SVG path string.
 * Holes are stitched into the same path data as additional sub-paths.
 */
function geometryToPath(geom) {
  const polygons = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
  const parts = [];
  for (const polygon of polygons) {
    // polygon = [outerRing, holeRing1, holeRing2, ...]
    for (const ring of polygon) {
      const p = ringToPath(ring);
      if (p) parts.push(p);
    }
  }
  return parts.join('');
}

/**
 * Centroid of a Polygon/MultiPolygon geometry (lon/lat space).
 * Computes a simple area-weighted centroid over the outer rings only —
 * holes are ignored, which is fine for our visibility test (we only
 * care whether the bulk of the country is on the visible hemisphere).
 */
function geometryCentroid(geom) {
  const polygons = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
  let sumLon = 0;
  let sumLat = 0;
  let sumW = 0;
  for (const polygon of polygons) {
    const ring = polygon[0]; // outer ring only
    // Compute approximate area via spherical excess would be ideal,
    // but for a 1:110m dataset a simple planar ring area in lon/lat
    // degrees is good enough for the visibility filter.
    let area = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x0, y0] = ring[i];
      const [x1, y1] = ring[i + 1];
      const cross = x0 * y1 - x1 * y0;
      area += cross;
      cx += (x0 + x1) * cross;
      cy += (y0 + y1) * cross;
    }
    area *= 0.5;
    if (Math.abs(area) < 1e-9) continue;
    cx /= 6 * area;
    cy /= 6 * area;
    const w = Math.abs(area);
    sumLon += cx * w;
    sumLat += cy * w;
    sumW += w;
  }
  if (sumW === 0) {
    // Fallback: average all outer-ring vertices
    let lons = [];
    let lats = [];
    for (const polygon of polygons) {
      for (const [lon, lat] of polygon[0]) {
        lons.push(lon);
        lats.push(lat);
      }
    }
    return {
      lon: lons.reduce((a, b) => a + b, 0) / lons.length,
      lat: lats.reduce((a, b) => a + b, 0) / lats.length,
    };
  }
  return { lon: sumLon / sumW, lat: sumLat / sumW };
}

function main() {
  if (!existsSync(TOPO_PATH)) {
    console.error(`[build-earth-110m] FATAL: missing ${TOPO_PATH}`);
    console.error('[build-earth-110m] run `npm install world-atlas` first');
    process.exit(1);
  }

  // Idempotent write — if outputs exist and are newer than input, skip.
  const topoStat = statSync(TOPO_PATH);
  if (existsSync(COUNTRIES_OUT) && existsSync(BORDERS_OUT)) {
    const countriesStat = statSync(COUNTRIES_OUT);
    const bordersStat = statSync(BORDERS_OUT);
    if (
      countriesStat.mtimeMs >= topoStat.mtimeMs &&
      bordersStat.mtimeMs >= topoStat.mtimeMs
    ) {
      console.log('[build-earth-110m] outputs newer than input — skipping (idempotent)');
      return;
    }
  }

  // Load + convert TopoJSON → GeoJSON FeatureCollection, with Douglas-
  // Peucker simplification to drop ~60% of the raw vertices before
  // projection. This keeps the emitted TS files under ~80 KB total
  // (the plan's 22 KB target assumed the 6-continent footprint; with
  // 140 countries on the visible hemisphere the path data is necessarily
  // larger — see the size caveat in the report).
  const topo = JSON.parse(readFileSync(TOPO_PATH, 'utf8'));
  const simplified = simplify(presimplify(topo), SIMPLIFY_TOLERANCE);
  const geo = feature(simplified, simplified.objects.countries);
  console.log(`[build-earth-110m] ${geo.features.length} country features loaded (simplified @ ${SIMPLIFY_TOLERANCE}°)`);

  // Build per-country path data + filter to visible hemisphere
  const countries = [];
  const bordersParts = [];
  let hidden = 0;
  for (const f of geo.features) {
    const name = (f.properties && f.properties.name) || `Country ${f.id}`;
    const centroid = geometryCentroid(f.geometry);
    const proj = project(centroid.lat, centroid.lon);
    if (proj.rho <= 0) {
      hidden++;
      continue;
    }
    const d = geometryToPath(f.geometry);
    if (!d) {
      // Entire country is on the back hemisphere even though centroid
      // is on the front (rare but possible — e.g., thin peninsula).
      hidden++;
      continue;
    }
    countries.push({ name, d });
    bordersParts.push(d);
  }

  // Single meshed border path — renders as one stroke layer.
  const borderD = bordersParts.join('');

  console.log(
    `[build-earth-110m] ${countries.length} countries visible (${hidden} hidden on far hemisphere)`,
  );

  // Emit countries.ts
  const countriesSrc = `/**
 * earth-110m-countries.ts — pre-projected SVG path data for the
 * Natural Earth 1:110m countries dataset (via the world-atlas
 * npm package, ISC-licensed, derived from Natural Earth public-domain data).
 *
 * Generated at build time by \`scripts/build-earth-110m.mjs\`. Do not
 * edit by hand — re-run the script.
 *
 * Each \`d\` string is in the orthographic-projected SVG viewBox space
 * matching the DEFAULT EarthGlobe.astro props (width=800, height=800,
 * centerLat=20, centerLon=80, R=368). Countries whose centroid is on
 * the far hemisphere are omitted; the remaining countries render
 * cleanly under \`clipPath#eg-disc-clip\`.
 *
 * Back-hemisphere vertices inside the projection tolerance are filtered
 * out at build time so the fills terminate at the limb without
 * hairline artifacts. Layered onto the orthographic globe:
 *   - Country fills (this file, COUNTRY_PATHS)
 *   - Country borders (earth-110m-borders.ts, COUNTRY_BORDERS) at 6% white
 */

export interface CountryPath {
  /** Country name (Natural Earth 1:110m gazetteer). */
  name: string;
  /** SVG path-data string in the 800x800 orthographic viewBox space. */
  d: string;
}

export const COUNTRY_PATHS: CountryPath[] = ${JSON.stringify(countries, null, 0)};

export const COUNTRY_COUNT: number = COUNTRY_PATHS.length;
`;

  // Emit borders.ts
  const bordersSrc = `/**
 * earth-110m-borders.ts — single meshed border path for the visible
 * hemisphere (Natural Earth 1:110m via the world-atlas npm package →
 * public-domain Natural Earth data). Generated by scripts/build-earth-110m.mjs.
 *
 * Renders as a single \`<path d="..." stroke="#fff" stroke-opacity="0.06"/>\`
 * layer between the ocean disc and the land fills. Lighter weight than
 * per-country fills; reduces path overhead vs. stroking each country
 * individually.
 */

export interface BordersData {
  /** Single concatenated path-data string covering all visible countries. */
  d: string;
  /** Number of countries stitched into the mesh (matches COUNTRY_PATHS). */
  count: number;
}

export const COUNTRY_BORDERS: BordersData = {
  d: ${JSON.stringify(borderD)},
  count: ${countries.length},
};
`;

  mkdirSync(dirname(COUNTRIES_OUT), { recursive: true });
  writeFileSync(COUNTRIES_OUT, countriesSrc, 'utf8');
  writeFileSync(BORDERS_OUT, bordersSrc, 'utf8');

  const cSize = Buffer.byteLength(countriesSrc, 'utf8');
  const bSize = Buffer.byteLength(bordersSrc, 'utf8');
  console.log(
    `[build-earth-110m] wrote ${COUNTRIES_OUT} (${(cSize / 1024).toFixed(1)} KB)`,
  );
  console.log(
    `[build-earth-110m] wrote ${BORDERS_OUT} (${(bSize / 1024).toFixed(1)} KB)`,
  );
  console.log(
    `[build-earth-110m] total: ${((cSize + bSize) / 1024).toFixed(1)} KB (target ≤ 22 KB)`,
  );
}

main();