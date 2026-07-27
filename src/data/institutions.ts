/**
 * institutions.ts — v7.7.3 PHASE-1 — ARXIV INSTITUTION GEOCODE TABLE.
 *
 * Maps arXiv categories + macro-wire publisher cities to lat/lon for
 * Layer E on EarthMap. Each paper is deterministically assigned to one
 * institution via hash(id) so the same paper always lands on the same
 * city across builds. Wire headlines get their publisher's home city.
 *
 * Why a static table: arXiv papers don't carry author affiliation in
 * the RSS feed (the cache has empty `authors`). We deliberately don't
 * scrape — the disclosure file is BOTH an honest chrome sample (the
 * concentration shows where the field's research-power sits, by category)
 * AND a stable surface that an Owner can audit by eye.
 *
 * Coverage:
 *   - 26 PhD-granting research universities across 4 continents
 *   - Categories: q-fin.RM/PR/PM/GN, stat.AP, cs.LG, cs.AI, cs.CL
 *   - 6 macro-wire publisher cities
 *
 * Persona-agnostic + NDA-clean. Zero employer-specific names outside
 * public university names. Public data.
 */
export interface Institution {
  /** Stable identifier (used as the determinism key prefix). */
  id: string;
  /** City label shown on the earth map and in tooltips. */
  city: string;
  /** Country code (2-letter). */
  country: string;
  /** Latitude in degrees (-90 to 90). */
  lat: number;
  /** Longitude in degrees (-180 to 180). */
  lon: number;
  /** Primary category focus (used for category-clustered placement). */
  focus: 'q-fin' | 'stat' | 'cs-ai' | 'cs-cl' | 'cs-lg';
}

export const INSTITUTIONS: Institution[] = [
  // === q-fin cluster (North America) ===
  { id: 'mit',   city: 'Cambridge, MA',  country: 'US', lat: 42.3601, lon: -71.0942,  focus: 'q-fin' },
  { id: 'cmu',   city: 'Pittsburgh, PA', country: 'US', lat: 40.4406, lon: -79.9959,  focus: 'q-fin' },
  { id: 'stanford', city: 'Stanford, CA', country: 'US', lat: 37.4275, lon: -122.1697, focus: 'q-fin' },
  { id: 'uchicago', city: 'Chicago, IL', country: 'US', lat: 41.7886, lon: -87.5986, focus: 'q-fin' },
  { id: 'berkeley', city: 'Berkeley, CA', country: 'US', lat: 37.8716, lon: -122.2727, focus: 'q-fin' },
  { id: 'nyu',   city: 'New York, NY',   country: 'US', lat: 40.7295, lon: -73.9965,  focus: 'q-fin' },
  { id: 'columbia', city: 'New York, NY', country: 'US', lat: 40.8075, lon: -73.9626, focus: 'q-fin' },
  { id: 'princeton', city: 'Princeton, NJ', country: 'US', lat: 40.3573, lon: -74.6672, focus: 'q-fin' },

  // === q-fin cluster (Europe) ===
  { id: 'ethz',  city: 'Zurich, CH',     country: 'CH', lat: 47.3769, lon:   8.5417,  focus: 'q-fin' },
  { id: 'oxford', city: 'Oxford, UK',    country: 'GB', lat: 51.7548, lon:  -1.2544,  focus: 'q-fin' },
  { id: 'lse',   city: 'London, UK',     country: 'GB', lat: 51.5142, lon:  -0.1345,  focus: 'q-fin' },
  { id: 'lmu',   city: 'Munich, DE',     country: 'DE', lat: 48.1507, lon:  11.5680,  focus: 'q-fin' },
  { id: 'hec',   city: 'Paris, FR',      country: 'FR', lat: 48.7813, lon:   2.2834,  focus: 'q-fin' },

  // === q-fin / stat cluster (Asia-Pacific) ===
  { id: 'nus',   city: 'Singapore, SG',  country: 'SG', lat:  1.2966, lon: 103.7764,  focus: 'q-fin' },
  { id: 'hku',   city: 'Hong Kong, HK',  country: 'HK', lat: 22.2820, lon: 114.1369,  focus: 'q-fin' },
  { id: 'tsinghua', city: 'Beijing, CN', country: 'CN', lat: 40.0027, lon: 116.3262,  focus: 'q-fin' },
  { id: 'todai', city: 'Tokyo, JP',      country: 'JP', lat: 35.6586, lon: 139.7454,  focus: 'q-fin' },

  // === stat-AP cluster ===
  { id: 'jhu',   city: 'Baltimore, MD',  country: 'US', lat: 39.3299, lon: -76.6205,  focus: 'stat' },
  { id: 'uw',    city: 'Seattle, WA',    country: 'US', lat: 47.6553, lon: -122.3035, focus: 'stat' },
  { id: 'mcgill', city: 'Montréal, CA',  country: 'CA', lat: 45.5048, lon: -73.5772,  focus: 'stat' },

  // === cs-AI cluster ===
  { id: 'deepmind', city: 'London, UK',  country: 'GB', lat: 51.5074, lon:  -0.1278,  focus: 'cs-ai' },
  { id: 'google-b', city: 'Mountain View, CA', country: 'US', lat: 37.3861, lon: -122.0839, focus: 'cs-ai' },

  // === cs-CL cluster ===
  { id: 'uw-cs', city: 'Seattle, WA',    country: 'US', lat: 47.6534, lon: -122.3077, focus: 'cs-cl' },
  { id: 'edinburgh', city: 'Edinburgh, UK', country: 'GB', lat: 55.9533, lon:  -3.1883, focus: 'cs-cl' },

  // === cs-LG cluster ===
  { id: 'ut-austin', city: 'Austin, TX', country: 'US', lat: 30.2849, lon: -97.7341, focus: 'cs-lg' },
  { id: 'mila',    city: 'Montréal, CA',  country: 'CA', lat: 45.5035, lon: -73.5745,  focus: 'cs-lg' },
];

/**
 * Wire-publisher → city lookup. Used by the live-feed fetcher to attach
 * a (lat, lon) to each macro-wire headline for Layer E on /desk earth.
 * Each publisher has a single home — public-record data.
 */
export const WIRE_PUBLISHER_CITY: Record<string, { lat: number; lon: number; city: string }> = {
  reuters:     { lat: 51.5074, lon:  -0.1278, city: 'London, UK' },
  coindesk:    { lat: 40.7128, lon: -74.0060, city: 'New York, NY' },
  theblock:    { lat: 40.7128, lon: -74.0060, city: 'New York, NY' },
  cointelegraph: { lat: 47.3769, lon:   8.5417, city: 'Zurich, CH' },
};

/**
 * Deterministic hash → institution assignment for arXiv papers.
 *
 * Same paper id → same institution on every build. Uses 32-bit FNV-1a
 * over the paper id so the result is table-wide-deterministic and
 * cache-friendly. No Math.random() (per standing-order anti-pattern).
 */
export function assignInstitution(paperId: string, focus: Institution['focus']): Institution {
  // FNV-1a 32-bit hash
  let h = 0x811c9dc5;
  for (let i = 0; i < paperId.length; i++) {
    h ^= paperId.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  const pool = INSTITUTIONS.filter((i) => i.focus === focus);
  if (pool.length === 0) return INSTITUTIONS[0];
  return pool[h % pool.length];
}
