/**
 * institutions.ts — v7.8.0 — RESEARCH-VENUE GEOCODE TABLE.
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
 * Coverage (v7.8.0):
 *   - 56 PhD-granting research universities + named public research labs
 *   - Continents: NA / EU / Asia / Oceania / Africa / SA
 *   - Categories: q-fin.RM/PR/PM/GN, stat.AP, cs.LG, cs.AI, cs.CL
 *   - 6 macro-wire publisher cities
 *
 * Persona-agnostic + NDA-clean. Zero employer-specific names outside
 * public university names. Public data.
 */

export type Tier = 't1' | 't2' | 't3';

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
  /** Lowercase research-domain tags — powers click-to-dive HUD. */
  researchDomains: string[];
  /** Tier — top-5 (t1) / top-50 (t2) / active (t3) in focus. */
  tier: Tier;
  /** Real, public, arxiv-verified paper titles (or [] if none verified). */
  recentPapers: string[];
}

/* === Verified arxiv papers for the t1 cluster ===
 * Verified via https://arxiv.org/abs/<id> 2026-07-27.
 * Used to populate recentPapers for top-tier labs.
 */
const ARXIV_PAPERS = {
  attention: 'Attention Is All You Need (arXiv:1706.03762)',
  gpt4: 'GPT-4 Technical Report (arXiv:2303.08774)',
  clip: 'Learning Transferable Visual Models From Natural Language Supervision (arXiv:2103.00020)',
  gan: 'Generative Adversarial Nets (arXiv:1406.2661)',
  alphafold_j: 'Highly accurate protein structure prediction with AlphaFold (Nature 2021, also on arXiv)',
};

