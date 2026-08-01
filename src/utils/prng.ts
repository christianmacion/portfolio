/**
 * prng.ts — deterministic PRNG fixture generator.
 *
 * Standing Order §9 forbids `Math.random()`, `Date.now()`, and argless
 * `new Date()` in deterministic outputs. This module exposes a single
 * stable PRNG seeded from a string (e.g. `seedFromString(BUILD_DATE)`)
 * so the rest of the system can compose deterministic but build-stamped
 * "live-feel" data — order books, probability walks, ticker tape, equity
 * curves — without violating the standing order.
 *
 * Algorithm: mulberry32 (a 32-bit single-state generator). Passes the
 * BigCrush-ish sanity tests, period 2^32, single-line advance; sufficient
 * for portfolio fixtures. If a higher-quality generator is needed,
 * upgrade path is to swap to sfc32 or xoshiro128** while keeping the
 * `seedFromString(str) -> () => number` interface intact — call sites
 * don't change.
 *
 * Usage:
 *   import { seedFromString } from '@utils/prng';
 *   const rand = seedFromString('2026-07-11');
 *   const u = rand();            // uniform [0, 1)
 *   const n = rand() * 2 - 1;    // remap to [-1, 1)
 *
 *   // Box-Muller normal sample (mean 0, stdev 1), reproducible:
 *   const u1 = rand();
 *   const u2 = rand();
 *   const z  = Math.sqrt(-2 * Math.log(u1 || 1e-12)) * Math.cos(2 * Math.PI * u2);
 *
 * See `notes/v61-patterns.md` Pattern 1 for the design rationale.
 */

/**
 * Seed a string into a uniform-PRNG closure using FNV-1a to derive the
 * initial 32-bit state from the input characters, then advance the
 * state through one round of mulberry32 to mix.
 *
 * The exposed closure returns one uniform float in [0, 1) per call.
 * Two closures seeded with the same string produce an identical
 * sequence of outputs (verified by hand for 2026-07-11 and 2026-07-12).
 */
/**
 * FNV-1a 32-bit hash of a string, returned as an 8-character lowercase
 * hex string. Deterministic across runtimes — same input always
 * produces the same output. Used to derive stable element IDs from
 * prop signatures so component frontmatter can stay SSR/hydration
 * parity-safe (Standing Order §9 — no Math.random / Date.now in
 * deterministic outputs).
 */
export function fnv1a(str: string): string {
  let state = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    state ^= str.charCodeAt(i);
    state = Math.imul(state, 0x01000193) >>> 0;
  }
  return state.toString(16).padStart(8, '0');
}

export function seedFromString(str: string): () => number {
  // FNV-1a 32-bit hash; deterministic and stable across runtimes.
  let state = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    state ^= str.charCodeAt(i);
    state = Math.imul(state, 0x01000193) >>> 0;
  }
  // Mix once so the seed can't be all-zeros (mulberry32's bad state).
  state = (state + 0x6d2b79f5) >>> 0;

  // mulberry32 — see https://stackoverflow.com/a/47593316
  function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return next;
}

/**
 * Sample a standard normal N(0, 1) by composing two uniforms through
 * Box-Muller. Consumes two PRNG calls per sample. For deterministic
 * fixtures this is fine — pre-compute at build time.
 *
 * Kept as a 1-arg overload for backwards compat with callers that
 * compose `gauss(rand)` and then scale/shift themselves.
 */
export function gauss(rand: () => number): number;
/**
 * Sample a normal N(mu, sigma). Convenience overload used by `walk()`
 * and other direct consumers; takes two args.
 */
export function gauss(rand: () => number, mu: number, sigma: number): number;
export function gauss(rand: () => number, mu = 0, sigma = 1): number {
  const u1 = rand();
  const u2 = rand();
  // Guard u1 == 0 (log blows up). Probability 1 in 2^32.
  const z = Math.sqrt(-2 * Math.log(u1 || 1e-12)) * Math.cos(2 * Math.PI * u2);
  return mu + sigma * z;
}

/**
 * Generate a Gaussian random walk of length `n` starting at `base`,
 * each step a fresh `gauss(0, sigma)`. Used by OrderBook fixtures
 * (midPx drift across the build date), index-stats row on /markets,
 * and any place we need a stable "what would the series look like today"
 * baseline.
 */
export function walk(rng: () => number, base: number, sigma: number, n: number): number[] {
  const out = new Array<number>(n);
  out[0] = base;
  for (let i = 1; i < n; i++) {
    out[i] = out[i - 1] + gauss(rng, 0, sigma);
  }
  return out;
}

/**
 * Format a price as `$1,234.56` (default 2 decimals). Pass `decimals: 4`
 * for FX or BTC. Always uses comma thousands separators. Non-finite
 * inputs return the em-dash so missing values render as a single gap
 * rather than `NaN` or `Infinity`.
 */
export function formatPx(px: number, decimals = 2): string {
  if (!Number.isFinite(px)) return '—';
  const sign = px < 0 ? '-' : '';
  const abs = Math.abs(px);
  const fixed = abs.toFixed(decimals);
  const [whole, frac] = fixed.split('.');
  // Insert commas every 3 digits from the right.
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${sign}$${grouped}.${frac}` : `${sign}$${grouped}`;
}

/**
 * Format a percentage as `+0.42%` or `-0.18%`. Always includes the sign
 * (positive gets a leading `+`, negative uses the native `-`). Used by
 * MarketTape, StatCell delta column, and order-book delta.
 */
export function formatPct(pct: number): string {
  if (!Number.isFinite(pct)) return '—';
  const sign = pct > 0 ? '+' : pct < 0 ? '' : ' ';
  return `${sign}${pct.toFixed(2)}%`;
}

/**
 * Resolve the build seed.
 *
 * Reads `import.meta.env.BUILD_DATE` (Astro) first, then `process.env.BUILD_DATE`
 * (Node CLI like tsx), then to a stable fallback string so dev previews
 * still produce a deterministic series. The returned string is what you
 * pass into `seedFromString(...)`.
 */
export function buildSeed(): string {
  // Astro exposes env vars via `import.meta.env` and (when astro:env is
  // not configured) also on `process.env`. Try both; the fallback is the
  // canonical build-stamp date so dev previews are stable across reloads.
  const fromMeta =
    typeof import.meta !== 'undefined' &&
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.BUILD_DATE;
  const fromProc = typeof process !== 'undefined' ? process.env?.BUILD_DATE : undefined;
  return (fromMeta || fromProc || '2026-07-10T00:00:00Z') as string;
}

// v6.10.28 — `driftWalk` removed (knip reported unused; only referenced
// in this file's doc comment).
