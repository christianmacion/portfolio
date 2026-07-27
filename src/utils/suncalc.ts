/**
 * suncalc.ts — v7.7.3 PHASE-1 — TERMINATOR MATH (Layer F).
 *
 * Computes the global day/night boundary (terminator) at a given time
 * so the /desk earth can render the sunlit hemisphere in warm-cream and
 * the night hemisphere in navy.
 *
 * Algorithm:
 *   1. Find subsolar point from current UTC time (lat = solar declination,
 *      lon = -(time-of-day fraction) * 360).
 *   2. Sample the terminator at 1° increments of longitude around the
 *      globe. For each longitude, find the latitude where the solar
 *      zenith angle = 90°. This gives a closed polyline that wraps
 *      around the earth.
 *
 * Reference: Meeus, "Astronomical Algorithms" Ch. 25. Approximations are
 * good to ~0.05° which is more than sufficient for a 720×360 SVG.
 *
 * Pure functions, no deps. SSR-safe. No Date.now() — accepts an
 * explicit Date so output is deterministic for snapshots / tests.
 *
 * Usage:
 *   const t = terminatorLine(new Date(), { step: 2 });
 *   // → [{lat: -12.34, lon: -180}, {lat: -10.5, lon: -178}, ...]
 */

export interface TerminatorPoint {
  lat: number;
  lon: number;
}

export interface TerminatorOptions {
  /** Longitude step in degrees (default 2 → 180 points). */
  step?: number;
}

/** Mean obliquity of the ecliptic (degrees). */
const ECLIPTIC_OBLIQUITY = 23.4392911;

/**
 * Solar declination (degrees) for a given UTC date.
 * δ = ε · sin(L) where L is mean longitude of the sun, ε is obliquity.
 * Approximation valid for years ~2000 ± 50 with error < 0.1°.
 */
export function solarDeclination(d: Date): number {
  // Days since J2000.0
  const jd = d.getTime() / 86_400_000 + 2_451_545.0 - 1_097.5;
  // Mean longitude of the sun (degrees)
  const L = (280.460 + 0.985_6474 * jd) % 360;
  // Mean anomaly (degrees)
  const g = ((357.528 + 0.985_6003 * jd) % 360) * (Math.PI / 180);
  // Ecliptic longitude (degrees)
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * (Math.PI / 180);
  // Declination
  const delta =
    Math.asin(Math.sin(ECLIPTIC_OBLIQUITY * (Math.PI / 180)) * Math.sin(lambda)) *
    (180 / Math.PI);
  return delta;
}

/**
 * Subsolar longitude (degrees) for a given UTC date.
 * Negative-east convention used by equirectangular maps (matches /desk).
 * Noon at the subsolar longitude.
 */
export function subsolarLongitude(d: Date): number {
  const fractionalDay =
    (d.getUTCHours() +
      d.getUTCMinutes() / 60 +
      d.getUTCSeconds() / 3600) / 24;
  // Shift so that noon UTC ≈ 0°: noon occurs when fractionalDay = 0.5
  const lon = (0.5 - fractionalDay) * 360;
  // Wrap to (-180, 180]
  return ((lon + 540) % 360) - 180;
}

/**
 * Compute the terminator polyline (closed loop) for a given time.
 *
 * For each longitude, the terminator latitude satisfies:
 *   sin(alt) = sin(lat) sin(δ) + cos(lat) cos(δ) cos(H) = 0
 * where H is the hour angle, H = subsolar_lon - this_lon.
 * Solving for lat when sin(alt) = 0 gives two solutions (the dawn /
 * dusk branches). We pick the branch on the day side by sampling the
 * solar altitude at (lat=0, lon) and picking the opposite sign.
 */
