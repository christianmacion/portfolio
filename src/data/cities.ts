/**
 * cities.ts : L1 / L2 / L3 venue dataset for the rotating globe (v13.1.4).
 *
 * 12 venues across 5 continents (per Globe RFC §5.2). Lat/lon are the
 * canonical coordinates used by the CoverageGlobe.astro + EarthMap.astro
 * layers; the globe reuses the same dataset so every visual surface
 * agrees on placement.
 *
 * Field shape:
 *   - id        : stable slug, also used as the pin key in Globe.pins Map
 *   - city      : human-friendly city name (for hover label)
 *   - country   : ISO 3166-1 alpha-2 country code (for chip color cue)
 *   - lat       : decimal degrees, +N / -S
 *   - lon       : decimal degrees, +E / -W (geoJSON convention)
 *   - utcOffset : hours from UTC, signed; used for local-time computation
 *   - venue     : exchange or operating venue acronym (NYSE, JPX, ...)
 *   - level     : 'L1' | 'L2' | 'L3' (depth-of-market tier)
 *   - region    : macro-region tag (NA / EU / APAC / LATAM / ME)
 *
 * L1 = direct exchange feed (top-of-book + last trade)
 * L2 = consolidated tape (SIP / OPRA / ECN depth)
 * L3 = full depth-of-book top 10 levels (US + EU + JPX only)
 *
 * Order is intentional: home base first, then APAC, EU, NA, LATAM.
 * The Ticker class reads this dataset to seed the alpha-feed ticker at
 * startup so the modal is never empty between GDELT refreshes.
 */

export type CityLevel = 'L1' | 'L2' | 'L3';
export type CityRegion = 'APAC' | 'EU' | 'NA' | 'LATAM' | 'ME';

export interface CityPin {
  id: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  utcOffset: number;
  venue: string;
  level: CityLevel;
  region: CityRegion;
}

export const CITIES: readonly CityPin[] = [
  { id: 'digos',     city: 'Digos City', country: 'PH', lat:   6.74, lon:  125.36, utcOffset:  8, venue: 'PSE',     level: 'L1', region: 'APAC' },
  { id: 'singapore', city: 'Singapore',  country: 'SG', lat:   1.35, lon:  103.82, utcOffset:  8, venue: 'SGX',     level: 'L1', region: 'APAC' },
  { id: 'tokyo',     city: 'Tokyo',      country: 'JP', lat:  35.68, lon:  139.69, utcOffset:  9, venue: 'JPX',     level: 'L3', region: 'APAC' },
  { id: 'hongkong',  city: 'Hong Kong',  country: 'HK', lat:  22.32, lon:  114.17, utcOffset:  8, venue: 'HKEX',    level: 'L2', region: 'APAC' },
  { id: 'sydney',    city: 'Sydney',     country: 'AU', lat: -33.87, lon:  151.21, utcOffset: 11, venue: 'ASX',     level: 'L1', region: 'APAC' },
  { id: 'mumbai',    city: 'Mumbai',     country: 'IN', lat:  19.08, lon:   72.88, utcOffset:  5, venue: 'NSE+BSE', level: 'L1', region: 'APAC' },
  { id: 'zurich',    city: 'Zurich',     country: 'CH', lat:  47.38, lon:    8.54, utcOffset:  1, venue: 'SIX',     level: 'L2', region: 'EU'   },
  { id: 'london',    city: 'London',     country: 'GB', lat:  51.51, lon:   -0.13, utcOffset:  0, venue: 'LSE',     level: 'L3', region: 'EU'   },
  { id: 'newyork',   city: 'New York',   country: 'US', lat:  40.71, lon:  -74.01, utcOffset: -5, venue: 'NYSE+NDX',level: 'L3', region: 'NA'   },
  { id: 'chicago',   city: 'Chicago',    country: 'US', lat:  41.88, lon:  -87.63, utcOffset: -6, venue: 'CME+CBOE',level: 'L3', region: 'NA'   },
  { id: 'toronto',   city: 'Toronto',    country: 'CA', lat:  43.65, lon:  -79.38, utcOffset: -5, venue: 'TSX',     level: 'L1', region: 'NA'   },
  { id: 'saopaulo',  city: 'São Paulo',  country: 'BR', lat: -23.55, lon:  -46.63, utcOffset: -3, venue: 'B3',      level: 'L1', region: 'LATAM'},
] as const;

/** Lookup a city by id; returns undefined when the slug is unknown. */
export function cityById(id: string): CityPin | undefined {
  return CITIES.find((c) => c.id === id);
}

/** Local-time helper : given a UTC Date and a city, return "HH:MM" in the
 *  city's local zone. Uses Date's UTC methods so it stays cheap + DST-naive
 *  (we don't need wall-clock-perfect for the globe label; trading hours
 *  drift by ±1h is acceptable for a visual marker). */
export function cityLocalTime(city: CityPin, now: Date = new Date()): string {
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const localMin = (utcMin + city.utcOffset * 60 + 24 * 60) % (24 * 60);
  const h = Math.floor(localMin / 60);
  const m = localMin % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

/** Compute the L1 / L2 / L3 depth-key for a city's marker visual. Returns
 *  the SVG circle radius + ring count per RFC §5.1. */
export function markerVisual(level: CityLevel): { radius: number; rings: number } {
  switch (level) {
    case 'L1': return { radius: 3, rings: 0 };
    case 'L2': return { radius: 5, rings: 1 };
    case 'L3': return { radius: 7, rings: 2 };
  }
}