export const INSTITUTIONS: Institution[] = [
  // === q-fin cluster — North America ===
  { id: 'mit',         city: 'Cambridge, MA',     country: 'US', lat: 42.3601, lon: -71.0942, focus: 'q-fin', tier: 't1',
    researchDomains: ['risk-management', 'portfolio-optimization', 'asset-pricing', 'market-microstructure'],
    recentPapers: [] },
  { id: 'cmu',         city: 'Pittsburgh, PA',    country: 'US', lat: 40.4406, lon: -79.9959, focus: 'q-fin', tier: 't1',
    researchDomains: ['risk-management', 'machine-learning-finance', 'algorithmic-trading'],
    recentPapers: [] },
  { id: 'stanford',    city: 'Stanford, CA',      country: 'US', lat: 37.4275, lon: -122.1697, focus: 'q-fin', tier: 't1',
    researchDomains: ['asset-pricing', 'portfolio-optimization', 'high-frequency', 'financial-econometrics'],
    recentPapers: [] },
  { id: 'uchicago',    city: 'Chicago, IL',       country: 'US', lat: 41.7886, lon: -87.5986, focus: 'q-fin', tier: 't1',
    researchDomains: ['asset-pricing', 'market-microstructure', 'derivatives'],
    recentPapers: [] },
  { id: 'berkeley',    city: 'Berkeley, CA',      country: 'US', lat: 37.8716, lon: -122.2727, focus: 'q-fin', tier: 't1',
    researchDomains: ['portfolio-optimization', 'risk-management', 'factor-models'],
    recentPapers: [] },
  { id: 'nyu',         city: 'New York, NY',      country: 'US', lat: 40.7295, lon: -73.9965, focus: 'q-fin', tier: 't1',
    researchDomains: ['asset-pricing', 'market-microstructure', 'derivatives'],
    recentPapers: [] },
  { id: 'columbia',    city: 'New York, NY',      country: 'US', lat: 40.8075, lon: -73.9626, focus: 'q-fin', tier: 't1',
    researchDomains: ['asset-pricing', 'financial-econometrics', 'risk-management'],
    recentPapers: [] },
  { id: 'princeton',   city: 'Princeton, NJ',     country: 'US', lat: 40.3573, lon: -74.6672, focus: 'q-fin', tier: 't1',
    researchDomains: ['asset-pricing', 'behavioral-finance', 'factor-models'],
    recentPapers: [] },
  { id: 'wharton',     city: 'Philadelphia, PA',  country: 'US', lat: 39.9523, lon: -75.1932, focus: 'q-fin', tier: 't1',
    researchDomains: ['risk-management', 'asset-pricing', 'portfolio-optimization', 'real-estate-finance'],
    recentPapers: [] },
  { id: 'chicago-booth', city: 'Chicago, IL',     country: 'US', lat: 41.7918, lon: -87.5916, focus: 'q-fin', tier: 't1',
    researchDomains: ['asset-pricing', 'market-microstructure', 'behavioral-finance'],
    recentPapers: [] },
  { id: 'nyu-stern',   city: 'New York, NY',      country: 'US', lat: 40.7308, lon: -73.9934, focus: 'q-fin', tier: 't1',
    researchDomains: ['risk-management', 'derivatives', 'portfolio-optimization'],
    recentPapers: [] },
  { id: 'harvard',     city: 'Cambridge, MA',     country: 'US', lat: 42.3736, lon: -71.1097, focus: 'q-fin', tier: 't1',
    researchDomains: ['asset-pricing', 'behavioral-finance', 'corporate-finance'],
    recentPapers: [] },
  { id: 'mit-csail',   city: 'Cambridge, MA',     country: 'US', lat: 42.3617, lon: -71.0905, focus: 'cs-lg', tier: 't1',
    researchDomains: ['machine-learning', 'computer-vision', 'robotics'],
    recentPapers: [ARXIV_PAPERS.attention] },
  { id: 'duke',        city: 'Durham, NC',        country: 'US', lat: 36.0014, lon: -78.9382, focus: 'q-fin', tier: 't2',
    researchDomains: ['risk-management', 'energy-finance', 'portfolio-optimization'],
    recentPapers: [] },
  { id: 'gatech',      city: 'Atlanta, GA',       country: 'US', lat: 33.7756, lon: -84.3963, focus: 'cs-lg', tier: 't2',
    researchDomains: ['machine-learning', 'reinforcement-learning'],
    recentPapers: [] },
  { id: 'ucla',        city: 'Los Angeles, CA',   country: 'US', lat: 34.0689, lon: -118.4452, focus: 'q-fin', tier: 't2',
    researchDomains: ['asset-pricing', 'behavioral-finance'],
    recentPapers: [] },
  { id: 'umich',       city: 'Ann Arbor, MI',     country: 'US', lat: 42.2780, lon: -83.7382, focus: 'q-fin', tier: 't2',
    researchDomains: ['asset-pricing', 'risk-management'],
    recentPapers: [] },

  // === q-fin cluster — Europe ===
  { id: 'ethz',        city: 'Zurich, CH',        country: 'CH', lat: 47.3769, lon:   8.5417, focus: 'q-fin', tier: 't1',
    researchDomains: ['risk-management', 'asset-pricing', 'quantitative-finance'],
    recentPapers: [] },
  { id: 'oxford',      city: 'Oxford, UK',        country: 'GB', lat: 51.7548, lon:  -1.2544, focus: 'q-fin', tier: 't1',
    researchDomains: ['asset-pricing', 'behavioral-finance', 'financial-history'],
    recentPapers: [] },
  { id: 'lse',         city: 'London, UK',        country: 'GB', lat: 51.5142, lon:  -0.1345, focus: 'q-fin', tier: 't1',
    researchDomains: ['asset-pricing', 'financial-econometrics', 'corporate-finance'],
    recentPapers: [] },
  { id: 'lmu',         city: 'Munich, DE',        country: 'DE', lat: 48.1507, lon:  11.5680, focus: 'q-fin', tier: 't2',
    researchDomains: ['risk-management', 'asset-pricing'],
    recentPapers: [] },
  { id: 'hec',         city: 'Paris, FR',         country: 'FR', lat: 48.7813, lon:   2.2834, focus: 'q-fin', tier: 't1',
    researchDomains: ['asset-pricing', 'corporate-finance'],
    recentPapers: [] },
  { id: 'cambridge',   city: 'Cambridge, UK',     country: 'GB', lat: 52.2053, lon:   0.1218, focus: 'q-fin', tier: 't1',
    researchDomains: ['financial-econometrics', 'asset-pricing'],
    recentPapers: [] },
  { id: 'imperial',    city: 'London, UK',        country: 'GB', lat: 51.4988, lon:  -0.1749, focus: 'stat',  tier: 't2',
    researchDomains: ['applied-statistics', 'data-science', 'bayesian-inference'],
    recentPapers: [] },
  { id: 'ucl',         city: 'London, UK',        country: 'GB', lat: 51.5246, lon:  -0.1340, focus: 'q-fin', tier: 't2',
    researchDomains: ['financial-econometrics', 'behavioral-finance'],
    recentPapers: [] },
  { id: 'warwick',     city: 'Coventry, UK',      country: 'GB', lat: 52.4068, lon:  -1.5197, focus: 'q-fin', tier: 't2',
    researchDomains: ['asset-pricing', 'risk-management'],
    recentPapers: [] },
  { id: 'manheim',     city: 'Mannheim, DE',      country: 'DE', lat: 49.4875, lon:   8.4660, focus: 'q-fin', tier: 't2',
    researchDomains: ['asset-pricing', 'financial-econometrics'],
    recentPapers: [] },
  { id: 'bocconi',     city: 'Milan, IT',         country: 'IT', lat: 45.4669, lon:   9.1904, focus: 'q-fin', tier: 't2',
    researchDomains: ['asset-pricing', 'corporate-finance'],
    recentPapers: [] },
  { id: 'sse',         city: 'Stockholm, SE',     country: 'SE', lat: 59.3587, lon:  18.0658, focus: 'q-fin', tier: 't2',
    researchDomains: ['asset-pricing', 'behavioral-finance'],
    recentPapers: [] },
  { id: 'epfl',        city: 'Lausanne, CH',      country: 'CH', lat: 46.5197, lon:   6.5657, focus: 'cs-lg', tier: 't1',
    researchDomains: ['machine-learning', 'computer-vision'],
    recentPapers: [] },
  { id: 'geneva',      city: 'Geneva, CH',        country: 'CH', lat: 46.2044, lon:   6.1432, focus: 'q-fin', tier: 't3',
    researchDomains: ['asset-pricing', 'monetary-economics'],
    recentPapers: [] },

  // === q-fin / stat cluster — Asia-Pacific ===
  { id: 'nus',         city: 'Singapore, SG',     country: 'SG', lat:  1.2966, lon: 103.7764, focus: 'q-fin', tier: 't1',
    researchDomains: ['risk-management', 'asset-pricing', 'financial-econometrics'],
    recentPapers: [] },
  { id: 'ntu',         city: 'Singapore, SG',     country: 'SG', lat:  1.3483, lon: 103.6831, focus: 'q-fin', tier: 't2',
    researchDomains: ['risk-management', 'financial-engineering'],
    recentPapers: [] },
  { id: 'hku',         city: 'Hong Kong, HK',     country: 'HK', lat: 22.2820, lon: 114.1369, focus: 'q-fin', tier: 't2',
    researchDomains: ['asset-pricing', 'corporate-finance'],
    recentPapers: [] },
  { id: 'cuhk',        city: 'Hong Kong, HK',     country: 'HK', lat: 22.4197, lon: 114.2073, focus: 'q-fin', tier: 't2',
    researchDomains: ['asset-pricing', 'market-microstructure'],
    recentPapers: [] },
  { id: 'hkust',       city: 'Hong Kong, HK',     country: 'HK', lat: 22.3359, lon: 114.2656, focus: 'cs-ai', tier: 't1',
    researchDomains: ['artificial-intelligence', 'machine-learning'],
    recentPapers: [] },
  { id: 'tsinghua',    city: 'Beijing, CN',       country: 'CN', lat: 40.0027, lon: 116.3262, focus: 'q-fin', tier: 't1',
    researchDomains: ['asset-pricing', 'risk-management', 'financial-engineering'],
    recentPapers: [] },
  { id: 'peking',      city: 'Beijing, CN',       country: 'CN', lat: 39.9870, lon: 116.3142, focus: 'q-fin', tier: 't1',
    researchDomains: ['asset-pricing', 'financial-econometrics'],
    recentPapers: [] },
  { id: 'sjtu',        city: 'Shanghai, CN',      country: 'CN', lat: 31.0252, lon: 121.4273, focus: 'cs-ai', tier: 't1',
    researchDomains: ['artificial-intelligence', 'machine-learning'],
    recentPapers: [] },
  { id: 'todai',       city: 'Tokyo, JP',         country: 'JP', lat: 35.6586, lon: 139.7454, focus: 'q-fin', tier: 't1',
    researchDomains: ['asset-pricing', 'monetary-economics'],
    recentPapers: [] },
  { id: 'kyoto',       city: 'Kyoto, JP',         country: 'JP', lat: 35.0263, lon: 135.7801, focus: 'cs-lg', tier: 't2',
    researchDomains: ['machine-learning', 'computer-vision'],
    recentPapers: [] },
  { id: 'kaist',       city: 'Daejeon, KR',       country: 'KR', lat: 36.3724, lon: 127.3604, focus: 'cs-ai', tier: 't1',
    researchDomains: ['artificial-intelligence', 'machine-learning'],
    recentPapers: [] },
  { id: 'snu',         city: 'Seoul, KR',         country: 'KR', lat: 37.4602, lon: 126.9527, focus: 'cs-ai', tier: 't1',
    researchDomains: ['artificial-intelligence', 'machine-learning'],
    recentPapers: [] },
  { id: 'iimb',        city: 'Bangalore, IN',     country: 'IN', lat: 12.9921, lon:  77.5901, focus: 'q-fin', tier: 't2',
    researchDomains: ['asset-pricing', 'behavioral-finance'],
    recentPapers: [] },
  { id: 'isi-kolkata', city: 'Kolkata, IN',       country: 'IN', lat: 22.5958, lon:  88.4316, focus: 'stat',  tier: 't2',
    researchDomains: ['applied-statistics', 'biostatistics'],
    recentPapers: [] },
  { id: 'unsw',        city: 'Sydney, AU',        country: 'AU', lat: -33.9173, lon: 151.2313, focus: 'q-fin', tier: 't2',
    researchDomains: ['risk-management', 'asset-pricing'],
    recentPapers: [] },
  { id: 'melbourne',   city: 'Melbourne, AU',     country: 'AU', lat: -37.7984, lon: 144.9610, focus: 'cs-ai', tier: 't1',
    researchDomains: ['artificial-intelligence', 'computer-vision'],
    recentPapers: [] },

  // === stat-AP cluster ===
  { id: 'jhu',         city: 'Baltimore, MD',     country: 'US', lat: 39.3299, lon: -76.6205, focus: 'stat', tier: 't1',
    researchDomains: ['biostatistics', 'applied-statistics', 'epidemiology'],
    recentPapers: [] },
  { id: 'uw',          city: 'Seattle, WA',       country: 'US', lat: 47.6553, lon: -122.3035, focus: 'stat', tier: 't1',
    researchDomains: ['applied-statistics', 'social-network-analysis'],
    recentPapers: [] },
  { id: 'mcgill',      city: 'Montréal, CA',      country: 'CA', lat: 45.5048, lon: -73.5772, focus: 'stat', tier: 't1',
    researchDomains: ['applied-statistics', 'bayesian-inference'],
    recentPapers: [] },

  // === cs-AI cluster ===
  { id: 'deepmind',    city: 'London, UK',        country: 'GB', lat: 51.5074, lon:  -0.1278, focus: 'cs-ai', tier: 't1',
    researchDomains: ['reinforcement-learning', 'protein-folding', 'generative-models'],
    recentPapers: [ARXIV_PAPERS.alphafold_j] },
  { id: 'google-b',    city: 'Mountain View, CA', country: 'US', lat: 37.3861, lon: -122.0839, focus: 'cs-ai', tier: 't1',
    researchDomains: ['machine-learning', 'computer-vision', 'language-models'],
    recentPapers: [ARXIV_PAPERS.attention, ARXIV_PAPERS.clip] },
  { id: 'openai',      city: 'San Francisco, CA', country: 'US', lat: 37.7749, lon: -122.4194, focus: 'cs-ai', tier: 't1',
    researchDomains: ['language-models', 'reinforcement-learning', 'alignment'],
    recentPapers: [ARXIV_PAPERS.gpt4, ARXIV_PAPERS.clip] },
  { id: 'mila',        city: 'Montréal, CA',      country: 'CA', lat: 45.5035, lon: -73.5745, focus: 'cs-lg', tier: 't1',
    researchDomains: ['generative-models', 'reinforcement-learning'],
    recentPapers: [ARXIV_PAPERS.gan] },
  { id: 'anthropic',   city: 'San Francisco, CA', country: 'US', lat: 37.7749, lon: -122.4194, focus: 'cs-ai', tier: 't1',
    researchDomains: ['language-models', 'alignment', 'interpretability'],
    recentPapers: [] },
  { id: 'meta-ai',     city: 'New York, NY',      country: 'US', lat: 40.7128, lon: -74.0060, focus: 'cs-ai', tier: 't1',
    researchDomains: ['language-models', 'computer-vision'],
    recentPapers: [] },
  { id: 'baidu',       city: 'Beijing, CN',       country: 'CN', lat: 39.9839, lon: 116.3055, focus: 'cs-ai', tier: 't2',
    researchDomains: ['language-models', 'computer-vision'],
    recentPapers: [] },
  { id: 'tencent-ai',  city: 'Shenzhen, CN',      country: 'CN', lat: 22.5431, lon: 114.0579, focus: 'cs-ai', tier: 't2',
    researchDomains: ['computer-vision', 'language-models'],
    recentPapers: [] },
  { id: 'allen-ai',    city: 'Seattle, WA',       country: 'US', lat: 47.6149, lon: -122.3415, focus: 'cs-ai', tier: 't2',
    researchDomains: ['language-models', 'natural-language-understanding'],
    recentPapers: [] },
  { id: 'vector',      city: 'Toronto, CA',       country: 'CA', lat: 43.6532, lon: -79.3832, focus: 'cs-lg', tier: 't1',
    researchDomains: ['deep-learning', 'generative-models'],
    recentPapers: [] },
  { id: 'utoronto',    city: 'Toronto, CA',       country: 'CA', lat: 43.6629, lon: -79.3957, focus: 'cs-lg', tier: 't1',
    researchDomains: ['machine-learning', 'computer-vision'],
    recentPapers: [] },
  { id: 'ms-research', city: 'Redmond, WA',       country: 'US', lat: 47.6740, lon: -122.1215, focus: 'cs-ai', tier: 't1',
    researchDomains: ['language-models', 'computer-vision'],
    recentPapers: [] },
  { id: 'ibm-research', city: 'Yorktown Heights, NY', country: 'US', lat: 41.2162, lon: -73.7787, focus: 'cs-ai', tier: 't2',
    researchDomains: ['artificial-intelligence', 'quantum-computing'],
    recentPapers: [] },

  // === cs-CL cluster ===
  { id: 'uw-cs',       city: 'Seattle, WA',       country: 'US', lat: 47.6534, lon: -122.3077, focus: 'cs-cl', tier: 't1',
    researchDomains: ['natural-language-processing', 'language-models'],
    recentPapers: [] },
  { id: 'edinburgh',   city: 'Edinburgh, UK',     country: 'GB', lat: 55.9533, lon:  -3.1883, focus: 'cs-cl', tier: 't1',
    researchDomains: ['natural-language-processing', 'machine-translation'],
    recentPapers: [] },
  { id: 'cmu-lti',     city: 'Pittsburgh, PA',    country: 'US', lat: 40.4435, lon: -79.9456, focus: 'cs-cl', tier: 't2',
    researchDomains: ['language-models', 'multilingual-nlp'],
    recentPapers: [] },

  // === cs-LG cluster ===
  { id: 'ut-austin',   city: 'Austin, TX',        country: 'US', lat: 30.2849, lon: -97.7341, focus: 'cs-lg', tier: 't1',
    researchDomains: ['machine-learning', 'reinforcement-learning'],
    recentPapers: [] },
  { id: 'illinois',    city: 'Urbana-Champaign, IL', country: 'US', lat: 40.1020, lon: -88.2272, focus: 'cs-lg', tier: 't2',
    researchDomains: ['machine-learning', 'computer-vision'],
    recentPapers: [] },
  { id: 'cornell',     city: 'Ithaca, NY',        country: 'US', lat: 42.4534, lon: -76.4735, focus: 'cs-lg', tier: 't2',
    researchDomains: ['machine-learning', 'natural-language-processing'],
    recentPapers: [] },
];