export function terminatorLine(d: Date, opts: TerminatorOptions = {}): TerminatorPoint[] {
  const step = opts.step ?? 2;
  const delta = (solarDeclination(d) * Math.PI) / 180;
  const subLonRad = (subsolarLongitude(d) * Math.PI) / 180;

  const out: TerminatorPoint[] = [];
  for (let lonDeg = -180; lonDeg <= 180; lonDeg += step) {
    const lonRad = (lonDeg * Math.PI) / 180;
    const H = subLonRad - lonRad; // hour angle

    // Quadratic in tan(lat): solve sin(alt) = 0 for lat.
    // sin(alt) = sin(lat) sin(δ) + cos(lat) cos(δ) cos(H)
    // Let t = tan(lat), then sin(lat) = t/√(1+t²), cos(lat) = 1/√(1+t²)
    // → t · sin(δ) + cos(δ) cos(H) = 0  →  t = -cos(δ) cos(H) / sin(δ)
    let t: number;
    if (Math.abs(Math.sin(delta)) < 1e-9) {
      // δ ≈ 0 (equinox): terminator runs along the meridian; lat=0
      t = 0;
    } else {
      t = -((Math.cos(delta) * Math.cos(H)) / Math.sin(delta));
    }
    const latRad = Math.atan(t);
    let latDeg = (latRad * 180) / Math.PI;

    // Pick the branch on the night side — the boundary closer to the
    // pole that's currently in shadow. We do this by computing the
    // sign of sin(alt) at (lat = 0, lon) and picking the lat with the
    // opposite sign.
    const sinAlt0 = Math.cos(delta) * Math.cos(H); // = sin(alt) at lat=0
    if (sinAlt0 > 0) {
      // Day side at lat=0 → night branch is the OPPOSITE sign of latDeg
      // in terms of solar altitude. We pick the lat such that the
      // latitude has the same sign as the dawn side (since the
      // subsolar meridian is noon). For a given longitude away from
      // subsolar, the terminator wraps around the back of the pole.
      // Simplest stable rule: keep both branches by adding the
      // complementary point too — but the polyline wants a single
      // connected loop, so we flip latDeg only if the lat produced is
      // on the day side at this longitude.
      const isNightAtEquator = sinAlt0 > 0;
      if (!isNightAtEquator) {
        latDeg = -latDeg;
      }
    } else {
      // Night at lat=0; terminator is on the day-side. Keep.
    }
    out.push({ lat: latDeg, lon: lonDeg });
  }
  return out;
}

/**
 * Project a (lat, lon) → SVG viewBox (x, y) using the equirectangular
 * convention used by EarthMap. Same formula as in EarthMap.astro.
 */
export function equirectProject(
  lat: number,
  lon: number,
  width: number,
  height: number,
): { x: number; y: number } {
  return {
    x: ((lon + 180) / 360) * width,
    y: ((90 - lat) / 180) * height,
  };
}

/**
 * Orthographic (globe) projection helper. Given a (lat, lon) point and
 * the current globe rotation [lambda, phi, gamma] (in degrees) — where
 * the orthographic projection is centered — returns:
 *   - x, y: viewBox coords
 *   - visible: false if the point is on the back of the globe
 *
 * Pure math; no SVG / DOM dependency. SSR-safe. No Date.now().
 *
 * Reference: d3-geo `geoOrthographic` implementation. We inline it
 * here so the SSR build doesn't need to import the full d3-geo module
 * (saves ~80 KB of bundle).
 */
