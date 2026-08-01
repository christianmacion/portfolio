/**
 * markets-data.test.ts — single source of truth for index snap quotes.
 *
 * Critical contract: every consumer of `getIndexSnap('SPX')` in the same
 * build gets the SAME numbers (deterministic). Different builds get
 * fresh numbers but the same internal consistency. This fix closed a
 * v6.11.12 bug where /markets tape and stat cards disagreed on price.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getIndexSnap, INDEX_SEEDS } from '@utils/markets-data';

describe('INDEX_SEEDS — registry', () => {
  it('contains 7 headline instruments', () => {
    expect(INDEX_SEEDS).toHaveLength(7);
  });

  it('every seed has the canonical shape', () => {
    for (const s of INDEX_SEEDS) {
      expect(typeof s.sym).toBe('string');
      expect(typeof s.base).toBe('number');
      expect(typeof s.sigma).toBe('number');
      expect(typeof s.decimals).toBe('number');
      expect(['idx', 'pts', 'usd', 'oz']).toContain(s.volUnit);
    }
  });

  it('symbols are unique', () => {
    const syms = INDEX_SEEDS.map((s) => s.sym);
    expect(new Set(syms).size).toBe(syms.length);
  });
});

describe('getIndexSnap', () => {
  let prev: string | undefined;

  beforeEach(() => {
    prev = process.env.BUILD_DATE;
    process.env.BUILD_DATE = '2026-08-01T00:00:00Z';
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.BUILD_DATE;
    else process.env.BUILD_DATE = prev;
  });

  it('returns null for an unknown symbol', () => {
    expect(getIndexSnap('UNKNOWN')).toBeNull();
  });

  it('returns the canonical snap for SPX', () => {
    const snap = getIndexSnap('SPX');
    expect(snap).not.toBeNull();
    expect(snap!.sym).toBe('SPX');
    expect(snap!.px).toBeGreaterThan(0);
    expect(snap!.deltaStr).toMatch(/^[+-]?\d+\.\d+%/);
    expect(snap!.pxStr).toMatch(/^\$[\d,]+\.\d+$/);
    expect(snap!.spark.length).toBe(30);
  });

  it('is deterministic within a build (same BUILD_DATE → same px)', () => {
    const a = getIndexSnap('SPX');
    const b = getIndexSnap('SPX');
    expect(a!.px).toBe(b!.px);
    expect(a!.deltaPct).toBe(b!.deltaPct);
    expect(a!.spark).toEqual(b!.spark);
  });

  it('all 7 symbols return a snap', () => {
    for (const seed of INDEX_SEEDS) {
      const snap = getIndexSnap(seed.sym);
      expect(snap, `${seed.sym} returned null`).not.toBeNull();
      expect(snap!.label).toBeTruthy();
    }
  });

  it('sparkline is the tail of a longer walk (length = 30)', () => {
    const snap = getIndexSnap('BTC-USD');
    expect(snap!.spark).toHaveLength(30);
    // All spark points are finite
    for (const v of snap!.spark) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('formatting respects per-symbol decimals (BTC=0, FX=2)', () => {
    const btc = getIndexSnap('BTC-USD');
    const spx = getIndexSnap('SPX');
    // BTC has decimals=0 → no fractional part
    expect(btc!.pxStr).not.toMatch(/\.\d/);
    // SPX has decimals=2 → 2 fractional digits
    expect(spx!.pxStr).toMatch(/\.\d{2}$/);
  });
});