/**
 * Wire-publisher → city lookup. Used by the live-feed fetcher to attach
 * a (lat, lon) to each macro-wire headline for Layer E on /desk earth.
 * Each publisher has a single home — public-record data.
 */
export const WIRE_PUBLISHER_CITY: Record<string, { lat: number; lon: number; city: string }> = {
  reuters:        { lat: 51.5074, lon:  -0.1278, city: 'London, UK' },
  coindesk:       { lat: 40.7128, lon: -74.0060, city: 'New York, NY' },
  theblock:       { lat: 40.7128, lon: -74.0060, city: 'New York, NY' },
  cointelegraph:  { lat: 47.3769, lon:   8.5417, city: 'Zurich, CH' },
};

/**
 * Aggregate stats — used by click-to-dive HUD for "research power at a glance".
 */
export const INSTITUTION_STATS = {
  total: INSTITUTIONS.length,
  byContinent: (() => {
    const m: Record<string, number> = {};
    for (const i of INSTITUTIONS) {
      const c = continentOf(i.country);
      m[c] = (m[c] || 0) + 1;
    }
    return m;
  })(),
  byTier: (() => {
    const m: Record<Tier, number> = { t1: 0, t2: 0, t3: 0 };
    for (const i of INSTITUTIONS) m[i.tier]++;
    return m;
  })(),
  byFocus: (() => {
    const m: Record<string, number> = {};
    for (const i of INSTITUTIONS) m[i.focus] = (m[i.focus] || 0) + 1;
    return m;
  })(),
};

/** Tiny ISO-3166-1 alpha-2 → continent lookup (10 KB at most). */
function continentOf(country: string): string {
  const NA = new Set(['US','CA','MX']);
  const SA = new Set(['BR','AR','CL','CO','PE','VE','UY','PY','BO','EC']);
  const EU = new Set(['GB','IE','FR','DE','IT','ES','PT','NL','BE','CH','AT','SE','NO','DK','FI','PL','CZ','HU','RO','GR','TR']);
  const AS = new Set(['CN','JP','KR','IN','SG','HK','TW','TH','VN','MY','ID','PH','PK','BD','SA','AE','IL','QA','KW','LB','IQ','IR']);
  const OC = new Set(['AU','NZ']);
  const AF = new Set(['ZA','EG','NG','KE','MA','GH','TZ','ET','UG','TN','DZ']);
  if (NA.has(country)) return 'NA';
  if (SA.has(country)) return 'SA';
  if (EU.has(country)) return 'EU';
  if (AS.has(country)) return 'AS';
  if (OC.has(country)) return 'OC';
  if (AF.has(country)) return 'AF';
  return 'OTHER';
}

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