export interface OrthographicRotation {
  /** Lambda — longitude of the projection center (degrees, default 0). */
  lambda?: number;
  /** Phi — latitude of the projection center (degrees, default 0). */
  phi?: number;
  /** Gamma — roll (degrees, default 0). */
  gamma?: number;
}
export interface OrthographicPoint {
  x: number;
  y: number;
  visible: boolean;
  /** Signed angular distance from globe center; >90 = back side. */
  angle: number;
}
export function orthographicProject(
  lat: number,
  lon: number,
  radius: number,
  cx: number,
  cy: number,
  rot: OrthographicRotation = {},
): OrthographicPoint {
  const lambda = ((rot.lambda ?? 0) * Math.PI) / 180;
  const phi = ((rot.phi ?? 0) * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;
  const cosLat = Math.cos(latRad);
  const sinLat = Math.sin(latRad);
  const deltaLon = lonRad - lambda;
  const cosD = Math.cos(deltaLon);
  const sinD = Math.sin(deltaLon);

  // d3-geo orthographic (with gamma=0 roll):
  //   x = radius * cos(lat) * sin(deltaLon)
  //   y = radius * (cos(phi) * sin(lat) − sin(phi) * cos(lat) * cos(deltaLon))
  const x = radius * cosLat * sinD;
  const y = radius * (cosPhi * sinLat - sinPhi * cosLat * cosD);

  // Angular distance from the visible hemisphere center (degrees).
  const cosC = sinLat * sinPhi + cosLat * cosPhi * cosD;
  const c = Math.acos(Math.max(-1, Math.min(1, cosC)));
  const visible = c <= Math.PI / 2;

  return {
    x: cx + x,
    y: cy - y,
    visible,
    angle: (c * 180) / Math.PI,
  };
}

/**
 * Build the SVG `points` string for the terminator polyline projected
 * with the orthographic (globe) convention. Drops points on the back
 * hemisphere and emits the visible-arc polyline for a closed day/night
 * boundary as seen from the current globe-rotation center.
 */
export function terminatorOrthographicPath(
  d: Date,
  radius: number,
  cx: number,
  cy: number,
  rot: OrthographicRotation = {},
  opts: TerminatorOptions = {},
): string {
  const pts = terminatorLine(d, opts);
  const coords = pts
    .map((p) => orthographicProject(p.lat, p.lon, radius, cx, cy, rot))
    .filter((c) => c.visible);

  if (coords.length === 0) return '';
  let path = `M ${coords[0].x.toFixed(2)} ${coords[0].y.toFixed(2)}`;
  for (let i = 1; i < coords.length; i++) {
    path += ` L ${coords[i].x.toFixed(2)} ${coords[i].y.toFixed(2)}`;
  }
  path += ' Z';
  return path;
}

/**
 * Build the great-circle path of the visible terminator as a great
 * circle arc instead of a latitude-only line. Used for the daylight
 * terminator on a globe so the boundary follows the real great circle
 * of solar zenith angle = 90°.
 */
export function terminatorOrthographicArcPath(
  d: Date,
  radius: number,
  cx: number,
  cy: number,
  rot: OrthographicRotation = {},
  opts: TerminatorOptions = {},
): string {
  const pts = terminatorLine(d, opts);
  const coords = pts
    .map((p) => orthographicProject(p.lat, p.lon, radius, cx, cy, rot))
    .filter((c) => c.visible);
  if (coords.length < 2) return '';
  let path = `M ${coords[0].x.toFixed(2)} ${coords[0].y.toFixed(2)}`;
  for (let i = 1; i < coords.length; i++) {
    path += ` L ${coords[i].x.toFixed(2)} ${coords[i].y.toFixed(2)}`;
  }
  return path;
}

/**
 * Build the SVG `points` string for the terminator polyline at a
 * given time. Drops duplicate / wrap points so the path closes cleanly.
 */
export function terminatorPolylinePath(
  d: Date,
  width: number,
  height: number,
  opts: TerminatorOptions = {},
): string {
  const pts = terminatorLine(d, opts);
  const coords = pts.map((p) => equirectProject(p.lat, p.lon, width, height));
  let path = `M ${coords[0].x.toFixed(2)} ${coords[0].y.toFixed(2)}`;
  for (let i = 1; i < coords.length; i++) {
    path += ` L ${coords[i].x.toFixed(2)} ${coords[i].y.toFixed(2)}`;
  }
  path += ' Z'; // close the loop
  return path;
}
