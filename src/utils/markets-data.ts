/**
 * markets-data.ts : shared index-seed data for /markets/ chrome.
 *
 * v6.11.12 : Before this file existed, the MarketTape and the four
 * StatCell cards (S&P / DXY / VIX / BTC-USD) on /markets/ each generated
 * their own PRNG walk from the same `base` but with DIFFERENT seeds,
 * sigmas, and walk lengths. That produced visible price disagreement:
 * the tape showed SPX at $5,947.55 while the stat card showed $5,804.62
 * for the same instrument on the same page. Recruiters noticed.
 *
 * This module is the SINGLE source of truth: every consumer of index
 * prices on /markets/ (and the home-page tape if it ever wants to
 * mirror them) calls `getIndexSnap(symbol)` and gets the same
 * {px, deltaPct, spark} for that build. The walk is shared across all
 * consumers because all consumers go through this function.
 *
 * Standing Order §9 : no Math.random / Date.now / argless Date anywhere.
 * Seed comes from build-stamp.ts -> buildSeed() (which reads
 * BUILD_DATE env var). Same build → same numbers. Next build → fresh.
 *
 * Consumer migration:
 *   - MarketTape.astro: replaces its inline `indexSeeds` walk loop
 *   - pages/markets.astro: replaces its inline `indexCards.map(...)`
 *     walk loop
 *
 * Both consumers then render identical prices for SPX / NDX / DJI /
 * DXY / VIX / BTC-USD / GOLD. Strategy tape entries (01·DEFLATED etc.)
 * are unaffected : they live in MarketTape.stratSeeds.
 */
import { seedFromString, walk, formatPx, buildSeed } from '@utils/prng';

export interface IndexSeed {
  sym: string;
  base: number;
  sigma: number;
  decimals: number;
  volUnit: string;
  /** display label (e.g. "S&P 500", "Dollar Index"). */
  label: string;
  /** sub-label under the value (e.g. "volatility · CBOE"). */
  sub: string;
}

/**
 * Seven headline market indicators : real instrument names, public-domain
 * data shape. Vol columns are illustrative (e.g., VIX in points, BTC in
 * USD). Base prices are illustrative "session" levels that read as
 * plausible 2026 values, NOT live quotes. The whole point of the
 * deterministic seed is that "today's tape" is reproducible.
 */
export const INDEX_SEEDS: readonly IndexSeed[] = [
  {
    sym: 'SPX',
    base: 5872,
    sigma: 8.0,
    decimals: 2,
    volUnit: 'idx',
    label: 'S&P 500',
    sub: 'equity · large-cap',
  },
  {
    sym: 'NDX',
    base: 20610,
    sigma: 28,
    decimals: 2,
    volUnit: 'idx',
    label: 'Nasdaq-100',
    sub: 'equity · tech',
  },
  {
    sym: 'DJI',
    base: 42340,
    sigma: 65,
    decimals: 2,
    volUnit: 'idx',
    label: 'Dow Jones',
    sub: 'equity · blue-chip',
  },
  {
    sym: 'DXY',
    base: 104.21,
    sigma: 0.08,
    decimals: 2,
    volUnit: 'idx',
    label: 'Dollar Index',
    sub: 'DXY basket · ICE',
  },
  {
    sym: 'VIX',
    base: 14.6,
    sigma: 0.32,
    decimals: 2,
    volUnit: 'pts',
    label: 'CBOE VIX',
    sub: 'volatility · CBOE',
  },
  {
    sym: 'BTC-USD',
    base: 96480,
    sigma: 320,
    decimals: 0,
    volUnit: 'usd',
    label: 'BTC-USD',
    sub: 'CME futures · spot',
  },
  {
    sym: 'GOLD',
    base: 3312,
    sigma: 4.8,
    decimals: 2,
    volUnit: 'oz',
    label: 'Gold spot',
    sub: 'CME futures · spot',
  },
] as const;

const TAPE_WALK_LEN = 80;
const STATS_WALK_LEN = 30;

export interface IndexSnap {
  sym: string;
  px: number;
  deltaPct: number;
  /** short price string with thousands sep + dollar sign. */
  pxStr: string;
  /** formatted delta string with leading sign and 2 decimals. */
  deltaStr: string;
  /** whole series for sparkline (length = STATS_WALK_LEN). */
  spark: number[];
  /** sigma-vol label (e.g. "idx", "pts", "usd"). */
  volUnit: string;
  /** display label. */
  label: string;
  /** sub-label. */
  sub: string;
  /** decimals used in pxStr. */
  decimals: number;
}

/**
 * Get the canonical price + delta + sparkline for a given index symbol.
 * All consumers calling `getIndexSnap('SPX')` in the same build get the
 * SAME numbers. Different builds (different BUILD_DATE) get fresh
 * numbers but the same internal consistency.
 *
 * Implementation note: the tape walk is 80 ticks (longer history for
 * the scrolling tape to feel like a session). The sparkline on stat
 * cards uses the LAST 30 ticks of that walk so the cards + tape
 * always agree on the current px (the value that matters to a
 * recruiter scanning the page).
 */
const tapeSeriesCache = new Map<string, number[]>();

function getTapeSeries(seedKey: string, base: number, sigma: number): number[] {
  const cacheKey = `${seedKey}::${base}::${sigma}`;
  let series = tapeSeriesCache.get(cacheKey);
  if (!series) {
    const rng = seedFromString(buildSeed() + '::' + seedKey);
    series = walk(rng, base, sigma, TAPE_WALK_LEN);
    tapeSeriesCache.set(cacheKey, series);
  }
  return series;
}

export function getIndexSnap(sym: string): IndexSnap | null {
  const seed = INDEX_SEEDS.find((s) => s.sym === sym);
  if (!seed) return null;

  const series = getTapeSeries('markets-index', seed.base, seed.sigma);
  const last = series[series.length - 1];
  const mean = series.reduce((a, b) => a + b, 0) / series.length;
  const deltaPct = +(((last - mean) / mean) * 100).toFixed(2);
  const px = +last.toFixed(seed.decimals);
  // Tail 30 ticks for the sparkline card. Same series → guaranteed
  // to end at `last` so the chip "now" matches the sparkline terminal.
  const spark = series.slice(-STATS_WALK_LEN);

  return {
    sym: seed.sym,
    px,
    deltaPct,
    pxStr: formatPx(px, seed.decimals),
    deltaStr: deltaPct > 0 ? `+${deltaPct.toFixed(2)}%` : `${deltaPct.toFixed(2)}%`,
    spark,
    volUnit: seed.volUnit,
    label: seed.label,
    sub: seed.sub,
    decimals: seed.decimals,
  };
}
